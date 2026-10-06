-- ============================================================================
-- VANTA — PRODUCTION SCHEMA BASELINE (PostgreSQL)
-- ============================================================================
-- Adopts the existing db-push-managed production database into Prisma Migrate.
--
-- WHY THIS FILE EXISTS
--   The previous migration history under prisma/migrations/ was generated for a
--   SQLite dev database (PRAGMA directives, DATETIME columns, table-rebuild
--   pattern) and can never run against the PostgreSQL production database on
--   Railway. Production schema was instead kept in sync with `prisma db push`,
--   which is exactly why the new CoinTransfer.requestId unique index blocked
--   the deployment: `prisma db push` refuses to add a unique constraint when it
--   cannot prove there are no duplicate values, and the old additive-replay
--   escape hatch (prisma/startup-sync.sql) did not cover the CoinTransfer
--   change. This baseline — together with `prisma migrate deploy` as the only
--   production schema-management mechanism — replaces that entire scheme.
--
-- WHAT THIS MIGRATION DOES
--   It is the exact PostgreSQL DDL of the production schema (every table,
--   index and foreign key) emitted by the Prisma engine from the datamodel,
--   made idempotent so it is safe to run against BOTH:
--     * a brand-new empty database (it creates the full schema), and
--     * the live production database (objects that already exist, including
--       all 12 COMPLETED CoinTransfer rows and every wallet balance, are
--       never touched — CREATE TABLE IF NOT EXISTS skips existing tables
--       without altering or deleting rows).
--
-- DATA SAFETY: strictly additive. No DROP, no TRUNCATE, no DELETE, no UPDATE.
-- Existing rows are never modified; new objects are only ADDED when missing.
--
-- Post-baseline migrations (20261006000000_transfer_otp_challenges,
-- 20261006000001_wallet_reconciliation, 20261006000002_phone_otp_table) are
-- then applied on top by `prisma migrate deploy`, adding the CoinTransfer
-- idempotency column/unique index and the new tables WITHOUT touching the 12
-- existing COMPLETED transfers (requestId is NULL for legacy rows, and
-- PostgreSQL unique indexes treat NULLs as distinct).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "phoneNumber" TEXT,
    "passwordHash" TEXT,
    "username" TEXT NOT NULL,
    "fullName" TEXT,
    "bio" TEXT,
    "gender" TEXT,
    "interestedIn" TEXT,
    "age" INTEGER,
    "country" TEXT,
    "city" TEXT,
    "avatar" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "earnings" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "googleId" TEXT,
    "appleId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "loginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "rememberMeToken" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "backupCodes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WelcomeReward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 100,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WelcomeReward_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CoinTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "reference" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UploadedFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "path" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "recordType" TEXT,
    "recordId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UploadSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "receivedChunks" INTEGER NOT NULL DEFAULT 0,
    "receivedBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "recordType" TEXT,
    "recordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Profile" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "bannerUrl" TEXT,
    "website" TEXT,
    "gender" TEXT,
    "age" INTEGER,
    "country" TEXT,
    "city" TEXT,
    "interests" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "creatorCategory" TEXT,
    "occupation" TEXT,
    "languages" TEXT,
    "pronouns" TEXT,
    "businessEmail" TEXT,
    "theme" TEXT,
    "featuredContent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SocialLink" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProfileMedia" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'IMAGE',
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileMedia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Photo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Follow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Story" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
    "caption" TEXT,
    "publishStatus" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "textStyle" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 5000,
    "resharedFromId" TEXT,
    "resharedFromUserId" TEXT,
    "resharedFromUsername" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StoryView" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StoryLike" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryLike_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StoryComment" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContentView" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Community" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatar" TEXT,
    "bannerUrl" TEXT,
    "category" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommunityMember" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommunityPost" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatar" TEXT,
    "category" TEXT,
    "ownerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChannelMember" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "ChannelMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChannelMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatar" TEXT,
    "ownerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GroupMessage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Video" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "videoUrl" TEXT,
    "thumbnailUrl" TEXT,
    "duration" DOUBLE PRECISION,
    "views" INTEGER NOT NULL DEFAULT 0,
    "publishStatus" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VideoLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoLike_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VideoComment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VideoSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoSave_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WatchHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "watchTime" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Post" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PostSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostSave_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PostLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PostComment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PostCommentLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostCommentLike_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL DEFAULT 'DIRECT',
    "name" TEXT,
    "avatar" TEXT,
    "description" TEXT,
    "handle" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "createdById" TEXT,
    "permissions" TEXT,
    "commentsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Participant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "mutedAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "replyToId" TEXT,
    "pinnedAt" TIMESTAMP(3),
    "pinnedById" TEXT,
    "deletedFor" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "storyReplyStoryId" TEXT,
    "storyReplyMediaUrl" TEXT,
    "storyReplyCaption" TEXT,
    "storyReplyAuthor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MessageRead" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reaction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Attachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserPresence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastActive" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPresence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LiveStream" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "streamKey" TEXT,
    "playbackUrl" TEXT,
    "liveKitRoom" TEXT,
    "liveKitToken" TEXT,
    "viewerCount" INTEGER NOT NULL DEFAULT 0,
    "peakViewers" INTEGER NOT NULL DEFAULT 0,
    "totalViewers" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "gifts" INTEGER NOT NULL DEFAULT 0,
    "allowGifts" BOOLEAN NOT NULL DEFAULT true,
    "allowPK" BOOLEAN NOT NULL DEFAULT false,
    "allowGuests" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'LIVE',
    "categoryName" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "country" TEXT,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recordingUrl" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lastHostHeartbeat" TIMESTAMP(3),
    "chatPaused" BOOLEAN NOT NULL DEFAULT false,
    "slowMode" BOOLEAN NOT NULL DEFAULT false,
    "slowModeInterval" INTEGER NOT NULL DEFAULT 3,
    "mutedUsers" TEXT,
    "bannedUsers" TEXT,
    "moderators" TEXT,
    "coHostId" TEXT,
    "guests" TEXT,
    "approvedGuests" TEXT,
    "screenShare" BOOLEAN NOT NULL DEFAULT false,
    "beautyMode" BOOLEAN NOT NULL DEFAULT false,
    "backgroundBlur" BOOLEAN NOT NULL DEFAULT false,
    "noiseSuppression" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveStream_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LiveReaction" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveReaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StreamCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "StreamCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LiveChatMessage" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StreamViewer" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamViewer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StreamFollower" (
    "id" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamFollower_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "themeMode" TEXT NOT NULL DEFAULT 'dark',
    "accent" TEXT NOT NULL DEFAULT 'monochrome',
    "density" TEXT NOT NULL DEFAULT 'comfortable',
    "language" TEXT NOT NULL DEFAULT 'en',
    "readReceipts" BOOLEAN NOT NULL DEFAULT true,
    "activityStatus" BOOLEAN NOT NULL DEFAULT true,
    "typingIndicators" BOOLEAN NOT NULL DEFAULT true,
    "messagePreviews" BOOLEAN NOT NULL DEFAULT true,
    "chatNotifications" BOOLEAN NOT NULL DEFAULT true,
    "privacyProfile" TEXT NOT NULL DEFAULT 'public',
    "privacyMessages" TEXT NOT NULL DEFAULT 'everyone',
    "privacyFollows" TEXT NOT NULL DEFAULT 'everyone',
    "privacyCalls" TEXT NOT NULL DEFAULT 'everyone',
    "privacyStories" TEXT NOT NULL DEFAULT 'everyone',
    "privacyLiveStream" TEXT NOT NULL DEFAULT 'everyone',
    "privacyTagging" TEXT NOT NULL DEFAULT 'everyone',
    "privacyInvites" TEXT NOT NULL DEFAULT 'everyone',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NotificationPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailAlerts" BOOLEAN NOT NULL DEFAULT true,
    "pushAlerts" BOOLEAN NOT NULL DEFAULT true,
    "chatAlerts" BOOLEAN NOT NULL DEFAULT true,
    "liveAlerts" BOOLEAN NOT NULL DEFAULT true,
    "likesAlerts" BOOLEAN NOT NULL DEFAULT true,
    "commentsAlerts" BOOLEAN NOT NULL DEFAULT true,
    "mentionsAlerts" BOOLEAN NOT NULL DEFAULT true,
    "followersAlerts" BOOLEAN NOT NULL DEFAULT true,
    "groupAlerts" BOOLEAN NOT NULL DEFAULT true,
    "channelAlerts" BOOLEAN NOT NULL DEFAULT true,
    "liveInteractionsAlerts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BlockedUser" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MutedUser" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MutedUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SecurityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "refreshToken" TEXT,
    "deviceFingerprint" TEXT,
    "isTrusted" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oauthExchangeCode" TEXT,
    "oauthExchangeExpiresAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProviderAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OAuthState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "redirect" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "linkingUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DeviceFingerprint" (
    "id" TEXT NOT NULL,
    "fingerprintId" TEXT NOT NULL,
    "userId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "isSuspicious" BOOLEAN NOT NULL DEFAULT false,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceFingerprint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IPReputation" (
    "id" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IPReputation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DataExportRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filePath" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataExportRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "signature" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SparkCoinPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "bonusCoins" INTEGER NOT NULL DEFAULT 0,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SparkCoinPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageId" TEXT,
    "coins" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerOrderId" TEXT,
    "paymentMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "packageName" TEXT,
    "paymentMode" TEXT,
    "providerReference" TEXT,
    "expiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundedBy" TEXT,
    "refundReason" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Gift" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "icon" TEXT,
    "image" TEXT,
    "emoji" TEXT,
    "category" TEXT NOT NULL DEFAULT 'popular',
    "subcategory" TEXT,
    "description" TEXT,
    "animationUrl" TEXT,
    "animationType" TEXT NOT NULL DEFAULT 'float',
    "thumbnailUrl" TEXT,
    "glowColor" TEXT,
    "particleColor" TEXT,
    "soundEffect" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isTrending" BOOLEAN NOT NULL DEFAULT false,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isLimited" BOOLEAN NOT NULL DEFAULT false,
    "isLegendary" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "comboEnabled" BOOLEAN NOT NULL DEFAULT true,
    "comboMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "animationDuration" INTEGER NOT NULL DEFAULT 3,
    "artworkType" TEXT NOT NULL DEFAULT 'artifact',
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "tier" TEXT NOT NULL DEFAULT 'low',
    "impactLevel" INTEGER NOT NULL DEFAULT 1,
    "effectProfile" TEXT NOT NULL DEFAULT 'shimmer',
    "previewAssetUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GiftTransaction" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "streamId" TEXT,
    "amount" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "isCombo" BOOLEAN NOT NULL DEFAULT false,
    "comboCount" INTEGER NOT NULL DEFAULT 1,
    "isAnon" BOOLEAN NOT NULL DEFAULT false,
    "isSuper" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LiveGiftEvent" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "giftName" TEXT NOT NULL,
    "giftEmoji" TEXT,
    "amount" INTEGER NOT NULL,
    "isCombo" BOOLEAN NOT NULL DEFAULT false,
    "comboCount" INTEGER NOT NULL DEFAULT 1,
    "isLegendary" BOOLEAN NOT NULL DEFAULT false,
    "isAnon" BOOLEAN NOT NULL DEFAULT false,
    "senderName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveGiftEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Wallet" (
    "id" TEXT NOT NULL,
    "coinBalance" INTEGER NOT NULL DEFAULT 0,
    "ceoAllocationGrantedAt" TIMESTAMP(3),
    "earningsBalance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "lifetimeEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalCoinsPurchased" INTEGER NOT NULL DEFAULT 0,
    "totalCoinsReceived" INTEGER NOT NULL DEFAULT 0,
    "totalCoinsSent" INTEGER NOT NULL DEFAULT 0,
    "totalGiftsSent" INTEGER NOT NULL DEFAULT 0,
    "totalGiftsReceived" INTEGER NOT NULL DEFAULT 0,
    "totalWithdrawn" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "bonusCoins" INTEGER NOT NULL DEFAULT 0,
    "lockedCoins" INTEGER NOT NULL DEFAULT 0,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMP(3),
    "frozenBy" TEXT,
    "freezeReason" TEXT,
    "usdtWalletAddress" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WalletPIN" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletPIN_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TransferLimit" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "dailyLimit" INTEGER NOT NULL DEFAULT 10000000,
    "dailyUsed" INTEGER NOT NULL DEFAULT 0,
    "lastResetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "singleTxLimit" INTEGER NOT NULL DEFAULT 10000000,
    "otpThreshold" INTEGER NOT NULL DEFAULT 10000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferLimit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "description" TEXT,
    "reference" TEXT,
    "metadata" TEXT,
    "balanceBefore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Withdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "netAmount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'USDT_BEP20',
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "walletAddress" TEXT,
    "cryptoNetwork" TEXT DEFAULT 'BNB_SMART_CHAIN',
    "adminNotes" TEXT,
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CoinTransfer" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "netAmount" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "otpCode" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "deviceFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinTransfer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WalletAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mediaUrl" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
    "ctaText" TEXT NOT NULL DEFAULT 'Learn More',
    "ctaUrl" TEXT,
    "ctaInternal" TEXT,
    "targetCountry" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "maxImpressions" INTEGER,
    "maxClicks" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdImpression" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdImpression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdClick" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdClick_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlatformSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'STRING',
    "description" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CreatorSubscription" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'BRONZE',
    "price" INTEGER NOT NULL DEFAULT 499,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SubscriptionTier" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'BRONZE',
    "price" INTEGER NOT NULL DEFAULT 499,
    "description" TEXT,
    "benefits" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PremiumMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'MONTHLY',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CreatorMilestone" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "milestone" TEXT NOT NULL,
    "achieved" BOOLEAN NOT NULL DEFAULT false,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "rewarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorMilestone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GiftCombo" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "streamId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCombo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeaderboardEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LoyaltyLevel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'BRONZE',
    "perks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyLevel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "referenceKey" TEXT,
    "data" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EventGift" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventGift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DEPLOYED',
    "config" TEXT,
    "metrics" TEXT,
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserEmbedding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "modelVersion" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContentEmbedding" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserInterest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interestType" TEXT NOT NULL,
    "interestValue" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInterest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Recommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "modelVersion" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InteractionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" TEXT,
    "sessionId" TEXT,
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InteractionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ModerationQueue" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reportedBy" TEXT,
    "reason" TEXT,
    "aiScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "aiCategories" TEXT,
    "aiSummary" TEXT,
    "humanReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationQueue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ModerationAction" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "automated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIContent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "inputContext" TEXT,
    "generatedContent" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "editedContent" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIContent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AITranslation" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sourceLang" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "translatedText" TEXT NOT NULL,
    "modelVersion" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AITranslation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIAnalytics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "insights" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FraudAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT,
    "aiConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIAccessibility" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "featureType" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "language" TEXT,
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIAccessibility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIInsight" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "insightType" TEXT NOT NULL,
    "insight" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInsight_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AISession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "featureType" TEXT NOT NULL,
    "metadata" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AISession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIFeatureFlag" (
    "id" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "featureName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT,
    "userOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIFeatureFlag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceType" TEXT,
    "platform" TEXT,
    "country" TEXT,
    "city" TEXT,
    "referrer" TEXT,
    "metadata" TEXT,
    "value" DOUBLE PRECISION,
    "duration" INTEGER,
    "path" TEXT,
    "elementId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "source" TEXT,
    "campaign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AnalyticsAggregation" (
    "id" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "previousValue" DOUBLE PRECISION,
    "changePercent" DOUBLE PRECISION,
    "breakdown" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsAggregation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AnalyticsSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "duration" INTEGER,
    "pagesViewed" INTEGER NOT NULL DEFAULT 0,
    "events" INTEGER NOT NULL DEFAULT 0,
    "deviceType" TEXT,
    "platform" TEXT,
    "ipAddress" TEXT,
    "country" TEXT,
    "referrer" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RetentionRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cohortDate" TIMESTAMP(3) NOT NULL,
    "dayX" INTEGER NOT NULL,
    "returned" BOOLEAN NOT NULL DEFAULT false,
    "activityDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DashboardSnapshot" (
    "id" TEXT NOT NULL,
    "dashboardType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "data" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "DashboardSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScheduledReport" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "filters" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "nextSendAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GeneratedReport" (
    "id" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "filePath" TEXT,
    "fileSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "recipients" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "generatedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PredictiveModel" (
    "id" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "parameters" TEXT,
    "accuracy" DOUBLE PRECISION,
    "lastTrainedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PredictiveModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Prediction" (
    "id" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "predictionType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetType" TEXT,
    "predictedValue" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "lowerBound" DOUBLE PRECISION,
    "upperBound" DOUBLE PRECISION,
    "period" TEXT NOT NULL,
    "forecastDate" TIMESTAMP(3) NOT NULL,
    "features" TEXT,
    "metadata" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AlertRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metricType" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "comparisonPeriod" TEXT,
    "timeWindow" INTEGER,
    "minTriggerCount" INTEGER NOT NULL DEFAULT 1,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "channels" TEXT NOT NULL,
    "recipients" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AlertEvent" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "condition" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" TEXT,
    "channels" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "channel" TEXT,
    "campaignType" TEXT NOT NULL,
    "budget" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "targetUrl" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MarketingAttribution" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "channel" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceType" TEXT,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAttribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FunnelStep" (
    "id" TEXT NOT NULL,
    "funnelName" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepName" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FunnelEvent" (
    "id" TEXT NOT NULL,
    "funnelName" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "timeSpent" INTEGER,
    "dropped" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FeatureUsage" (
    "id" TEXT NOT NULL,
    "featureName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "duration" INTEGER,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CreatorDailyAnalytics" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "profileViews" INTEGER NOT NULL DEFAULT 0,
    "followersGained" INTEGER NOT NULL DEFAULT 0,
    "followersLost" INTEGER NOT NULL DEFAULT 0,
    "subscriberCount" INTEGER NOT NULL DEFAULT 0,
    "totalWatchTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "videoCompletionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "streamDuration" INTEGER NOT NULL DEFAULT 0,
    "peakViewers" INTEGER NOT NULL DEFAULT 0,
    "avgViewers" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "giftRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subscriptionRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "newFollowers" INTEGER NOT NULL DEFAULT 0,
    "liveStreamCount" INTEGER NOT NULL DEFAULT 0,
    "videoUploadCount" INTEGER NOT NULL DEFAULT 0,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "storyCount" INTEGER NOT NULL DEFAULT 0,
    "chatMessages" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "revenueBreakdown" TEXT,
    "audienceDemographics" TEXT,
    "trafficSources" TEXT,
    "topContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorDailyAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LiveStreamAnalytics" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "concurrentViewers" INTEGER NOT NULL DEFAULT 0,
    "peakConcurrent" INTEGER NOT NULL DEFAULT 0,
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "uniqueViewers" INTEGER NOT NULL DEFAULT 0,
    "totalWatchTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgWatchTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewerRetention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "newFollowers" INTEGER NOT NULL DEFAULT 0,
    "giftVolume" INTEGER NOT NULL DEFAULT 0,
    "coinRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chatMessages" INTEGER NOT NULL DEFAULT 0,
    "chatParticipants" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "pollParticipants" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "reports" INTEGER NOT NULL DEFAULT 0,
    "avgBitrate" DOUBLE PRECISION,
    "bufferingEvents" INTEGER NOT NULL DEFAULT 0,
    "streamQuality" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "viewerTimeline" TEXT,
    "giftTimeline" TEXT,
    "chatTimeline" TEXT,
    "geolocation" TEXT,
    "deviceBreakdown" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveStreamAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommunityAnalytics" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "activeMembers" INTEGER NOT NULL DEFAULT 0,
    "newMembers" INTEGER NOT NULL DEFAULT 0,
    "postsCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "messagesCount" INTEGER NOT NULL DEFAULT 0,
    "reactionsCount" INTEGER NOT NULL DEFAULT 0,
    "engagementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "moderatorActions" INTEGER NOT NULL DEFAULT 0,
    "reportsCount" INTEGER NOT NULL DEFAULT 0,
    "spamDetected" INTEGER NOT NULL DEFAULT 0,
    "healthScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "retentionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "topContributors" TEXT,
    "activityTimeline" TEXT,
    "hourlyActivity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SearchAnalytics" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "userId" TEXT,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "clicked" BOOLEAN NOT NULL DEFAULT false,
    "clickTarget" TEXT,
    "clickTargetId" TEXT,
    "clickPosition" INTEGER,
    "zeroResults" BOOLEAN NOT NULL DEFAULT false,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TrendingTopic" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "velocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "category" TEXT,
    "metadata" TEXT,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendingTopic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "opened" BOOLEAN NOT NULL DEFAULT false,
    "clicked" BOOLEAN NOT NULL DEFAULT false,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserLTV" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSpend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPurchases" INTEGER NOT NULL DEFAULT 0,
    "totalGifts" INTEGER NOT NULL DEFAULT 0,
    "totalSubscriptions" INTEGER NOT NULL DEFAULT 0,
    "daysActive" INTEGER NOT NULL DEFAULT 0,
    "predictedLTV" DOUBLE PRECISION,
    "tier" TEXT NOT NULL DEFAULT 'BRONZE',
    "lastCalculated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLTV_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScreenAnalytics" (
    "id" TEXT NOT NULL,
    "screenName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "uniqueViews" INTEGER NOT NULL DEFAULT 0,
    "avgTimeOnScreen" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exits" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "APIPerformance" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTime" DOUBLE PRECISION NOT NULL,
    "userId" TEXT,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APIPerformance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QueryPerformance" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryPerformance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdRevenue" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cpm" DOUBLE PRECISION,
    "cpc" DOUBLE PRECISION,
    "fillRate" DOUBLE PRECISION,
    "ecpm" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdRevenue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ARPUAnalytics" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "arpu" DOUBLE PRECISION NOT NULL,
    "payingUsers" INTEGER NOT NULL DEFAULT 0,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ARPUAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VerificationBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokeReason" TEXT,
    "sourcePurchaseId" TEXT,
    "planId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationBadge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VerificationPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "network" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerOrderId" TEXT,
    "providerReference" TEXT,
    "paymentMode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundedBy" TEXT,
    "refundReason" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationPurchase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VerificationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "documents" TEXT,
    "notes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT,
    "benefits" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "badgeType" TEXT NOT NULL DEFAULT 'GOLD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CreatorMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3) NOT NULL,
    "renewalDate" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "paymentTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CryptoPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CryptoPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VerificationHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedBy" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FollowerRewardCampaign" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "eligibilityType" TEXT NOT NULL,
    "totalAllocation" INTEGER NOT NULL,
    "rewardPerUser" INTEGER NOT NULL,
    "coinAmount" INTEGER,
    "giftId" TEXT,
    "reservedAmount" INTEGER NOT NULL,
    "distributedAmount" INTEGER NOT NULL DEFAULT 0,
    "remainingAmount" INTEGER NOT NULL,
    "claimedUsers" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowerRewardCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FollowerRewardClaim" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "coinAmount" INTEGER,
    "giftId" TEXT,
    "giftSnapshot" TEXT,
    "walletTransactionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowerRewardClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User"("phone");

CREATE UNIQUE INDEX IF NOT EXISTS "User_phoneNumber_key" ON "User"("phoneNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId");

CREATE UNIQUE INDEX IF NOT EXISTS "User_appleId_key" ON "User"("appleId");

CREATE INDEX IF NOT EXISTS "User_username_status_idx" ON "User"("username", "status");

CREATE INDEX IF NOT EXISTS "User_email_status_idx" ON "User"("email", "status");

CREATE INDEX IF NOT EXISTS "User_role_status_idx" ON "User"("role", "status");

CREATE INDEX IF NOT EXISTS "User_status_createdAt_idx" ON "User"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "User_premium_status_idx" ON "User"("premium", "status");

CREATE INDEX IF NOT EXISTS "User_country_status_idx" ON "User"("country", "status");

CREATE INDEX IF NOT EXISTS "User_city_status_idx" ON "User"("city", "status");

CREATE INDEX IF NOT EXISTS "User_gender_interestedIn_status_idx" ON "User"("gender", "interestedIn", "status");

CREATE INDEX IF NOT EXISTS "User_age_status_idx" ON "User"("age", "status");

CREATE INDEX IF NOT EXISTS "User_lastLoginAt_idx" ON "User"("lastLoginAt");

CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "WelcomeReward_userId_key" ON "WelcomeReward"("userId");

CREATE INDEX IF NOT EXISTS "WelcomeReward_userId_idx" ON "WelcomeReward"("userId");

CREATE INDEX IF NOT EXISTS "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "CoinTransaction_userId_type_createdAt_idx" ON "CoinTransaction"("userId", "type", "createdAt");

CREATE INDEX IF NOT EXISTS "CoinTransaction_type_createdAt_idx" ON "CoinTransaction"("type", "createdAt");

CREATE INDEX IF NOT EXISTS "UploadedFile_userId_category_idx" ON "UploadedFile"("userId", "category");

CREATE INDEX IF NOT EXISTS "UploadedFile_userId_createdAt_idx" ON "UploadedFile"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "UploadedFile_recordType_recordId_idx" ON "UploadedFile"("recordType", "recordId");

CREATE INDEX IF NOT EXISTS "UploadedFile_category_createdAt_idx" ON "UploadedFile"("category", "createdAt");

CREATE INDEX IF NOT EXISTS "UploadedFile_deletedAt_idx" ON "UploadedFile"("deletedAt");

CREATE INDEX IF NOT EXISTS "UploadSession_userId_status_idx" ON "UploadSession"("userId", "status");

CREATE INDEX IF NOT EXISTS "UploadSession_recordType_recordId_idx" ON "UploadSession"("recordType", "recordId");

CREATE INDEX IF NOT EXISTS "UploadSession_expiresAt_idx" ON "UploadSession"("expiresAt");

CREATE INDEX IF NOT EXISTS "TrustedDevice_deviceId_idx" ON "TrustedDevice"("deviceId");

CREATE INDEX IF NOT EXISTS "TrustedDevice_userId_expiresAt_idx" ON "TrustedDevice"("userId", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "TrustedDevice_userId_deviceId_key" ON "TrustedDevice"("userId", "deviceId");

CREATE UNIQUE INDEX IF NOT EXISTS "Profile_username_key" ON "Profile"("username");

CREATE UNIQUE INDEX IF NOT EXISTS "Profile_userId_key" ON "Profile"("userId");

CREATE INDEX IF NOT EXISTS "Profile_country_idx" ON "Profile"("country");

CREATE INDEX IF NOT EXISTS "Profile_isOnline_idx" ON "Profile"("isOnline");

CREATE INDEX IF NOT EXISTS "Profile_country_isOnline_idx" ON "Profile"("country", "isOnline");

CREATE INDEX IF NOT EXISTS "Profile_gender_age_idx" ON "Profile"("gender", "age");

CREATE INDEX IF NOT EXISTS "Profile_creatorCategory_idx" ON "Profile"("creatorCategory");

CREATE INDEX IF NOT EXISTS "SocialLink_profileId_idx" ON "SocialLink"("profileId");

CREATE UNIQUE INDEX IF NOT EXISTS "SocialLink_profileId_platform_key" ON "SocialLink"("profileId", "platform");

CREATE INDEX IF NOT EXISTS "ProfileMedia_profileId_type_idx" ON "ProfileMedia"("profileId", "type");

CREATE INDEX IF NOT EXISTS "Photo_userId_createdAt_idx" ON "Photo"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "Follow_followingId_createdAt_idx" ON "Follow"("followingId", "createdAt");

CREATE INDEX IF NOT EXISTS "Follow_followerId_createdAt_idx" ON "Follow"("followerId", "createdAt");

CREATE INDEX IF NOT EXISTS "Follow_followingId_followerId_idx" ON "Follow"("followingId", "followerId");

CREATE UNIQUE INDEX IF NOT EXISTS "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

CREATE INDEX IF NOT EXISTS "Story_userId_expiresAt_idx" ON "Story"("userId", "expiresAt");

CREATE INDEX IF NOT EXISTS "Story_publishStatus_idx" ON "Story"("publishStatus");

CREATE INDEX IF NOT EXISTS "Story_expiresAt_idx" ON "Story"("expiresAt");

CREATE INDEX IF NOT EXISTS "Story_userId_createdAt_expiresAt_idx" ON "Story"("userId", "createdAt", "expiresAt");

CREATE INDEX IF NOT EXISTS "Story_resharedFromId_idx" ON "Story"("resharedFromId");

CREATE INDEX IF NOT EXISTS "StoryView_userId_storyId_idx" ON "StoryView"("userId", "storyId");

CREATE INDEX IF NOT EXISTS "StoryView_viewedAt_idx" ON "StoryView"("viewedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "StoryView_storyId_userId_key" ON "StoryView"("storyId", "userId");

CREATE UNIQUE INDEX IF NOT EXISTS "StoryLike_storyId_userId_key" ON "StoryLike"("storyId", "userId");

CREATE INDEX IF NOT EXISTS "StoryComment_storyId_createdAt_idx" ON "StoryComment"("storyId", "createdAt");

CREATE INDEX IF NOT EXISTS "ContentView_contentType_contentId_viewedAt_idx" ON "ContentView"("contentType", "contentId", "viewedAt");

CREATE INDEX IF NOT EXISTS "ContentView_userId_viewedAt_idx" ON "ContentView"("userId", "viewedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ContentView_contentId_userId_contentType_key" ON "ContentView"("contentId", "userId", "contentType");

CREATE UNIQUE INDEX IF NOT EXISTS "Community_name_key" ON "Community"("name");

CREATE INDEX IF NOT EXISTS "Community_category_isPrivate_idx" ON "Community"("category", "isPrivate");

CREATE INDEX IF NOT EXISTS "Community_createdAt_idx" ON "Community"("createdAt");

CREATE INDEX IF NOT EXISTS "Community_name_idx" ON "Community"("name");

CREATE INDEX IF NOT EXISTS "Community_category_createdAt_isPrivate_idx" ON "Community"("category", "createdAt", "isPrivate");

CREATE INDEX IF NOT EXISTS "CommunityMember_userId_idx" ON "CommunityMember"("userId");

CREATE INDEX IF NOT EXISTS "CommunityMember_communityId_role_idx" ON "CommunityMember"("communityId", "role");

CREATE UNIQUE INDEX IF NOT EXISTS "CommunityMember_communityId_userId_key" ON "CommunityMember"("communityId", "userId");

CREATE INDEX IF NOT EXISTS "CommunityPost_communityId_createdAt_idx" ON "CommunityPost"("communityId", "createdAt");

CREATE INDEX IF NOT EXISTS "CommunityPost_authorId_idx" ON "CommunityPost"("authorId");

CREATE INDEX IF NOT EXISTS "CommunityPost_communityId_authorId_createdAt_idx" ON "CommunityPost"("communityId", "authorId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Channel_name_key" ON "Channel"("name");

CREATE UNIQUE INDEX IF NOT EXISTS "Channel_conversationId_key" ON "Channel"("conversationId");

CREATE INDEX IF NOT EXISTS "Channel_category_idx" ON "Channel"("category");

CREATE INDEX IF NOT EXISTS "Channel_name_idx" ON "Channel"("name");

CREATE INDEX IF NOT EXISTS "Channel_ownerId_createdAt_idx" ON "Channel"("ownerId", "createdAt");

CREATE INDEX IF NOT EXISTS "ChannelMember_userId_idx" ON "ChannelMember"("userId");

CREATE INDEX IF NOT EXISTS "ChannelMember_channelId_role_idx" ON "ChannelMember"("channelId", "role");

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelMember_channelId_userId_key" ON "ChannelMember"("channelId", "userId");

CREATE INDEX IF NOT EXISTS "ChannelMessage_channelId_createdAt_idx" ON "ChannelMessage"("channelId", "createdAt");

CREATE INDEX IF NOT EXISTS "ChannelMessage_authorId_createdAt_idx" ON "ChannelMessage"("authorId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Group_conversationId_key" ON "Group"("conversationId");

CREATE INDEX IF NOT EXISTS "Group_ownerId_idx" ON "Group"("ownerId");

CREATE INDEX IF NOT EXISTS "Group_name_idx" ON "Group"("name");

CREATE INDEX IF NOT EXISTS "Group_createdAt_idx" ON "Group"("createdAt");

CREATE INDEX IF NOT EXISTS "GroupMember_userId_idx" ON "GroupMember"("userId");

CREATE INDEX IF NOT EXISTS "GroupMember_groupId_role_idx" ON "GroupMember"("groupId", "role");

CREATE UNIQUE INDEX IF NOT EXISTS "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

CREATE INDEX IF NOT EXISTS "GroupMessage_groupId_createdAt_idx" ON "GroupMessage"("groupId", "createdAt");

CREATE INDEX IF NOT EXISTS "GroupMessage_authorId_createdAt_idx" ON "GroupMessage"("authorId", "createdAt");

CREATE INDEX IF NOT EXISTS "Video_creatorId_createdAt_idx" ON "Video"("creatorId", "createdAt");

CREATE INDEX IF NOT EXISTS "Video_views_createdAt_idx" ON "Video"("views", "createdAt");

CREATE INDEX IF NOT EXISTS "Video_createdAt_idx" ON "Video"("createdAt");

CREATE INDEX IF NOT EXISTS "Video_title_idx" ON "Video"("title");

CREATE INDEX IF NOT EXISTS "Video_publishStatus_idx" ON "Video"("publishStatus");

CREATE INDEX IF NOT EXISTS "Video_creatorId_views_createdAt_idx" ON "Video"("creatorId", "views", "createdAt");

CREATE INDEX IF NOT EXISTS "Video_duration_createdAt_idx" ON "Video"("duration", "createdAt");

CREATE INDEX IF NOT EXISTS "VideoLike_videoId_createdAt_idx" ON "VideoLike"("videoId", "createdAt");

CREATE INDEX IF NOT EXISTS "VideoLike_userId_createdAt_idx" ON "VideoLike"("userId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "VideoLike_userId_videoId_key" ON "VideoLike"("userId", "videoId");

CREATE INDEX IF NOT EXISTS "VideoComment_videoId_createdAt_idx" ON "VideoComment"("videoId", "createdAt");

CREATE INDEX IF NOT EXISTS "VideoComment_userId_createdAt_idx" ON "VideoComment"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "VideoSave_userId_idx" ON "VideoSave"("userId");

CREATE INDEX IF NOT EXISTS "VideoSave_videoId_userId_idx" ON "VideoSave"("videoId", "userId");

CREATE UNIQUE INDEX IF NOT EXISTS "VideoSave_userId_videoId_key" ON "VideoSave"("userId", "videoId");

CREATE INDEX IF NOT EXISTS "WatchHistory_userId_updatedAt_idx" ON "WatchHistory"("userId", "updatedAt");

CREATE INDEX IF NOT EXISTS "WatchHistory_userId_completed_updatedAt_idx" ON "WatchHistory"("userId", "completed", "updatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "WatchHistory_userId_videoId_key" ON "WatchHistory"("userId", "videoId");

CREATE INDEX IF NOT EXISTS "Post_authorId_createdAt_idx" ON "Post"("authorId", "createdAt");

CREATE INDEX IF NOT EXISTS "Post_createdAt_idx" ON "Post"("createdAt");

CREATE INDEX IF NOT EXISTS "Post_pinned_authorId_idx" ON "Post"("pinned", "authorId");

CREATE INDEX IF NOT EXISTS "Post_authorId_pinned_createdAt_idx" ON "Post"("authorId", "pinned", "createdAt");

CREATE INDEX IF NOT EXISTS "Post_content_idx" ON "Post"("content");

CREATE INDEX IF NOT EXISTS "PostSave_userId_createdAt_idx" ON "PostSave"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "PostSave_postId_userId_idx" ON "PostSave"("postId", "userId");

CREATE UNIQUE INDEX IF NOT EXISTS "PostSave_userId_postId_key" ON "PostSave"("userId", "postId");

CREATE INDEX IF NOT EXISTS "PostLike_postId_createdAt_idx" ON "PostLike"("postId", "createdAt");

CREATE INDEX IF NOT EXISTS "PostLike_userId_createdAt_idx" ON "PostLike"("userId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "PostLike_userId_postId_key" ON "PostLike"("userId", "postId");

CREATE INDEX IF NOT EXISTS "PostComment_postId_createdAt_idx" ON "PostComment"("postId", "createdAt");

CREATE INDEX IF NOT EXISTS "PostComment_userId_createdAt_idx" ON "PostComment"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "PostComment_parentId_createdAt_idx" ON "PostComment"("parentId", "createdAt");

CREATE INDEX IF NOT EXISTS "PostCommentLike_commentId_createdAt_idx" ON "PostCommentLike"("commentId", "createdAt");

CREATE INDEX IF NOT EXISTS "PostCommentLike_userId_createdAt_idx" ON "PostCommentLike"("userId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "PostCommentLike_userId_commentId_key" ON "PostCommentLike"("userId", "commentId");

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_handle_key" ON "Conversation"("handle");

CREATE INDEX IF NOT EXISTS "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");

CREATE INDEX IF NOT EXISTS "Conversation_type_updatedAt_idx" ON "Conversation"("type", "updatedAt");

CREATE INDEX IF NOT EXISTS "Conversation_createdById_type_idx" ON "Conversation"("createdById", "type");

CREATE INDEX IF NOT EXISTS "Conversation_id_updatedAt_idx" ON "Conversation"("id", "updatedAt");

CREATE INDEX IF NOT EXISTS "Participant_userId_conversationId_idx" ON "Participant"("userId", "conversationId");

CREATE INDEX IF NOT EXISTS "Participant_conversationId_userId_idx" ON "Participant"("conversationId", "userId");

CREATE INDEX IF NOT EXISTS "Participant_conversationId_role_idx" ON "Participant"("conversationId", "role");

CREATE UNIQUE INDEX IF NOT EXISTS "Participant_userId_conversationId_key" ON "Participant"("userId", "conversationId");

CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

CREATE INDEX IF NOT EXISTS "Message_conversationId_deletedAt_createdAt_idx" ON "Message"("conversationId", "deletedAt", "createdAt");

CREATE INDEX IF NOT EXISTS "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");

CREATE INDEX IF NOT EXISTS "Message_conversationId_senderId_createdAt_idx" ON "Message"("conversationId", "senderId", "createdAt");

CREATE INDEX IF NOT EXISTS "Message_type_conversationId_createdAt_idx" ON "Message"("type", "conversationId", "createdAt");

CREATE INDEX IF NOT EXISTS "Message_replyToId_idx" ON "Message"("replyToId");

CREATE INDEX IF NOT EXISTS "Message_conversationId_pinnedAt_idx" ON "Message"("conversationId", "pinnedAt");

CREATE INDEX IF NOT EXISTS "Message_storyReplyStoryId_idx" ON "Message"("storyReplyStoryId");

CREATE INDEX IF NOT EXISTS "MessageRead_userId_readAt_idx" ON "MessageRead"("userId", "readAt");

CREATE INDEX IF NOT EXISTS "MessageRead_messageId_userId_readAt_idx" ON "MessageRead"("messageId", "userId", "readAt");

CREATE UNIQUE INDEX IF NOT EXISTS "MessageRead_messageId_userId_key" ON "MessageRead"("messageId", "userId");

CREATE INDEX IF NOT EXISTS "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");

CREATE INDEX IF NOT EXISTS "MessageReaction_messageId_reaction_idx" ON "MessageReaction"("messageId", "reaction");

CREATE UNIQUE INDEX IF NOT EXISTS "MessageReaction_messageId_userId_key" ON "MessageReaction"("messageId", "userId");

CREATE INDEX IF NOT EXISTS "Attachment_messageId_idx" ON "Attachment"("messageId");

CREATE INDEX IF NOT EXISTS "Attachment_fileType_messageId_idx" ON "Attachment"("fileType", "messageId");

CREATE UNIQUE INDEX IF NOT EXISTS "UserPresence_userId_key" ON "UserPresence"("userId");

CREATE INDEX IF NOT EXISTS "UserPresence_isOnline_lastActive_idx" ON "UserPresence"("isOnline", "lastActive");

CREATE INDEX IF NOT EXISTS "UserPresence_lastActive_idx" ON "UserPresence"("lastActive");

CREATE UNIQUE INDEX IF NOT EXISTS "LiveStream_liveKitRoom_key" ON "LiveStream"("liveKitRoom");

CREATE INDEX IF NOT EXISTS "LiveStream_active_viewerCount_idx" ON "LiveStream"("active", "viewerCount");

CREATE INDEX IF NOT EXISTS "LiveStream_hostId_active_idx" ON "LiveStream"("hostId", "active");

CREATE INDEX IF NOT EXISTS "LiveStream_categoryName_active_idx" ON "LiveStream"("categoryName", "active");

CREATE INDEX IF NOT EXISTS "LiveStream_active_createdAt_idx" ON "LiveStream"("active", "createdAt");

CREATE INDEX IF NOT EXISTS "LiveStream_active_categoryName_viewerCount_idx" ON "LiveStream"("active", "categoryName", "viewerCount");

CREATE INDEX IF NOT EXISTS "LiveStream_active_status_lastHostHeartbeat_idx" ON "LiveStream"("active", "status", "lastHostHeartbeat");

CREATE INDEX IF NOT EXISTS "LiveStream_hostId_active_createdAt_idx" ON "LiveStream"("hostId", "active", "createdAt");

CREATE INDEX IF NOT EXISTS "LiveStream_title_idx" ON "LiveStream"("title");

CREATE INDEX IF NOT EXISTS "LiveStream_status_idx" ON "LiveStream"("status");

CREATE INDEX IF NOT EXISTS "LiveStream_language_idx" ON "LiveStream"("language");

CREATE INDEX IF NOT EXISTS "LiveStream_country_idx" ON "LiveStream"("country");

CREATE INDEX IF NOT EXISTS "LiveReaction_streamId_createdAt_idx" ON "LiveReaction"("streamId", "createdAt");

CREATE INDEX IF NOT EXISTS "LiveReaction_userId_streamId_idx" ON "LiveReaction"("userId", "streamId");

CREATE UNIQUE INDEX IF NOT EXISTS "StreamCategory_name_key" ON "StreamCategory"("name");

CREATE INDEX IF NOT EXISTS "StreamCategory_name_idx" ON "StreamCategory"("name");

CREATE INDEX IF NOT EXISTS "LiveChatMessage_streamId_createdAt_idx" ON "LiveChatMessage"("streamId", "createdAt");

CREATE INDEX IF NOT EXISTS "LiveChatMessage_userId_streamId_createdAt_idx" ON "LiveChatMessage"("userId", "streamId", "createdAt");

CREATE INDEX IF NOT EXISTS "StreamViewer_streamId_idx" ON "StreamViewer"("streamId");

CREATE INDEX IF NOT EXISTS "StreamViewer_userId_streamId_idx" ON "StreamViewer"("userId", "streamId");

CREATE UNIQUE INDEX IF NOT EXISTS "StreamViewer_streamId_userId_key" ON "StreamViewer"("streamId", "userId");

CREATE INDEX IF NOT EXISTS "StreamFollower_followerId_idx" ON "StreamFollower"("followerId");

CREATE INDEX IF NOT EXISTS "StreamFollower_streamerId_followerId_createdAt_idx" ON "StreamFollower"("streamerId", "followerId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "StreamFollower_streamerId_followerId_key" ON "StreamFollower"("streamerId", "followerId");

CREATE UNIQUE INDEX IF NOT EXISTS "UserSettings_userId_key" ON "UserSettings"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId");

CREATE INDEX IF NOT EXISTS "BlockedUser_userId_idx" ON "BlockedUser"("userId");

CREATE INDEX IF NOT EXISTS "BlockedUser_userId_targetId_idx" ON "BlockedUser"("userId", "targetId");

CREATE UNIQUE INDEX IF NOT EXISTS "BlockedUser_userId_targetId_key" ON "BlockedUser"("userId", "targetId");

CREATE INDEX IF NOT EXISTS "MutedUser_userId_idx" ON "MutedUser"("userId");

CREATE INDEX IF NOT EXISTS "MutedUser_userId_targetId_idx" ON "MutedUser"("userId", "targetId");

CREATE UNIQUE INDEX IF NOT EXISTS "MutedUser_userId_targetId_key" ON "MutedUser"("userId", "targetId");

CREATE INDEX IF NOT EXISTS "SecurityLog_userId_createdAt_idx" ON "SecurityLog"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "SecurityLog_action_createdAt_idx" ON "SecurityLog"("action", "createdAt");

CREATE INDEX IF NOT EXISTS "SecurityLog_createdAt_idx" ON "SecurityLog"("createdAt");

CREATE INDEX IF NOT EXISTS "SecurityLog_userId_action_createdAt_idx" ON "SecurityLog"("userId", "action", "createdAt");

CREATE INDEX IF NOT EXISTS "SecurityLog_ipAddress_createdAt_idx" ON "SecurityLog"("ipAddress", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key" ON "Session"("token");

CREATE UNIQUE INDEX IF NOT EXISTS "Session_refreshToken_key" ON "Session"("refreshToken");

CREATE UNIQUE INDEX IF NOT EXISTS "Session_oauthExchangeCode_key" ON "Session"("oauthExchangeCode");

CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");

CREATE INDEX IF NOT EXISTS "Session_refreshToken_idx" ON "Session"("refreshToken");

CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE INDEX IF NOT EXISTS "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

CREATE INDEX IF NOT EXISTS "Session_lastActiveAt_idx" ON "Session"("lastActiveAt");

CREATE INDEX IF NOT EXISTS "ProviderAccount_userId_idx" ON "ProviderAccount"("userId");

CREATE INDEX IF NOT EXISTS "ProviderAccount_provider_providerAccountId_idx" ON "ProviderAccount"("provider", "providerAccountId");

CREATE INDEX IF NOT EXISTS "ProviderAccount_provider_email_idx" ON "ProviderAccount"("provider", "email");

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderAccount_provider_providerAccountId_key" ON "ProviderAccount"("provider", "providerAccountId");

CREATE INDEX IF NOT EXISTS "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

CREATE INDEX IF NOT EXISTS "OAuthState_provider_idx" ON "OAuthState"("provider");

CREATE INDEX IF NOT EXISTS "OAuthState_consumedAt_idx" ON "OAuthState"("consumedAt");

CREATE INDEX IF NOT EXISTS "RateLimit_key_idx" ON "RateLimit"("key");

CREATE INDEX IF NOT EXISTS "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");

CREATE INDEX IF NOT EXISTS "RateLimit_key_expiresAt_idx" ON "RateLimit"("key", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "DeviceFingerprint_fingerprintId_key" ON "DeviceFingerprint"("fingerprintId");

CREATE INDEX IF NOT EXISTS "DeviceFingerprint_fingerprintId_idx" ON "DeviceFingerprint"("fingerprintId");

CREATE INDEX IF NOT EXISTS "DeviceFingerprint_isSuspicious_idx" ON "DeviceFingerprint"("isSuspicious");

CREATE INDEX IF NOT EXISTS "DeviceFingerprint_lastSeen_idx" ON "DeviceFingerprint"("lastSeen");

CREATE INDEX IF NOT EXISTS "DeviceFingerprint_userId_fingerprintId_idx" ON "DeviceFingerprint"("userId", "fingerprintId");

CREATE INDEX IF NOT EXISTS "DeviceFingerprint_trustScore_isSuspicious_idx" ON "DeviceFingerprint"("trustScore", "isSuspicious");

CREATE UNIQUE INDEX IF NOT EXISTS "IPReputation_ipAddress_key" ON "IPReputation"("ipAddress");

CREATE INDEX IF NOT EXISTS "IPReputation_riskScore_idx" ON "IPReputation"("riskScore");

CREATE INDEX IF NOT EXISTS "IPReputation_isBlocked_idx" ON "IPReputation"("isBlocked");

CREATE INDEX IF NOT EXISTS "IPReputation_lastActivity_idx" ON "IPReputation"("lastActivity");

CREATE INDEX IF NOT EXISTS "IPReputation_riskScore_isBlocked_lastActivity_idx" ON "IPReputation"("riskScore", "isBlocked", "lastActivity");

CREATE INDEX IF NOT EXISTS "ConsentRecord_userId_type_idx" ON "ConsentRecord"("userId", "type");

CREATE INDEX IF NOT EXISTS "ConsentRecord_userId_type_granted_idx" ON "ConsentRecord"("userId", "type", "granted");

CREATE INDEX IF NOT EXISTS "DataExportRequest_userId_idx" ON "DataExportRequest"("userId");

CREATE INDEX IF NOT EXISTS "DataExportRequest_status_createdAt_idx" ON "DataExportRequest"("status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AccountDeletionRequest_userId_key" ON "AccountDeletionRequest"("userId");

CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_status_scheduledFor_idx" ON "AccountDeletionRequest"("status", "scheduledFor");

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

CREATE INDEX IF NOT EXISTS "WebhookEvent_provider_eventId_idx" ON "WebhookEvent"("provider", "eventId");

CREATE INDEX IF NOT EXISTS "WebhookEvent_status_idx" ON "WebhookEvent"("status");

CREATE INDEX IF NOT EXISTS "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

CREATE INDEX IF NOT EXISTS "WebhookEvent_provider_status_createdAt_idx" ON "WebhookEvent"("provider", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "SparkCoinPackage_isActive_sortOrder_idx" ON "SparkCoinPackage"("isActive", "sortOrder");

CREATE INDEX IF NOT EXISTS "SparkCoinPackage_isActive_isPopular_sortOrder_idx" ON "SparkCoinPackage"("isActive", "isPopular", "sortOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_providerOrderId_key" ON "PurchaseOrder"("providerOrderId");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_userId_idx" ON "PurchaseOrder"("userId");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_providerOrderId_idx" ON "PurchaseOrder"("providerOrderId");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_userId_status_idx" ON "PurchaseOrder"("userId", "status");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_provider_status_createdAt_idx" ON "PurchaseOrder"("provider", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_paymentMode_status_createdAt_idx" ON "PurchaseOrder"("paymentMode", "status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Gift_slug_key" ON "Gift"("slug");

CREATE INDEX IF NOT EXISTS "Gift_category_isActive_idx" ON "Gift"("category", "isActive");

CREATE INDEX IF NOT EXISTS "Gift_isActive_sortOrder_idx" ON "Gift"("isActive", "sortOrder");

CREATE INDEX IF NOT EXISTS "Gift_isFeatured_isActive_sortOrder_idx" ON "Gift"("isFeatured", "isActive", "sortOrder");

CREATE INDEX IF NOT EXISTS "Gift_isTrending_isActive_sortOrder_idx" ON "Gift"("isTrending", "isActive", "sortOrder");

CREATE INDEX IF NOT EXISTS "Gift_isPopular_isActive_sortOrder_idx" ON "Gift"("isPopular", "isActive", "sortOrder");

CREATE INDEX IF NOT EXISTS "Gift_isLimited_expiresAt_idx" ON "Gift"("isLimited", "expiresAt");

CREATE INDEX IF NOT EXISTS "Gift_category_subcategory_isActive_idx" ON "Gift"("category", "subcategory", "isActive");

CREATE INDEX IF NOT EXISTS "Gift_isLegendary_isActive_idx" ON "Gift"("isLegendary", "isActive");

CREATE INDEX IF NOT EXISTS "Gift_price_isActive_idx" ON "Gift"("price", "isActive");

CREATE INDEX IF NOT EXISTS "Gift_rarity_tier_isActive_idx" ON "Gift"("rarity", "tier", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "GiftTransaction_requestId_key" ON "GiftTransaction"("requestId");

CREATE INDEX IF NOT EXISTS "GiftTransaction_senderId_idx" ON "GiftTransaction"("senderId");

CREATE INDEX IF NOT EXISTS "GiftTransaction_receiverId_idx" ON "GiftTransaction"("receiverId");

CREATE INDEX IF NOT EXISTS "GiftTransaction_streamId_idx" ON "GiftTransaction"("streamId");

CREATE INDEX IF NOT EXISTS "GiftTransaction_createdAt_idx" ON "GiftTransaction"("createdAt");

CREATE INDEX IF NOT EXISTS "GiftTransaction_receiverId_createdAt_idx" ON "GiftTransaction"("receiverId", "createdAt");

CREATE INDEX IF NOT EXISTS "GiftTransaction_senderId_receiverId_createdAt_idx" ON "GiftTransaction"("senderId", "receiverId", "createdAt");

CREATE INDEX IF NOT EXISTS "GiftTransaction_streamId_receiverId_createdAt_idx" ON "GiftTransaction"("streamId", "receiverId", "createdAt");

CREATE INDEX IF NOT EXISTS "GiftTransaction_giftId_createdAt_idx" ON "GiftTransaction"("giftId", "createdAt");

CREATE INDEX IF NOT EXISTS "LiveGiftEvent_streamId_idx" ON "LiveGiftEvent"("streamId");

CREATE INDEX IF NOT EXISTS "LiveGiftEvent_createdAt_idx" ON "LiveGiftEvent"("createdAt");

CREATE INDEX IF NOT EXISTS "LiveGiftEvent_streamId_createdAt_idx" ON "LiveGiftEvent"("streamId", "createdAt");

CREATE INDEX IF NOT EXISTS "LiveGiftEvent_senderId_streamId_createdAt_idx" ON "LiveGiftEvent"("senderId", "streamId", "createdAt");

CREATE INDEX IF NOT EXISTS "LiveGiftEvent_receiverId_streamId_createdAt_idx" ON "LiveGiftEvent"("receiverId", "streamId", "createdAt");

CREATE INDEX IF NOT EXISTS "LiveGiftEvent_isLegendary_streamId_createdAt_idx" ON "LiveGiftEvent"("isLegendary", "streamId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Wallet_userId_key" ON "Wallet"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "WalletPIN_walletId_key" ON "WalletPIN"("walletId");

CREATE INDEX IF NOT EXISTS "WalletPIN_walletId_idx" ON "WalletPIN"("walletId");

CREATE INDEX IF NOT EXISTS "TransferLimit_walletId_idx" ON "TransferLimit"("walletId");

CREATE UNIQUE INDEX IF NOT EXISTS "TransferLimit_walletId_key" ON "TransferLimit"("walletId");

CREATE INDEX IF NOT EXISTS "WalletTransaction_userId_idx" ON "WalletTransaction"("userId");

CREATE INDEX IF NOT EXISTS "WalletTransaction_type_idx" ON "WalletTransaction"("type");

CREATE INDEX IF NOT EXISTS "WalletTransaction_createdAt_idx" ON "WalletTransaction"("createdAt");

CREATE INDEX IF NOT EXISTS "WalletTransaction_reference_idx" ON "WalletTransaction"("reference");

CREATE INDEX IF NOT EXISTS "WalletTransaction_userId_createdAt_idx" ON "WalletTransaction"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "WalletTransaction_userId_type_createdAt_idx" ON "WalletTransaction"("userId", "type", "createdAt");

CREATE INDEX IF NOT EXISTS "WalletTransaction_status_createdAt_idx" ON "WalletTransaction"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "WalletTransaction_walletId_type_createdAt_idx" ON "WalletTransaction"("walletId", "type", "createdAt");

CREATE INDEX IF NOT EXISTS "Withdrawal_userId_idx" ON "Withdrawal"("userId");

CREATE INDEX IF NOT EXISTS "Withdrawal_status_idx" ON "Withdrawal"("status");

CREATE INDEX IF NOT EXISTS "Withdrawal_status_createdAt_idx" ON "Withdrawal"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "Withdrawal_userId_status_createdAt_idx" ON "Withdrawal"("userId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "Withdrawal_method_status_createdAt_idx" ON "Withdrawal"("method", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "CoinTransfer_senderId_createdAt_idx" ON "CoinTransfer"("senderId", "createdAt");

CREATE INDEX IF NOT EXISTS "CoinTransfer_receiverId_createdAt_idx" ON "CoinTransfer"("receiverId", "createdAt");

CREATE INDEX IF NOT EXISTS "CoinTransfer_senderId_receiverId_createdAt_idx" ON "CoinTransfer"("senderId", "receiverId", "createdAt");

CREATE INDEX IF NOT EXISTS "CoinTransfer_status_createdAt_idx" ON "CoinTransfer"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "CoinTransfer_ipAddress_createdAt_idx" ON "CoinTransfer"("ipAddress", "createdAt");

CREATE INDEX IF NOT EXISTS "WalletAuditLog_userId_createdAt_idx" ON "WalletAuditLog"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "WalletAuditLog_action_createdAt_idx" ON "WalletAuditLog"("action", "createdAt");

CREATE INDEX IF NOT EXISTS "WalletAuditLog_userId_action_createdAt_idx" ON "WalletAuditLog"("userId", "action", "createdAt");

CREATE INDEX IF NOT EXISTS "WalletAuditLog_ipAddress_createdAt_idx" ON "WalletAuditLog"("ipAddress", "createdAt");

CREATE INDEX IF NOT EXISTS "AdCampaign_status_startDate_endDate_idx" ON "AdCampaign"("status", "startDate", "endDate");

CREATE INDEX IF NOT EXISTS "AdCampaign_status_priority_idx" ON "AdCampaign"("status", "priority");

CREATE INDEX IF NOT EXISTS "AdCampaign_createdBy_idx" ON "AdCampaign"("createdBy");

CREATE INDEX IF NOT EXISTS "AdCampaign_targetCountry_status_idx" ON "AdCampaign"("targetCountry", "status");

CREATE INDEX IF NOT EXISTS "AdCampaign_status_startDate_endDate_priority_idx" ON "AdCampaign"("status", "startDate", "endDate", "priority");

CREATE INDEX IF NOT EXISTS "AdImpression_campaignId_createdAt_idx" ON "AdImpression"("campaignId", "createdAt");

CREATE INDEX IF NOT EXISTS "AdImpression_campaignId_idx" ON "AdImpression"("campaignId");

CREATE INDEX IF NOT EXISTS "AdImpression_createdAt_idx" ON "AdImpression"("createdAt");

CREATE INDEX IF NOT EXISTS "AdClick_campaignId_createdAt_idx" ON "AdClick"("campaignId", "createdAt");

CREATE INDEX IF NOT EXISTS "AdClick_campaignId_idx" ON "AdClick"("campaignId");

CREATE INDEX IF NOT EXISTS "AdClick_createdAt_idx" ON "AdClick"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformSetting_key_key" ON "PlatformSetting"("key");

CREATE INDEX IF NOT EXISTS "PlatformSetting_key_idx" ON "PlatformSetting"("key");

CREATE INDEX IF NOT EXISTS "CreatorSubscription_creatorId_idx" ON "CreatorSubscription"("creatorId");

CREATE INDEX IF NOT EXISTS "CreatorSubscription_status_idx" ON "CreatorSubscription"("status");

CREATE INDEX IF NOT EXISTS "CreatorSubscription_creatorId_status_idx" ON "CreatorSubscription"("creatorId", "status");

CREATE INDEX IF NOT EXISTS "CreatorSubscription_currentPeriodEnd_idx" ON "CreatorSubscription"("currentPeriodEnd");

CREATE INDEX IF NOT EXISTS "CreatorSubscription_subscriberId_creatorId_status_idx" ON "CreatorSubscription"("subscriberId", "creatorId", "status");

CREATE INDEX IF NOT EXISTS "CreatorSubscription_tier_creatorId_status_idx" ON "CreatorSubscription"("tier", "creatorId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorSubscription_subscriberId_creatorId_key" ON "CreatorSubscription"("subscriberId", "creatorId");

CREATE INDEX IF NOT EXISTS "SubscriptionTier_creatorId_isActive_idx" ON "SubscriptionTier"("creatorId", "isActive");

CREATE INDEX IF NOT EXISTS "SubscriptionTier_creatorId_tier_isActive_idx" ON "SubscriptionTier"("creatorId", "tier", "isActive");

CREATE INDEX IF NOT EXISTS "SubscriptionTier_price_creatorId_isActive_idx" ON "SubscriptionTier"("price", "creatorId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "PremiumMembership_userId_key" ON "PremiumMembership"("userId");

CREATE INDEX IF NOT EXISTS "PremiumMembership_status_endDate_idx" ON "PremiumMembership"("status", "endDate");

CREATE INDEX IF NOT EXISTS "PremiumMembership_userId_status_idx" ON "PremiumMembership"("userId", "status");

CREATE INDEX IF NOT EXISTS "CreatorMilestone_creatorId_achieved_idx" ON "CreatorMilestone"("creatorId", "achieved");

CREATE INDEX IF NOT EXISTS "CreatorMilestone_achieved_rewarded_idx" ON "CreatorMilestone"("achieved", "rewarded");

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorMilestone_creatorId_milestone_key" ON "CreatorMilestone"("creatorId", "milestone");

CREATE INDEX IF NOT EXISTS "GiftCombo_senderId_receiverId_giftId_idx" ON "GiftCombo"("senderId", "receiverId", "giftId");

CREATE INDEX IF NOT EXISTS "GiftCombo_streamId_senderId_giftId_idx" ON "GiftCombo"("streamId", "senderId", "giftId");

CREATE INDEX IF NOT EXISTS "GiftCombo_createdAt_idx" ON "GiftCombo"("createdAt");

CREATE INDEX IF NOT EXISTS "LeaderboardEntry_period_category_rank_idx" ON "LeaderboardEntry"("period", "category", "rank");

CREATE INDEX IF NOT EXISTS "LeaderboardEntry_userId_period_category_idx" ON "LeaderboardEntry"("userId", "period", "category");

CREATE INDEX IF NOT EXISTS "LeaderboardEntry_score_period_category_idx" ON "LeaderboardEntry"("score", "period", "category");

CREATE INDEX IF NOT EXISTS "LeaderboardEntry_period_category_updatedAt_idx" ON "LeaderboardEntry"("period", "category", "updatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "LeaderboardEntry_userId_period_category_key" ON "LeaderboardEntry"("userId", "period", "category");

CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyLevel_userId_key" ON "LoyaltyLevel"("userId");

CREATE INDEX IF NOT EXISTS "LoyaltyLevel_level_tier_idx" ON "LoyaltyLevel"("level", "tier");

CREATE INDEX IF NOT EXISTS "LoyaltyLevel_xp_idx" ON "LoyaltyLevel"("xp");

CREATE INDEX IF NOT EXISTS "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");

CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "Notification_type_userId_createdAt_idx" ON "Notification"("type", "userId", "createdAt");

CREATE INDEX IF NOT EXISTS "Notification_read_createdAt_idx" ON "Notification"("read", "createdAt");

CREATE INDEX IF NOT EXISTS "Notification_type_idx" ON "Notification"("type");

CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Notification_userId_referenceKey_key" ON "Notification"("userId", "referenceKey");

CREATE INDEX IF NOT EXISTS "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "Report_targetId_status_idx" ON "Report"("targetId", "status");

CREATE INDEX IF NOT EXISTS "Report_type_status_createdAt_idx" ON "Report"("type", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "Report_reporterId_targetId_idx" ON "Report"("reporterId", "targetId");

CREATE INDEX IF NOT EXISTS "EventGift_eventId_idx" ON "EventGift"("eventId");

CREATE INDEX IF NOT EXISTS "EventGift_giftId_eventId_idx" ON "EventGift"("giftId", "eventId");

CREATE INDEX IF NOT EXISTS "AIModel_status_idx" ON "AIModel"("status");

CREATE INDEX IF NOT EXISTS "AIModel_modelType_status_idx" ON "AIModel"("modelType", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "AIModel_name_version_key" ON "AIModel"("name", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "UserEmbedding_userId_key" ON "UserEmbedding"("userId");

CREATE INDEX IF NOT EXISTS "ContentEmbedding_contentId_contentType_idx" ON "ContentEmbedding"("contentId", "contentType");

CREATE INDEX IF NOT EXISTS "ContentEmbedding_contentType_idx" ON "ContentEmbedding"("contentType");

CREATE INDEX IF NOT EXISTS "UserInterest_userId_weight_idx" ON "UserInterest"("userId", "weight");

CREATE INDEX IF NOT EXISTS "UserInterest_interestType_interestValue_weight_idx" ON "UserInterest"("interestType", "interestValue", "weight");

CREATE UNIQUE INDEX IF NOT EXISTS "UserInterest_userId_interestType_interestValue_source_key" ON "UserInterest"("userId", "interestType", "interestValue", "source");

CREATE INDEX IF NOT EXISTS "Recommendation_userId_contentType_score_idx" ON "Recommendation"("userId", "contentType", "score");

CREATE INDEX IF NOT EXISTS "Recommendation_userId_score_idx" ON "Recommendation"("userId", "score");

CREATE INDEX IF NOT EXISTS "Recommendation_contentType_contentId_idx" ON "Recommendation"("contentType", "contentId");

CREATE INDEX IF NOT EXISTS "InteractionEvent_userId_createdAt_idx" ON "InteractionEvent"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "InteractionEvent_eventType_createdAt_idx" ON "InteractionEvent"("eventType", "createdAt");

CREATE INDEX IF NOT EXISTS "InteractionEvent_targetType_targetId_idx" ON "InteractionEvent"("targetType", "targetId");

CREATE INDEX IF NOT EXISTS "InteractionEvent_sessionId_idx" ON "InteractionEvent"("sessionId");

CREATE INDEX IF NOT EXISTS "InteractionEvent_userId_eventType_targetType_idx" ON "InteractionEvent"("userId", "eventType", "targetType");

CREATE INDEX IF NOT EXISTS "ModerationQueue_status_aiScore_idx" ON "ModerationQueue"("status", "aiScore");

CREATE INDEX IF NOT EXISTS "ModerationQueue_aiCategories_idx" ON "ModerationQueue"("aiCategories");

CREATE INDEX IF NOT EXISTS "ModerationQueue_targetType_targetId_idx" ON "ModerationQueue"("targetType", "targetId");

CREATE INDEX IF NOT EXISTS "ModerationQueue_priority_status_idx" ON "ModerationQueue"("priority", "status");

CREATE INDEX IF NOT EXISTS "ModerationAction_queueId_idx" ON "ModerationAction"("queueId");

CREATE INDEX IF NOT EXISTS "ModerationAction_moderatorId_idx" ON "ModerationAction"("moderatorId");

CREATE INDEX IF NOT EXISTS "ModerationAction_action_idx" ON "ModerationAction"("action");

CREATE INDEX IF NOT EXISTS "AIContent_userId_contentType_idx" ON "AIContent"("userId", "contentType");

CREATE INDEX IF NOT EXISTS "AIContent_userId_approved_idx" ON "AIContent"("userId", "approved");

CREATE INDEX IF NOT EXISTS "AITranslation_targetLang_idx" ON "AITranslation"("targetLang");

CREATE UNIQUE INDEX IF NOT EXISTS "AITranslation_contentId_contentType_targetLang_key" ON "AITranslation"("contentId", "contentType", "targetLang");

CREATE INDEX IF NOT EXISTS "AIAnalytics_userId_reportType_periodStart_idx" ON "AIAnalytics"("userId", "reportType", "periodStart");

CREATE INDEX IF NOT EXISTS "AIAnalytics_userId_generatedAt_idx" ON "AIAnalytics"("userId", "generatedAt");

CREATE INDEX IF NOT EXISTS "FraudAlert_severity_reviewed_idx" ON "FraudAlert"("severity", "reviewed");

CREATE INDEX IF NOT EXISTS "FraudAlert_userId_createdAt_idx" ON "FraudAlert"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "FraudAlert_alertType_idx" ON "FraudAlert"("alertType");

CREATE INDEX IF NOT EXISTS "AIAccessibility_contentId_contentType_idx" ON "AIAccessibility"("contentId", "contentType");

CREATE INDEX IF NOT EXISTS "AIAccessibility_featureType_idx" ON "AIAccessibility"("featureType");

CREATE INDEX IF NOT EXISTS "AIInsight_targetType_targetId_insightType_idx" ON "AIInsight"("targetType", "targetId", "insightType");

CREATE INDEX IF NOT EXISTS "AIInsight_insightType_score_idx" ON "AIInsight"("insightType", "score");

CREATE INDEX IF NOT EXISTS "AISession_userId_featureType_idx" ON "AISession"("userId", "featureType");

CREATE INDEX IF NOT EXISTS "AISession_featureType_startedAt_idx" ON "AISession"("featureType", "startedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AIFeatureFlag_featureKey_key" ON "AIFeatureFlag"("featureKey");

CREATE INDEX IF NOT EXISTS "AIFeatureFlag_enabled_idx" ON "AIFeatureFlag"("enabled");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_eventType_createdAt_idx" ON "AnalyticsEvent"("eventType", "createdAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_userId_createdAt_idx" ON "AnalyticsEvent"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_eventType_userId_createdAt_idx" ON "AnalyticsEvent"("eventType", "userId", "createdAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_sessionId_createdAt_idx" ON "AnalyticsEvent"("sessionId", "createdAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_country_createdAt_idx" ON "AnalyticsEvent"("country", "createdAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_source_campaign_createdAt_idx" ON "AnalyticsEvent"("source", "campaign", "createdAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_targetType_targetId_eventType_idx" ON "AnalyticsEvent"("targetType", "targetId", "eventType");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_deviceType_platform_createdAt_idx" ON "AnalyticsEvent"("deviceType", "platform", "createdAt");

CREATE INDEX IF NOT EXISTS "AnalyticsAggregation_metricType_period_date_idx" ON "AnalyticsAggregation"("metricType", "period", "date");

CREATE INDEX IF NOT EXISTS "AnalyticsAggregation_period_date_idx" ON "AnalyticsAggregation"("period", "date");

CREATE INDEX IF NOT EXISTS "AnalyticsAggregation_metricType_date_idx" ON "AnalyticsAggregation"("metricType", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "AnalyticsAggregation_metricType_period_date_key" ON "AnalyticsAggregation"("metricType", "period", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "AnalyticsSession_sessionId_key" ON "AnalyticsSession"("sessionId");

CREATE INDEX IF NOT EXISTS "AnalyticsSession_userId_startTime_idx" ON "AnalyticsSession"("userId", "startTime");

CREATE INDEX IF NOT EXISTS "AnalyticsSession_sessionId_idx" ON "AnalyticsSession"("sessionId");

CREATE INDEX IF NOT EXISTS "AnalyticsSession_startTime_isActive_idx" ON "AnalyticsSession"("startTime", "isActive");

CREATE INDEX IF NOT EXISTS "AnalyticsSession_country_startTime_idx" ON "AnalyticsSession"("country", "startTime");

CREATE INDEX IF NOT EXISTS "AnalyticsSession_referrer_startTime_idx" ON "AnalyticsSession"("referrer", "startTime");

CREATE INDEX IF NOT EXISTS "RetentionRecord_cohortDate_dayX_idx" ON "RetentionRecord"("cohortDate", "dayX");

CREATE INDEX IF NOT EXISTS "RetentionRecord_cohortDate_dayX_returned_idx" ON "RetentionRecord"("cohortDate", "dayX", "returned");

CREATE INDEX IF NOT EXISTS "RetentionRecord_dayX_returned_idx" ON "RetentionRecord"("dayX", "returned");

CREATE UNIQUE INDEX IF NOT EXISTS "RetentionRecord_userId_dayX_key" ON "RetentionRecord"("userId", "dayX");

CREATE INDEX IF NOT EXISTS "DashboardSnapshot_dashboardType_period_date_idx" ON "DashboardSnapshot"("dashboardType", "period", "date");

CREATE INDEX IF NOT EXISTS "DashboardSnapshot_dashboardType_generatedAt_idx" ON "DashboardSnapshot"("dashboardType", "generatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "DashboardSnapshot_dashboardType_period_date_key" ON "DashboardSnapshot"("dashboardType", "period", "date");

CREATE INDEX IF NOT EXISTS "ScheduledReport_enabled_nextSendAt_idx" ON "ScheduledReport"("enabled", "nextSendAt");

CREATE INDEX IF NOT EXISTS "ScheduledReport_frequency_enabled_idx" ON "ScheduledReport"("frequency", "enabled");

CREATE INDEX IF NOT EXISTS "ScheduledReport_createdBy_idx" ON "ScheduledReport"("createdBy");

CREATE INDEX IF NOT EXISTS "GeneratedReport_reportType_period_date_idx" ON "GeneratedReport"("reportType", "period", "date");

CREATE INDEX IF NOT EXISTS "GeneratedReport_status_createdAt_idx" ON "GeneratedReport"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "GeneratedReport_createdAt_idx" ON "GeneratedReport"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "PredictiveModel_modelName_key" ON "PredictiveModel"("modelName");

CREATE INDEX IF NOT EXISTS "PredictiveModel_modelType_status_idx" ON "PredictiveModel"("modelType", "status");

CREATE INDEX IF NOT EXISTS "Prediction_predictionType_forecastDate_idx" ON "Prediction"("predictionType", "forecastDate");

CREATE INDEX IF NOT EXISTS "Prediction_targetType_targetId_predictionType_idx" ON "Prediction"("targetType", "targetId", "predictionType");

CREATE INDEX IF NOT EXISTS "Prediction_modelName_forecastDate_idx" ON "Prediction"("modelName", "forecastDate");

CREATE INDEX IF NOT EXISTS "Prediction_predictionType_period_forecastDate_idx" ON "Prediction"("predictionType", "period", "forecastDate");

CREATE INDEX IF NOT EXISTS "AlertRule_metricType_enabled_idx" ON "AlertRule"("metricType", "enabled");

CREATE INDEX IF NOT EXISTS "AlertRule_severity_enabled_idx" ON "AlertRule"("severity", "enabled");

CREATE INDEX IF NOT EXISTS "AlertRule_createdFor_enabled_idx" ON "AlertRule"("createdFor", "enabled");

CREATE INDEX IF NOT EXISTS "AlertEvent_status_createdAt_idx" ON "AlertEvent"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "AlertEvent_severity_createdAt_idx" ON "AlertEvent"("severity", "createdAt");

CREATE INDEX IF NOT EXISTS "AlertEvent_metricType_createdAt_idx" ON "AlertEvent"("metricType", "createdAt");

CREATE INDEX IF NOT EXISTS "AlertEvent_ruleId_createdAt_idx" ON "AlertEvent"("ruleId", "createdAt");

CREATE INDEX IF NOT EXISTS "AlertEvent_createdAt_idx" ON "AlertEvent"("createdAt");

CREATE INDEX IF NOT EXISTS "MarketingCampaign_source_startDate_idx" ON "MarketingCampaign"("source", "startDate");

CREATE INDEX IF NOT EXISTS "MarketingCampaign_campaignType_isActive_idx" ON "MarketingCampaign"("campaignType", "isActive");

CREATE INDEX IF NOT EXISTS "MarketingCampaign_utmCampaign_idx" ON "MarketingCampaign"("utmCampaign");

CREATE INDEX IF NOT EXISTS "MarketingAttribution_campaignId_eventType_idx" ON "MarketingAttribution"("campaignId", "eventType");

CREATE INDEX IF NOT EXISTS "MarketingAttribution_userId_campaignId_idx" ON "MarketingAttribution"("userId", "campaignId");

CREATE INDEX IF NOT EXISTS "MarketingAttribution_source_createdAt_idx" ON "MarketingAttribution"("source", "createdAt");

CREATE INDEX IF NOT EXISTS "MarketingAttribution_converted_campaignId_idx" ON "MarketingAttribution"("converted", "campaignId");

CREATE INDEX IF NOT EXISTS "FunnelStep_funnelName_idx" ON "FunnelStep"("funnelName");

CREATE UNIQUE INDEX IF NOT EXISTS "FunnelStep_funnelName_stepOrder_key" ON "FunnelStep"("funnelName", "stepOrder");

CREATE INDEX IF NOT EXISTS "FunnelEvent_funnelName_stepOrder_idx" ON "FunnelEvent"("funnelName", "stepOrder");

CREATE INDEX IF NOT EXISTS "FunnelEvent_userId_funnelName_idx" ON "FunnelEvent"("userId", "funnelName");

CREATE INDEX IF NOT EXISTS "FunnelEvent_funnelName_completed_createdAt_idx" ON "FunnelEvent"("funnelName", "completed", "createdAt");

CREATE INDEX IF NOT EXISTS "FunnelEvent_funnelName_dropped_createdAt_idx" ON "FunnelEvent"("funnelName", "dropped", "createdAt");

CREATE INDEX IF NOT EXISTS "FeatureUsage_featureName_createdAt_idx" ON "FeatureUsage"("featureName", "createdAt");

CREATE INDEX IF NOT EXISTS "FeatureUsage_userId_featureName_createdAt_idx" ON "FeatureUsage"("userId", "featureName", "createdAt");

CREATE INDEX IF NOT EXISTS "FeatureUsage_featureName_actionType_createdAt_idx" ON "FeatureUsage"("featureName", "actionType", "createdAt");

CREATE INDEX IF NOT EXISTS "CreatorDailyAnalytics_creatorId_date_idx" ON "CreatorDailyAnalytics"("creatorId", "date");

CREATE INDEX IF NOT EXISTS "CreatorDailyAnalytics_date_idx" ON "CreatorDailyAnalytics"("date");

CREATE INDEX IF NOT EXISTS "CreatorDailyAnalytics_creatorId_totalEarnings_idx" ON "CreatorDailyAnalytics"("creatorId", "totalEarnings");

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorDailyAnalytics_creatorId_date_key" ON "CreatorDailyAnalytics"("creatorId", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "LiveStreamAnalytics_streamId_key" ON "LiveStreamAnalytics"("streamId");

CREATE INDEX IF NOT EXISTS "LiveStreamAnalytics_hostId_startedAt_idx" ON "LiveStreamAnalytics"("hostId", "startedAt");

CREATE INDEX IF NOT EXISTS "LiveStreamAnalytics_streamId_idx" ON "LiveStreamAnalytics"("streamId");

CREATE INDEX IF NOT EXISTS "LiveStreamAnalytics_category_startedAt_idx" ON "LiveStreamAnalytics"("category", "startedAt");

CREATE INDEX IF NOT EXISTS "LiveStreamAnalytics_peakConcurrent_startedAt_idx" ON "LiveStreamAnalytics"("peakConcurrent", "startedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "CommunityAnalytics_communityId_key" ON "CommunityAnalytics"("communityId");

CREATE INDEX IF NOT EXISTS "CommunityAnalytics_communityId_idx" ON "CommunityAnalytics"("communityId");

CREATE INDEX IF NOT EXISTS "CommunityAnalytics_healthScore_idx" ON "CommunityAnalytics"("healthScore");

CREATE INDEX IF NOT EXISTS "CommunityAnalytics_engagementRate_memberCount_idx" ON "CommunityAnalytics"("engagementRate", "memberCount");

CREATE INDEX IF NOT EXISTS "SearchAnalytics_query_createdAt_idx" ON "SearchAnalytics"("query", "createdAt");

CREATE INDEX IF NOT EXISTS "SearchAnalytics_zeroResults_createdAt_idx" ON "SearchAnalytics"("zeroResults", "createdAt");

CREATE INDEX IF NOT EXISTS "SearchAnalytics_clicked_createdAt_idx" ON "SearchAnalytics"("clicked", "createdAt");

CREATE INDEX IF NOT EXISTS "SearchAnalytics_userId_createdAt_idx" ON "SearchAnalytics"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "SearchAnalytics_createdAt_idx" ON "SearchAnalytics"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "TrendingTopic_topic_key" ON "TrendingTopic"("topic");

CREATE INDEX IF NOT EXISTS "TrendingTopic_type_score_idx" ON "TrendingTopic"("type", "score");

CREATE INDEX IF NOT EXISTS "TrendingTopic_velocity_idx" ON "TrendingTopic"("velocity");

CREATE INDEX IF NOT EXISTS "TrendingTopic_category_score_idx" ON "TrendingTopic"("category", "score");

CREATE INDEX IF NOT EXISTS "NotificationDelivery_notificationId_idx" ON "NotificationDelivery"("notificationId");

CREATE INDEX IF NOT EXISTS "NotificationDelivery_userId_sentAt_idx" ON "NotificationDelivery"("userId", "sentAt");

CREATE INDEX IF NOT EXISTS "NotificationDelivery_channel_sentAt_idx" ON "NotificationDelivery"("channel", "sentAt");

CREATE INDEX IF NOT EXISTS "NotificationDelivery_opened_clicked_converted_idx" ON "NotificationDelivery"("opened", "clicked", "converted");

CREATE UNIQUE INDEX IF NOT EXISTS "UserLTV_userId_key" ON "UserLTV"("userId");

CREATE INDEX IF NOT EXISTS "UserLTV_totalRevenue_idx" ON "UserLTV"("totalRevenue");

CREATE INDEX IF NOT EXISTS "UserLTV_tier_idx" ON "UserLTV"("tier");

CREATE INDEX IF NOT EXISTS "UserLTV_predictedLTV_idx" ON "UserLTV"("predictedLTV");

CREATE INDEX IF NOT EXISTS "ScreenAnalytics_screenName_date_idx" ON "ScreenAnalytics"("screenName", "date");

CREATE INDEX IF NOT EXISTS "ScreenAnalytics_date_idx" ON "ScreenAnalytics"("date");

CREATE INDEX IF NOT EXISTS "ScreenAnalytics_views_date_idx" ON "ScreenAnalytics"("views", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "ScreenAnalytics_screenName_date_key" ON "ScreenAnalytics"("screenName", "date");

CREATE INDEX IF NOT EXISTS "APIPerformance_endpoint_timestamp_idx" ON "APIPerformance"("endpoint", "timestamp");

CREATE INDEX IF NOT EXISTS "APIPerformance_statusCode_timestamp_idx" ON "APIPerformance"("statusCode", "timestamp");

CREATE INDEX IF NOT EXISTS "APIPerformance_responseTime_timestamp_idx" ON "APIPerformance"("responseTime", "timestamp");

CREATE INDEX IF NOT EXISTS "APIPerformance_timestamp_idx" ON "APIPerformance"("timestamp");

CREATE INDEX IF NOT EXISTS "QueryPerformance_model_operation_timestamp_idx" ON "QueryPerformance"("model", "operation", "timestamp");

CREATE INDEX IF NOT EXISTS "QueryPerformance_duration_timestamp_idx" ON "QueryPerformance"("duration", "timestamp");

CREATE INDEX IF NOT EXISTS "QueryPerformance_timestamp_idx" ON "QueryPerformance"("timestamp");

CREATE INDEX IF NOT EXISTS "AdRevenue_date_idx" ON "AdRevenue"("date");

CREATE INDEX IF NOT EXISTS "AdRevenue_provider_date_idx" ON "AdRevenue"("provider", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "AdRevenue_date_provider_key" ON "AdRevenue"("date", "provider");

CREATE INDEX IF NOT EXISTS "ARPUAnalytics_date_period_idx" ON "ARPUAnalytics"("date", "period");

CREATE UNIQUE INDEX IF NOT EXISTS "ARPUAnalytics_date_period_key" ON "ARPUAnalytics"("date", "period");

CREATE UNIQUE INDEX IF NOT EXISTS "VerificationBadge_userId_key" ON "VerificationBadge"("userId");

CREATE INDEX IF NOT EXISTS "VerificationBadge_userId_status_idx" ON "VerificationBadge"("userId", "status");

CREATE INDEX IF NOT EXISTS "VerificationBadge_badgeType_status_idx" ON "VerificationBadge"("badgeType", "status");

CREATE INDEX IF NOT EXISTS "VerificationBadge_status_expiresAt_idx" ON "VerificationBadge"("status", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "VerificationPurchase_providerOrderId_key" ON "VerificationPurchase"("providerOrderId");

CREATE INDEX IF NOT EXISTS "VerificationPurchase_userId_status_idx" ON "VerificationPurchase"("userId", "status");

CREATE INDEX IF NOT EXISTS "VerificationPurchase_status_createdAt_idx" ON "VerificationPurchase"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "VerificationPurchase_status_expiresAt_idx" ON "VerificationPurchase"("status", "expiresAt");

CREATE INDEX IF NOT EXISTS "VerificationPurchase_planId_idx" ON "VerificationPurchase"("planId");

CREATE UNIQUE INDEX IF NOT EXISTS "VerificationRequest_userId_key" ON "VerificationRequest"("userId");

CREATE INDEX IF NOT EXISTS "VerificationRequest_status_createdAt_idx" ON "VerificationRequest"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "VerificationRequest_userId_status_idx" ON "VerificationRequest"("userId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlan_name_key" ON "SubscriptionPlan"("name");

CREATE INDEX IF NOT EXISTS "SubscriptionPlan_isActive_sortOrder_idx" ON "SubscriptionPlan"("isActive", "sortOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorMembership_userId_key" ON "CreatorMembership"("userId");

CREATE INDEX IF NOT EXISTS "CreatorMembership_userId_status_idx" ON "CreatorMembership"("userId", "status");

CREATE INDEX IF NOT EXISTS "CreatorMembership_status_endDate_idx" ON "CreatorMembership"("status", "endDate");

CREATE INDEX IF NOT EXISTS "CreatorMembership_endDate_idx" ON "CreatorMembership"("endDate");

CREATE UNIQUE INDEX IF NOT EXISTS "CryptoPayment_txHash_key" ON "CryptoPayment"("txHash");

CREATE INDEX IF NOT EXISTS "CryptoPayment_userId_status_idx" ON "CryptoPayment"("userId", "status");

CREATE INDEX IF NOT EXISTS "CryptoPayment_status_createdAt_idx" ON "CryptoPayment"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "CryptoPayment_txHash_idx" ON "CryptoPayment"("txHash");

CREATE INDEX IF NOT EXISTS "CryptoPayment_expiresAt_idx" ON "CryptoPayment"("expiresAt");

CREATE INDEX IF NOT EXISTS "VerificationHistory_userId_createdAt_idx" ON "VerificationHistory"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "VerificationHistory_action_createdAt_idx" ON "VerificationHistory"("action", "createdAt");

CREATE INDEX IF NOT EXISTS "FollowerRewardCampaign_creatorId_status_idx" ON "FollowerRewardCampaign"("creatorId", "status");

CREATE INDEX IF NOT EXISTS "FollowerRewardCampaign_status_expiresAt_idx" ON "FollowerRewardCampaign"("status", "expiresAt");

CREATE INDEX IF NOT EXISTS "FollowerRewardCampaign_status_createdAt_idx" ON "FollowerRewardCampaign"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "FollowerRewardCampaign_creatorId_createdAt_idx" ON "FollowerRewardCampaign"("creatorId", "createdAt");

CREATE INDEX IF NOT EXISTS "FollowerRewardCampaign_giftId_idx" ON "FollowerRewardCampaign"("giftId");

CREATE INDEX IF NOT EXISTS "FollowerRewardClaim_campaignId_idx" ON "FollowerRewardClaim"("campaignId");

CREATE INDEX IF NOT EXISTS "FollowerRewardClaim_campaignId_status_idx" ON "FollowerRewardClaim"("campaignId", "status");

CREATE INDEX IF NOT EXISTS "FollowerRewardClaim_userId_createdAt_idx" ON "FollowerRewardClaim"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "FollowerRewardClaim_creatorId_createdAt_idx" ON "FollowerRewardClaim"("creatorId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "FollowerRewardClaim_campaignId_userId_key" ON "FollowerRewardClaim"("campaignId", "userId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WelcomeReward_userId_fkey') THEN
        ALTER TABLE "WelcomeReward" ADD CONSTRAINT "WelcomeReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoinTransaction_userId_fkey') THEN
        ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UploadSession_userId_fkey') THEN
        ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrustedDevice_userId_fkey') THEN
        ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Profile_userId_fkey') THEN
        ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialLink_profileId_fkey') THEN
        ALTER TABLE "SocialLink" ADD CONSTRAINT "SocialLink_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProfileMedia_profileId_fkey') THEN
        ALTER TABLE "ProfileMedia" ADD CONSTRAINT "ProfileMedia_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Photo_userId_fkey') THEN
        ALTER TABLE "Photo" ADD CONSTRAINT "Photo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Follow_followerId_fkey') THEN
        ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Follow_followingId_fkey') THEN
        ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Story_userId_fkey') THEN
        ALTER TABLE "Story" ADD CONSTRAINT "Story_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoryView_storyId_fkey') THEN
        ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoryView_userId_fkey') THEN
        ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoryLike_storyId_fkey') THEN
        ALTER TABLE "StoryLike" ADD CONSTRAINT "StoryLike_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoryLike_userId_fkey') THEN
        ALTER TABLE "StoryLike" ADD CONSTRAINT "StoryLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoryComment_storyId_fkey') THEN
        ALTER TABLE "StoryComment" ADD CONSTRAINT "StoryComment_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoryComment_userId_fkey') THEN
        ALTER TABLE "StoryComment" ADD CONSTRAINT "StoryComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContentView_userId_fkey') THEN
        ALTER TABLE "ContentView" ADD CONSTRAINT "ContentView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Community_ownerId_fkey') THEN
        ALTER TABLE "Community" ADD CONSTRAINT "Community_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityMember_communityId_fkey') THEN
        ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityMember_userId_fkey') THEN
        ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityPost_communityId_fkey') THEN
        ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityPost_authorId_fkey') THEN
        ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Channel_ownerId_fkey') THEN
        ALTER TABLE "Channel" ADD CONSTRAINT "Channel_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMember_channelId_fkey') THEN
        ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMember_userId_fkey') THEN
        ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMessage_channelId_fkey') THEN
        ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelMessage_authorId_fkey') THEN
        ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Group_ownerId_fkey') THEN
        ALTER TABLE "Group" ADD CONSTRAINT "Group_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GroupMember_groupId_fkey') THEN
        ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GroupMember_userId_fkey') THEN
        ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GroupMessage_groupId_fkey') THEN
        ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GroupMessage_authorId_fkey') THEN
        ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Video_creatorId_fkey') THEN
        ALTER TABLE "Video" ADD CONSTRAINT "Video_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VideoLike_userId_fkey') THEN
        ALTER TABLE "VideoLike" ADD CONSTRAINT "VideoLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VideoLike_videoId_fkey') THEN
        ALTER TABLE "VideoLike" ADD CONSTRAINT "VideoLike_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VideoComment_userId_fkey') THEN
        ALTER TABLE "VideoComment" ADD CONSTRAINT "VideoComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VideoComment_videoId_fkey') THEN
        ALTER TABLE "VideoComment" ADD CONSTRAINT "VideoComment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VideoSave_userId_fkey') THEN
        ALTER TABLE "VideoSave" ADD CONSTRAINT "VideoSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VideoSave_videoId_fkey') THEN
        ALTER TABLE "VideoSave" ADD CONSTRAINT "VideoSave_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WatchHistory_userId_fkey') THEN
        ALTER TABLE "WatchHistory" ADD CONSTRAINT "WatchHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WatchHistory_videoId_fkey') THEN
        ALTER TABLE "WatchHistory" ADD CONSTRAINT "WatchHistory_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Post_authorId_fkey') THEN
        ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostSave_userId_fkey') THEN
        ALTER TABLE "PostSave" ADD CONSTRAINT "PostSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostSave_postId_fkey') THEN
        ALTER TABLE "PostSave" ADD CONSTRAINT "PostSave_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostLike_userId_fkey') THEN
        ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostLike_postId_fkey') THEN
        ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostComment_userId_fkey') THEN
        ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostComment_postId_fkey') THEN
        ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostComment_parentId_fkey') THEN
        ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostCommentLike_userId_fkey') THEN
        ALTER TABLE "PostCommentLike" ADD CONSTRAINT "PostCommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostCommentLike_commentId_fkey') THEN
        ALTER TABLE "PostCommentLike" ADD CONSTRAINT "PostCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Participant_userId_fkey') THEN
        ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Participant_conversationId_fkey') THEN
        ALTER TABLE "Participant" ADD CONSTRAINT "Participant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_conversationId_fkey') THEN
        ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_senderId_fkey') THEN
        ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_replyToId_fkey') THEN
        ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageRead_messageId_fkey') THEN
        ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageRead_userId_fkey') THEN
        ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageReaction_messageId_fkey') THEN
        ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageReaction_userId_fkey') THEN
        ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Attachment_messageId_fkey') THEN
        ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserPresence_userId_fkey') THEN
        ALTER TABLE "UserPresence" ADD CONSTRAINT "UserPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveStream_hostId_fkey') THEN
        ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveStream_categoryName_fkey') THEN
        ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_categoryName_fkey" FOREIGN KEY ("categoryName") REFERENCES "StreamCategory"("name") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveStream_coHostId_fkey') THEN
        ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_coHostId_fkey" FOREIGN KEY ("coHostId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveReaction_streamId_fkey') THEN
        ALTER TABLE "LiveReaction" ADD CONSTRAINT "LiveReaction_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveReaction_userId_fkey') THEN
        ALTER TABLE "LiveReaction" ADD CONSTRAINT "LiveReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveChatMessage_streamId_fkey') THEN
        ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveChatMessage_userId_fkey') THEN
        ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StreamViewer_streamId_fkey') THEN
        ALTER TABLE "StreamViewer" ADD CONSTRAINT "StreamViewer_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StreamViewer_userId_fkey') THEN
        ALTER TABLE "StreamViewer" ADD CONSTRAINT "StreamViewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StreamFollower_streamerId_fkey') THEN
        ALTER TABLE "StreamFollower" ADD CONSTRAINT "StreamFollower_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StreamFollower_followerId_fkey') THEN
        ALTER TABLE "StreamFollower" ADD CONSTRAINT "StreamFollower_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserSettings_userId_fkey') THEN
        ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationPreferences_userId_fkey') THEN
        ALTER TABLE "NotificationPreferences" ADD CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BlockedUser_userId_fkey') THEN
        ALTER TABLE "BlockedUser" ADD CONSTRAINT "BlockedUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BlockedUser_targetId_fkey') THEN
        ALTER TABLE "BlockedUser" ADD CONSTRAINT "BlockedUser_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MutedUser_userId_fkey') THEN
        ALTER TABLE "MutedUser" ADD CONSTRAINT "MutedUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MutedUser_targetId_fkey') THEN
        ALTER TABLE "MutedUser" ADD CONSTRAINT "MutedUser_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SecurityLog_userId_fkey') THEN
        ALTER TABLE "SecurityLog" ADD CONSTRAINT "SecurityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Session_userId_fkey') THEN
        ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProviderAccount_userId_fkey') THEN
        ALTER TABLE "ProviderAccount" ADD CONSTRAINT "ProviderAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrder_userId_fkey') THEN
        ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrder_packageId_fkey') THEN
        ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SparkCoinPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftTransaction_giftId_fkey') THEN
        ALTER TABLE "GiftTransaction" ADD CONSTRAINT "GiftTransaction_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftTransaction_senderId_fkey') THEN
        ALTER TABLE "GiftTransaction" ADD CONSTRAINT "GiftTransaction_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftTransaction_receiverId_fkey') THEN
        ALTER TABLE "GiftTransaction" ADD CONSTRAINT "GiftTransaction_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveGiftEvent_streamId_fkey') THEN
        ALTER TABLE "LiveGiftEvent" ADD CONSTRAINT "LiveGiftEvent_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveGiftEvent_senderId_fkey') THEN
        ALTER TABLE "LiveGiftEvent" ADD CONSTRAINT "LiveGiftEvent_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveGiftEvent_receiverId_fkey') THEN
        ALTER TABLE "LiveGiftEvent" ADD CONSTRAINT "LiveGiftEvent_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveGiftEvent_giftId_fkey') THEN
        ALTER TABLE "LiveGiftEvent" ADD CONSTRAINT "LiveGiftEvent_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Wallet_userId_fkey') THEN
        ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WalletPIN_walletId_fkey') THEN
        ALTER TABLE "WalletPIN" ADD CONSTRAINT "WalletPIN_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TransferLimit_walletId_fkey') THEN
        ALTER TABLE "TransferLimit" ADD CONSTRAINT "TransferLimit_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WalletTransaction_walletId_fkey') THEN
        ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WalletTransaction_userId_fkey') THEN
        ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Withdrawal_userId_fkey') THEN
        ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoinTransfer_senderId_fkey') THEN
        ALTER TABLE "CoinTransfer" ADD CONSTRAINT "CoinTransfer_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoinTransfer_receiverId_fkey') THEN
        ALTER TABLE "CoinTransfer" ADD CONSTRAINT "CoinTransfer_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WalletAuditLog_userId_fkey') THEN
        ALTER TABLE "WalletAuditLog" ADD CONSTRAINT "WalletAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdImpression_campaignId_fkey') THEN
        ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdClick_campaignId_fkey') THEN
        ALTER TABLE "AdClick" ADD CONSTRAINT "AdClick_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorSubscription_subscriberId_fkey') THEN
        ALTER TABLE "CreatorSubscription" ADD CONSTRAINT "CreatorSubscription_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorSubscription_creatorId_fkey') THEN
        ALTER TABLE "CreatorSubscription" ADD CONSTRAINT "CreatorSubscription_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionTier_creatorId_fkey') THEN
        ALTER TABLE "SubscriptionTier" ADD CONSTRAINT "SubscriptionTier_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PremiumMembership_userId_fkey') THEN
        ALTER TABLE "PremiumMembership" ADD CONSTRAINT "PremiumMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorMilestone_creatorId_fkey') THEN
        ALTER TABLE "CreatorMilestone" ADD CONSTRAINT "CreatorMilestone_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftCombo_senderId_fkey') THEN
        ALTER TABLE "GiftCombo" ADD CONSTRAINT "GiftCombo_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftCombo_receiverId_fkey') THEN
        ALTER TABLE "GiftCombo" ADD CONSTRAINT "GiftCombo_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftCombo_giftId_fkey') THEN
        ALTER TABLE "GiftCombo" ADD CONSTRAINT "GiftCombo_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaderboardEntry_userId_fkey') THEN
        ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyLevel_userId_fkey') THEN
        ALTER TABLE "LoyaltyLevel" ADD CONSTRAINT "LoyaltyLevel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_userId_fkey') THEN
        ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_reporterId_fkey') THEN
        ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_targetId_fkey') THEN
        ALTER TABLE "Report" ADD CONSTRAINT "Report_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventGift_giftId_fkey') THEN
        ALTER TABLE "EventGift" ADD CONSTRAINT "EventGift_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserEmbedding_userId_fkey') THEN
        ALTER TABLE "UserEmbedding" ADD CONSTRAINT "UserEmbedding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserInterest_userId_fkey') THEN
        ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InteractionEvent_userId_fkey') THEN
        ALTER TABLE "InteractionEvent" ADD CONSTRAINT "InteractionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ModerationAction_queueId_fkey') THEN
        ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "ModerationQueue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIContent_userId_fkey') THEN
        ALTER TABLE "AIContent" ADD CONSTRAINT "AIContent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AIAnalytics_userId_fkey') THEN
        ALTER TABLE "AIAnalytics" ADD CONSTRAINT "AIAnalytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FraudAlert_userId_fkey') THEN
        ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AISession_userId_fkey') THEN
        ALTER TABLE "AISession" ADD CONSTRAINT "AISession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VerificationBadge_userId_fkey') THEN
        ALTER TABLE "VerificationBadge" ADD CONSTRAINT "VerificationBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VerificationPurchase_userId_fkey') THEN
        ALTER TABLE "VerificationPurchase" ADD CONSTRAINT "VerificationPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VerificationPurchase_planId_fkey') THEN
        ALTER TABLE "VerificationPurchase" ADD CONSTRAINT "VerificationPurchase_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VerificationRequest_userId_fkey') THEN
        ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorMembership_userId_fkey') THEN
        ALTER TABLE "CreatorMembership" ADD CONSTRAINT "CreatorMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorMembership_planId_fkey') THEN
        ALTER TABLE "CreatorMembership" ADD CONSTRAINT "CreatorMembership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CryptoPayment_userId_fkey') THEN
        ALTER TABLE "CryptoPayment" ADD CONSTRAINT "CryptoPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CryptoPayment_planId_fkey') THEN
        ALTER TABLE "CryptoPayment" ADD CONSTRAINT "CryptoPayment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VerificationHistory_userId_fkey') THEN
        ALTER TABLE "VerificationHistory" ADD CONSTRAINT "VerificationHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowerRewardCampaign_creatorId_fkey') THEN
        ALTER TABLE "FollowerRewardCampaign" ADD CONSTRAINT "FollowerRewardCampaign_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowerRewardCampaign_giftId_fkey') THEN
        ALTER TABLE "FollowerRewardCampaign" ADD CONSTRAINT "FollowerRewardCampaign_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowerRewardClaim_campaignId_fkey') THEN
        ALTER TABLE "FollowerRewardClaim" ADD CONSTRAINT "FollowerRewardClaim_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "FollowerRewardCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowerRewardClaim_userId_fkey') THEN
        ALTER TABLE "FollowerRewardClaim" ADD CONSTRAINT "FollowerRewardClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowerRewardClaim_creatorId_fkey') THEN
        ALTER TABLE "FollowerRewardClaim" ADD CONSTRAINT "FollowerRewardClaim_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowerRewardClaim_giftId_fkey') THEN
        ALTER TABLE "FollowerRewardClaim" ADD CONSTRAINT "FollowerRewardClaim_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;


