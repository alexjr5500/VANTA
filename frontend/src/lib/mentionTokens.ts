/** Shared parsing for a currently typed @username and for gold tag highlighting.
 * This module deliberately has no React/DOM imports so it can run in browser,
 * WebView and Node tests without JSX transforms. */
export type ActiveMention = { prefixStart: number; end: number; query: string };

export function mentionAtCaret(value: string, caret: number): ActiveMention | null {
  if (caret < 0 || caret > value.length) return null;
  const preceding = value.slice(0, caret);
  const match = /(?:^|[\s([{])@([a-zA-Z0-9_]{1,30})$/.exec(preceding);
  if (!match) return null;
  const prefixStart = caret - match[1].length - 1;
  return { prefixStart, end: caret, query: match[1] };
}

export function applyMention(value: string, mention: ActiveMention, username: string): { value: string; caret: number } {
  const insertion = `@${username} `;
  return {
    value: value.slice(0, mention.prefixStart) + insertion + value.slice(mention.end),
    caret: mention.prefixStart + insertion.length,
  };
}

const TOKEN = /(?:^|[\s([{])([@#])([a-zA-Z0-9_]{1,30})(?=$|[^a-zA-Z0-9_])/g;

export function highlightedParts(value: string): Array<{ text: string; highlighted: boolean }> {
  const parts: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  TOKEN.lastIndex = 0;
  let found: RegExpExecArray | null;
  while ((found = TOKEN.exec(value)) !== null) {
    const offset = found[0].lastIndexOf(found[1]);
    const start = found.index + offset;
    const end = start + 1 + found[2].length;
    if (start > cursor) parts.push({ text: value.slice(cursor, start), highlighted: false });
    parts.push({ text: value.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor), highlighted: false });
  return parts;
}
