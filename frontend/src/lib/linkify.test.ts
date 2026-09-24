// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { safeUrlHref, renderTextWithLinks } from './linkify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripReact(reactNodes: any[]): string {
  return reactNodes.map((node) => {
    if (typeof node === 'string') return node;
    if (node && typeof node === 'object') {
      const text = node.props?.children ?? '';
      const tag = node.type === 'a' ? 'A' : '';
      const href = node.type === 'a' ? `[${node.props.href}]` : '';
      if (typeof text === 'string') return `${tag}${href}${text}`;
      return `${tag}${href}${stripReact(text)}`;
    }
    return '';
  }).join('');
}

describe('safeUrlHref', () => {
  it('keeps http/https unchanged', () => {
    expect(safeUrlHref('https://t.me/alphidrop')).toBe('https://t.me/alphidrop');
    expect(safeUrlHref('http://example.com')).toBe('http://example.com');
  });

  it('prepends https to www links', () => {
    expect(safeUrlHref('www.example.com')).toBe('https://www.example.com');
  });
});

describe('renderTextWithLinks', () => {
  it('renders a bare URL as a link', () => {
    const nodes = renderTextWithLinks('https://t.me/alphidrop');
    expect(stripReact(nodes)).toContain('A');
    expect(stripReact(nodes)).toContain('https://t.me/alphidrop');
  });

  it('renders http/https/www as links', () => {
    for (const url of ['https://t.me/alphidrop', 'https://example.com', 'http://example.com', 'www.example.com']) {
      expect(stripReact(renderTextWithLinks(url))).toContain('A');
    }
  });

  it('keeps surrounding text normal and linkifies embedded URLs', () => {
    const output = stripReact(renderTextWithLinks('Check this out https://t.me/alphidrop guys'));
    expect(output).toContain('Check this out ');
    expect(output).toContain('A[https://t.me/alphidrop]https://t.me/alphidrop');
    expect(output).toContain(' guys');
  });

  it('never emits javascript:/data: hrefs', () => {
    const nodes = renderTextWithLinks('javascript:alert(1)');
    // No link element is produced for the dangerous scheme.
    expect(stripReact(nodes)).not.toContain('A[');
    expect(stripReact(nodes)).toContain('javascript:alert(1)');
  });

  it('renders without links when there is no URL', () => {
    expect(stripReact(renderTextWithLinks('just plain text'))).toBe('just plain text');
  });
});

describe('renderTextWithLinks — @username mentions', () => {
  it('keeps @username plain by default (no behavior change)', () => {
    expect(stripReact(renderTextWithLinks('Hey @alex!'))).toBe('Hey @alex!');
  });

  it('links a mention at the start of the text when enabled', () => {
    const output = stripReact(renderTextWithLinks('@alex great post', 'linkify', { mentions: true }));
    expect(output).toContain('A[/profile/alex]@alex');
    expect(output).toContain(' great post');
  });

  it('links an embedded mention and keeps surrounding text intact', () => {
    const output = stripReact(renderTextWithLinks('Let me tag @alex here', 'linkify', { mentions: true }));
    expect(output).toBe('Let me tag A[/profile/alex]@alex here');
  });

  it('preserves the visible @ and links the canonical lowercase profile', () => {
    // VANTA stores usernames lowercase and mention lookup lowercases, so
    // @Alex navigates to /profile/alex while the visible text keeps @Alex.
    const output = stripReact(renderTextWithLinks('@Alex', 'linkify', { mentions: true }));
    expect(output).toContain('A[/profile/alex]@Alex');
  });

  it('does not turn email-style @ or non-username @ text into mentions', () => {
    const output = stripReact(renderTextWithLinks('mail me at alex@example.com or @x', 'linkify', { mentions: true }));
    expect(output).toBe('mail me at alex@example.com or @x');
  });

  it('links URLs and mentions together without corrupting either', () => {
    const output = stripReact(renderTextWithLinks('@alex check https://t.me/alphidrop now', 'linkify', { mentions: true }));
    expect(output).toContain('A[/profile/alex]@alex');
    expect(output).toContain('A[https://t.me/alphidrop]https://t.me/alphidrop');
    expect(output).toContain(' now');
  });
});