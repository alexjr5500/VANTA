import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import BookmarkIcon from './BookmarkIcon';

describe('VANTA bookmark appearance', () => {
  it('renders saved bookmarks filled with VANTA gold', () => {
    const html = renderToStaticMarkup(createElement(BookmarkIcon, { saved: true }));
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('color:var(--vanta-gold-bright, #dfbd55)');
  });
  it('renders unsaved bookmarks as a neutral outline', () => {
    const html = renderToStaticMarkup(createElement(BookmarkIcon, { saved: false }));
    expect(html).toContain('fill="none"');
    expect(html).not.toContain('--vanta-gold-bright');
  });
});
