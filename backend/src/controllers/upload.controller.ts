import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { uploadService } from "../services";
import { prisma } from "../prisma";

// ============================================================================
// GENERIC UPLOAD
// ============================================================================

export const uploadFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "File is required" }); return; }

    const category = typeof req.body.category === "string" ? req.body.category.slice(0, 50) : "generic";
    const result = await uploadService.uploadFile(req, req.file, { category });
    res.status(201).json({ message: "File uploaded successfully", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    res.status(400).json({ error: message });
  }
};

export const uploadMultipleFiles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const files = (req.files || []) as Express.Multer.File[];
    if (files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    const category = typeof req.body.category === "string" ? req.body.category.slice(0, 50) : "post-media";
    const results = await Promise.all(
      files.map(file => uploadService.uploadFile(req, file, { category }))
    );

    res.status(201).json({ message: "Files uploaded successfully", files: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// AVATAR / BANNER UPLOADS
// ============================================================================

export const uploadAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "Avatar file is required" }); return; }

    // Upload and persist metadata
    const result = await uploadService.uploadFile(req, req.file, {
      category: "avatar",
      recordType: "User",
      recordId: userId,
    });

    // Delete previous avatar
    await uploadService.deletePreviousForUser(userId, "avatar", result.id);

    // Update user profile
    const { userService } = await import("../services");
    const profile = await userService.updateProfileImage(userId, "avatar", result.url);

    res.set("Cache-Control", "no-store, private");
    res.status(200).json({ message: "Avatar updated successfully", url: result.url, user: profile, profile, file: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Avatar upload failed";
    res.status(400).json({ error: message });
  }
};

export const uploadBanner = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "Banner file is required" }); return; }

    // Upload and persist metadata
    const result = await uploadService.uploadFile(req, req.file, {
      category: "banner",
      recordType: "User",
      recordId: userId,
      optimize: true,
    });

    // Delete previous banner
    await uploadService.deletePreviousForUser(userId, "banner", result.id);

    // Update user profile
    const { userService } = await import("../services");
    const profile = await userService.updateProfileImage(userId, "banner", result.url);

    res.set("Cache-Control", "no-store, private");
    res.status(200).json({ message: "Banner updated successfully", url: result.url, user: profile, profile, file: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Banner upload failed";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// PROFILE MEDIA
// ============================================================================

export const uploadProfileMedia = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "Media file is required" }); return; }

    const result = await uploadService.uploadFile(req, req.file, {
      category: "profile-media",
      recordType: "Profile",
      recordId: userId,
    });

    const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 80) : undefined;
    const { userService } = await import("../services");
    const media = await userService.addProfileMedia(userId, result.url, result.type, title);
    await uploadService.linkFile(result.id, userId, "ProfileMedia", media.id, ["profile-media"]);

    res.status(201).json({ message: "Media uploaded successfully", media, file: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media upload failed";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// LIVE STREAM THUMBNAIL
// ============================================================================

export const uploadStreamThumbnail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "Thumbnail file is required" }); return; }

    const streamId = typeof req.body.streamId === "string" ? req.body.streamId : undefined;

    const result = await uploadService.uploadFile(req, req.file, {
      category: "thumbnail",
      recordType: "LiveStream",
      recordId: streamId,
    });

    // Update the live stream thumbnail if streamId provided
    if (streamId) {
      const stream = await prisma.liveStream.findUnique({ where: { id: streamId } });
      if (!stream || stream.hostId !== userId) {
        await uploadService.deleteFile(result.filename, result.id);
        res.status(403).json({ error: "You cannot update this stream thumbnail" });
        return;
      }
      if (stream.hostId === userId) {
        await prisma.liveStream.update({
          where: { id: streamId },
          data: { thumbnailUrl: result.url },
        });
        await uploadService.deletePreviousForRecord("LiveStream", streamId, "thumbnail", result.id);
      }
    }

    res.status(200).json({ message: "Thumbnail uploaded successfully", url: result.url, file: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Thumbnail upload failed";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// GROUP / CHANNEL / COMMUNITY AVATAR
// ============================================================================

export const uploadGroupAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "Group avatar file is required" }); return; }

    const groupId = req.params.id;
    const group = await prisma.group.findUnique({ where: { id: groupId }, include: { members: true } });
    if (!group) { res.status(404).json({ error: "Group not found" }); return; }
    const member = group.members.find(item => item.userId === userId);
    if (group.ownerId !== userId && member?.role !== "ADMIN") { res.status(403).json({ error: "Only group administrators can change the photo" }); return; }

    const result = await uploadService.uploadFile(req, req.file, {
      category: "group-avatar",
      recordType: "Group",
      recordId: groupId,
      optimize: true,
    });

    await prisma.$transaction([
      prisma.group.update({ where: { id: groupId }, data: { avatar: result.url } }),
      ...(group.conversationId ? [prisma.conversation.update({ where: { id: group.conversationId }, data: { avatar: result.url } })] : []),
    ]);
    await uploadService.deletePreviousForRecord("Group", groupId, "group-avatar", result.id);

    res.status(200).json({ message: "Group avatar updated", url: result.url, file: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Group avatar upload failed";
    res.status(400).json({ error: message });
  }
};

export const uploadChannelAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "Channel avatar file is required" }); return; }

    const channelId = req.params.id;
    const channel = await prisma.channel.findUnique({ where: { id: channelId }, include: { members: true } });
    if (!channel) { res.status(404).json({ error: "Channel not found" }); return; }
    const member = channel.members.find(item => item.userId === userId);
    if (channel.ownerId !== userId && !["OWNER", "ADMIN", "MODERATOR"].includes(member?.role || "")) { res.status(403).json({ error: "Only channel administrators can change the photo" }); return; }

    const result = await uploadService.uploadFile(req, req.file, {
      category: "channel-avatar",
      recordType: "Channel",
      recordId: channelId,
      optimize: true,
    });

    await prisma.$transaction([
      prisma.channel.update({ where: { id: channelId }, data: { avatar: result.url } }),
      ...(channel.conversationId ? [prisma.conversation.update({ where: { id: channel.conversationId }, data: { avatar: result.url } })] : []),
    ]);
    await uploadService.deletePreviousForRecord("Channel", channelId, "channel-avatar", result.id);

    res.status(200).json({ message: "Channel avatar updated", url: result.url, file: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Channel avatar upload failed";
    res.status(400).json({ error: message });
  }
};

export const uploadCommunityAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "Community avatar file is required" }); return; }

    const communityId = req.params.id;
    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) { res.status(404).json({ error: "Community not found" }); return; }
    if (community.ownerId !== userId) { res.status(403).json({ error: "Only community owner can change avatar" }); return; }

    const result = await uploadService.uploadFile(req, req.file, {
      category: "community-avatar",
      recordType: "Community",
      recordId: communityId,
      optimize: true,
    });

    await prisma.community.update({ where: { id: communityId }, data: { avatar: result.url } });
    await uploadService.deletePreviousForRecord("Community", communityId, "community-avatar", result.id);

    res.status(200).json({ message: "Community avatar updated", url: result.url, file: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Community avatar upload failed";
    res.status(400).json({ error: message });
  }
};

export const uploadCommunityBanner = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "Community banner file is required" }); return; }

    const communityId = req.params.id;
    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) { res.status(404).json({ error: "Community not found" }); return; }
    if (community.ownerId !== userId) { res.status(403).json({ error: "Only community owner can change banner" }); return; }

    const result = await uploadService.uploadFile(req, req.file, {
      category: "community-banner",
      recordType: "Community",
      recordId: communityId,
      optimize: true,
    });

    await prisma.community.update({ where: { id: communityId }, data: { bannerUrl: result.url } });
    await uploadService.deletePreviousForRecord("Community", communityId, "community-banner", result.id);

    res.status(200).json({ message: "Community banner updated", url: result.url, file: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Community banner upload failed";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// VERIFICATION DOCUMENTS
// ============================================================================

export const uploadVerificationDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "Document file is required" }); return; }

    const result = await uploadService.uploadFile(req, req.file, {
      category: "verification",
      recordType: "VerificationRequest",
      recordId: userId,
      optimize: false,
    });

    res.status(200).json({ message: "Document uploaded successfully", url: result.url, file: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document upload failed";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// MESSAGE ATTACHMENT
// ============================================================================

export const uploadMessageAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!req.file) { res.status(400).json({ error: "Attachment file is required" }); return; }

    const conversationId = typeof req.body.conversationId === "string" ? req.body.conversationId : undefined;
    const messageId = typeof req.body.messageId === "string" ? req.body.messageId : undefined;

    if (!messageId && !conversationId) { res.status(400).json({ error: "conversationId is required" }); return; }
    if (conversationId) {
      const participant = await prisma.participant.findUnique({ where: { userId_conversationId: { userId, conversationId } } });
      if (!participant) { res.status(403).json({ error: "You cannot upload to this conversation" }); return; }
    }
    const result = await uploadService.uploadFile(req, req.file, {
      category: "message",
      recordType: messageId ? "Message" : "Conversation",
      recordId: messageId || conversationId,
    });

    // If messageId provided, verify the sender owns the target message before linking.
    if (messageId) {
      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message || message.senderId !== userId) {
        await uploadService.deleteFile(result.filename, result.id);
        res.status(403).json({ error: "You cannot attach a file to this message" });
        return;
      }
      await prisma.attachment.create({
        data: {
          messageId,
          url: result.url,
          fileType: result.type,
          fileName: req.file.originalname,
          fileSize: req.file.size,
        },
      });
    }

    res.status(201).json({ message: "Attachment uploaded successfully", ...result, fileId: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Attachment upload failed";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// DELETE FILE
// ============================================================================

export const deleteUploadedFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const fileId = req.params.fileId;
    const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file) { res.status(404).json({ error: "File not found" }); return; }

    // Only allow owner or admin to delete
    if (file.userId !== userId && req.user?.role !== "ADMIN") {
      res.status(403).json({ error: "Unauthorized to delete this file" });
      return;
    }

    // A linked asset must be removed through its owning feature so references
    // can be updated atomically instead of leaving broken URLs.
    if (file.recordType && file.recordId) {
      res.status(409).json({ error: "This file is in use. Delete or replace it from the feature that owns it." });
      return;
    }
    await uploadService.deleteFile(file.filename, file.id);
    res.status(200).json({ message: "File deleted successfully" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "File deletion failed";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// GET USER FILES
// ============================================================================

export const getUserFiles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const files = await uploadService.getUserFiles(userId, category);

    res.status(200).json(files);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get files";
    res.status(400).json({ error: message });
  }
};

// ============================================================================
// REEL UPLOAD
// ============================================================================

export const uploadReel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (!req.file) {
      res.status(400).json({ error: "Video file is required" });
      return;
    }

    const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 120) : "Untitled Reel";
    const description = typeof req.body.description === "string" ? req.body.description.trim() : undefined;

    // Upload video
    const result = await uploadService.uploadFile(req, req.file, {
      category: "reel",
      recordType: "Video",
      recordId: undefined,
      optimize: false,
    });

    // Create Video record
    const video = await prisma.video.create({
      data: {
        title,
        description,
        videoUrl: result.url,
        creatorId: userId,
      },
    });

    // Link file to video
    await prisma.uploadedFile.update({
      where: { id: result.id },
      data: { recordId: video.id },
    });

    res.status(201).json({ message: "Reel uploaded successfully", ...result, video });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reel upload failed";
    res.status(400).json({ error: message });
  }
};

export const uploadReelWithThumbnail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const files = (req.files || []) as any;
    const videoFile = files?.video?.[0];
    const thumbnailFile = files?.thumbnail?.[0];

    if (!videoFile) {
      res.status(400).json({ error: "Video file is required" });
      return;
    }

    const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 120) : "Untitled Reel";
    const description = typeof req.body.description === "string" ? req.body.description.trim() : undefined;

    // Upload video
    const videoResult = await uploadService.uploadFile(req, videoFile, {
      category: "reel",
      recordType: "Video",
      recordId: undefined,
      optimize: false,
    });

    // Upload thumbnail if provided
    let thumbnailUrl: string | undefined;
    if (thumbnailFile) {
      const thumbResult = await uploadService.uploadFile(req, thumbnailFile, {
        category: "thumbnail",
        recordType: "Video",
        recordId: undefined,
        optimize: true,
      });
      thumbnailUrl = thumbResult.url;
    }

    // Create Video record
    const video = await prisma.video.create({
      data: {
        title,
        description,
        videoUrl: videoResult.url,
        thumbnailUrl: thumbnailUrl || videoResult.thumbnailUrl || null,
        creatorId: userId,
      },
    });

    // Link video file to video record
    await prisma.uploadedFile.update({
      where: { id: videoResult.id },
      data: { recordId: video.id },
    });
    if (thumbnailFile) {
      const thumbnailRecord = await prisma.uploadedFile.findFirst({
        where: { userId, category: "thumbnail", url: thumbnailUrl, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      if (thumbnailRecord) await prisma.uploadedFile.update({ where: { id: thumbnailRecord.id }, data: { recordId: video.id } });
    }

    res.status(201).json({ message: "Reel uploaded successfully", ...videoResult, video });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reel upload failed";
    res.status(400).json({ error: message });
  }
};