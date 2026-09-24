/**
 * liveStageLayout
 * ---------------
 * Pure stage-layout rules for the VANTA live room (host + up to 4 guests).
 *
 * The host is always visually prioritized:
 *  - 1 person  → host fills the screen
 *  - 2 people  → host left / guest right (50/50)
 *  - 3 people  → host left / 2 guests stacked on the right
 *  - 4 people  → host left / 3 guests on the right
 *  - 5 people  → host left / 4 guests in a 2×2 grid on the right
 * On narrow screens the host moves to the top and guests flow below.
 *
 * The layout is deliberately expressed as data (Tailwind class strings) so the
 * renderer stays a dumb consumer and every rule is unit-testable. All video
 * uses object-fit: cover at the tile level, so tiles never stretch faces.
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
  /** 1 = guests stack in a column, 2 = guests fill a 2×2 grid. */
  guestColumns: 1 | 2;
}

/** Outer shell shared by every participant count. */
export const STAGE_CONTAINER_CLASS = 'absolute inset-0 flex flex-col gap-1.5 p-1.5 md:flex-row md:gap-2 md:p-2';

const SOLO: StageLayout = {
  arrangement: 'solo',
  containerClass: STAGE_CONTAINER_CLASS,
  hostTileClass: 'flex-1',
  hostWrapperClass: undefined,
  guestTileClass: 'flex-1',
  guestAreaClass: undefined,
  guestColumns: 1,
};

const SPLIT: StageLayout = {
  arrangement: 'split',
  containerClass: STAGE_CONTAINER_CLASS,
  hostTileClass: 'min-h-[38dvh] flex-1',
  hostWrapperClass: undefined,
  guestTileClass: 'min-h-[38dvh] flex-1',
  guestAreaClass: undefined,
  guestColumns: 1,
};

const HOST_COL: StageLayout = {
  arrangement: 'host-col',
  containerClass: STAGE_CONTAINER_CLASS,
  hostTileClass: 'h-full w-full',
  hostWrapperClass: 'flex h-[46dvh] flex-1 md:h-auto md:w-[60%] lg:w-[64%]',
  guestTileClass: 'min-h-[22dvh] flex-1 md:min-h-0',
  guestAreaClass: 'flex flex-1 flex-col gap-1.5 md:gap-2',
  guestColumns: 1,
};

const HOST_COL_GRID: StageLayout = {
  arrangement: 'host-col-grid',
  containerClass: STAGE_CONTAINER_CLASS,
  hostTileClass: 'h-full w-full',
  hostWrapperClass: 'flex h-[46dvh] flex-1 md:h-auto md:w-[56%] lg:w-[60%]',
  guestTileClass: 'min-h-[22dvh] md:min-h-0',
  guestAreaClass: 'grid flex-1 grid-cols-2 gap-1.5 md:gap-2',
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