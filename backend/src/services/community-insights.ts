import { prisma } from "../prisma";
import { auditLog } from "../security/auditLog";
import { config } from "../security/config";

export type CommunityKind = "group" | "channel";
const labels: Record<string, string> = {
  SETTINGS_UPDATED: "Community settings updated",
  MEMBER_LIST_UPDATED: "Member list updated",
  ROLES_UPDATED: "Administrator roles updated",
  MEMBER_ADDED: "Member added",
  MEMBER_REMOVED: "Member removed",
  OWNERSHIP_TRANSFERRED: "Ownership transferred",
};
export function canViewCommunityInsights(ownerId: string, userId: string, role?: string): boolean {
  return !!role && (ownerId === userId || role === "OWNER" || role === "ADMIN");
}

export async function logCommunityUpdate(kind: CommunityKind, id: string, actorId: string, fields: Record<string, unknown>) {
  const actions = [
    ...(["name", "description", "avatar", "category", "visibility", "handle", "permissions"].some(key => fields[key] !== undefined) ? ["SETTINGS_UPDATED"] : []),
    ...(Array.isArray(fields.memberIds) ? ["MEMBER_LIST_UPDATED"] : []),
    ...(fields.memberRoles && typeof fields.memberRoles === "object" ? ["ROLES_UPDATED"] : []),
  ];
  for (const action of actions) await logCommunityAction(kind, id, actorId, action);
}

export async function logCommunityAction(kind: CommunityKind, id: string, actorId: string, action: string) {
  if (!Object.prototype.hasOwnProperty.call(labels, action)) return;
  await auditLog.log({ userId: actorId, action: kind.toUpperCase() + "_" + action, metadata: { [kind + "Id"]: id } });
}

// Return a minimal allowlisted projection, never raw audit metadata, IPs,
// user agents, or platform-wide events.
export function safeCommunityAction(kind: CommunityKind, id: string, row: { id: string; action: string; metadata: string | null; createdAt: Date; user?: { username: string } | null }) {
  const prefix = kind.toUpperCase() + "_";
  if (!row.action.startsWith(prefix)) return null;
  const action = row.action.slice(prefix.length);
  if (!Object.prototype.hasOwnProperty.call(labels, action)) return null;
  try {
    if (JSON.parse(row.metadata || "{}")[kind + "Id"] !== id) return null;
  } catch { return null; }
  return { id: row.id, label: labels[action], actor: row.user?.username || null, createdAt: row.createdAt };
}

export async function getCommunityInsights(kind: CommunityKind, id: string, userId: string) {
  const select = { ownerId: true, conversationId: true, members: { where: { userId }, select: { role: true } }, _count: { select: { members: true } } } as const;
  const entity = kind === "group" ? await prisma.group.findUnique({ where: { id }, select }) : await prisma.channel.findUnique({ where: { id }, select });
  if (!entity || !canViewCommunityInsights(entity.ownerId, userId, entity.members[0]?.role)) return null;
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 86400000);
  const auditSince = new Date(now.getTime() - 30 * 86400000);
  const conversationId = entity.conversationId;
  const messageFilter = { conversationId: conversationId || "", deletedAt: null, moderationRemovedAt: null, createdAt: { gte: since } };
  const [messages, recentMembers, rows] = await Promise.all([
    conversationId ? prisma.message.count({ where: messageFilter }) : Promise.resolve(null),
    conversationId ? prisma.participant.count({ where: { conversationId, createdAt: { gte: since } } }) : Promise.resolve(null),
    config.auditLog.enabled ? prisma.securityLog.findMany({
      where: { action: { in: Object.keys(labels).map(action => kind.toUpperCase() + "_" + action) }, createdAt: { gte: auditSince }, metadata: { contains: JSON.stringify(kind + "Id") + ":" + JSON.stringify(id) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, action: true, metadata: true, createdAt: true, user: { select: { username: true } } },
    }) : Promise.resolve([]),
  ]);
  return { members: entity._count.members, messagesLast7Days: messages, currentMembersJoinedLast7Days: recentMembers, asOf: now, auditEnabled: config.auditLog.enabled, recentActions: rows.map(row => safeCommunityAction(kind, id, row)).filter(Boolean) };
}
