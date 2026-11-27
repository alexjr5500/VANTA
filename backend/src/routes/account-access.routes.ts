import { Router } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { auditLog } from '../security/auditLog';
import { rateLimiter } from '../security';
import { CryptoUtils } from '../security/crypto';
import { twoFactorAuth } from '../security/twoFactorAuth';
import { prisma } from '../prisma';
import { buildAuthorizeRequest, OAUTH_PROVIDERS } from '../services/oauth.service';
import { getPendingProviderLink, confirmProviderLink } from '../services/provider-link.service';
import { connectedIdentities, trustedDeviceRecords, removeTrustedDeviceRecord } from '../services/account-access.service';

export const accountAccessRoutes = Router();
// Mounted only after the canonical authentication middleware.
accountAccessRoutes.get('/connected-accounts', async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try { res.set('Cache-Control', 'private, no-store'); res.json({ items: await connectedIdentities(userId) }); }
  catch { res.status(500).json({ error: 'Could not load connected accounts' }); }
});
accountAccessRoutes.get('/trusted-devices', async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try { res.set('Cache-Control', 'private, no-store'); res.json({ items: await trustedDeviceRecords(userId) }); }
  catch { res.status(500).json({ error: 'Could not load trusted devices' }); }
});
accountAccessRoutes.delete('/trusted-devices/:id', async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (!id) { res.status(400).json({ error: 'Device required' }); return; }
  try {
    if (!await removeTrustedDeviceRecord(userId, id)) { res.status(404).json({ error: 'Device not found' }); return; }
    await auditLog.log({ userId, action: 'TRUSTED_DEVICE_REMOVED', metadata: { id } });
    res.json({ message: 'Trusted-device record removed' });
  } catch { res.status(500).json({ error: 'Could not remove trusted device' }); }
});

 // Disconnect only after reauthentication. Require a working password
 // login method so an OAuth-only account cannot remove its only credential.
 accountAccessRoutes.post('/connected-accounts/:id/disconnect', rateLimiter.login2fa, async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  const currentSession = req.user?.sessionId;
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const password = req.body?.password;
  const code = req.body?.code;
  if (!userId || !currentSession) { res.status(401).json({error:'Unauthorized'}); return; }
  if (!id || typeof password !== 'string' || password.length > 1024) {res.status(400).json({error:'Enter your current VANTA password'});return;}
  try {
    const user = await prisma.user.findUnique({where:{id:userId},select:{passwordHash:true,twoFactorEnabled:true,emailVerified:true,status:true,lockedUntil:true}});
    if (!user?.passwordHash || user.status !== 'ACTIVE' || (user.lockedUntil && user.lockedUntil > new Date()) || !await CryptoUtils.verifyPassword(user.passwordHash,password)) {
      res.status(403).json({error:'A working VANTA password is required before disconnecting a sign-in method'});return;
    }
    if (!user.emailVerified) {res.status(403).json({error:'Verify your VANTA email before disconnecting a sign-in method'});return;}
    if (user.twoFactorEnabled && (typeof code !== 'string' || !/^\d{6}$/.test(code) || !(await twoFactorAuth.verifyLogin(userId,code)).valid)) {
      res.status(403).json({error:'Enter a fresh authenticator code'});return;
    }
    const removed = await prisma.$transaction(async tx => {
      // Re-check the credential state before the mutation; never accept a
      // password or 2FA decision made against an outdated configuration.
      const current = await tx.user.findUnique({where:{id:userId},select:{passwordHash:true,twoFactorEnabled:true,emailVerified:true,status:true}});
      if (!current || current.status !== 'ACTIVE' || !current.emailVerified || current.passwordHash !== user.passwordHash || current.twoFactorEnabled !== user.twoFactorEnabled) throw new Error('Credentials changed');
      const deleted = await tx.providerAccount.deleteMany({where:{id,userId}});
      if (deleted.count) await tx.session.deleteMany({where:{userId,id:{not:currentSession}}});
      return deleted.count;
    });
    if (!removed) {res.status(404).json({error:'Connected account not found'});return;}
    await auditLog.log({userId,action:'OAUTH_ACCOUNT_DISCONNECTED',metadata:{id}});
    res.json({message:'Account disconnected; other sessions revoked'});
  } catch {res.status(400).json({error:'Could not disconnect account safely. Try again.'});}
 });

accountAccessRoutes.post('/connected-accounts/link/start', rateLimiter.login2fa, async (req: AuthRequest,res) => {
  const userId=req.user?.userId, sessionId=req.user?.sessionId;
  const provider=OAUTH_PROVIDERS.find(value=>value===req.body?.provider);
  if(!userId||!sessionId){res.status(401).json({error:'Unauthorized'});return;}
  if(!provider){res.status(400).json({error:'Unsupported sign-in provider'});return;}
  try {
    const user=await prisma.user.findUnique({where:{id:userId},select:{passwordHash:true,emailVerified:true}});
    if(!user?.passwordHash||!user.emailVerified){res.status(403).json({error:'A verified email and VANTA password are required for linking'});return;}
    const result=await buildAuthorizeRequest(provider,'/settings/security/connected',userId,sessionId);
    res.set('Cache-Control','private, no-store');
    res.json({authorizeUrl:result.authorizeUrl});
  } catch {res.status(400).json({error:'This provider is unavailable. Try again later.'});}
});
accountAccessRoutes.get('/connected-accounts/link/:id',async(req:AuthRequest,res)=>{
  const userId=req.user?.userId,sessionId=req.user?.sessionId;
  if(!userId||!sessionId){res.status(401).json({error:'Unauthorized'});return;}
  try{
    const item=await getPendingProviderLink(userId,sessionId,String(req.params.id));
    if(!item){res.status(404).json({error:'Link request expired or unavailable'});return;}
    res.set('Cache-Control','private, no-store');res.json({provider:item.provider,email:item.identity.email,displayName:item.identity.displayName});
  }catch{res.status(400).json({error:'Could not load link request'});}
});
accountAccessRoutes.post('/connected-accounts/link/:id/confirm',rateLimiter.login2fa,async(req:AuthRequest,res)=>{
  const userId=req.user?.userId,sessionId=req.user?.sessionId;
  if(!userId||!sessionId){res.status(401).json({error:'Unauthorized'});return;}
  const password=req.body?.password,code=req.body?.code;
  if(typeof password!=='string'||!password||password.length>1024){res.status(400).json({error:'Enter your VANTA password'});return;}
  try{
    const pending=await getPendingProviderLink(userId,sessionId,String(req.params.id));
    if(!pending){res.status(404).json({error:'Link request expired or unavailable'});return;}
    const user=await prisma.user.findUnique({where:{id:userId},select:{passwordHash:true,emailVerified:true,status:true,lockedUntil:true,twoFactorEnabled:true,twoFactorSecret:true}});
    if(!user?.passwordHash||!user.emailVerified||user.status!=='ACTIVE'||(user.lockedUntil&&user.lockedUntil>new Date())||!await CryptoUtils.verifyPassword(user.passwordHash,password)){res.status(403).json({error:'Verify your email and enter your current VANTA password'});return;}
    if(user.twoFactorEnabled&&(typeof code!=='string'||!/^\d{6}$/.test(code)||!(await twoFactorAuth.verifyLogin(userId,code)).valid)){res.status(403).json({error:'Enter a fresh authenticator code'});return;}
    await confirmProviderLink(userId,sessionId,pending,user);
    await auditLog.log({userId,action:'OAUTH_ACCOUNT_LINKED',metadata:{provider:pending.provider}});
    res.json({message:'Sign-in account connected'});
  }catch{res.status(400).json({error:'Could not connect this identity safely. It may already be linked or expired.'});}
});
