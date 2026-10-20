// Frontend API Service - Centralized API calls for all backend endpoints
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from './apiClient';

// ==========================================
// STORIES
// ==========================================
export const fetchStories = () => apiGet<any[]>('/api/stories');
export const createStory = (formData: FormData) => apiUpload<any>('/api/stories', formData);
export const viewStory = (storyId: string) => apiPost<any>(`/api/stories/${storyId}/view`, {});
export const deleteStory = (storyId: string) => apiDelete<any>(`/api/stories/${storyId}`);
export const getStoryViewers = (storyId: string) => apiGet<any[]>(`/api/stories/${storyId}/viewers`);

// ==========================================
// FEED / POSTS
// ==========================================
export const fetchFeed = (cursor?: string) => apiGet<any>(`/api/feed${cursor ? `?cursor=${cursor}` : ''}`);
export const fetchTrendingFeed = (cursor?: string) => apiGet<any>(`/api/feed/trending${cursor ? `?cursor=${cursor}` : ''}`);
export const fetchExploreFeed = () => apiGet<any>('/api/feed/explore');
export const createPost = (content: string, mediaUrl?: string) => apiPost<any>('/api/feed', { content, mediaUrl });
export const deletePost = (postId: string) => apiDelete<any>(`/api/feed/${postId}`);
export const likePost = (postId: string) => apiPost<any>(`/api/feed/${postId}/like`, {});
export const commentOnPost = (postId: string, content: string) => apiPost<any>(`/api/feed/${postId}/comments`, { content });
export const getPostComments = (postId: string, cursor?: string) => apiGet<any>(`/api/feed/${postId}/comments${cursor ? `?cursor=${cursor}` : ''}`);
export const fetchFollowers = () => apiGet<any>('/api/feed/followers');
export const fetchFollowing = () => apiGet<any>('/api/feed/following');

// ==========================================
// SEARCH
// ==========================================
export const searchAll = (query: string, type?: string) => apiGet<any>(`/api/search?q=${encodeURIComponent(query)}${type ? `&type=${type}` : ''}`);
export const getSearchSuggestions = () => apiGet<any>('/api/search/suggestions');
export const getTrending = () => apiGet<any>('/api/search/trending');

// ==========================================
// UPLOAD
// ==========================================
export const uploadFile = (formData: FormData) => apiUpload<any>('/api/upload', formData);
export const uploadAvatar = (formData: FormData) => apiUpload<any>('/api/upload/avatar', formData);
export const uploadBanner = (formData: FormData) => apiUpload<any>('/api/upload/banner', formData);

// ==========================================
// COMMUNITIES
// ==========================================
export const fetchCommunities = () => apiGet<any>('/api/communities');
export const getCommunity = (id: string) => apiGet<any>(`/api/communities/${id}`);
export const createCommunity = (data: any) => apiPost<any>('/api/communities', data);
export const joinCommunity = (id: string) => apiPost<any>(`/api/communities/${id}/join`, {});
export const leaveCommunity = (id: string) => apiPost<any>(`/api/communities/${id}/leave`, {});
export const createCommunityPost = (id: string, content: string, mediaUrl?: string) => apiPost<any>(`/api/communities/${id}/posts`, { content, mediaUrl });
export const getCommunityPosts = (id: string) => apiGet<any>(`/api/communities/${id}/posts`);

// ==========================================
// CHANNELS
// ==========================================
export const fetchChannels = () => apiGet<any>('/api/channels');
export const getChannel = (id: string) => apiGet<any>(`/api/channels/${id}`);
export const createChannel = (data: any) => apiPost<any>('/api/channels', data);
export const joinChannel = (id: string) => apiPost<any>(`/api/channels/${id}/join`, {});
export const leaveChannel = (id: string) => apiPost<any>(`/api/channels/${id}/leave`, {});
export const sendChannelMessage = (id: string, content: string) => apiPost<any>(`/api/channels/${id}/messages`, { content });
export const getChannelMessages = (id: string) => apiGet<any>(`/api/channels/${id}/messages`);
export const transferChannelOwnership = (id: string, targetUserId: string) => apiPost<any>(`/api/channels/${id}/transfer-ownership`, { targetUserId });

// ==========================================
// GROUPS
// ==========================================
export const fetchMyGroups = () => apiGet<any>('/api/groups');
export const getGroup = (id: string) => apiGet<any>(`/api/groups/${id}`);
export const createGroup = (data: any) => apiPost<any>('/api/groups', data);
export const addGroupMember = (id: string, targetUserId: string) => apiPost<any>(`/api/groups/${id}/members`, { targetUserId });
export const removeGroupMember = (id: string, targetUserId: string) => apiDelete<any>(`/api/groups/${id}/members/${targetUserId}`);
export const sendGroupMessage = (id: string, content: string) => apiPost<any>(`/api/groups/${id}/messages`, { content });
export const getGroupMessages = (id: string) => apiGet<any>(`/api/groups/${id}/messages`);
export const transferGroupOwnership = (id: string, targetUserId: string) => apiPost<any>(`/api/groups/${id}/transfer-ownership`, { targetUserId });

// ==========================================
// PROFILE
// ==========================================
export const fetchMyProfile = () => apiGet<any>('/api/profiles/me');
export const fetchPublicProfile = (username: string) => apiGet<any>(`/api/profiles/public/${username}`);
export const updateProfile = (data: any) => apiPut<any>('/api/profiles/me', data);
export const getProfilePosts = () => apiGet<any>('/api/profiles/me/posts');
export const getProfileMedia = () => apiGet<any>('/api/profiles/me/media');
export const followUser = (username: string) => apiPost<any>(`/api/profiles/${username}/follow`, {});
export const unfollowUser = (username: string) => apiDelete<any>(`/api/profiles/${username}/follow`);

// ==========================================
// MESSAGES
// ==========================================
export const fetchChats = () => apiGet<any>('/api/messages');
export const getConversation = (id: string) => apiGet<any>(`/api/messages/${id}`);
export const sendMessage = (conversationId: string, content: string, type?: string) => apiPost<any>('/api/messages/send', { conversationId, content, type });
export const createConversation = (participantIds: string[]) => apiPost<any>('/api/messages/start', { participantIds });

// ==========================================
// NOTIFICATIONS
// ==========================================
export const fetchNotifications = () => apiGet<any>('/api/notifications');
export const getUnreadCount = () => apiGet<any>('/api/notifications/unread-count');
export const markNotificationRead = (id: string) => apiPut<any>(`/api/notifications/${id}/read`, {});
export const markAllNotificationsRead = () => apiPut<any>('/api/notifications/read-all', {});

// ==========================================
// WALLET
// ==========================================
export const fetchWallet = () => apiGet<any>('/api/wallets/me');
export const fetchWalletTransactions = () => apiGet<any>('/api/wallets/transactions');
export const fetchCoinTransactions = () => apiGet<any>('/api/wallets/coin-transactions');
export const fetchGiftHistory = (limit?: number) =>
  apiGet<any>(`/api/wallets/gift-history${limit ? `?limit=${limit}` : ''}`);
export const saveWalletAddress = (address: string) => apiPost<any>('/api/wallets/address', { address });
export const requestWithdrawal = (data: { amount: number; walletAddress: string }) =>
  apiPost<any>('/api/wallets/withdraw', data);
export const fetchWithdrawals = () => apiGet<any>('/api/wallets/withdrawals');

// ==========================================
// LIVE
// ==========================================
export const fetchLiveStreams = () => apiGet<any>('/api/live');
export const fetchLiveCategories = () => apiGet<any>('/api/live/categories');
export const getStream = (id: string) => apiGet<any>(`/api/live/${id}`);
export const goLive = (data: any) => apiPost<any>('/api/live/go-live', data);
export const endStream = (id: string) => apiPut<any>(`/api/live/${id}/end`, {});
export const followStream = (id: string) => apiPost<any>(`/api/live/${id}/follow`, {});

// ==========================================
// GIFTS
// ==========================================
export const fetchGifts = () => apiGet<any>('/api/gifts');

// ==========================================
// SETTINGS
// ==========================================
export const fetchSettings = () => apiGet<any>('/api/settings');
export const updateSettings = (data: any) => apiPut<any>('/api/settings', data);
export const changePassword = (currentPassword: string, newPassword: string) => apiPut<any>('/api/settings/password', { currentPassword, newPassword });

// ==========================================
// MONETIZATION - VANTA Coins & Packages
// ==========================================
export const fetchCoinPackages = () => apiGet<any>('/api/monetization/packages');
export const createPurchaseOrder = (packageId: string) => apiPost<any>('/api/monetization/purchase', { packageId });
export const completePurchase = (orderId: string, providerOrderId: string, paymentMethod?: string) =>
  apiPost<any>('/api/monetization/purchase/complete', { orderId, providerOrderId, paymentMethod });

// ==========================================
// MONETIZATION - Gifts
// ==========================================
export const fetchMonetizationGifts = (category?: string) =>
  apiGet<any>(`/api/monetization/gifts${category ? `?category=${category}` : ''}`);
export const getGiftById = (id: string) => apiGet<any>(`/api/monetization/gifts/${id}`);
export const sendGift = (receiverId: string, giftId: string, options?: { streamId?: string; isAnon?: boolean; isSuper?: boolean; requestId?: string }) =>
  apiPost<any>('/api/monetization/gifts/send', { receiverId, giftId, requestId: options?.requestId || createGiftRequestId(), ...options });

const createGiftRequestId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;

// ==========================================
// MONETIZATION - Wallet & History
// ==========================================
export const fetchMonetizationWallet = () => apiGet<any>('/api/monetization/wallet');
export const fetchMonetizationTransactions = (type?: string, limit?: number) =>
  apiGet<any>(`/api/monetization/wallet/transactions${type ? `?type=${type}` : ''}${limit ? `${type ? '&' : '?'}limit=${limit}` : ''}`);
export const fetchMonetizationGiftHistory = (limit?: number) =>
  apiGet<any>(`/api/monetization/gift-history${limit ? `?limit=${limit}` : ''}`);

// ==========================================
// MONETIZATION - Creator Earnings
// ==========================================
export const fetchCreatorEarnings = () => apiGet<any>('/api/monetization/earnings');

// ==========================================
// MONETIZATION - Subscriptions
// ==========================================
export const subscribeToCreator = (creatorId: string, tier: string) =>
  apiPost<any>('/api/monetization/subscribe', { creatorId, tier });
export const cancelSubscription = (creatorId: string) =>
  apiPost<any>('/api/monetization/subscribe/cancel', { creatorId });
export const fetchSubscribers = () => apiGet<any>('/api/monetization/subscribers');

// ==========================================
// MONETIZATION - Premium
// ==========================================
export const fetchPremiumPlans = () => apiGet<any>('/api/monetization/premium/plans');
export const purchasePremium = (planSlug: string) =>
  apiPost<any>('/api/monetization/premium/purchase', { planSlug });
export const getPremiumStatus = () => apiGet<any>('/api/monetization/premium/status');

// ==========================================
// MONETIZATION - Leaderboard & Supporters
// ==========================================
export const fetchLeaderboard = (period?: string, type?: string, limit?: number) =>
  apiGet<any>(`/api/monetization/leaderboard?period=${period || 'WEEKLY'}&type=${type || 'TOP_SPENDER'}&limit=${limit || 20}`);
export const fetchTopSupporters = (creatorId: string, limit?: number) =>
  apiGet<any>(`/api/monetization/top-supporters/${creatorId}${limit ? `?limit=${limit}` : ''}`);

// ==========================================
// VANTA HOMES - Property rental marketplace
// ==========================================
// `useAuth()` exposes `token: string | null`, while apiClient accepts
// `string | undefined`. Normalize once so every Homes call compiles.
const authToken = (token?: string | null): string | undefined => token ?? undefined;
export const fetchHomes = (params: {
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
}) => {
  const qs = new URLSearchParams();
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.city) qs.set('city', params.city);
  if (params.area) qs.set('area', params.area);
  if (params.propertyType) qs.set('propertyType', params.propertyType);
  if (params.minRent) qs.set('minRent', params.minRent);
  if (params.maxRent) qs.set('maxRent', params.maxRent);
  if (params.bedrooms) qs.set('bedrooms', params.bedrooms);
  if (params.bathrooms) qs.set('bathrooms', params.bathrooms);
  if (params.furnished !== undefined) qs.set('furnished', params.furnished);
  if (params.search) qs.set('search', params.search);
  if (params.sort) qs.set('sort', params.sort);
  return apiGet<any>(`/api/homes?${qs.toString()}`);
};

export const fetchHome = (id: string, token?: string | null) =>
  // Optional auth: the backend derives viewerId from the Authorization header
  // (optionallyAuthenticateJWT -> req.user.userId). That is what powers
  // `isSaved` and lets owners preview their own non-published listings.
  apiGet<any>(`/api/homes/${id}`, authToken(token));

export const fetchHomePropertyTypes = () => apiGet<any>('/api/homes/property-types');
export const fetchHomeRentPeriods = () => apiGet<any>('/api/homes/rent-periods');
export const fetchHomeContactOptions = (id: string) =>
  apiGet<any>(`/api/homes/${id}/contact-options`);

export const createHomeListing = (data: any, token?: string | null) =>
  apiPost<any>('/api/homes', data, authToken(token));
export const updateHomeListing = (id: string, data: any, token?: string | null) =>
  apiPut<any>(`/api/homes/${id}`, data, authToken(token));
export const submitHomeListingForReview = (id: string, token?: string | null) =>
  apiPost<any>(`/api/homes/${id}/submit-for-review`, {}, authToken(token));
export const archiveHomeListing = (id: string, token?: string | null) =>
  apiDelete<any>(`/api/homes/${id}`, authToken(token));
export const setHomeListingAvailability = (id: string, status: string, token?: string | null) =>
  apiPost<any>(`/api/homes/${id}/availability`, { status }, authToken(token));

export const fetchMyHomes = (params?: { cursor?: string; limit?: number; status?: string }, token?: string | null) => {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.status) qs.set('status', params.status);
  return apiGet<any>(`/api/homes/mine${qs.toString() ? `?${qs.toString()}` : ''}`, authToken(token));
};

export const uploadHomePhotos = (listingId: string, formData: FormData, token?: string | null) =>
  apiUpload<any>(`/api/homes/${listingId}/media/photos`, formData, authToken(token));
export const uploadHomeVideos = (listingId: string, formData: FormData, token?: string | null) =>
  apiUpload<any>(`/api/homes/${listingId}/media/videos`, formData, authToken(token));
export const updateHomeMedia = (listingId: string, mediaId: string, data: any, token?: string | null) =>
  apiPut<any>(`/api/homes/${listingId}/media/${mediaId}`, data, authToken(token));
export const deleteHomeMedia = (listingId: string, mediaId: string, token?: string | null) =>
  apiDelete<any>(`/api/homes/${listingId}/media/${mediaId}`, authToken(token));

export const toggleSaveHome = (listingId: string, token?: string | null) =>
  apiPost<any>(`/api/homes/${listingId}/save`, {}, authToken(token));
export const fetchSavedHomes = (params?: { cursor?: string; limit?: number }, token?: string | null) => {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  return apiGet<any>(`/api/homes/saved${qs.toString() ? `?${qs.toString()}` : ''}`, authToken(token));
};

export const contactHomeListing = (listingId: string, message?: string, token?: string | null) =>
  apiPost<any>(`/api/homes/${listingId}/contact`, { message }, authToken(token));
export const fetchHomeEnquiries = (listingId: string, params?: { cursor?: string; limit?: number }, token?: string | null) => {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  return apiGet<any>(`/api/homes/${listingId}/enquiries${qs.toString() ? `?${qs.toString()}` : ''}`, authToken(token));
};

export const submitHomeVerification = (data: any, token?: string | null) =>
  apiPost<any>('/api/homes/verification', data, authToken(token));
export const fetchMyHomeVerification = (token?: string | null) =>
  apiGet<any>('/api/homes/verification', authToken(token));

export const createHomeReport = (data: any) => apiPost<any>('/api/homes/reports', data);

// ==========================================
// VANTA HOMES - Admin
// ==========================================
export const fetchAdminHomes = (params?: any) => {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.status) qs.set('status', params.status);
  if (params?.propertyType) qs.set('propertyType', params.propertyType);
  if (params?.city) qs.set('city', params.city);
  if (params?.owner) qs.set('owner', params.owner);
  if (params?.search) qs.set('search', params.search);
  return apiGet<any>(`/api/homes/admin${qs.toString() ? `?${qs.toString()}` : ''}`);
};
export const fetchAdminHomeVerifications = (params?: any) => {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.type) qs.set('type', params.type);
  if (params?.status) qs.set('status', params.status);
  return apiGet<any>(`/api/homes/admin/verifications${qs.toString() ? `?${qs.toString()}` : ''}`);
};
export const decideHomeVerification = (id: string, data: any) =>
  apiPost<any>(`/api/homes/admin/verifications/${id}/decide`, data);
export const fetchAdminHomeReports = (params?: any) => {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.status) qs.set('status', params.status);
  return apiGet<any>(`/api/homes/admin/reports${qs.toString() ? `?${qs.toString()}` : ''}`);
};
export const resolveHomeReport = (id: string, data: any) =>
  apiPost<any>(`/api/homes/admin/reports/${id}/resolve`, data);
export const fetchAdminHomeAuditLogs = (params?: any) => {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.listingId) qs.set('listingId', params.listingId);
  if (params?.actorId) qs.set('actorId', params.actorId);
  if (params?.action) qs.set('action', params.action);
  return apiGet<any>(`/api/homes/admin/audit${qs.toString() ? `?${qs.toString()}` : ''}`);
};
