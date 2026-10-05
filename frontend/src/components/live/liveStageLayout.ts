/**
 * liveStageLayout
 * ---------------
 * Pure stage-layout rules for the VANTA live room (host + up to 4 guests).
 *
 * The layout is a REAL grid algorithm expressed as CSS grid geometry
 * (template-areas / columns / rows). The renderer stays a dumb consumer and
 * every rule is unit-testable.
 *
 * HOST ANCHORING — the host is ALWAYS placed into the primary grid area via the
 * explicit `isHost` role, never by array order. A reordered participant list
 * can therefore never move the host to a secondary position.
 *
 * Arrangements (mirroring the product spec):
 *   - 1 person  → SOLO: host fills the stage (object-contain + blurred backdrop)
 *   - 2 people  → SPLIT: host LEFT | guest RIGHT (50/50)
 *   - 3 people  → host + guest on the top row, third guest spans the bottom row
 *   - 4 people  → 2×2 grid, host top-left
 *   - 5 people  → host anchors the left column (2 cells tall), 4 guests flow
 *                 into the right column + bottom row — an adaptive grid that
 *                 keeps faces readable and the host prioritised.
 *
 * All sizes are `minmax(0, 1fr)` fractions of the available viewport — never
 * fixed `dvh`/pixel heights — so the stage can never overflow any screen.
 * The video fit itself lives in the renderer (`object-contain` solo vs
 * `object-cover` tiles).
 */

export const MAX_STAGE_PARTICIPANTS = 5;

export type StageArrangement = 'solo' | 'split' | 'host-col' | 'host-grid' | 'host-grid5';

export interface StageLayout {
  /** Which arrangement the stage uses for this participant count. */
  arrangement: StageArrangement;
  /** Classes of the always-present outer grid container. */
  containerClass: string;
  /** CSS `grid-template-columns` value (fractions of the available width). */
  columns: string;
  /** CSS `grid-template-rows` value (fractions of the available height). */
  rows: string;
  /** CSS `grid-template-areas` strings — one quoted row per array element. */
  areas: string[];
  /** Grid-area every HOST tile renders into. */
  hostArea: string;
  /** Guest area names in their visual row-major order. */
  guestAreas: string[];
  /** Base classes for every tile. */
  tileClass: string;
  /** Extra classes applied only to the host tile (subtle gold identity ring). */
  hostTileClass: string;
  /** Solo renders `object-contain` over a blurred full-bleed backdrop. */
  soloContain: boolean;
}

/** The host always anchors this named grid area. */
export const HOST_AREA = 'host';

/** Outer shell shared by every participant count — an inset CSS grid. */
export const STAGE_CONTAINER_CLASS = 'absolute inset-0 grid gap-1.5 p-1.5 md:gap-2 md:p-2';

const TILE_CLASS = 'live-stage-tile min-h-0 min-w-0 overflow-hidden rounded-2xl';

const SOLO: StageLayout = {
  arrangement: 'solo',
  containerClass: STAGE_CONTAINER_CLASS,
  columns: 'minmax(0, 1fr)',
  rows: 'minmax(0, 1fr)',
  areas: ['"host"'],
  hostArea: HOST_AREA,
  guestAreas: [],
  tileClass: TILE_CLASS,
  hostTileClass: '',
  soloContain: true,
};

const SPLIT: StageLayout = {
  arrangement: 'split',
  containerClass: STAGE_CONTAINER_CLASS,
  // True side-by-side 2-column grid for exactly 2 participants: both columns
  // share the available width equally (host LEFT in the `host` area, the single
  // guest RIGHT in `g1`). Explicit repeat(2, minmax(0, 1fr)) — never a row
  // stack, never one tile larger than the other, responsive at every width.
  columns: 'repeat(2, minmax(0, 1fr))',
  rows: 'minmax(0, 1fr)',
  areas: ['"host g1"'],
  hostArea: HOST_AREA,
  guestAreas: ['g1'],
  tileClass: TILE_CLASS,
  hostTileClass: '',
  soloContain: false,
};

const HOST_COL: StageLayout = {
  arrangement: 'host-col',
  containerClass: STAGE_CONTAINER_CLASS,
  columns: 'minmax(0, 1fr) minmax(0, 1fr)',
  rows: 'minmax(0, 1fr) minmax(0, 1fr)',
  areas: ['"host g1"', '"g2 g2"'],
  hostArea: HOST_AREA,
  guestAreas: ['g1', 'g2'],
  tileClass: TILE_CLASS,
  hostTileClass: '',
  soloContain: false,
};

const HOST_GRID: StageLayout = {
  arrangement: 'host-grid',
  containerClass: STAGE_CONTAINER_CLASS,
  columns: 'minmax(0, 1fr) minmax(0, 1fr)',
  rows: 'minmax(0, 1fr) minmax(0, 1fr)',
  areas: ['"host g1"', '"g2 g3"'],
  hostArea: HOST_AREA,
  guestAreas: ['g1', 'g2', 'g3'],
  tileClass: TILE_CLASS,
  hostTileClass: '',
  soloContain: false,
};

const HOST_GRID5: StageLayout = {
  arrangement: 'host-grid5',
  containerClass: STAGE_CONTAINER_CLASS,
  columns: 'minmax(0, 1fr) minmax(0, 1fr)',
  rows: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
  areas: ['"host g1"', '"host g2"', '"g3 g4"'],
  hostArea: HOST_AREA,
  guestAreas: ['g1', 'g2', 'g3', 'g4'],
  tileClass: TILE_CLASS,
  hostTileClass: '',
  soloContain: false,
};

/** Classify a participant count into its stage arrangement. */
export function stageArrangementFor(participantCount: number): StageArrangement {
  if (participantCount <= 1) return 'solo';
  if (participantCount === 2) return 'split';
  if (participantCount === 3) return 'host-col';
  if (participantCount === 4) return 'host-grid';
  // 5+ (or defensive negative input) flows extra guests into the 2×2 cluster.
  return 'host-grid5';
}

/** Resolve the full layout for a participant count. */
export function stageLayoutFor(participantCount: number): StageLayout {
  switch (stageArrangementFor(Math.max(0, participantCount))) {
    case 'solo':
      return SOLO;
    case 'split':
      return SPLIT;
    case 'host-col':
      return HOST_COL;
    case 'host-grid':
      return HOST_GRID;
    case 'host-grid5':
      return HOST_GRID5;
  }
}