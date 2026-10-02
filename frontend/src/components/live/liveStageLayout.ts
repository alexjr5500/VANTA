/**
 * liveStageLayout
 * ---------------
 * Pure stage-layout rules for the VANTA live room (host + up to 4 guests).
 *
 * The layout is PORTRAIT-FIRST: the phone is meant to stay upright, so every
 * participant count is solved for a tall/narrow viewport first:
 *  - 1 person  → host fills the screen
 *  - 2 people  → host and guest split the available height 50/50 (stacked)
 *  - 3 people  → host on top (larger), 2 guests side by side below
 *  - 4 people  → host on top, 3 guests below (2 + 1 full-width)
 *  - 5 people  → host on top, 4 guests in a 2×2 grid below
 * On landscape screens (md+) the host moves to the left column and guests flow
 * to the right, matching the original desktop design.
 *
 * All sizes are expressed with flex-grow / grid fractions of the AVAILABLE
 * viewport — never fixed `dvh`/pixel heights — so the stage can never overflow
 * a portrait screen, and 4x3 tiles keep their correct aspect ratio. The video
 * fit itself lives in the renderer (`object-contain` full-bleed vs
 * `object-cover` tiles).
 *
 * The layout is deliberately expressed as data (Tailwind class strings) so the
 * renderer stays a dumb consumer and every rule is unit-testable.
 */

export const MAX_STAGE_PARTICIPANTS = 5;

export type StageArrangement = 'solo' | 'split' | 'host-col' | 'host-col-grid';

export interface StageLayout {
  /** Which responsive arrangement the stage should use. */
  arrangement: StageArrangement;
  /** Classes of the always-present outer stage container. */
  containerClass: string;
  /** Tile classes for the host (or the single/paired tile in solo/split). */
  hostTileClass: string;
  /** Wrapper around the host tile for 3+ participant layouts (undefined for ≤ 2). */
  hostWrapperClass: string | undefined;
  /** Tile classes for every guest tile. */
  guestTileClass: string;
  /** Container of guest tiles for 3+ participant layouts (undefined for ≤ 2). */
  guestAreaClass: string | undefined;
  /** Extra class for the LAST guest tile when it must span a full row (odd guest counts in a 2-col portrait grid). */
  guestSpanClass: string | undefined;
  /** 1 = guests stack in a column, 2 = guests fill a 2×2 grid. */
  guestColumns: 1 | 2;
}

/** Outer shell shared by every participant count. Portrait stacks, landscape splits. */
export const STAGE_CONTAINER_CLASS = 'absolute inset-0 flex flex-col gap-1.5 p-1.5 md:flex-row md:gap-2 md:p-2';

const SOLO: StageLayout = {
  arrangement: 'solo',
  containerClass: STAGE_CONTAINER_CLASS,
  hostTileClass: 'flex-1',
  hostWrapperClass: undefined,
  guestTileClass: 'flex-1',
  guestAreaClass: undefined,
  guestSpanClass: undefined,
  guestColumns: 1,
};

const SPLIT: StageLayout = {
  arrangement: 'split',
  containerClass: STAGE_CONTAINER_CLASS,
  // `flex-1` distributes the AVAILABLE main axis: stacked in portrait (50/50
  // height), side-by-side in landscape (50/50 width). No fixed heights, so it
  // can never overflow a portrait viewport.
  hostTileClass: 'min-h-0 flex-1',
  hostWrapperClass: undefined,
  guestTileClass: 'min-h-0 flex-1',
  guestAreaClass: undefined,
  guestSpanClass: undefined,
  guestColumns: 1,
};

const HOST_COL: StageLayout = {
  arrangement: 'host-col',
  containerClass: STAGE_CONTAINER_CLASS,
  hostTileClass: 'h-full w-full',
  // Portrait: full width on top, 5/9 of the stage height (guests take 4/9).
  // Landscape: full height, 60% (later 64%) of the width on the left.
  hostWrapperClass: 'flex min-h-0 w-full grow-[5] md:h-full md:grow-0 md:w-[60%] lg:w-[64%]',
  guestTileClass: 'min-h-0 min-w-0',
  guestAreaClass:
    'grid min-h-0 w-full grow-[4] grid-cols-2 content-start gap-1.5 md:h-full md:grow md:w-[40%] md:flex md:flex-col md:gap-2 lg:w-[36%]',
  guestSpanClass: 'col-span-2',
  guestColumns: 2,
};

const HOST_COL_GRID: StageLayout = {
  arrangement: 'host-col-grid',
  containerClass: STAGE_CONTAINER_CLASS,
  hostTileClass: 'h-full w-full',
  // Portrait: host ~44% of the height, guests ~56% in a 2×2 grid below.
  // Landscape: full height, 56–60% of the width, guests 2×2 on the right.
  hostWrapperClass: 'flex min-h-0 w-full grow-[7] md:h-full md:grow-0 md:w-[56%] lg:w-[60%]',
  guestTileClass: 'min-h-0 min-w-0',
  guestAreaClass: 'grid min-h-0 w-full grow-[9] grid-cols-2 content-start gap-1.5 md:h-full md:grow md:grid-cols-2 md:w-[44%] md:gap-2 lg:w-[40%]',
  guestSpanClass: undefined,
  guestColumns: 2,
};

/** Classify a participant count into its responsive stage arrangement. */
export function stageArrangementFor(participantCount: number): StageArrangement {
  if (participantCount <= 1) return 'solo';
  if (participantCount === 2) return 'split';
  if (participantCount === 3 || participantCount === 4) return 'host-col';
  // 5+ (or defensive negative input) flows excess guests into the 2×2 grid.
  return 'host-col-grid';
}

/** Resolve the full class-string layout for a participant count. */
export function stageLayoutFor(participantCount: number): StageLayout {
  switch (stageArrangementFor(Math.max(0, participantCount))) {
    case 'solo':
      return SOLO;
    case 'split':
      return SPLIT;
    case 'host-col':
      return HOST_COL;
    case 'host-col-grid':
      return HOST_COL_GRID;
  }
}