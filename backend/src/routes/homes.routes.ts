import { Router } from 'express';
import authenticate, { authenticateJWT, optionallyAuthenticateJWT } from '../middleware/auth.middleware';
import {
  uploadImage,
  uploadVideo,
} from '../services';
import {
  getListings,
  getListing,
  getPropertyTypes,
  getRentPeriods,
  createListing,
  updateListing,
  submitListingForReview,
  archiveListing,
  setListingAvailability,
  getOwnerListings,
  addListingMedia,
  updateListingMedia,
  removeListingMedia,
  toggleSavedProperty,
  getSavedProperties,
  contactListing,
  getListingContactOptions,
  getListingEnquiries,
  submitVerification,
  getMyVerification,
  createReport,
  // Admin
  adminGetListings,
  adminReviewListing,
  adminGetVerifications,
  adminDecideVerification,
  adminGetReports,
  adminResolveReport,
  adminGetAuditLogs,
} from '../controllers/homes.controller';
import { Role } from '../security/rbac';

const router = Router();

const requireAdmin = (req: any, res: any, next: any) => {
  if (![Role.ADMIN, Role.CEO, Role.SUPER_ADMIN].includes(req.user?.role as any)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
};

// ============================================================================
// Public discovery (optional auth so logged-out users can browse)
// Specific static GETs must come before parametric GET /:id.
// ============================================================================

router.get('/', optionallyAuthenticateJWT, getListings);
router.get('/property-types', getPropertyTypes);
router.get('/rent-periods', getRentPeriods);

// ============================================================================
// Admin moderation (ADMIN / CEO / SUPER_ADMIN) — before /:id to avoid shadowing
// ============================================================================

router.get('/admin', authenticate, requireAdmin, adminGetListings);
router.get('/admin/listings', authenticate, requireAdmin, adminGetListings);
router.post('/admin/listings/:id/review', authenticate, requireAdmin, adminReviewListing);
router.get('/admin/verifications', authenticate, requireAdmin, adminGetVerifications);
router.post('/admin/verifications/:id/decide', authenticate, requireAdmin, adminDecideVerification);
router.get('/admin/reports', authenticate, requireAdmin, adminGetReports);
router.post('/admin/reports/:id/resolve', authenticate, requireAdmin, adminResolveReport);
router.get('/admin/audit', authenticate, requireAdmin, adminGetAuditLogs);

// ============================================================================
// Authenticated tenant / owner actions (specific paths before /:id)
// ============================================================================

router.post('/', authenticate, createListing);
router.get('/mine', authenticate, getOwnerListings);
router.get('/saved', authenticate, getSavedProperties);
router.post('/:id/submit-for-review', authenticate, submitListingForReview);
router.put('/:id', authenticate, updateListing);
router.delete('/:id', authenticate, archiveListing);
router.post('/:id/availability', authenticate, setListingAvailability);

// Media (owner only)
router.post('/:id/media/photos', authenticate, uploadImage.array('photos', 10), addListingMedia);
router.post('/:id/media/videos', authenticate, uploadVideo.array('videos', 3), addListingMedia);
router.put('/:id/media/:mediaId', authenticate, updateListingMedia);
router.delete('/:id/media/:mediaId', authenticate, removeListingMedia);

// Saved properties
router.post('/:id/save', authenticate, toggleSavedProperty);

// Contact / enquiries
router.post('/:id/contact', authenticate, contactListing);
router.get('/:id/enquiries', authenticate, getListingEnquiries);

// Owner verification (landlord / agent) — static paths before /:id
router.post('/verification', authenticate, submitVerification);
router.get('/verification', authenticate, getMyVerification);

// Reports
router.post('/reports', authenticate, createReport);

// ============================================================================
// Parametric public routes LAST so they never shadow specific paths
// ============================================================================

router.get('/:id/contact-options', optionallyAuthenticateJWT, getListingContactOptions);
router.get('/:id', optionallyAuthenticateJWT, getListing);

export default router;