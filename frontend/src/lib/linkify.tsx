'use client';

// ============================================================================
// linkify
// ----------------------------------------------------------------------------
// Safe, reusable URL detection + rendering for every VANTA text surface
// (private/group/channel messages, replies, comments, live chat, stories).
//
// Security:
//  - We parse the raw text into plain segments (never trust HTML).
//  - Each URL is rendered as a React <a> element via createElement — React
//    escapes all content so arbitrary message text can never become executable
//    HTML/JS.
//  - All external links open in a new tab with `rel="noopener noreferrer"`.
//  - Only http(s) and `www.` (prefixed with https) are treated as links, so
//    javascript:/data: URIs and other dangerous schemes are never rendered.
// ============================================================================

import { createElement, Fragment, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';

// Matches http(s)://host/path or bare www.host/path. The match is permissive on
// the trailing boundary (whitespace, punctuation, end-of-line) so embedded URLs
// in normal sentences are still detected.
const URL_PATTERN =
  /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

// A URL must follow a safe scheme. We only ever assemble `http://`, `https://`
// or `https://` for bare `www.` — never javascript:, data: etc.
const SAFE_SCHEME = /^(https?:\/\/)/i;

/** Normalise a detected URL token into a safe, openable href. */
export function safeUrlHref(match: string): string {
  if (SAFE_SCHEME.test(match)) return match;
  // Bare `www.` (or a bare host) gets an explicit https:// prefix.
  return `https://${match}`;
}

/** Split a string into linkable pieces. Returns an array of React nodes. */
export function renderTextWithLinks(text: string, linkClassName?: string): ReactNode[] {
  if (!text) return [];
  const result: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const urlToken = match[0];
    const start = match.index;

    // Leading text before this URL (plain, unlinked).
    if (start > lastIndex) {
      result.push(createElement(Fragment, { key: key++ }, text.slice(lastIndex, start)));
    }

    const href = safeUrlHref(urlToken);
    result.push(
      createElement(
        'a',
        {
          key: key++,
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          onClick: (event: ReactMouseEvent) => event.stopPropagation(),
          className: linkClassName,
        },
        urlToken
      ),
    );

    lastIndex = start + urlToken.length;
  }

  // Trailing plain text after the last URL.
  if (lastIndex < text.length) {
    result.push(createElement(Fragment, { key: key++ }, text.slice(lastIndex)));
  }

  return result;
}