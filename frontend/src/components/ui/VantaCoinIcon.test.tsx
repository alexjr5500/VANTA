import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import VantaCoinIcon from './VantaCoinIcon';

describe('VANTA currency branding', () => {
  it('uses the original packaged VANTA mark and a currency label', () => {
    const html = renderToStaticMarkup(<VantaCoinIcon size={24} />);
    expect(html).toContain('/branding/pwa-192.png');
    expect(html).toContain('aria-label="VANTA Coins"');
    expect(html).not.toContain('<svg');
  });
  it('can be decorative when the adjacent text already identifies currency', () => {
    const html = renderToStaticMarkup(<VantaCoinIcon decorative />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('aria-label=');
  });
});
