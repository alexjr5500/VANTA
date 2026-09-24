import { describe, expect, test } from 'vitest';
import {
  MAX_STAGE_PARTICIPANTS,
  STAGE_CONTAINER_CLASS,
  stageArrangementFor,
  stageLayoutFor,
} from './liveStageLayout';

describe('stageArrangementFor', () => {
  test('a single participant fills the stage solo', () => {
    expect(stageArrangementFor(1)).toBe('solo');
  });

  test('two participants split the stage 50/50', () => {
    expect(stageArrangementFor(2)).toBe('split');
  });

  test('three or four participants use the host-left column layout', () => {
    expect(stageArrangementFor(3)).toBe('host-col');
    expect(stageArrangementFor(4)).toBe('host-col');
  });

  test('five participants use the host-left 2x2 grid layout', () => {
    expect(stageArrangementFor(5)).toBe('host-col-grid');
  });

  test('degenerate inputs degrade gracefully instead of crashing', () => {
    expect(stageArrangementFor(0)).toBe('solo');
    expect(stageArrangementFor(-3)).toBe('solo');
    expect(stageArrangementFor(6)).toBe('host-col-grid');
  });
});

describe('stageLayoutFor', () => {
  test('solo layout has no wrappers and a flex host tile', () => {
    const layout = stageLayoutFor(1);
    expect(layout.arrangement).toBe('solo');
    expect(layout.hostTileClass).toBe('flex-1');
    expect(layout.hostWrapperClass).toBeUndefined();
    expect(layout.guestAreaClass).toBeUndefined();
    expect(layout.guestColumns).toBe(1);
  });

  test('split layout gives both tiles equal height, side by side', () => {
    const layout = stageLayoutFor(2);
    expect(layout.hostTileClass).toBe('min-h-[38dvh] flex-1');
    expect(layout.guestTileClass).toBe('min-h-[38dvh] flex-1');
    expect(layout.hostWrapperClass).toBeUndefined();
    expect(layout.guestAreaClass).toBeUndefined();
  });

  test('host-col sizes the host wider than the guest stack', () => {
    const layout = stageLayoutFor(3);
    expect(layout.arrangement).toBe('host-col');
    expect(layout.hostWrapperClass).toContain('md:w-[60%]');
    expect(layout.hostWrapperClass).toContain('lg:w-[64%]');
    expect(layout.hostTileClass).toBe('h-full w-full');
    expect(layout.guestTileClass).toBe('min-h-[22dvh] flex-1 md:min-h-0');
    expect(layout.guestAreaClass).toBe('flex flex-1 flex-col gap-1.5 md:gap-2');
    expect(layout.guestColumns).toBe(1);
  });

  test('host-col-grid uses a slimmer host column and a 2x2 guest grid', () => {
    const layout = stageLayoutFor(5);
    expect(layout.arrangement).toBe('host-col-grid');
    expect(layout.hostWrapperClass).toContain('md:w-[56%]');
    expect(layout.hostWrapperClass).toContain('lg:w-[60%]');
    expect(layout.hostTileClass).toBe('h-full w-full');
    expect(layout.guestTileClass).toBe('min-h-[22dvh] md:min-h-0');
    expect(layout.guestAreaClass).toBe('grid flex-1 grid-cols-2 gap-1.5 md:gap-2');
    expect(layout.guestColumns).toBe(2);
  });

  test('every supported count shares the same outer container', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      expect(stageLayoutFor(count).containerClass).toBe(STAGE_CONTAINER_CLASS);
    }
  });

  test('the design only ever seats host + up to 4 guests', () => {
    expect(MAX_STAGE_PARTICIPANTS).toBe(5);
    // 4 guests max → a 2x2 grid, never a taller stack.
    expect(stageLayoutFor(5).guestColumns).toBe(2);
  });
});