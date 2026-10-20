import { Request, Response } from 'express';
import { homesService } from '../services';
import { AuthRequest } from '../middleware/auth.middleware';
import { getParamString } from '../utils/params';

const wrap =
  (fn: (req: AuthRequest, res: Response) => Promise<void | unknown>) =>
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error: any) {
      const message = error?.message || 'Internal server error';
      const status =
        message.includes('not found') || message.includes('Not found')
          ? 404
          : message.includes('Not authorized') ||
            message.includes('not authorized') ||
            message.includes('Admin access required')
            ? 403
            : 400;
      res.status(status).json({ error: message });
    }
  };

export const getListings = wrap(async (req: AuthRequest, res: Response) => {
  const {
    cursor,
    limit,
    city,
    area,
    propertyType,
    minRent,
    maxRent,
    bedrooms,
    bathrooms,
    furnished,
    search,
    sort,
  } = req.query;
  const result = await homesService.getPublicListings({
    viewerId: req.user?.userId,
    cursor: typeof cursor === 'string' ? cursor : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
    city: typeof city === 'string' ? city : undefined,
    area: typeof area === 'string' ? area : undefined,
    propertyType: typeof propertyType === 'string' ? propertyType : undefined,
    minRent: typeof minRent === 'string' ? minRent : undefined,
    maxRent: typeof maxRent === 'string' ? maxRent : undefined,
    bedrooms: typeof bedrooms === 'string' ? bedrooms : undefined,
    bathrooms: typeof bathrooms === 'string' ? bathrooms : undefined,
    furnished: typeof furnished === 'string' ? furnished : undefined,
    search: typeof search === 'string' ? search : undefined,
    sort: typeof sort === 'string' ? sort : undefined,
  });
  res.status(200).json(result);
});

export const createListing = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listing = await homesService.createListing(userId, req.body);
  res.status(201).json(listing);
});

export const updateListing = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const updated = await homesService.updateListing(listingId, userId, req.body);
  res.status(200).json(updated);
});

export const submitListingForReview = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const updated = await homesService.submitListingForReview(listingId, userId);
  res.status(200).json(updated);
});

export const archiveListing = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const updated = await homesService.archiveListing(listingId, userId);
  res.status(200).json(updated);
});

export const setListingAvailability = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const { status } = req.body;
  const updated = await homesService.setListingAvailability(listingId, userId, status);
  res.status(200).json(updated);
});

export const getOwnerListings = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const { cursor, limit } = req.query;
  const result = await homesService.getOwnerListings(userId, {
    cursor: typeof cursor === 'string' ? cursor : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
  });
  res.status(200).json(result);
});

export const addListingMedia = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const files = (req.files || []) as Express.Multer.File[];
  const type = (req.body.type || 'PHOTO') as 'PHOTO' | 'VIDEO';
  const result = await homesService.addListingMedia(listingId, userId, files, type, req);
  res.status(201).json(result);
});

export const updateListingMedia = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const mediaId = getParamString(req.params.mediaId);
  const result = await homesService.updateListingMedia(listingId, mediaId, userId, req.body);
  res.status(200).json(result);
});

export const toggleSavedProperty = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const result = await homesService.toggleSavedProperty(userId, listingId);
  res.status(200).json(result);
});

export const getSavedProperties = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const { cursor, limit } = req.query;
  const result = await homesService.getSavedProperties(userId, {
    cursor: typeof cursor === 'string' ? cursor : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
  });
  res.status(200).json(result);
});

export const contactListing = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const { message } = req.body;
  const result = await homesService.contactListing(listingId, userId, message);
  res.status(200).json(result);
});

export const getListingContactOptions = wrap(async (req: AuthRequest, res: Response) => {
  const listingId = getParamString(req.params.id);
  const result = await homesService.getListingContactOptions(listingId);
  if (!result) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }
  res.status(200).json(result);
});

export const getListingEnquiries = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const { cursor, limit } = req.query;
  const result = await homesService.getListingEnquiries(listingId, userId, {
    cursor: typeof cursor === 'string' ? cursor : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
  });
  res.status(200).json(result);
});

export const submitVerification = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const result = await homesService.submitVerification(userId, req.body);
  res.status(200).json(result);
});

// ------------------------- Admin -------------------------

export const adminGetListings = wrap(async (req: AuthRequest, res: Response) => {
  const {
    cursor,
    limit,
    status,
    propertyType,
    city,
    owner,
    search,
  } = req.query;
  const result = await homesService.adminGetListings({
    cursor: typeof cursor === 'string' ? cursor : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
    status: typeof status === 'string' ? status : undefined,
    propertyType: typeof propertyType === 'string' ? propertyType : undefined,
    city: typeof city === 'string' ? city : undefined,
    owner: typeof owner === 'string' ? owner : undefined,
    search: typeof search === 'string' ? search : undefined,
  });
  res.status(200).json(result);
});

export const adminReviewListing = wrap(async (req: AuthRequest, res: Response) => {
  const adminId = req.user?.userId;
  if (!adminId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const result = await homesService.adminReviewListing(listingId, adminId, req.body);
  res.status(200).json(result);
});

export const adminGetVerifications = wrap(async (req: AuthRequest, res: Response) => {
  const { cursor, limit, type, status } = req.query;
  const result = await homesService.adminGetVerifications({
    cursor: typeof cursor === 'string' ? cursor : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
    type: typeof type === 'string' ? type : undefined,
    status: typeof status === 'string' ? status : undefined,
  });
  res.status(200).json(result);
});

export const adminDecideVerification = wrap(async (req: AuthRequest, res: Response) => {
  const adminId = req.user?.userId;
  if (!adminId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const verificationId = getParamString(req.params.id);
  const result = await homesService.adminDecideVerification(verificationId, adminId, req.body);
  res.status(200).json(result);
});

export const adminGetReports = wrap(async (req: AuthRequest, res: Response) => {
  const { cursor, limit, status } = req.query;
  const result = await homesService.adminGetReports({
    cursor: typeof cursor === 'string' ? cursor : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
    status: typeof status === 'string' ? status : undefined,
  });
  res.status(200).json(result);
});

export const adminResolveReport = wrap(async (req: AuthRequest, res: Response) => {
  const adminId = req.user?.userId;
  if (!adminId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const reportId = getParamString(req.params.id);
  const result = await homesService.adminResolveReport(reportId, adminId, req.body);
  res.status(200).json(result);
});

export const adminGetAuditLogs = wrap(async (req: AuthRequest, res: Response) => {
  const { cursor, limit, listingId, actorId, action } = req.query;
  const result = await homesService.adminGetAuditLogs({
    cursor: typeof cursor === 'string' ? cursor : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
    listingId: typeof listingId === 'string' ? listingId : undefined,
    actorId: typeof actorId === 'string' ? actorId : undefined,
    action: typeof action === 'string' ? action : undefined,
  });
  res.status(200).json(result);
});

export const getMyVerification = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const result = await homesService.getMyVerification(userId);
  res.status(200).json(result);
});

export const createReport = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const result = await homesService.createReport(userId, req.body);
  res.status(201).json(result);
});

export const removeListingMedia = wrap(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const listingId = getParamString(req.params.id);
  const mediaId = getParamString(req.params.mediaId);
  await homesService.removeListingMedia(listingId, mediaId, userId);
  res.status(200).json({ ok: true });
});
export const getListing = wrap(async (req: AuthRequest, res: Response) => {
  const listingId = getParamString(req.params.id);
  const viewerId = req.user?.userId;
  const result = await homesService.getPublicListing(listingId, viewerId);
  if (!result) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }
  res.status(200).json(result);
});

export const getPropertyTypes = wrap(async (_req: AuthRequest, res: Response) => {
  res.status(200).json({ propertyTypes: homesService.PROPERTY_TYPES });
});

export const getRentPeriods = wrap(async (_req: AuthRequest, res: Response) => {
  res.status(200).json({ rentPeriods: homesService.RENT_PERIODS });
});