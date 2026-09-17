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
  cleaveNormalFromCameraFacing,
  rotateCleaveNormal90,
  advanceOrientChopCount,
  CHOPS_BEFORE_ORIENT_ROTATE,
  isRechopWorthy,
  isFirewoodChip,
  isFirewoodByVolumeAspect,
  volumeInchesFromBBox,
  horizontalAspectXZ,
  horizontalAspectFromSize,
  thicknessInchesAlong,
  isTooThinToSplit,
  azimuthNudgeVelocity,
  lateralOffsetFromDiameter,
  INCH,
  FIREWOOD_VOL_ABS_MIN,
  FIREWOOD_VOL_MAX,
  FIREWOOD_ASPECT_RESCUE,
  VOLUME_BBOX_FILL,
  MIN_SPLIT_THICKNESS_IN,
  AZIMUTH_NUDGE_DAMP,
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
