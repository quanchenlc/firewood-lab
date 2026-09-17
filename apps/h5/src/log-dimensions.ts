/**
 * Choppable upright round + chopping-block scale for the H5 scene.
 *
 * Sized so AABB × VOLUME_BBOX_FILL (0.7) volume lands in the low thousands of in³,
 * matching existing FIREWOOD_VOL_ABS_MIN=250 / FIREWOOD_VOL_MAX=500 gates
 * (thresholds unchanged — the log was scaled down to meet them).
 *
 * Old giant: H=0.7, R=0.36/0.4 → AABB ≈ 0.8×0.7×0.8 → ~19k in³ (16 equal pieces still >500).
 * New round: H=0.38, R=0.17/0.19 → AABB ≈ 0.38³ → ~2340 in³
 *   → ~8 equal bipartition pieces ≈ 293 in³ (≤500); ~16 ≈ 146 in³ (≤250).
 */
export const LOG_HEIGHT = 0.38;
export const LOG_RADIUS_TOP = 0.17;
export const LOG_RADIUS_BOT = 0.19;

/** Flat-top chopping block under the round (slightly wider than the log). */
export const STUMP_TOP_RADIUS = 0.32;
export const STUMP_BOT_RADIUS = 0.36;
export const STUMP_HEIGHT = 0.42;

/** Orbit look-at Y ≈ stump top + half log height (log visual center). */
export const CAM_LOOK_AT_Y = STUMP_HEIGHT + LOG_HEIGHT * 0.5;
/** Closer orbit so the smaller round still fills first-person framing. */
export const CAM_RADIUS = 3.35;

/** Approximate full-log AABB width (uses bottom radius — widest). */
export function logAabbSize(): { x: number; y: number; z: number } {
  const d = LOG_RADIUS_BOT * 2;
  return { x: d, y: LOG_HEIGHT, z: d };
}
