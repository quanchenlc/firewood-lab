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
  isRechopWorthy,
  MIN_RECHOP_DIAGONAL,
  MAX_LIVE_FRAGMENTS,
  TINY_CHIP_DIAGONAL,
  type FracturePlan,
  type FracturePlanInput,
  type FractureAxeStats,
} from './fracture-plan.ts';
