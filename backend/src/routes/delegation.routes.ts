import { Router } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { rateLimiter } from '../security';
import { prisma } from '../prisma';
import { CryptoUtils } from '../security/crypto';
import { twoFactorAuth } from '../security/twoFactorAuth';
import { auditLog } from '../security/auditLog';
import { notificationService } from '../services/notification.service';
import { listDelegations, inviteDelegate, respondToDelegation, endDelegation, readDelegatedAnalytics } from '../services/delegation.service';
export const delegationRoutes=Router();

delegationRoutes.get('/delegations',async(req:AuthRequest,res)=>{
  if(!req.user){res.status(401).json({error:'Unauthorized'});return;}
  try{res.set('Cache-Control','private, no-store');res.json(await listDelegations(req.user.userId));}catch{res.status(500).json({error:'Could not load delegations'});}
});
delegationRoutes.post('/delegations',rateLimiter.login2fa,async(req:AuthRequest,res)=>{
  if(!req.user){res.status(401).json({error:'Unauthorized'});return;}
  const username=typeof req.body?.username==='string'?req.body.username.trim().replace(/^@/,''):'';
  if(!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)){res.status(400).json({error:'Enter a valid username'});return;}
  const ownerId=req.user.userId;
  const password=req.body?.password,code=req.body?.code;
  if(typeof password!=='string'||!password||password.length>1024){res.status(400).json({error:'Enter your current VANTA password'});return;}
  try{
    const owner=await prisma.user.findUnique({where:{id:ownerId},select:{passwordHash:true,twoFactorEnabled:true,status:true,lockedUntil:true}});
    if(!owner?.passwordHash||owner.status!=='ACTIVE'||(owner.lockedUntil&&owner.lockedUntil>new Date())||!await CryptoUtils.verifyPassword(owner.passwordHash,password)){res.status(403).json({error:'Current password required to grant access'});return;}
    if(owner.twoFactorEnabled&&(typeof code!=='string'||!/^\d{6}$/.test(code)||!(await twoFactorAuth.verifyLogin(ownerId,code)).valid)){res.status(403).json({error:'Enter a fresh authenticator code'});return;}
    const result=await inviteDelegate(ownerId,username);
    if(result.created){
      await auditLog.log({userId:ownerId,action:'DELEGATION_INVITED',metadata:{grantId:result.grant.id,scope:result.grant.scope}});
      await notificationService.createNotification(result.grant.delegateId,'delegation_invite','Delegated access invitation','@'+result.grant.owner.username+' invited you to view their content analytics',{actorId:ownerId,entityType:'account_delegation',entityId:result.grant.id,referenceKey:'delegation:'+result.grant.id}).catch(()=>null);
    }
    res.status(200).json(result.grant);
  }catch{res.status(400).json({error:'Invitation unavailable or limit reached'});}
});
delegationRoutes.post('/delegations/:id/respond',async(req:AuthRequest,res)=>{
  if(!req.user){res.status(401).json({error:'Unauthorized'});return;}
  if(typeof req.body?.accept!=='boolean'){res.status(400).json({error:'Choose accept or decline'});return;}
  try{
    await respondToDelegation(req.user.userId,String(req.params.id),req.body.accept);
    await auditLog.log({userId:req.user.userId,action:req.body.accept?'DELEGATION_ACCEPTED':'DELEGATION_DECLINED',metadata:{grantId:String(req.params.id)}});
    res.json({message:'Invitation reviewed'});
  }catch{res.status(400).json({error:'Invitation expired or unavailable'});}
});
delegationRoutes.delete('/delegations/:id',async(req:AuthRequest,res)=>{
  if(!req.user){res.status(401).json({error:'Unauthorized'});return;}
  try{
    if(!await endDelegation(req.user.userId,String(req.params.id))){res.status(404).json({error:'Grant unavailable'});return;}
    await auditLog.log({userId:req.user.userId,action:'DELEGATION_REVOKED',metadata:{grantId:String(req.params.id)}});
    res.json({message:'Access ended'});
  }catch{res.status(500).json({error:'Could not end access'});}
});
delegationRoutes.get('/delegations/:id/analytics',async(req:AuthRequest,res)=>{
  if(!req.user){res.status(401).json({error:'Unauthorized'});return;}
  try{
    const stats=await readDelegatedAnalytics(req.user.userId,String(req.params.id));
    res.set('Cache-Control','private, no-store');res.json({stats});
  }catch{res.status(403).json({error:'Analytics unavailable or access ended'});}
});
