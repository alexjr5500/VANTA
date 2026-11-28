import { Response } from 'express';
import { AuthenticatedRequest } from '../security/authMiddleware';
import { prisma } from '../prisma';
import { auditLog } from '../security/auditLog';
import { cacheService } from '../services/cache.service';

export async function setContentSensitivity(req:AuthenticatedRequest,res:Response):Promise<void>{
  if(!req.user){res.status(401).json({error:'Unauthorized'});return;}
  const {targetType,targetId,sensitive,reason}=req.body||{};
  if(!['post','reel'].includes(targetType)||typeof targetId!=='string'||! /^[A-Za-z0-9_-]{1,200}$/.test(targetId)||typeof sensitive!=='boolean'||typeof reason!=='string'||!reason.trim()||reason.trim().length>500){res.status(400).json({error:'Valid content type, ID, label and reason required'});return;}
  try{
    const result=targetType==='post'?await prisma.post.updateMany({where:{id:targetId,moderationRemovedAt:null},data:{sensitiveContent:sensitive}}):await prisma.video.updateMany({where:{id:targetId,moderationRemovedAt:null,publishStatus:'PUBLISHED'},data:{sensitiveContent:sensitive}});
    if(result.count!==1){res.status(404).json({error:'Published content not found'});return;}
    await Promise.all(['feed:*','homefeed:*','trending:*','explore:*'].map(pattern=>cacheService.delPattern(pattern)));
    await auditLog.log({userId:req.user.userId,action:'CONTENT_SENSITIVITY_UPDATED',severity:'WARNING',metadata:{targetType,targetId,sensitive,reason:reason.trim()}});
    res.json({message:'Sensitive-content label updated'});
  }catch{res.status(500).json({error:'Could not update sensitivity label'});}
}
