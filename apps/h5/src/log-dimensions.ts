/**
 * Choppable upright round + chopping-block scale for the H5 scene.
 *
 * Reference (screen.toys/firewood `ow()` / spawnLog — logic only, no assets):
 *   ld = 0.0254  (inch → metre)
 *   radiusIn = (9 + Math.random() * 7) / 2   // 4.5 … 8 in  (equal top/bot)
 *   heightIn = 12 + Math.random() * 4        // 12 … 16 in
 *   bark amp qu=0.4 in, bottom bias Ju=0.1; sin-sum noise on radial silhouette
 *   volumeInches = π · r² · h  (their true-cylinder gate; we still use AABB×0.7)
 *
 * Sized so AABB × VOLUME_BBOX_FILL (0.7) volume lands in ~0.7k–3.5k in³ across
 * the random range — workable with FIREWOOD_VOL_ABS_MIN=250 / FIREWOOD_VOL_MAX=500
 * (thresholds unchanged). Mid defaults keep framing close to the prior fixed round.
 */

export const INCH = 0.0254;

/** Reference radius range (inches), from `(9+rand*7)/2`. */
export const LOG_RADIUS_IN_MIN = 4.5;
export const LOG_RADIUS_IN_MAX = 8;
/** Reference height range (inches), from `12+rand*4`. */
export const LOG_HEIGHT_IN_MIN = 12;
export const LOG_HEIGHT_IN_MAX = 16;

/** Bark irregularity (reference `qu` / `Ju`), in inches. */
export const BARK_AMP_IN = 0.4;
export const BARK_BOTTOM_BIAS = 0.1;

/** Mid-range defaults (stable exports for framing / tests). */
export const LOG_HEIGHT = ((LOG_HEIGHT_IN_MIN + LOG_HEIGHT_IN_MAX) / 2) * INCH;
export const LOG_RADIUS_BOT = ((LOG_RADIUS_IN_MIN + LOG_RADIUS_IN_MAX) / 2) * INCH;
/** Mild taper so end-grain reads slightly narrower than the base (beyond equal-r ref). */
export const LOG_RADIUS_TOP = LOG_RADIUS_BOT * 0.92;

/** Flat-top chopping block under the round (slightly wider than max log). */
export const STUMP_TOP_RADIUS = 0.32;
export const STUMP_BOT_RADIUS = 0.36;
export const STUMP_HEIGHT = 0.42;

/** Orbit look-at Y ≈ stump top + half default log height. */
export const CAM_LOOK_AT_Y = STUMP_HEIGHT + LOG_HEIGHT * 0.5;
/** Closer orbit so the smaller round still fills first-person framing. */
export const CAM_RADIUS = 2.95;

export interface LogRoundDims {
  /** Metres. */
  height: number;
  radiusTop: number;
  radiusBot: number;
  /** Seed for bark silhouette noise (reference `Math.random()*1e3`). */
  barkSeed: number;
}

export type RandFn = () => number;

/**
 * Sample a new upright round in the reference style.
 * Radius top/bot start equal (ref), then a light taper (0.88–1.0) for extra shape variety
 * without leaving the firewood volume band.
 */
export function sampleLogRound(rand: RandFn = Math.random): LogRoundDims {
  const radiusIn = LOG_RADIUS_IN_MIN + rand() * (LOG_RADIUS_IN_MAX - LOG_RADIUS_IN_MIN);
  const heightIn = LOG_HEIGHT_IN_MIN + rand() * (LOG_HEIGHT_IN_MAX - LOG_HEIGHT_IN_MIN);
  const radiusBot = radiusIn * INCH;
  // Subtle taper on top of equal-r base (ref itself relies on bark noise for silhouette).
  const taper = 0.88 + rand() * 0.12;
  const radiusTop = radiusBot * taper;
  const barkSeed = rand() * 1e3;
  return { height: heightIn * INCH, radiusTop, radiusBot, barkSeed };
}

export function defaultLogRound(): LogRoundDims {
  return {
    height: LOG_HEIGHT,
    radiusTop: LOG_RADIUS_TOP,
    radiusBot: LOG_RADIUS_BOT,
    barkSeed: 0,
  };
}

/** Approximate full-log AABB (uses bottom radius — widest). */
export function logAabbSize(dims: LogRoundDims = defaultLogRound()): {
  x: number;
  y: number;
  z: number;
} {
  const d = dims.radiusBot * 2;
  return { x: d, y: dims.height, z: d };
}

export function camLookAtY(dims: LogRoundDims, stumpTopY: number = STUMP_HEIGHT): number {
  return stumpTopY + dims.height * 0.5;
}

/**
 * Reference `rw`: cheap multi-sine radial noise (not Perlin).
 * `theta` is usually `atan2(z,x) * 3`.
 */
export function barkNoise(theta: number, seed = 0): number {
  return (
    Math.sin(theta * 127.1 + seed * 311.7) * 0.5 +
    Math.sin(theta * 269.5 + seed * 183.3) * 0.3 +
    Math.sin(theta * 419.2 + seed * 77.9) * 0.2
  );
}

/**
 * Displace cylinder side verts radially (reference `ow` loop).
 * Caps (~top/bottom) are left alone so the round still sits flat on the stump.
 */
export function applyBarkIrregularity(
  geo: {
    getAttribute(name: string): {
      count: number;
      getX(i: number): number;
      getY(i: number): number;
      getZ(i: number): number;
      setXYZ(i: number, x: number, y: number, z: number): void;
      needsUpdate: boolean;
    } | undefined;
    computeVertexNormals(): void;
  },
  dims: LogRoundDims,
): void {
  const pos = geo.getAttribute('position');
  if (!pos) return;
  const halfH = dims.height * 0.5;
  const amp = BARK_AMP_IN * INCH;
  const seed = dims.barkSeed;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const radial = Math.hypot(x, z);
    // Skip near-axis / cap centers.
    if (radial < 1e-4) continue;
    // Skip flat caps (end grain) so seating on the stump stays flat.
    if (Math.abs(Math.abs(y) - halfH) < 1e-4) continue;
    const n = y / dims.height + 0.5; // 0 at bottom → 1 at top
    const theta = Math.atan2(z, x) * 3;
    const topN = barkNoise(theta, seed);
    const botN = barkNoise(theta, seed + 42);
    const mixed = topN * n + botN * (1 - n);
    const f = mixed * (amp * (1 + (1 - n) * BARK_BOTTOM_BIAS));
    const scale = (radial + f) / radial;
    pos.setXYZ(i, x * scale, y, z * scale);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}
