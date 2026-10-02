import { describe, expect, test } from 'vitest';
import {
  HOST_AREA,
  MAX_STAGE_PARTICIPANTS,
  STAGE_CONTAINER_CLASS,
  stageArrangementFor,
  stageLayoutFor,
} from './liveStageLayout';

describe('stageArrangementFor', () => {
  test('a single participant fills the stage solo', () => {
    expect(stageArrangementFor(1)).toBe('solo');
  });

  test('two participants split the stage host LEFT / guest RIGHT', () => {
    expect(stageArrangementFor(2)).toBe('split');
  });

  test('three participants use the two-top one-bottom arrangement', () => {
    expect(stageArrangementFor(3)).toBe('host-col');
  });

  test('four participants use a 2x2 grid with the host first', () => {
    expect(stageArrangementFor(4)).toBe('host-grid');
  });

  test('five participants use the host-anchored 5-up grid', () => {
    expect(stageArrangementFor(5)).toBe('host-grid5');
  });

  test('degenerate inputs degrade gracefully instead of crashing', () => {
    expect(stageArrangementFor(0)).toBe('solo');
    expect(stageArrangementFor(-3)).toBe('solo');
    expect(stageArrangementFor(6)).toBe('host-grid5');
  });
});

describe('stageLayoutFor', () => {
  test('the host is always anchored to the primary grid area', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const layout = stageLayoutFor(count);
      expect(layout.hostArea).toBe(HOST_AREA);
      // The host area is always the FIRST cell (row-major) of the grid.
      expect(layout.areas[0]).toContain('host');
      expect(layout.areas[0].replace(/"/g, '').trim().split(/\s+/)[0]).toBe(HOST_AREA);
    }
  });

  test('solo layout is one full-bleed tile rendered object-contain', () => {
    const layout = stageLayoutFor(1);
    expect(layout.arrangement).toBe('solo');
    expect(layout.columns).toBe('minmax(0, 1fr)');
    expect(layout.rows).toBe('minmax(0, 1fr)');
    expect(layout.areas).toEqual(['"host"']);
    expect(layout.guestAreas).toEqual([]);
    expect(layout.soloContain).toBe(true);
    expect(layout.hostTileClass).toBe('');
  });

  test('split layout puts the host LEFT and the single guest RIGHT', () => {
    const layout = stageLayoutFor(2);
    expect(layout.arrangement).toBe('split');
    expect(layout.columns).toBe('minmax(0, 1fr) minmax(0, 1fr)');
    expect(layout.areas).toEqual(['"host g1"']);
    expect(layout.guestAreas).toEqual(['g1']);
    // "host" appears before "g1" on the same row → host is on the left.
    const row = layout.areas[0];
    expect(row.indexOf('host')).toBeLessThan(row.indexOf('g1'));
  });

  test('three participants: host+g1 on top, g2 spans the bottom row', () => {
    const layout = stageLayoutFor(3);
    expect(layout.arrangement).toBe('host-col');
    expect(layout.areas).toEqual(['"host g1"', '"g2 g2"']);
    expect(layout.guestAreas).toEqual(['g1', 'g2']);
    expect(layout.columns).toBe('minmax(0, 1fr) minmax(0, 1fr)');
    expect(layout.rows).toBe('minmax(0, 1fr) minmax(0, 1fr)');
  });

  test('four participants: 2x2 grid with host top-left', () => {
    const layout = stageLayoutFor(4);
    expect(layout.arrangement).toBe('host-grid');
    expect(layout.areas).toEqual(['"host g1"', '"g2 g3"']);
    expect(layout.guestAreas).toEqual(['g1', 'g2', 'g3']);
  });

  test('five participants keep a readable adaptive grid with host priority', () => {
    const layout = stageLayoutFor(5);
    expect(layout.arrangement).toBe('host-grid5');
    expect(layout.areas).toEqual(['"host g1"', '"host g2"', '"g3 g4"']);
    expect(layout.guestAreas).toEqual(['g1', 'g2', 'g3', 'g4']);
    // Host spans the left column of the first two rows (2 cells — prioritised,
    // not overpowering).
    expect(layout.areas[0]).toContain('host');
    expect(layout.areas[1]).toContain('host');
    expect(layout.areas[2]).not.toContain('host');
  });

  test('every supported count uses integer-free responsive grid fractions', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const layout = stageLayoutFor(count);
      expect(layout.columns).toMatch(/minmax\(0, 1fr\)/);
      expect(layout.rows).toMatch(/minmax\(0, 1fr\)/);
      // Never fixed pixel/dvh heights that could overflow a viewport.
      expect(layout.rows).not.toMatch(/dvh|px/);
      expect(layout.columns).not.toMatch(/dvh|px/);
    }
  });

  test('every supported count shares the same outer container', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      expect(stageLayoutFor(count).containerClass).toBe(STAGE_CONTAINER_CLASS);
      expect(STAGE_CONTAINER_CLASS).toContain('grid');
    }
  });

  test('every tile (host + guests) resolves to exactly one grid area', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const layout = stageLayoutFor(count);
      const cells = layout.areas.flatMap((row) => row.replace(/"/g, '').trim().split(/\s+/));
      const present = [layout.hostArea, ...layout.guestAreas];
      expect(present).toHaveLength(count);
      for (const area of present) {
        expect(cells).toContain(area);
      }
    }
  });

  test('the design only ever seats host + up to 4 guests', () => {
    expect(MAX_STAGE_PARTICIPANTS).toBe(5);
    const layout = stageLayoutFor(5);
    // 4 guests max → a 2x2 guest cluster, never a taller stack.
    expect(layout.guestAreas).toHaveLength(4);
    expect(layout.rows.match(/minmax\(0, 1fr\)/g)).toHaveLength(3);
  });
});