import { Router, Request, Response } from 'express';
import { complianceService } from '../services/compliance.service';
import { authenticate, requirePermission, AuthenticatedRequest } from '../security/authMiddleware';
import { Permission } from '../security/rbac';

const router = Router();

// ============================================================================
// PRIVACY SETTINGS
// ============================================================================

router.get('/privacy-settings', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await complianceService.getPrivacySettings(req.user!.userId);
    res.json(settings);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/privacy-settings', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await complianceService.updatePrivacySettings(req.user!.userId, req.body);
    res.json(settings);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// CONSENT MANAGEMENT
// ============================================================================

router.get('/consent', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prefs = await complianceService.getConsentPreferences(req.user!.userId);
    res.json(prefs);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/consent', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prefs = await complianceService.updateConsentPreferences(
      req.user!.userId,
      req.body,
      'privacy_center',
      req.ip,
      req.headers['user-agent'],
    );
    res.json(prefs);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/consent/history', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const history = await complianceService.getConsentHistory(req.user!.userId);
    res.json(history);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// DATA EXPORT
// ============================================================================

router.post('/export/request', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const request = await complianceService.requestDataExport(req.user!.userId);
    res.json(request);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/export/list', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const exports = await complianceService.getDataExports(req.user!.userId);
    res.json(exports);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/export/download/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const exportReq = await complianceService.downloadExport(req.params.id, req.user!.userId);
    if (exportReq.filePath) {
      res.download(exportReq.filePath);
    } else {
      res.status(404).json({ error: 'Export file not found' });
    }
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// ACCOUNT DEACTIVATION / DELETION
// ============================================================================

router.post('/account/deactivate', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { reason, reasonDetail } = req.body;
    const result = await complianceService.deactivateAccount(req.user!.userId, reason, reasonDetail);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/account/schedule-deletion', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { reason, scheduledDate } = req.body;
    const result = await complianceService.scheduleAccountDeletion(
      req.user!.userId,
      reason,
      scheduledDate ? new Date(scheduledDate) : undefined,
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/account/cancel-deletion', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await complianceService.cancelDeletion(req.user!.userId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/account/recover', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { recoveryToken } = req.body;
    const result = await complianceService.recoverAccount(req.user!.userId, recoveryToken);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/account/deactivation-status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await complianceService.getDeactivationStatus(req.user!.userId);
    res.json(status || { status: 'ACTIVE' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// REPORTING
// ============================================================================

router.post('/reports', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetType, targetId, category, description, targetUserId, evidenceUrls } = req.body;
    const report = await complianceService.createReport(
      req.user!.userId,
      targetType,
      targetId,
      category,
      description,
      targetUserId,
      evidenceUrls,
    );
    res.json(report);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/reports', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const reports = await complianceService.getReports(
      req.user!.userId,
      req.user!.role,
      limit,
      offset,
    );
    res.json(reports);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// APPEALS
// ============================================================================

router.post('/appeals', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { appealType, reason, explanation, targetId, reportId, evidenceUrls } = req.body;
    const appeal = await complianceService.createAppeal(
      req.user!.userId,
      appealType,
      reason,
      explanation,
      targetId,
      reportId,
      evidenceUrls,
    );
    res.json(appeal);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/appeals', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const appeals = await complianceService.getAppeals(req.user!.userId, req.user!.role, limit, offset);
    res.json(appeals);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// CONNECTED DEVICES & LOGIN HISTORY
// ============================================================================

router.get('/devices', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const devices = await complianceService.getConnectedDevices(req.user!.userId);
    res.json(devices);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/login-history', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const history = await complianceService.getLoginHistory(req.user!.userId);
    res.json(history);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// COMMUNITY STANDARDS
// ============================================================================

router.get('/community-standards', async (req: Request, res: Response) => {
  try {
    const standards = await complianceService.getCommunityStandards();
    res.json(standards);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// POLICIES / USER AGREEMENTS
// ============================================================================

router.get('/policies', async (req: Request, res: Response) => {
  try {
    const policies = await complianceService.getAllPolicies();
    res.json(policies);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/policies/:type', async (req: Request, res: Response) => {
  try {
    const policy = await complianceService.getCurrentPolicy(req.params.type);
    res.json(policy);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/policies/:type/accept', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { version } = req.body;
    const acceptance = await complianceService.acceptPolicy(
      req.user!.userId,
      req.params.type,
      version,
      req.ip,
      req.headers['user-agent'],
    );
    res.json(acceptance);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/policy-acceptances', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const acceptances = await complianceService.getUserPolicyAcceptances(req.user!.userId);
    res.json(acceptances);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// TRANSPARENCY CENTER
// ============================================================================

router.get('/transparency', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'MONTHLY';
    const metrics = await complianceService.getTransparencyMetrics(period);
    res.json(metrics);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// COMPLIANCE NOTIFICATIONS
// ============================================================================

router.get('/notifications', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const notifications = await complianceService.getComplianceNotifications(req.user!.userId, unreadOnly);
    res.json(notifications);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/notifications/:id/read', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await complianceService.markNotificationRead(req.params.id, req.user!.userId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/notifications/read-all', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await complianceService.markAllNotificationsRead(req.user!.userId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// AUDIT LOGS (For admin use)
// ============================================================================

router.get('/audit-logs', authenticate, requirePermission(Permission.VIEW_AUDIT_LOGS), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const logs = await complianceService.getAuditLogs({
      userId: req.query.userId as string,
      action: req.query.action as string,
      resourceType: req.query.resourceType as string,
      limit,
      offset,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    });
    res.json(logs);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// ADMIN COMPLIANCE DASHBOARD
// ============================================================================

router.get('/admin/dashboard', authenticate, requirePermission(Permission.VIEW_COMPLIANCE_DASHBOARD), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await complianceService.getComplianceDashboardStats();
    res.json(stats);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Process reports
router.put('/admin/reports/:id/process', authenticate, requirePermission(Permission.MODERATE_CONTENT), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, note } = req.body;
    const result = await complianceService.processReport(req.params.id, req.user!.userId, action, note);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Process appeals
router.put('/admin/appeals/:id/process', authenticate, requirePermission(Permission.MODERATE_CONTENT), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { decision, reason } = req.body;
    const result = await complianceService.processAppeal(req.params.id, req.user!.userId, decision, reason);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Process copyright claims
router.put('/admin/copyright/:id/process', authenticate, requirePermission(Permission.MODERATE_CONTENT), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, note } = req.body;
    const result = await complianceService.processCopyrightClaim(req.params.id, req.user!.userId, action, note);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Process child safety flags
router.put('/admin/child-safety/:id/process', authenticate, requirePermission(Permission.MODERATE_CONTENT), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, note } = req.body;
    const result = await complianceService.processChildSafetyFlag(req.params.id, req.user!.userId, action, note);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Get all reports
router.get('/admin/reports', authenticate, requirePermission(Permission.MODERATE_CONTENT), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const reports = await complianceService.getReports(req.user!.userId, 'ADMIN', limit, offset);
    res.json(reports);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Get all appeals
router.get('/admin/appeals', authenticate, requirePermission(Permission.MODERATE_CONTENT), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const appeals = await complianceService.getAppeals('', 'ADMIN', limit, offset);
    res.json(appeals);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Get copyright claims
router.get('/admin/copyright', authenticate, requirePermission(Permission.MODERATE_CONTENT), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string;
    const claims = await complianceService.getCopyrightClaims(limit, offset, status);
    res.json(claims);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Generate transparency report
router.post('/admin/transparency/generate', authenticate, requirePermission(Permission.VIEW_COMPLIANCE_DASHBOARD), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await complianceService.generateTransparencyReport();
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Publish community standard
router.post('/admin/community-standards', authenticate, requirePermission(Permission.MANAGE_POLICIES), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, title, content, version } = req.body;
    const standard = await complianceService.upsertCommunityStandard(type, title, content, version);
    res.json(standard);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Publish policy version
router.post('/admin/policies', authenticate, requirePermission(Permission.MANAGE_POLICIES), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { policyType, version, title, content } = req.body;
    const policy = await complianceService.publishPolicyVersion(policyType, version, title, content);
    res.json(policy);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;