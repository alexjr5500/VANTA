import { prisma } from "../prisma";
import { emitSocialEvent, emitSocialEventToUser } from "./social-events.service";
import { contentViewService } from "./content-view.service";

export class PostService {
  async savePost(userId: string, postId: string) {
    const existing = await prisma.postSave.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      await prisma.postSave.delete({ where: { id: existing.id } });
      emitSocialEventToUser(userId, "social:bookmark-updated", { postId, saved: false });
      return { saved: false, message: "Post unsaved successfully" };
    }

    await prisma.postSave.create({
      data: { userId, postId },
    });

    emitSocialEventToUser(userId, "social:bookmark-updated", { postId, saved: true });
    return { saved: true, message: "Post saved successfully" };
  }

  async unsavePost(userId: string, postId: string) {
    await prisma.postSave.deleteMany({
      where: { userId, postId },
    });

    emitSocialEventToUser(userId, "social:bookmark-updated", { postId, saved: false });
    return { saved: false, message: "Post unsaved successfully" };
  }

  async getSavedPosts(userId: string, cursor?: string, limit: number = 20) {
    const saves = await prisma.postSave.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        post: {
          include: {
            author: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
            _count: { select: { likes: true, comments: true, saves: true } },
          },
        },
      },
    });

    const nextCursor = saves.length > limit ? saves.pop()?.id : undefined;
    return {
      items: saves.map((s) => ({
        ...s.post,
        savedAt: s.createdAt,
        likesCount: (s.post as any)._count.likes,
        commentsCount: (s.post as any)._count.comments,
        savesCount: (s.post as any)._count.saves,
        isSaved: true,
      })),
      nextCursor,
    };
  }

  async sharePost(postId: string, userId: string, destination = "COPY_LINK") {
    const post = await prisma.$transaction(async (tx) => {
      const updated = await tx.post.update({ where: { id: postId }, data: { shareCount: { increment: 1 } }, select: { shareCount: true } });
      await tx.interactionEvent.create({
        data: { userId, eventType: "POST_SHARE", targetType: "POST", targetId: postId, metadata: JSON.stringify({ destination }) },
      });
      return updated;
    });
    emitSocialEvent("social:post-updated", { postId, shares: post.shareCount });
    return { shared: true, shareCount: post.shareCount };
  }

  async getPostById(postId: string, userId?: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: { select: { id: true, username: true, fullName: true, avatar: true, verified: true } },
        likes: userId ? { where: { userId }, select: { id: true } } : false,
        saves: userId ? { where: { userId }, select: { id: true } } : false,
        _count: { select: { likes: true, comments: true, saves: true } },
      },
    });

    if (!post) throw new Error("Post not found");

    return {
      ...post,
      isLiked: userId ? (post as any).likes?.length > 0 : false,
      isSaved: userId ? (post as any).saves?.length > 0 : false,
      likes: undefined,
      saves: undefined,
      likesCount: (post as any)._count.likes,
      commentsCount: (post as any)._count.comments,
      savesCount: (post as any)._count.saves,
    };
  }

  async viewPost(postId: string, userId: string) {
    return contentViewService.record("POST", postId, userId);
  }
}

export const postService = new PostService();