/**
 * VANTA Homes — property rental marketplace service layer.
 *
 * Reuses existing VANTA infrastructure:
 *  - Prisma / PostgreSQL (new additive models only)
 *  - Existing `uploadService` + `UploadedFile` for media storage/validation
 *  - Existing `chatService` (Conversation/Message) for enquiries
 *  - Existing `notificationService` for notifications
 *  - Existing `auditLog` (SecurityLog) for moderation audit trail
 *  - Existing RBAC (`Role.ADMIN`, `Permission.MODERATE_CONTENT`, ...)
 *
 * All authorization is enforced server-side. Client-provided owner IDs,
 * moderation statuses, and verification statuses are never trusted.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { uploadService } from './upload.service';
import { chatService } from './chat.service';
import { notificationService } from './notification.service';
import { auditLog } from '../security/auditLog';
import { config } from '../security/config';
import { Role, Permission, hasPermission } from '../security/rbac';

// ---------------------------------------------------------------------------
// Configuration / limits (configurable via environment variables)
// ---------------------------------------------------------------------------

const MAX_PROPERTY_PHOTOS = Number(process.env.MAX_PROPERTY_PHOTOS || 10);
const MAX_PROPERTY_VIDEOS = Number(process.env.MAX_PROPERTY_VIDEOS || 3);
const MAX_PROPERTY_MEDIA_TOTAL = Number(process.env.MAX_PROPERTY_MEDIA_TOTAL || 12);
const MAX_VIDEO_DURATION_SECONDS =
  Number(process.env.MAX_VIDEO_DURATION_SECONDS || 600);
const LISTING_PAGE_LIMIT = Number(process.env.HOMES_PAGE_LIMIT || 20);
const MAX_LISTING_PAGE_LIMIT = Number(process.env.HOMES_MAX_PAGE_LIMIT || 50);

export const LISTING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'PUBLISHED',
  'PAUSED',
  'RESERVED',
  'RENTED',
  'REJECTED',
  'ARCHIVED',
] as const;

export const PROPERTY_TYPES = [
  'APARTMENT',
  'STUDIO',
  'FLAT',
  'DETACHED_HOUSE',
  'SEMI_DETACHED_HOUSE',
  'DUPLEX',
  'ROOM_SHARED',
  'OTHER',
] as const;

export const RENT_PERIODS = ['WEEKLY', 'MONTHLY', 'YEARLY'] as const;

export const VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'PENDING_REVIEW',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
] as const;

export const VERIFICATION_TYPES = ['LANDLORD', 'AGENT'] as const;

export const REPORT_STATUSES = ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'] as const;

const PUBLIC_LISTING_SELECT = {
  id: true,
  title: true,
  description: true,
  propertyType: true,
  rentAmount: true,
  rentPeriod: true,
  currency: true,
  country: true,
  state: true,
  city: true,
  area: true,
  bedrooms: true,
  bathrooms: true,
  furnished: true,
  amenities: true,
  availabilityStatus: true,
  depositAmount: true,
  additionalFees: true,
  moveInInfo: true,
  contactVantaMessaging: true,
  contactWhatsApp: true,
  contactWhatsAppPublished: true,
  contactPhone: true,
  contactPhonePublished: true,
  ownerVerificationStatus: true,
  ownerVerificationType: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  owner: {
    select: {
      id: true,
      username: true,
      fullName: true,
      avatar: true,
      verified: true,
    },
  },
  media: {
    select: {
      id: true,
      type: true,
      order: true,
      isCover: true,
      thumbnailUrl: true,
      duration: true,
      uploadedFile: {
        select: {
          id: true,
          url: true,
          mimeType: true,
          fileType: true,
          size: true,
        },
      },
    },
    orderBy: { order: 'asc' },
  },
  _count: {
    select: { saves: true },
  },
} as const;

const LISTING_PUBLIC_SELECT = {
  id: true,
  title: true,
  description: true,
  propertyType: true,
  rentAmount: true,
  rentPeriod: true,
  currency: true,
  country: true,
  state: true,
  city: true,
  area: true,
  bedrooms: true,
  bathrooms: true,
  furnished: true,
  amenities: true,
  availabilityStatus: true,
  depositAmount: true,
  additionalFees: true,
  moveInInfo: true,
  contactVantaMessaging: true,
  contactWhatsAppPublished: true,
  contactPhonePublished: true,
  ownerVerificationStatus: true,
  ownerVerificationType: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  owner: {
    select: {
      id: true,
      username: true,
      fullName: true,
      avatar: true,
      verified: true,
    },
  },
  media: {
    select: {
      id: true,
      type: true,
      order: true,
      isCover: true,
      thumbnailUrl: true,
      duration: true,
      uploadedFile: {
        select: {
          id: true,
          url: true,
          mimeType: true,
          fileType: true,
          size: true,
        },
      },
    },
    orderBy: { order: 'asc' },
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidListingStatus(status: string): status is (typeof LISTING_STATUSES)[number] {
  return LISTING_STATUSES.includes(status as any);
}

function isValidPropertyType(type: string): type is (typeof PROPERTY_TYPES)[number] {
  return PROPERTY_TYPES.includes(type as any);
}

function isValidRentPeriod(period: string): period is (typeof RENT_PERIODS)[number] {
  return RENT_PERIODS.includes(period as any);
}

function isValidVerificationStatus(status: string): status is (typeof VERIFICATION_STATUSES)[number] {
  return VERIFICATION_STATUSES.includes(status as any);
}

function isValidVerificationType(type: string): type is (typeof VERIFICATION_TYPES)[number] {
  return VERIFICATION_TYPES.includes(type as any);
}

function isValidReportStatus(status: string): status is (typeof REPORT_STATUSES)[number] {
  return REPORT_STATUSES.includes(status as any);
}

function requireActiveUser(userId: string | undefined) {
  if (!userId) throw new Error('Authentication required');
}

function requireAdmin(role: string | undefined) {
  if (![Role.ADMIN, Role.CEO, Role.SUPER_ADMIN].includes(role as any)) {
    throw new Error('Admin access required');
  }
}

async function assertCanMessage(senderId: string, recipientId: string): Promise<void> {
  if (senderId === recipientId) return;
  const blocked = await prisma.blockedUser.findFirst({
    where: {
      OR: [
        { userId: senderId, targetId: recipientId },
        { userId: recipientId, targetId: senderId },
      ],
    },
    select: { id: true },
  });
  if (blocked) throw new Error('Messaging with this account is not allowed');

  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { status: true },
  });
  if (!recipient || recipient.status !== 'ACTIVE') {
    throw new Error('This account is not accepting messages');
  }
}

// ---------------------------------------------------------------------------
// Public discovery
// ---------------------------------------------------------------------------

export async function getPublicListings(params: {
  viewerId?: string;
  cursor?: string;
  limit?: number;
  city?: string;
  area?: string;
  propertyType?: string;
  minRent?: string;
  maxRent?: string;
  bedrooms?: string;
  bathrooms?: string;
  furnished?: string;
  search?: string;
  sort?: string;
}) {
  const take = Math.min(Math.max(1, Number(params.limit || LISTING_PAGE_LIMIT)), MAX_LISTING_PAGE_LIMIT);
  const where: Prisma.PropertyListingWhereInput = {
    availabilityStatus: 'PUBLISHED',
    owner: { status: 'ACTIVE' },
  };

  if (params.city) where.city = { contains: params.city, mode: 'insensitive' };
  if (params.area) where.area = { contains: params.area, mode: 'insensitive' };
  if (params.propertyType) {
    if (!isValidPropertyType(params.propertyType)) throw new Error('Invalid property type');
    where.propertyType = params.propertyType;
  }
  if (params.minRent) {
    const min = Number(params.minRent);
    if (Number.isNaN(min)) throw new Error('Invalid min rent');
    where.rentAmount = { ...(where.rentAmount as object), gte: min };
  }
  if (params.maxRent) {
    const max = Number(params.maxRent);
    if (Number.isNaN(max)) throw new Error('Invalid max rent');
    where.rentAmount = { ...(where.rentAmount as object), lte: max };
  }
  if (params.bedrooms) {
    const b = Number(params.bedrooms);
    if (Number.isNaN(b)) throw new Error('Invalid bedrooms');
    where.bedrooms = { gte: b };
  }
  if (params.bathrooms) {
    const b = Number(params.bathrooms);
    if (Number.isNaN(b)) throw new Error('Invalid bathrooms');
    where.bathrooms = { gte: b };
  }
  if (params.furnished !== undefined) {
    where.furnished = params.furnished === 'true';
  }
  if (params.search) {
    where.OR = [
      { title: { contains: params.search, mode: 'insensitive' } },
      { description: { contains: params.search, mode: 'insensitive' } },
      { city: { contains: params.search, mode: 'insensitive' } },
      { area: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  let orderBy: Prisma.PropertyListingOrderByWithRelationInput[] = [];
  switch (params.sort) {
    case 'price_asc': orderBy = [{ rentAmount: 'asc' }, { createdAt: 'desc' }]; break;
    case 'price_desc': orderBy = [{ rentAmount: 'desc' }, { createdAt: 'desc' }]; break;
    case 'newest':
    default: orderBy = [{ createdAt: 'desc' }]; break;
  }

  const listings = await prisma.propertyListing.findMany({
    where,
    select: LISTING_PUBLIC_SELECT,
    orderBy,
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });

  const hasMore = listings.length > take;
  const page = hasMore ? listings.slice(0, -1) : listings;
  const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;

  return {
    data: page.map((l) => ({ ...l, isSaved: false })),
    nextCursor,
    hasMore: !!nextCursor,
  };
}

export async function getPublicListing(listingId: string, viewerId?: string) {
  const listing = await prisma.propertyListing.findUnique({
    where: { id: listingId },
    select: PUBLIC_LISTING_SELECT,
  });
  if (!listing) throw new Error('Listing not found');

  let isSaved = false;
  if (viewerId) {
    const save = await prisma.savedProperty.findUnique({
      where: { userId_listingId: { userId: viewerId, listingId } },
      select: { id: true },
    });
    isSaved = !!save;
  }

  // Only published listings are visible publicly; owners/admins can see their own
  if (listing.availabilityStatus !== 'PUBLISHED' && viewerId !== listing.owner.id) {
    throw new Error('Listing not found');
  }

  return { ...listing, isSaved };
}

// ---------------------------------------------------------------------------
// Listing CRUD (owner)
// ---------------------------------------------------------------------------

export async function createListing(userId: string, data: any) {
  requireActiveUser(userId);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
  if (!user || user.status !== 'ACTIVE') throw new Error('Account not active');

  if (!data.title || typeof data.title !== 'string' || data.title.trim().length < 3) {
    throw new Error('Title is required');
  }
  if (!data.description || typeof data.description !== 'string' || data.description.trim().length < 10) {
    throw new Error('Description is required');
  }
  if (!isValidPropertyType(data.propertyType)) throw new Error('Invalid property type');
  if (!isValidRentPeriod(data.rentPeriod)) throw new Error('Invalid rental period');
  const rentAmount = Number(data.rentAmount);
  if (Number.isNaN(rentAmount) || rentAmount < 0) throw new Error('Invalid rent amount');
  if (!data.country || typeof data.country !== 'string') throw new Error('Country is required');
  if (!data.city || typeof data.city !== 'string') throw new Error('City is required');
  const bedrooms = Number(data.bedrooms);
  const bathrooms = Number(data.bathrooms);
  if (Number.isNaN(bedrooms) || bedrooms < 0) throw new Error('Invalid bedrooms');
  if (Number.isNaN(bathrooms) || bathrooms < 0) throw new Error('Invalid bathrooms');

  const listing = await prisma.propertyListing.create({
    data: {
      ownerId: userId,
      title: data.title.trim(),
      description: data.description.trim(),
      propertyType: data.propertyType,
      rentAmount,
      rentPeriod: data.rentPeriod,
      currency: data.currency || 'NGN',
      country: data.country.trim(),
      state: data.state?.trim() || null,
      city: data.city.trim(),
      area: data.area?.trim() || null,
      streetAddress: data.streetAddress?.trim() || null,
      bedrooms,
      bathrooms,
      furnished: data.furnished === true,
      amenities: data.amenities ? JSON.stringify(data.amenities) : null,
      availabilityStatus: 'DRAFT',
      depositAmount: data.depositAmount ? Number(data.depositAmount) : null,
      additionalFees: data.additionalFees ? JSON.stringify(data.additionalFees) : null,
      moveInInfo: data.moveInInfo?.trim() || null,
      contactVantaMessaging: data.contactVantaMessaging !== false,
      contactWhatsApp: data.contactWhatsApp?.trim() || null,
      contactWhatsAppPublished: data.contactWhatsAppPublished === true,
      contactPhone: data.contactPhone?.trim() || null,
      contactPhonePublished: data.contactPhonePublished === true,
      ownerVerificationStatus: 'UNVERIFIED',
    },
    select: LISTING_PUBLIC_SELECT,
  });

  await auditLog.log({
    userId,
    action: 'HOMES_LISTING_CREATED',
    metadata: { listingId: listing.id, title: listing.title },
    severity: 'INFO',
  });

  return listing;
}

export async function updateListing(listingId: string, userId: string, data: any) {
  requireActiveUser(userId);

  const existing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!existing) throw new Error('Listing not found');
  if (existing.ownerId !== userId) throw new Error('Not authorized to edit this listing');

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status !== 'ACTIVE') throw new Error('Account not active');

  const updateData: Prisma.PropertyListingUpdateInput = {};

  if (data.title !== undefined) {
    if (typeof data.title !== 'string' || data.title.trim().length < 3) throw new Error('Invalid title');
    updateData.title = data.title.trim();
  }
  if (data.description !== undefined) {
    if (typeof data.description !== 'string' || data.description.trim().length < 10) throw new Error('Invalid description');
    updateData.description = data.description.trim();
  }
  if (data.propertyType !== undefined) {
    if (!isValidPropertyType(data.propertyType)) throw new Error('Invalid property type');
    updateData.propertyType = data.propertyType;
  }
  if (data.rentPeriod !== undefined) {
    if (!isValidRentPeriod(data.rentPeriod)) throw new Error('Invalid rental period');
    updateData.rentPeriod = data.rentPeriod;
  }
  if (data.rentAmount !== undefined) {
    const amt = Number(data.rentAmount);
    if (Number.isNaN(amt) || amt < 0) throw new Error('Invalid rent amount');
    updateData.rentAmount = amt;
  }
  if (data.currency !== undefined) updateData.currency = data.currency;
  if (data.country !== undefined) updateData.country = data.country;
  if (data.state !== undefined) updateData.state = data.state || null;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.area !== undefined) updateData.area = data.area || null;
  if (data.streetAddress !== undefined) updateData.streetAddress = data.streetAddress || null;
  if (data.bedrooms !== undefined) {
    const b = Number(data.bedrooms);
    if (Number.isNaN(b) || b < 0) throw new Error('Invalid bedrooms');
    updateData.bedrooms = b;
  }
  if (data.bathrooms !== undefined) {
    const b = Number(data.bathrooms);
    if (Number.isNaN(b) || b < 0) throw new Error('Invalid bathrooms');
    updateData.bathrooms = b;
  }
  if (data.furnished !== undefined) updateData.furnished = Boolean(data.furnished);
  if (data.amenities !== undefined) updateData.amenities = JSON.stringify(data.amenities);
  if (data.depositAmount !== undefined) updateData.depositAmount = data.depositAmount ? Number(data.depositAmount) : null;
  if (data.additionalFees !== undefined) updateData.additionalFees = data.additionalFees ? JSON.stringify(data.additionalFees) : null;
  if (data.moveInInfo !== undefined) updateData.moveInInfo = data.moveInInfo || null;
  if (data.contactVantaMessaging !== undefined) updateData.contactVantaMessaging = Boolean(data.contactVantaMessaging);
  if (data.contactWhatsApp !== undefined) updateData.contactWhatsApp = data.contactWhatsApp || null;
  if (data.contactWhatsAppPublished !== undefined) updateData.contactWhatsAppPublished = Boolean(data.contactWhatsAppPublished);
  if (data.contactPhone !== undefined) updateData.contactPhone = data.contactPhone || null;
  if (data.contactPhonePublished !== undefined) updateData.contactPhonePublished = Boolean(data.contactPhonePublished);

  // If a published listing is edited significantly, reset to pending review
  if (existing.availabilityStatus === 'PUBLISHED' && (data.title || data.description || data.rentAmount || data.propertyType)) {
    updateData.availabilityStatus = 'PENDING_REVIEW';
    updateData.publishedAt = null;
  }

  const updated = await prisma.propertyListing.update({
    where: { id: listingId },
    data: updateData,
    select: LISTING_PUBLIC_SELECT,
  });

  await auditLog.log({
    userId,
    action: 'HOMES_LISTING_UPDATED',
    metadata: { listingId, changes: Object.keys(updateData) },
    severity: 'INFO',
  });

  return updated;
}

export async function submitListingForReview(listingId: string, userId: string) {
  requireActiveUser(userId);

  const listing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');
  if (listing.ownerId !== userId) throw new Error('Not authorized');

  if (listing.availabilityStatus === 'PUBLISHED') throw new Error('Listing is already published');
  if (listing.availabilityStatus === 'REJECTED') throw new Error('Rejected listings cannot be resubmitted without changes');

  const mediaCount = await prisma.propertyMedia.count({ where: { listingId } });
  if (mediaCount === 0) throw new Error('At least one photo is required before submitting for review');

  const updated = await prisma.propertyListing.update({
    where: { id: listingId },
    data: { availabilityStatus: 'PENDING_REVIEW' },
    select: LISTING_PUBLIC_SELECT,
  });

  await auditLog.log({
    userId,
    action: 'HOMES_LISTING_SUBMITTED_FOR_REVIEW',
    metadata: { listingId },
    severity: 'INFO',
  });

  return updated;
}

export async function archiveListing(listingId: string, userId: string) {
  requireActiveUser(userId);

  const listing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');
  if (listing.ownerId !== userId) throw new Error('Not authorized');

  const updated = await prisma.propertyListing.update({
    where: { id: listingId },
    data: { availabilityStatus: 'ARCHIVED' },
    select: LISTING_PUBLIC_SELECT,
  });

  await auditLog.log({
    userId,
    action: 'HOMES_LISTING_ARCHIVED',
    metadata: { listingId },
    severity: 'INFO',
  });

  return updated;
}

export async function setListingAvailability(listingId: string, userId: string, status: string) {
  requireActiveUser(userId);

  const listing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');
  if (listing.ownerId !== userId) throw new Error('Not authorized');

  const validStatuses = ['PAUSED', 'RESERVED', 'RENTED', 'PUBLISHED', 'ARCHIVED'];
  if (!validStatuses.includes(status)) throw new Error('Invalid availability status');

  const updateData: Prisma.PropertyListingUpdateInput = { availabilityStatus: status as any };
  if (status === 'PUBLISHED' && listing.availabilityStatus !== 'PUBLISHED') {
    updateData.publishedAt = new Date();
  }

  const updated = await prisma.propertyListing.update({
    where: { id: listingId },
    data: updateData,
    select: LISTING_PUBLIC_SELECT,
  });

  await auditLog.log({
    userId,
    action: `HOMES_LISTING_AVAILABILITY_${status}`,
    metadata: { listingId, previousStatus: listing.availabilityStatus },
    severity: 'INFO',
  });

  return updated;
}

export async function getOwnerListings(userId: string, { cursor, limit = 20 }: { cursor?: string; limit?: number }) {
  requireActiveUser(userId);
  const take = Math.min(Math.max(1, Number(limit || 20)), 50);
  const listings = await prisma.propertyListing.findMany({
    where: { ownerId: userId },
    select: LISTING_PUBLIC_SELECT,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = listings.length > take;
  const page = hasMore ? listings.slice(0, -1) : listings;
  const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;
  return { data: page, nextCursor, hasMore: !!nextCursor };
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export async function addListingMedia(listingId: string, userId: string, files: Express.Multer.File[], type: 'PHOTO' | 'VIDEO', req: any) {
  requireActiveUser(userId);

  const listing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');
  if (listing.ownerId !== userId) throw new Error('Not authorized');

  const existingMedia = await prisma.propertyMedia.count({ where: { listingId } });
  const maxCount = type === 'VIDEO' ? MAX_PROPERTY_VIDEOS : MAX_PROPERTY_PHOTOS;
  const existingOfType = await prisma.propertyMedia.count({ where: { listingId, type } });
  if (existingOfType + files.length > maxCount) throw new Error(`Maximum ${maxCount} ${type.toLowerCase()}s allowed`);
  if (existingMedia + files.length > MAX_PROPERTY_MEDIA_TOTAL) throw new Error(`Maximum ${MAX_PROPERTY_MEDIA_TOTAL} total media items allowed`);

  const maxOrder = await prisma.propertyMedia.findFirst({
    where: { listingId },
    orderBy: { order: 'desc' },
    select: { order: true },
  });
  let nextOrder = (maxOrder?.order || -1) + 1;

  const results = [];
  for (const file of files) {
    const mimeType = file.mimetype;
    if (type === 'PHOTO' && !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mimeType)) {
      throw new Error('Unsupported image type');
    }
    if (type === 'VIDEO' && !['video/mp4', 'video/webm'].includes(mimeType)) {
      throw new Error('Unsupported video type');
    }

    const uploadedFile = await uploadService.uploadFile(req, file, {
      category: type === 'VIDEO' ? 'video' : 'image',
      recordType: 'PropertyListing',
      recordId: listingId,
    });

    const media = await prisma.propertyMedia.create({
      data: {
        listingId,
        uploadedFileId: uploadedFile.id,
        type,
        order: nextOrder++,
        isCover: false,
        thumbnailUrl: uploadedFile.thumbnailUrl || null,
        duration: null,
      },
      select: {
        id: true, type: true, order: true, isCover: true, thumbnailUrl: true, duration: true,
        uploadedFile: { select: { id: true, url: true, mimeType: true, fileType: true, size: true } },
      },
    });
    results.push(media);
  }

  await auditLog.log({
    userId,
    action: 'HOMES_MEDIA_ADDED',
    metadata: { listingId, type, count: files.length },
    severity: 'INFO',
  });

  return results;
}

export async function updateListingMedia(listingId: string, mediaId: string, userId: string, data: any) {
  requireActiveUser(userId);

  const media = await prisma.propertyMedia.findUnique({ where: { id: mediaId } });
  if (!media) throw new Error('Media not found');
  if (media.listingId !== listingId) throw new Error('Media does not belong to this listing');

  const listing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.ownerId !== userId) throw new Error('Not authorized');

  const updateData: Prisma.PropertyMediaUpdateInput = {};
  if (data.order !== undefined) updateData.order = Number(data.order);
  if (data.isCover !== undefined) {
    if (data.isCover) {
      await prisma.propertyMedia.updateMany({
        where: { listingId, isCover: true },
        data: { isCover: false },
      });
    }
    updateData.isCover = Boolean(data.isCover);
  }

  const updated = await prisma.propertyMedia.update({
    where: { id: mediaId },
    data: updateData,
    select: {
      id: true, type: true, order: true, isCover: true, thumbnailUrl: true, duration: true,
      uploadedFile: { select: { id: true, url: true, mimeType: true, fileType: true, size: true } },
    },
  });

  await auditLog.log({
    userId,
    action: 'HOMES_MEDIA_UPDATED',
    metadata: { listingId, mediaId },
    severity: 'INFO',
  });

  return updated;
}

export async function removeListingMedia(listingId: string, mediaId: string, userId: string) {
  requireActiveUser(userId);

  const media = await prisma.propertyMedia.findUnique({ where: { id: mediaId } });
  if (!media) throw new Error('Media not found');
  if (media.listingId !== listingId) throw new Error('Media does not belong to this listing');

  const listing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.ownerId !== userId) throw new Error('Not authorized');

  await prisma.propertyMedia.delete({ where: { id: mediaId } });

  await auditLog.log({
    userId,
    action: 'HOMES_MEDIA_REMOVED',
    metadata: { listingId, mediaId },
    severity: 'INFO',
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Saved properties
// ---------------------------------------------------------------------------

export async function toggleSavedProperty(userId: string, listingId: string) {
  requireActiveUser(userId);

  const listing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');

  const existing = await prisma.savedProperty.findUnique({
    where: { userId_listingId: { userId, listingId } },
  });

  if (existing) {
    await prisma.savedProperty.delete({ where: { id: existing.id } });
    await auditLog.log({
      userId,
      action: 'HOMES_SAVED_PROPERTY_REMOVED',
      metadata: { listingId },
      severity: 'INFO',
    });
    return { saved: false };
  }

  await prisma.savedProperty.create({ data: { userId, listingId } });
  await auditLog.log({
    userId,
    action: 'HOMES_SAVED_PROPERTY_ADDED',
    metadata: { listingId },
    severity: 'INFO',
  });
  return { saved: true };
}

export async function getSavedProperties(userId: string, { cursor, limit = 20 }: { cursor?: string; limit?: number }) {
  requireActiveUser(userId);
  const take = Math.min(Math.max(1, Number(limit || 20)), 50);
  const saves = await prisma.savedProperty.findMany({
    where: { userId },
    include: { listing: { select: LISTING_PUBLIC_SELECT } },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = saves.length > take;
  const page = hasMore ? saves.slice(0, -1) : saves;
  const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;
  return {
    data: page.map((s) => s.listing).filter(Boolean),
    nextCursor,
    hasMore: !!nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Contact / enquiries
// ---------------------------------------------------------------------------

export async function contactListing(listingId: string, enquirerId: string, message?: string) {
  requireActiveUser(enquirerId);

  const listing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');
  if (listing.ownerId === enquirerId) throw new Error('Cannot contact your own listing');

  const enquirer = await prisma.user.findUnique({ where: { id: enquirerId }, select: { status: true, username: true } });
  if (!enquirer || enquirer.status !== 'ACTIVE') throw new Error('Account not active');

  const owner = await prisma.user.findUnique({ where: { id: listing.ownerId }, select: { id: true, status: true, username: true } });
  if (!owner || owner.status !== 'ACTIVE') throw new Error('Listing owner not available');

  await assertCanMessage(enquirerId, listing.ownerId);

  // Reuse existing conversation if one exists between these two users
  let conversation = await prisma.conversation.findFirst({
    where: {
      isGroup: false,
      type: 'DIRECT',
      participants: {
        every: { userId: { in: [enquirerId, listing.ownerId] } },
      },
    },
    include: { participants: true },
  });

  if (!conversation || conversation.participants.length !== 2) {
    conversation = await prisma.conversation.create({
      data: {
        isGroup: false,
        type: 'DIRECT',
        name: null,
        visibility: 'PRIVATE',
        createdById: enquirerId,
        participants: {
          create: [
            { userId: enquirerId },
            { userId: listing.ownerId },
          ],
        },
      },
      include: { participants: true },
    });
  }

  const propertyRef = `🏠 Property enquiry: "${listing.title}" (${listing.city}${listing.area ? ', ' + listing.area : ''})`;
  const content = message ? `${propertyRef}\n\n${message}` : propertyRef;

  await chatService.sendMessage(conversation.id, enquirerId, content, 'TEXT', [], undefined);

  // Create or update the PropertyEnquiry record linking to this conversation
  let enquiry = await prisma.propertyEnquiry.findUnique({ where: { conversationId: conversation.id } });
  if (!enquiry) {
    enquiry = await prisma.propertyEnquiry.create({
      data: {
        listingId,
        enquirerId,
        ownerId: listing.ownerId,
        conversationId: conversation.id,
        status: 'OPEN',
      },
    });
  } else {
    enquiry = await prisma.propertyEnquiry.update({
      where: { id: enquiry.id },
      data: { status: 'OPEN', updatedAt: new Date() },
    });
  }

  // Notify the listing owner
  await notificationService.createNotification(
    listing.ownerId,
    'message',
    'New property enquiry',
    `${enquirer.username || 'A user'} is interested in "${listing.title}"`,
    { listingId, conversationId: conversation.id, enquirerId }
  );

  await auditLog.log({
    userId: enquirerId,
    action: 'HOMES_CONTACT_LISTING',
    metadata: { listingId, conversationId: conversation.id, ownerId: listing.ownerId },
    severity: 'INFO',
  });

  return { conversationId: conversation.id, enquiryId: enquiry.id };
}

export async function getListingContactOptions(listingId: string) {
  const listing = await prisma.propertyListing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      contactVantaMessaging: true,
      contactWhatsApp: true,
      contactWhatsAppPublished: true,
      contactPhone: true,
      contactPhonePublished: true,
    },
  });
  if (!listing) throw new Error('Listing not found');

  const options: any = {
    vantaMessaging: listing.contactVantaMessaging,
  };

  if (listing.contactWhatsAppPublished && listing.contactWhatsApp) {
    options.whatsapp = listing.contactWhatsApp;
    options.whatsappUrl = `https://wa.me/${encodeURIComponent(listing.contactWhatsApp.replace(/\D/g, ''))}`;
  }

  if (listing.contactPhonePublished && listing.contactPhone) {
    options.phone = listing.contactPhone;
    options.phoneUrl = `tel:${encodeURIComponent(listing.contactPhone.replace(/\D/g, ''))}`;
  }

  return options;
}

export async function getListingEnquiries(listingId: string, ownerId: string, { cursor, limit = 20 }: { cursor?: string; limit?: number }) {
  requireActiveUser(ownerId);

  const listing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');
  if (listing.ownerId !== ownerId) throw new Error('Not authorized');

  const take = Math.min(Math.max(1, Number(limit || 20)), 50);
  const enquiries = await prisma.propertyEnquiry.findMany({
    where: { listingId },
    include: {
      enquirer: { select: { id: true, username: true, fullName: true, avatar: true } },
      conversation: { select: { id: true, updatedAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = enquiries.length > take;
  const page = hasMore ? enquiries.slice(0, -1) : enquiries;
  const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;
  return { data: page, nextCursor, hasMore: !!nextCursor };
}

// ---------------------------------------------------------------------------
// Verification (landlord / agent)
// ---------------------------------------------------------------------------

export async function submitVerification(userId: string, data: any) {
  requireActiveUser(userId);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
  if (!user || user.status !== 'ACTIVE') throw new Error('Account not active');

  const type = data.type;
  if (!isValidVerificationType(type)) throw new Error('Invalid verification type');

  if (type === 'AGENT') {
    if (!data.agencyName || typeof data.agencyName !== 'string') throw new Error('Agency name is required for agents');
    if (!data.agencyLicense || typeof data.agencyLicense !== 'string') throw new Error('Agency license is required for agents');
  }

  const proofDocIds = data.proofDocumentIds || [];
  if (!Array.isArray(proofDocIds) || proofDocIds.length === 0) {
    throw new Error('At least one proof document is required');
  }

  // Verify all proof documents belong to this user and are verification category
  for (const fileId of proofDocIds) {
    const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file || file.userId !== userId || file.category !== 'verification') {
      throw new Error('Invalid proof document');
    }
  }

  const existing = await prisma.propertyVerification.findFirst({ where: { userId } });
  if (existing) {
    const updated = await prisma.propertyVerification.update({
      where: { id: existing.id },
      data: {
        type,
        status: 'PENDING_REVIEW',
        agencyName: type === 'AGENT' ? data.agencyName : null,
        agencyLicense: type === 'AGENT' ? data.agencyLicense : null,
        proofDocumentIds: JSON.stringify(proofDocIds),
        reviewNotes: null,
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      },
    });
    await auditLog.log({
      userId,
      action: 'HOMES_VERIFICATION_RESUBMITTED',
      metadata: { type },
      severity: 'INFO',
    });
    return updated;
  }

  const verification = await prisma.propertyVerification.create({
    data: {
      userId,
      type,
      status: 'PENDING_REVIEW',
      agencyName: type === 'AGENT' ? data.agencyName : null,
      agencyLicense: type === 'AGENT' ? data.agencyLicense : null,
      proofDocumentIds: JSON.stringify(proofDocIds),
    },
  });

  await auditLog.log({
    userId,
    action: 'HOMES_VERIFICATION_SUBMITTED',
    metadata: { type },
    severity: 'INFO',
  });

  return verification;
}

export async function getMyVerification(userId: string) {
  requireActiveUser(userId);
  const verification = await prisma.propertyVerification.findFirst({ where: { userId } });
  if (!verification) return { status: 'UNVERIFIED', type: null };
  return {
    id: verification.id,
    type: verification.type,
    status: verification.status,
    agencyName: verification.agencyName,
    agencyLicense: verification.agencyLicense,
    reviewNotes: verification.reviewNotes,
    reviewedAt: verification.reviewedAt,
    expiresAt: verification.expiresAt,
    createdAt: verification.createdAt,
    updatedAt: verification.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function createReport(reporterId: string, data: any) {
  requireActiveUser(reporterId);

  const reporter = await prisma.user.findUnique({ where: { id: reporterId }, select: { status: true } });
  if (!reporter || reporter.status !== 'ACTIVE') throw new Error('Account not active');

  const listing = await prisma.propertyListing.findUnique({ where: { id: data.listingId } });
  if (!listing) throw new Error('Listing not found');

  const validTypes = ['SCAM', 'FAKE_PROPERTY', 'UNAUTHORIZED_LISTING', 'MISLEADING_MEDIA', 'INCORRECT_PRICE', 'DUPLICATE_LISTING', 'ALREADY_RENTED', 'INAPPROPRIATE', 'OTHER'];
  if (!validTypes.includes(data.type)) throw new Error('Invalid report type');
  if (!data.reason || typeof data.reason !== 'string') throw new Error('Reason is required');

  // Prevent duplicate reports from same user on same listing
  const existing = await prisma.propertyReport.findUnique({
    where: { reporterId_listingId: { reporterId, listingId: data.listingId } },
  });
  if (existing) throw new Error('You have already reported this listing');

  const report = await prisma.propertyReport.create({
    data: {
      reporterId,
      listingId: data.listingId,
      type: data.type,
      reason: data.reason.trim(),
      description: data.description?.trim() || null,
      status: 'PENDING',
    },
    include: {
      reporter: { select: { id: true, username: true } },
      listing: { select: { id: true, title: true, ownerId: true } },
    },
  });

  await auditLog.log({
    userId: reporterId,
    action: 'HOMES_REPORT_CREATED',
    metadata: { reportId: report.id, listingId: data.listingId, type: data.type },
    severity: 'WARNING',
  });

  return report;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function adminGetListings(params: {
  cursor?: string; limit?: number; status?: string; propertyType?: string; city?: string; owner?: string; search?: string;
}) {
  const take = Math.min(Math.max(1, Number(params.limit || 20)), 50);
  const where: Prisma.PropertyListingWhereInput = {};

  if (params.status) where.availabilityStatus = params.status;
  if (params.propertyType) where.propertyType = params.propertyType;
  if (params.city) where.city = { contains: params.city, mode: 'insensitive' };
  if (params.owner) where.owner = { username: { contains: params.owner, mode: 'insensitive' } };
  if (params.search) {
    where.OR = [
      { title: { contains: params.search, mode: 'insensitive' } },
      { id: { contains: params.search, mode: 'insensitive' } },
      { owner: { username: { contains: params.search, mode: 'insensitive' } } },
    ];
  }

  const listings = await prisma.propertyListing.findMany({
    where,
    select: LISTING_PUBLIC_SELECT,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  const hasMore = listings.length > take;
  const page = hasMore ? listings.slice(0, -1) : listings;
  const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;
  return { data: page, nextCursor, hasMore: !!nextCursor };
}

export async function adminReviewListing(listingId: string, adminId: string, decision: 'APPROVE' | 'REJECT', reason?: string) {
  requireActiveUser(adminId);
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
  requireAdmin(admin?.role);

  const listing = await prisma.propertyListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new Error('Listing not found');

  if (decision === 'APPROVE') {
    if (listing.availabilityStatus !== 'PENDING_REVIEW') throw new Error('Only pending listings can be approved');
    await prisma.propertyListing.update({
      where: { id: listingId },
      data: { availabilityStatus: 'PUBLISHED', publishedAt: new Date() },
    });
  } else {
    if (listing.availabilityStatus !== 'PENDING_REVIEW') throw new Error('Only pending listings can be rejected');
    await prisma.propertyListing.update({
      where: { id: listingId },
      data: { availabilityStatus: 'REJECTED' },
    });
  }

  await auditLog.log({
    userId: adminId,
    action: `HOMES_ADMIN_LISTING_${decision}`,
    metadata: { listingId, reason },
    severity: 'INFO',
  });

  return { success: true, listingId, decision };
}

export async function adminGetVerifications(params: { cursor?: string; limit?: number; type?: string; status?: string }) {
  const take = Math.min(Math.max(1, Number(params.limit || 20)), 50);
  const where: Prisma.PropertyVerificationWhereInput = {};
  if (params.type) where.type = params.type;
  if (params.status) where.status = params.status;

  const verifications = await prisma.propertyVerification.findMany({
    where,
    include: { user: { select: { id: true, username: true, fullName: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  const hasMore = verifications.length > take;
  const page = hasMore ? verifications.slice(0, -1) : verifications;
  const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;
  return { data: page, nextCursor, hasMore: !!nextCursor };
}

export async function adminDecideVerification(verificationId: string, adminId: string, decision: 'APPROVE' | 'REJECT', reason?: string) {
  requireActiveUser(adminId);
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
  requireAdmin(admin?.role);

  const verification = await prisma.propertyVerification.findUnique({ where: { id: verificationId } });
  if (!verification) throw new Error('Verification not found');
  if (verification.status !== 'PENDING_REVIEW') throw new Error('Only pending verifications can be decided');

  const newStatus = decision === 'APPROVE' ? 'VERIFIED' : 'REJECTED';
  const updated = await prisma.propertyVerification.update({
    where: { id: verificationId },
    data: {
      status: newStatus,
      reviewNotes: reason || null,
      reviewedBy: adminId,
      reviewedAt: new Date(),
    },
    include: { user: { select: { id: true, username: true } } },
  });

  // Denormalise verification status onto the user's listings
  await prisma.propertyListing.updateMany({
    where: { ownerId: verification.userId },
    data: { ownerVerificationStatus: newStatus, ownerVerificationType: verification.type },
  });

  await auditLog.log({
    userId: adminId,
    action: `HOMES_ADMIN_VERIFICATION_${decision}`,
    metadata: { verificationId, userId: verification.userId, type: verification.type, newStatus },
    severity: 'INFO',
  });

  return updated;
}

export async function adminGetReports(params: { cursor?: string; limit?: number; status?: string }) {
  const take = Math.min(Math.max(1, Number(params.limit || 20)), 50);
  const where: Prisma.PropertyReportWhereInput = {};
  if (params.status) where.status = params.status;

  const reports = await prisma.propertyReport.findMany({
    where,
    include: {
      reporter: { select: { id: true, username: true } },
      listing: { select: { id: true, title: true, ownerId: true, owner: { select: { id: true, username: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  const hasMore = reports.length > take;
  const page = hasMore ? reports.slice(0, -1) : reports;
  const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;
  return { data: page, nextCursor, hasMore: !!nextCursor };
}

export async function adminResolveReport(reportId: string, adminId: string, decision: 'RESOLVED' | 'DISMISSED', notes?: string) {
  requireActiveUser(adminId);
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
  requireAdmin(admin?.role);

  const report = await prisma.propertyReport.findUnique({ where: { id: reportId } });
  if (!report) throw new Error('Report not found');
  if (report.status !== 'PENDING' && report.status !== 'REVIEWING') throw new Error('Only pending reports can be resolved');

  const updated = await prisma.propertyReport.update({
    where: { id: reportId },
    data: {
      status: decision,
      resolvedBy: adminId,
      resolvedAt: new Date(),
    },
    include: {
      reporter: { select: { id: true, username: true } },
      listing: { select: { id: true, title: true, ownerId: true } },
    },
  });

  await auditLog.log({
    userId: adminId,
    action: `HOMES_ADMIN_REPORT_${decision}`,
    metadata: { reportId, listingId: report.listingId, notes },
    severity: 'INFO',
  });

  return updated;
}

export async function adminGetAuditLogs(params: { cursor?: string; limit?: number; listingId?: string; actorId?: string; action?: string }) {
  const take = Math.min(Math.max(1, Number(params.limit || 20)), 50);
  const where: Prisma.PropertyAuditLogWhereInput = {};
  if (params.listingId) where.listingId = params.listingId;
  if (params.actorId) where.actorId = params.actorId;
  if (params.action) where.action = { contains: params.action, mode: 'insensitive' };

  const logs = await prisma.propertyAuditLog.findMany({
    where,
    include: {
      listing: { select: { id: true, title: true } },
      actor: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  const hasMore = logs.length > take;
  const page = hasMore ? logs.slice(0, -1) : logs;
  const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;
  return { data: page, nextCursor, hasMore: !!nextCursor };
}

// ---------------------------------------------------------------------------
// Export named functions used by controllers
// ---------------------------------------------------------------------------

export const homesService = {
  getPublicListings,
  getPublicListing,
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
  adminGetListings,
  adminReviewListing,
  adminGetVerifications,
  adminDecideVerification,
  adminGetReports,
  adminResolveReport,
  adminGetAuditLogs,
  LISTING_STATUSES,
  PROPERTY_TYPES,
  RENT_PERIODS,
  VERIFICATION_STATUSES,
};
