/** Shared settings for group/channel engagement, stored in the existing
 * Conversation permissions JSON so no production schema migration is needed. */
export const COMMUNITY_REACTIONS = ["❤️", "😂", "🔥", "👏", "👍"] as const;
const REACTION_KEYS = COMMUNITY_REACTIONS.map((_, index) => `reaction_${index}`);

export function readCommunitySettings(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function allowedCommunityReactions(raw: string | null | undefined): string[] {
  const settings = readCommunitySettings(raw);
  return settings.reactionsEnabled === false ? [] : COMMUNITY_REACTIONS.filter((_, index) => settings[REACTION_KEYS[index]] !== false);
}

export function mergeCommunitySettings(raw: string | null | undefined, input: Record<string, unknown>, allowedPermissions: string[], now = new Date()): string {
  const next = readCommunitySettings(raw);
  for (const key of [...allowedPermissions, "reactionsEnabled", ...REACTION_KEYS]) {
    if (typeof input[key] === "boolean") next[key] = input[key];
  }
  if (typeof input.welcomeMessage === "string") {
    const message = input.welcomeMessage.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, 500);
    if (message !== next.welcomeMessage) {
      next.welcomeMessage = message;
      // Editing an active greeting does not reclassify already eligible members.
      if (!message || typeof next.welcomeEnabledAt !== "string" || !next.welcomeEnabledAt) next.welcomeEnabledAt = message ? now.toISOString() : null;
    }
  }
  return JSON.stringify(next);
}

export function memberWelcome(raw: string | null | undefined, participant: { id?: string; role?: string; createdAt?: Date | string } | undefined) {
  const settings = readCommunitySettings(raw);
  const text = typeof settings.welcomeMessage === "string" ? settings.welcomeMessage.trim().slice(0, 500) : "";
  const enabledAt = typeof settings.welcomeEnabledAt === "string" ? Date.parse(settings.welcomeEnabledAt) : NaN;
  const joinedAt = participant?.createdAt ? new Date(participant.createdAt).getTime() : NaN;
  if (!text || !participant?.id || participant.role === "OWNER" || !Number.isFinite(enabledAt) || !Number.isFinite(joinedAt) || joinedAt < enabledAt) return null;
  return { text, membershipId: participant.id };
}
