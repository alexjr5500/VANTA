import { describe, expect, it } from 'vitest';
import { homeLocationLine } from './homeLocation';

describe('Homes public locality', () => {
  it('trims and deduplicates labels while retaining locality order', () => {
    expect(homeLocationLine({area:'  Lekki   Phase 1 ',city:'Lagos',state:' lagos ',country:'Nigeria'})).toBe('Lekki Phase 1, Lagos, Nigeria');
  });
  it('ignores empty and non-string fields', () => {
    expect(homeLocationLine({area:' ',city:null,state:123}, 'Location not specified')).toBe('Location not specified');
  });
  it('does not invent a measurement or change owner-supplied locality text', () => {
    expect(homeLocationLine({area:'Area 51',city:'Example City'})).toBe('Area 51, Example City');
  });
});
