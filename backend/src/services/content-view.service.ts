import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export const CONTENT_TYPES = ["REEL", "POST", "STORY"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export class ContentViewService {
  private async assertExists(contentType: ContentType, contentId: string) {
    if (!contentId || contentId.length > 191) throw new Error("Invalid content ID");
    if (contentType === "REEL") return prisma.video.findUnique({ where: { id: contentId }, select: { id: true } });
    if (contentType === "POST") return prisma.post.findUnique({ where: { id: contentId }, select: { id: true } });
    return prisma.story.findFirst({
      where: { id: contentId, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
  }

  async record(contentType: ContentType, contentId: string, userId: string) {
    const content = await this.assertExists(contentType, contentId);
    if (!content) throw new Error(contentType === "STORY" ? "Story not found or expired" : `${contentType === "REEL" ? "Reel" : "Post"} not found`);

    let counted = false;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.contentView.create({ data: { contentType, contentId, userId } });
        if (contentType === "REEL") {
          await tx.video.update({ where: { id: contentId }, data: { views: { increment: 1 } } });
        } else if (contentType === "POST") {
          await tx.post.update({ where: { id: contentId }, data: { views: { increment: 1 } } });
        }
      });
      counted = true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    if (contentType === "REEL") {
      const result = await prisma.video.findUniqueOrThrow({ where: { id: contentId }, select: { views: true } });
      return { counted, views: result.views };
    }
    if (contentType === "POST") {
      const result = await prisma.post.findUniqueOrThrow({ where: { id: contentId }, select: { views: true } });
      return { counted, views: result.views };
    }

    const views = await prisma.contentView.count({ where: { contentType: "STORY", contentId } });
    return { counted, views };
  }

  async storyViewers(storyId: string, ownerId: string) {
    const story = await prisma.story.findUnique({ where: { id: storyId }, select: { userId: true } });
    if (!story) throw new Error("Story not found");
    if (story.userId !== ownerId) throw new Error("Forbidden");

    return prisma.contentView.findMany({
      where: { contentType: "STORY", contentId: storyId },
      orderBy: { viewedAt: "desc" },
      select: {
        id: true,
        viewedAt: true,
        user: { select: { id: true, username: true, fullName: true, avatar: true } },
      },
    });
  }
}

export const contentViewService = new ContentViewService();