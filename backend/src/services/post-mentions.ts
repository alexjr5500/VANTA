/** Match the same ASCII username boundaries as the frontend. Avoid matching emails and URL fragments. */
export function postMentionNames(content: string): string[] {
  const plain = content.replace(/(?:https?:\/\/|www\.)[^\s<>"']+/gi, " ");
  return [...new Set(Array.from(plain.matchAll(/(?:^|[\s([{])@([a-zA-Z0-9_]{2,30})(?![a-zA-Z0-9_])/g), match => match[1].toLowerCase()))].slice(0, 50);
}
