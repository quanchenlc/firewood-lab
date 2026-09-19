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
 * Plan-view polish (user feedback — “不要是规整圆形”):
 *   Reference applies `rw` to ALL verts with radial>ε (including cap rims).
 *   We also add a mild low-frequency ellipse + lobe scale so the overall
 *   silhouette reads as an imperfect stump circle, not a clean cylinder.
 *
 * Sized so AABB × VOLUME_BBOX_FILL (0.7) volume lands in ~0.9k–3.5k in³ across
 * the random range — workable with FIREWOOD_VOL_ABS_MIN=250 / FIREWOOD_VOL_MAX=500
 * (thresholds unchanged). Mid defaults keep framing close to the prior fixed round.
 *
 * Visual retune vs stockier stump (STUMP_* ≈ 0.34/0.40/0.34): inch ranges sit a
 * modest ~12–15% above the pure reference so the round reads larger on the block
 * (stump outline noise also fattens the visual top), while max bot radius (+ bark)
 * still seats inside the stump top with margin.
 */

export const INCH = 0.0254;

/**
 * Radius range (inches). Reference was `(9+rand*7)/2` → 4.5…8;
 * bumped so the round fills the stump top better after stockier STUMP_* retune.
 */
export const LOG_RADIUS_IN_MIN = 5.5;
export const LOG_RADIUS_IN_MAX = 9;
/** Height range (inches). Reference was `12+rand*4` → 12…16; modest bump. */
export const LOG_HEIGHT_IN_MIN = 13.5;
export const LOG_HEIGHT_IN_MAX = 17.5;

/** Bark irregularity (reference `qu` / `Ju`), in inches. */
export const BARK_AMP_IN = 0.4;
export const BARK_BOTTOM_BIAS = 0.1;

/**
 * Low-frequency plan silhouette (unitless radius scale).
 * Ellipse ±~14% + 3/5-lobe bumps — clearly not a clean circle, still stump-like.
 */
export const PLAN_ELLIPSE_AMP = 0.14;
export const PLAN_LOBE3_AMP = 0.11;
export const PLAN_LOBE5_AMP = 0.05;

/** Mid-range defaults (stable exports for framing / tests). */
export const LOG_HEIGHT = ((LOG_HEIGHT_IN_MIN + LOG_HEIGHT_IN_MAX) / 2) * INCH;
export const LOG_RADIUS_BOT = ((LOG_RADIUS_IN_MIN + LOG_RADIUS_IN_MAX) / 2) * INCH;
/** Mild taper so end-grain reads slightly narrower than the base (beyond equal-r ref). */
export const LOG_RADIUS_TOP = LOG_RADIUS_BOT * 0.92;

/**
 * Flat-top chopping block under the round (slightly wider than max log).
 * Stockier silhouette: height ≈ half average diameter, top a bit narrower than bottom
 * (feel toward a real chopping stump — not 1:1 with any proprietary ref mesh).
 */
export const STUMP_TOP_RADIUS = 0.34;
export const STUMP_BOT_RADIUS = 0.4;
export const STUMP_HEIGHT = 0.34;

/** Orbit look-at Y ≈ stump top + half default log height. */
export const CAM_LOOK_AT_Y = STUMP_HEIGHT + LOG_HEIGHT * 0.5;
/** Orbit distance — slightly out so the modestly larger round still frames cleanly. */
export const CAM_RADIUS = 3.1;

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
 * Low-frequency plan-view scale so the stump outline is an imperfect circle.
 * `angle` = atan2(z, x) in radians (not the ×3 bark theta).
 */
export function planSilhouetteScale(angle: number, seed = 0): number {
  const ellipse = PLAN_ELLIPSE_AMP * Math.cos(2 * angle + seed * 0.017);
  const lobe3 = PLAN_LOBE3_AMP * Math.sin(3 * angle + seed * 0.031);
  const lobe5 = PLAN_LOBE5_AMP * Math.sin(5 * angle + seed * 0.053);
  return 1 + ellipse + lobe3 + lobe5;
}

/** Combined radial offset (metres) at a height fraction n∈[0,1] and angle. */
export function radialBarkOffsetMetres(
  angle: number,
  heightFrac: number,
  seed: number,
  ampIn: number = BARK_AMP_IN,
): number {
  const n = Math.max(0, Math.min(1, heightFrac));
  const theta = angle * 3;
  const topN = barkNoise(theta, seed);
  const botN = barkNoise(theta, seed + 42);
  const mixed = topN * n + botN * (1 - n);
  return mixed * (ampIn * INCH * (1 + (1 - n) * BARK_BOTTOM_BIAS));
}

/**
 * Displace cylinder verts radially (reference `ow` loop + plan silhouette).
 * Cap centers (near-axis) stay put; cap rims ARE displaced so the plan outline
 * is organic. Y is never changed → flat top/bottom seats for sit-on-stump.
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
  const seed = dims.barkSeed;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const radial = Math.hypot(x, z);
    // Skip near-axis / cap centers only (reference `p>1e-4`).
    if (radial < 1e-4) continue;
    const angle = Math.atan2(z, x);
    const n = y / dims.height + 0.5; // 0 at bottom → 1 at top
    const plan = planSilhouetteScale(angle, seed);
    const bark = radialBarkOffsetMetres(angle, n, seed);
    const targetR = radial * plan + bark;
    const scale = targetR / radial;
    pos.setXYZ(i, x * scale, y, z * scale);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * Per-log random U offset on the cylindrical mantle (side group only).
 * Caps keep their own verts/UVs — do not touch endgrain unwrap.
 * Matches reference `ow` random U shift so bark doesn't tile identically.
 */
export function applyRandomMantleUOffset(
  geo: {
    groups: Array<{ start: number; count: number; materialIndex?: number }>;
    index: { getX(i: number): number } | null;
    getAttribute(name: string): {
      count: number;
      getX(i: number): number;
      setX(i: number, x: number): void;
      needsUpdate: boolean;
    } | undefined;
  },
  uOffset = Math.random(),
): number {
  const uv = geo.getAttribute('uv');
  const index = geo.index;
  if (!uv || !index) return uOffset;
  const side =
    geo.groups.find((g) => (g.materialIndex ?? 0) === 0) ?? geo.groups[0];
  if (!side || side.count <= 0) return uOffset;
  const seen = new Set<number>();
  const end = side.start + side.count;
  for (let i = side.start; i < end; i++) {
    const vi = index.getX(i);
    if (seen.has(vi)) continue;
    seen.add(vi);
    uv.setX(vi, uv.getX(vi) + uOffset);
  }
  uv.needsUpdate = true;
  return uOffset;
}

/**
 * Same organic outline for the chopping-block cylinder / cut-face disk.
 * - Cylinder (Y-up): radial = hypot(x,z)
 * - CircleGeometry (XY plane, later rotated flat): radial = hypot(x,y)
 *
 * Additive bark must NOT be divided by near-axis radial (cap interiors) —
 * that explodes top/bottom disks into a giant ground-plane pancake.
 * Fade bark by edgeFactor = radial / refRadius so only the outer silhouette moves.
 */
export function applyStumpOutlineIrregularity(
  geo: {
    getAttribute(name: string): {
      count: number;
      getX(i: number): number;
      getY(i: number): number;
      getZ(i: number): number;
      setXYZ(i: number, x: number, y: number, z: number): void;
      needsUpdate: boolean;
    } | undefined;
    computeVertexNormals?: () => void;
  },
  opts: {
    height: number;
    seed?: number;
    ampIn?: number;
    /** 'xz' for Y-up cylinder; 'xy' for flat CircleGeometry before tilt. */
    plane?: 'xz' | 'xy';
    /** Nominal outer radius (or top/bot for a taper) — required for safe caps. */
    refRadius?: number;
    refRadiusTop?: number;
    refRadiusBot?: number;
  },
): void {
  const pos = geo.getAttribute('position');
  if (!pos) return;
  const seed = opts.seed ?? 17;
  const ampIn = opts.ampIn ?? BARK_AMP_IN * 0.85;
  const h = Math.max(1e-6, opts.height);
  const plane = opts.plane ?? 'xz';
  const rTop = opts.refRadiusTop ?? opts.refRadius;
  const rBot = opts.refRadiusBot ?? opts.refRadius;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const radial = plane === 'xy' ? Math.hypot(x, y) : Math.hypot(x, z);
    if (radial < 1e-4) continue;
    const angle = plane === 'xy' ? Math.atan2(y, x) : Math.atan2(z, x);
    const heightFrac =
      plane === 'xy' ? 1 : Math.max(0, Math.min(1, (y + h * 0.5) / h));
    const plan = planSilhouetteScale(angle, seed + 9);
    const bark = radialBarkOffsetMetres(angle, heightFrac, seed, ampIn);
    // Nominal mantle radius at this height (taper-aware).
    const refR =
      rTop != null && rBot != null
        ? rBot + (rTop - rBot) * heightFrac
        : (opts.refRadius ?? radial);
    const edge = Math.min(1, radial / Math.max(refR * 0.85, 1e-6));
    const targetR = radial * plan + bark * edge;
    const scale = targetR / radial;
    if (plane === 'xy') {
      pos.setXYZ(i, x * scale, y * scale, z);
    } else {
      pos.setXYZ(i, x * scale, y, z * scale);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals?.();
}

/**
 * Sample plan-view radii after silhouette warp (for tests / debug).
 * Returns min/max hypot(x,z) among non-axis verts near a given height band.
 */
export function samplePlanRadii(
  positions: Array<{ x: number; y: number; z: number }>,
  dims: LogRoundDims,
): { min: number; max: number; ratio: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of positions) {
    const r0 = Math.hypot(p.x, p.z);
    if (r0 < 1e-4) continue;
    const angle = Math.atan2(p.z, p.x);
    const n = p.y / dims.height + 0.5;
    const r = r0 * planSilhouetteScale(angle, dims.barkSeed) + radialBarkOffsetMetres(angle, n, dims.barkSeed);
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  if (!Number.isFinite(min) || min <= 0) return { min: 0, max: 0, ratio: 1 };
  return { min, max, ratio: max / min };
}
