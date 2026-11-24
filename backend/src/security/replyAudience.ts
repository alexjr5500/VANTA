import { prisma } from "../prisma";

/** Stored as a string for backwards-compatible Prisma migrations. */
export const REPLY_AUDIENCES = ["EVERYONE", "VERIFIED", "FOLLOWING", "MENTIONED", "EXTENDED"] as const;
export type ReplyAudience = (typeof REPLY_AUDIENCES)[number];

export function parseReplyAudience(input: unknown): ReplyAudience {
  if (input === undefined || input === null) return "EVERYONE";
  if (typeof input === "string" && (REPLY_AUDIENCES as readonly string[]).includes(input)) {
    return input as ReplyAudience;
  }
  throw new Error("Invalid reply audience");
}

type Content = { authorId: string; content: string; replyAudience: string };
type Viewer = { id: string; username: string; verified: boolean };

/** Apply the post author's audience on the server, not only in the composer. */
export async function assertReplyAllowed(content: Content, viewer: Viewer): Promise<void> {
  const audience = parseReplyAudience(content.replyAudience);
  if (content.authorId === viewer.id || audience === "EVERYONE") return;

  // In accordance with the audience sheet: accounts explicitly mentioned
  // by the post author can always reply, regardless of the selected audience.
  const mentions = Array.from(content.content.matchAll(/(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{2,30})\b/g), match => match[1].toLowerCase());
  if (mentions.includes(viewer.username.toLowerCase())) return;

  if (audience === "VERIFIED" && viewer.verified) return;
  if (audience === "MENTIONED") throw new Error("Only accounts mentioned in this post can reply");
  if (audience === "VERIFIED") throw new Error("Only verified accounts can reply");

  // FOLLOWING: the author follows the replying account.
  const isFollowed = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: content.authorId, followingId: viewer.id } },
    select: { id: true },
  });
  if (isFollowed) return;
  if (audience === "FOLLOWING") throw new Error("Only accounts followed by the author can reply");

  // EXTENDED: accounts the author follows, plus accounts followed by any
  // of those accounts (author -> followed account -> viewer).
  // EXISTS-style relational filter avoids loading whole follower lists.
  const extended = await prisma.follow.findFirst({
    where: {
      followingId: viewer.id,
      follower: { followers: { some: { followerId: content.authorId } } },
    },
    select: { id: true },
  });
  if (extended) return;
  throw new Error("Only the author's follow network can reply");
}
