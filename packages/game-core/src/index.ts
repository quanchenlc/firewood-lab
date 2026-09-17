/**
 * Pure game logic — no DOM / window / wx.
 */

export type { ChopOutcome } from './chop-types.ts';
export type { Axe, Species } from './types.ts';
export {
  resolveChop,
  getSweetSliderRange,
  axeForceScale,
  sweetHalfWindow,
  type ResolveChopInput,
} from './resolve-chop.ts';

export type { FractureHook, FractureHookContext } from './hooks.ts';

export {
  planFracture,
  cleaveNormalXZ,
  isRechopWorthy,
  isFirewoodChip,
  lateralOffsetFromDiameter,
  INCH,
  FACE_GAP_DIAMETER_FRAC,
  BOUNCE_POP_HEIGHT,
  BOUNCE_DURATION_MS,
  BOUNCE_YAW_JITTER_DEG,
  BOUNCE_TILT_DEG,
  MAX_RECHOP_GENERATION,
  MIN_RECHOP_DIAGONAL,
  MAX_LIVE_FRAGMENTS,
  TINY_CHIP_DIAGONAL,
  type FracturePlan,
  type FracturePlanInput,
  type FractureAxeStats,
  type SplitStyle,
} from './fracture-plan.ts';
