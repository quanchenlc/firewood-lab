/**
 * Pure fracture planning — no DOM / Three / physics.
 * Maps chop outcome (+ optional axe stats) to fragment budgets & impulse.
 *
 * Directional cleave: prefer a vertical chop plane through the aim point
 * (grain-aligned / planar split) over isotropic Voronoi burst.
 *
 * Settle feel mirrors reverse-engineered screen.toys/firewood `performSplit`
 * bounce (logic only — not assets). Face gap is a modest crack
 * (~0.15–0.25× diameter total / ~1–2″ per side), not a half-diameter dump.
 */

import type { ChopOutcome } from './chop-types.ts';

export interface FractureAxeStats {
  weight: number;
  edge: number;
}

export interface FracturePlanInput {
  outcome: ChopOutcome;
  /** Prefer lower counts on phones / low-core devices. */
  weakDevice?: boolean;
  axe?: Pick<FractureAxeStats, 'weight' | 'edge'>;
  /** External generation for re-chop (0 = first break). */
  generation?: number;
}

/** How the H5 layer should open the wood. */
export type SplitStyle = 'nick' | 'cleave' | 'cleave_messy';

/** Metres per inch — screen.toys unit scale `ld = 0.0254`. */
export const INCH = 0.0254;
/**
 * Reference firewood volume gate (cubic inches), from screen.toys `performSplit`.
 * Volume uses AABB × fill factor then ÷ INCH³ (see `volumeInchesFromBBox`).
 * H5 choppable log is scaled so full-round volume sits in the low thousands in³
 * under these gates — do not raise the thresholds to “fix” an oversized log.
 */
export const FIREWOOD_VOL_ABS_MIN = 250;
export const FIREWOOD_VOL_MAX = 500;
/** Horizontal PCA aspect above this + vol in (250, 500] → rescue (stay on stump). */
export const FIREWOOD_ASPECT_RESCUE = 3;
/** Bbox fill factor matching reference `iw` (AABB volume × 0.7). */
export const VOLUME_BBOX_FILL = 0.7;
/** Minimum cleave-direction thickness in inches (`Xu * 2`, Xu = 2.5). */
export const MIN_SPLIT_THICKNESS_IN = 5;
/** Per-frame azimuth damping for ~90° camera nudge (`fd = 0.92`). */
export const AZIMUTH_NUDGE_DAMP = 0.92;
/** Target face-to-face gap as a fraction of the pre-split log diameter.
 * Modest crack: ~0.2× diameter total (~1–2″ per side on a ~0.38 m round).
 * Tuned down hard from the previous ~0.5–0.7× "wide dump" feel.
 */
export const FACE_GAP_DIAMETER_FRAC = 0.2;
/** Peak pop height during settle (metres) — keep subtle; main motion is lateral. */
export const BOUNCE_POP_HEIGHT = 0.04;
/** Scripted slide duration in ms. */
export const BOUNCE_DURATION_MS = 160;
/** Random yaw jitter applied to each stump half (±degrees) — tiny, stay upright. */
export const BOUNCE_YAW_JITTER_DEG = 1.5;
/** Mid-bounce tilt (degrees) — reference stays upright; keep near-zero tip. */
export const BOUNCE_TILT_DEG = 2;

/**
 * Scripted firewood tip-drop (logic feel of screen.toys chips leaving the stump).
 * Prefer a short tip/slide onto nearby yard ground over cannon-es impulse arcs.
 */
/** Tip-over duration (ms) — longer than stump bounce so the tip reads clearly. */
export const TIP_DROP_DURATION_MS = 340;
/** Extra random duration jitter (ms). */
export const TIP_DROP_DURATION_JIT_MS = 90;
/** Peak tip angle (degrees) — fall onto a side, not a full tumble. */
export const TIP_DROP_ANGLE_DEG = 78;
export const TIP_DROP_ANGLE_JIT_DEG = 14;
/** Tiny yaw while tipping (±degrees). */
export const TIP_DROP_YAW_JIT_DEG = 8;
/** Soft mid-arc lift (metres) — barely leaves the stump lip, no pop. */
export const TIP_DROP_ARC_HEIGHT = 0.028;
/**
 * Rest radial band beside the stump (metres from origin).
 * Stump visual R≈0.32 / collider ≥0.35 — keep chips clear of the top face
 * and far enough that a tipped AABB does not re-intersect the cylinder.
 */
export const TIP_DROP_REST_RADIAL = 0.66;
export const TIP_DROP_REST_RADIAL_JIT = 0.14;
/** Round-end scatter rests a bit farther out than single-chip tip-drop. */
export const TIP_DROP_SCATTER_RADIAL = 0.82;
export const TIP_DROP_SCATTER_RADIAL_JIT = 0.2;
/**
 * Mid-animation Y estimate pad (added to thin-axis half-height).
 * Final rest Y is corrected by AABB-min settle after tip — do not treat this
 * as the absolute ground contact height.
 */
export const TIP_DROP_GROUND_PAD = 0.02;
/** Reserved soft-physics window after tip (ms). Currently settle stays STATIC. */
export const TIP_DROP_POST_SETTLE_MS = 200;
/**
 * Visual / settle yard ground plane Y (metres). Physics Plane is at y=0;
 * tip-drop and ring-pile AABB settle share this so chips sit flush on dirt.
 */
export const YARD_GROUND_Y = 0;
/** Tiny lift above contact so meshes don't z-fight the ground (1.5 mm). */
export const GROUND_SETTLE_EPS = 0.0015;

/**
 * World Y for a mesh whose AABB min.y was measured at the current pose,
 * so the lowest point sits on `groundY` (+eps).
 * Same pattern as stump `supportY - box.min.y`, with a 1–2 mm epsilon.
 */
export function settlePositionY(
  boxMinY: number,
  groundY: number = YARD_GROUND_Y,
  eps: number = GROUND_SETTLE_EPS,
): number {
  return groundY + eps - boxMinY;
}

/**
 * Ring firewood pile after a full stump is chopped
 * (screen.toys FirewoodPile — logic only).
 *
 *   radius          = 60 * ld ≈ 1.524 m
 *   startAngle      = 320°
 *   arcSpan         = 230°  (crescent → reads as annular pile around stump)
 *   tierDepthSpacing = 18 * ld ≈ 0.457 m
 *   slot width XC   = 5 * ld
 *   ground pad      ≈ half-thickness + small lift (no pieces on stump top)
 */
export const RING_PILE_RADIUS = 60 * INCH;
export const RING_PILE_START_ANGLE = (320 * Math.PI) / 180;
export const RING_PILE_ARC_SPAN = (230 * Math.PI) / 180;
export const RING_PILE_TIER_DEPTH = 18 * INCH;
export const RING_PILE_SLOT_WIDTH = 5 * INCH;
/** Extra radial jitter (±) so the ring isn't a perfect bead necklace. */
export const RING_PILE_RADIAL_JIT = 2 * INCH;
/** Max pieces per arc tier before spilling to next outer tier. */
export const RING_PILE_MAX_PER_TIER = 14;
/** Ground clearance pad above half-thickness (metres). */
export const RING_PILE_GROUND_PAD = 0.015;
/** Soft roll jitter (±radians) while lying in the pile. */
export const RING_PILE_ROLL_JIT = 0.12;
/** Recycle slide duration (ms). */
export const RING_PILE_RECYCLE_MS = 520;
export const RING_PILE_RECYCLE_JIT_MS = 180;
/** Stagger between piece starts (ms). */
export const RING_PILE_STAGGER_MS = 35;

export type Vec3Tuple = readonly [number, number, number];

export interface RingPileSlot {
  /** World XZ on the annular pile. */
  x: number;
  y: number;
  z: number;
  /** Yaw of the radial outward axis (atan2(z,x)). */
  yaw: number;
  /** Tier index (0 = innermost arc). */
  tier: number;
  /** Roll about the radial axis (radians). */
  roll: number;
  /** True when local cross-section X < Z (reference `_getCrossSection2D`). */
  isXThinner: boolean;
  /**
   * Orientation basis matching reference `_simToWorld` (piece lying on side):
   * column0 / column1 / column2 as XYZ unit axes of the local frame.
   * Right-handed; local grain (Y when Y is longest) maps roughly horizontal.
   */
  axisX: Vec3Tuple;
  axisY: Vec3Tuple;
  axisZ: Vec3Tuple;
}

function v3(x: number, y: number, z: number): [number, number, number] {
  return [x, y, z];
}

function vDot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vCross(a: Vec3Tuple, b: Vec3Tuple): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vScale(a: Vec3Tuple, s: number): [number, number, number] {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function vAdd(a: Vec3Tuple, b: Vec3Tuple): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vNorm(a: Vec3Tuple): [number, number, number] {
  const len = Math.hypot(a[0], a[1], a[2]);
  if (len < 1e-12) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

/** Scalar triple product = det of basis with columns (c0,c1,c2). */
export function basisDeterminant(c0: Vec3Tuple, c1: Vec3Tuple, c2: Vec3Tuple): number {
  return vDot(c0, vCross(c1, c2));
}

/**
 * Pick which local AABB axis is grain (longest upright cylinder axis).
 * Prefer Y on ties so stump-cut / Voronoi pieces (Y-up log) stay stable.
 */
export function pickLocalGrainAxis(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
): 0 | 1 | 2 {
  // Longest wins; tie-break Y → Z → X (log grain defaults to local Y).
  const ranked: Array<{ ax: 0 | 1 | 2; v: number; pref: number }> = [
    { ax: 1, v: sizeY, pref: 0 },
    { ax: 2, v: sizeZ, pref: 1 },
    { ax: 0, v: sizeX, pref: 2 },
  ];
  ranked.sort((a, b) => b.v - a.v || a.pref - b.pref);
  return ranked[0]!.ax;
}

/**
 * Reference `_getCrossSection2D` thin-axis flag when grain is local Y:
 * `isXThinner = size.x < size.z`.
 */
export function isCrossSectionXThinner(sizeX: number, sizeZ: number): boolean {
  return sizeX < sizeZ;
}

/**
 * Rotate vector `v` about unit axis `axis` by `rad` (Rodrigues).
 */
function rotateAboutAxis(v: Vec3Tuple, axis: Vec3Tuple, rad: number): [number, number, number] {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const d = vDot(axis, v);
  return vAdd(
    vAdd(vScale(v, c), vScale(vCross(axis, v), s)),
    vScale(axis, d * (1 - c)),
  );
}

/** World Y π flip used by reference `_simToWorld` after the side-lie basis. */
function premultiplyWorldYPi(v: Vec3Tuple): [number, number, number] {
  return [-v[0], v[1], -v[2]];
}

/**
 * Reference FirewoodPile `_simToWorld` rest basis (logic only).
 *
 * Non-thin: `makeBasis(-tangent, radial, up)` then roll about radial, then π about world Y.
 * Thin (`size.x < size.z`): `makeBasis(up, radial, tangent)` then same post-multiplies.
 * `tangent = up × radial` — using −tangent keeps the basis right-handed.
 *
 * When grain is not local Y, remaps so the longest (grain) local axis lies horizontal
 * along −radial after the π-Y flip (AABB-aware for odd Voronoi extents).
 */
export function ringPileSimToWorldAxes(input: {
  angle: number;
  roll?: number;
  /** Local AABB sizes (metres). Defaults treat Y as grain, X≈Z (non-thin). */
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  /** Override thin-axis branch; default from sizeX < sizeZ when grain is Y. */
  isXThinner?: boolean;
}): {
  axisX: [number, number, number];
  axisY: [number, number, number];
  axisZ: [number, number, number];
  isXThinner: boolean;
  grainAxis: 0 | 1 | 2;
} {
  const sizeX = Math.max(1e-6, input.sizeX ?? 0.2);
  const sizeY = Math.max(1e-6, input.sizeY ?? 0.35);
  const sizeZ = Math.max(1e-6, input.sizeZ ?? 0.2);
  const grainAxis = pickLocalGrainAxis(sizeX, sizeY, sizeZ);
  const roll = input.roll ?? 0;

  const radial = vNorm(v3(Math.cos(input.angle), 0, Math.sin(input.angle)));
  const up = v3(0, 1, 0);
  // tangent = up × radial  (right-handed with radial, up)
  const tangent = vNorm(vCross(up, radial));

  // Cross-section axes = the two non-grain local axes; thinner → world up.
  const cross: Array<0 | 1 | 2> = ([0, 1, 2] as const).filter((a) => a !== grainAxis);
  const c0 = cross[0]!;
  const c1 = cross[1]!;
  const sizes = [sizeX, sizeY, sizeZ];
  const thinFirst = sizes[c0]! < sizes[c1]!;
  const thinAxis = thinFirst ? c0 : c1;
  const wideAxis = thinFirst ? c1 : c0;
  const isXThinner =
    input.isXThinner ??
    (grainAxis === 1 ? isCrossSectionXThinner(sizeX, sizeZ) : thinAxis === 0);

  // Reference Y-grain columns before roll / πY:
  //   thin:    (up, radial, tangent)
  //   nonthin: (-tangent, radial, up)
  // Generalize: grain → radial, thin → up (or X→up when thin), wide → ±tangent.
  const localCols: Array<[number, number, number]> = [
    v3(0, 0, 0),
    v3(0, 0, 0),
    v3(0, 0, 0),
  ];

  if (grainAxis === 1) {
    // Exact reference `_simToWorld` for Y-up logs.
    if (isXThinner) {
      localCols[0] = up;
      localCols[1] = radial;
      localCols[2] = tangent;
    } else {
      localCols[0] = vScale(tangent, -1);
      localCols[1] = radial;
      localCols[2] = up;
    }
  } else {
    // AABB remapping when grain ≠ Y: grain→radial, thin→up, complete RH triad.
    localCols[grainAxis] = radial;
    localCols[thinAxis] = up;
    // wide = grain × thin  (so columns grain, thin, wide form RH — then assign to axes)
    let wideDir = vNorm(vCross(localCols[grainAxis], localCols[thinAxis]));
    // Prefer aligning wide with ±tangent for a tidy crescent look.
    if (vDot(wideDir, tangent) < 0) wideDir = vScale(wideDir, -1);
    localCols[wideAxis] = wideDir;
    // Ensure full XYZ basis is right-handed; flip wide if needed.
    if (basisDeterminant(localCols[0], localCols[1], localCols[2]) < 0) {
      localCols[wideAxis] = vScale(localCols[wideAxis], -1);
    }
  }

  // Premultiply roll about radial, then π about world Y (reference order).
  const afterRoll = localCols.map((col) => rotateAboutAxis(col, radial, roll));
  const final = afterRoll.map((col) => premultiplyWorldYPi(col)) as Array<
    [number, number, number]
  >;

  // Tiny numeric normalize.
  const axisX = vNorm(final[0]!);
  const axisY = vNorm(final[1]!);
  const axisZ = vNorm(final[2]!);

  return { axisX, axisY, axisZ, isXThinner, grainAxis };
}

/**
 * Plan neat annular slots for finished firewood around the stump.
 * Packs pieces tightly along the reference arc by half-width (not sparse even
 * angular spacing); overflow → outer tier (larger radius).
 * Never places inside the stump footprint (radius ≫ stump ~0.32).
 */
export function planRingPileSlots(
  count: number,
  opts?: {
    radius?: number;
    startAngle?: number;
    arcSpan?: number;
    tierDepth?: number;
    maxPerTier?: number;
    groundYBase?: number;
    /** Per-piece half-thickness (metres) for ground Y; defaults to 0.05. */
    halfHeights?: number[];
    /** Approximate half-width along the arc (metres); defaults to halfHeights. */
    halfWidths?: number[];
    /** Local AABB sizes for `_simToWorld` thin-axis / grain (metres). */
    sizeXs?: number[];
    sizeYs?: number[];
    sizeZs?: number[];
    /** Per-piece thin-axis override (length ≥ count). */
    isXThinners?: boolean[];
    /** Injected [0,1) samples for jitter (length ≥ count*2 preferred). */
    rnds?: number[];
  },
): RingPileSlot[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const baseR = opts?.radius ?? RING_PILE_RADIUS;
  const start = opts?.startAngle ?? RING_PILE_START_ANGLE;
  const span = opts?.arcSpan ?? RING_PILE_ARC_SPAN;
  const tierDepth = opts?.tierDepth ?? RING_PILE_TIER_DEPTH;
  const groundBase = opts?.groundYBase ?? 0;
  const slots: RingPileSlot[] = [];

  // Greedy pack along arc by width — reference slot grid keeps chips touching.
  let tier = 0;
  let cursor = 0; // arc-length along current tier

  for (let i = 0; i < n; i++) {
    const halfH = opts?.halfHeights?.[i] ?? 0.05;
    const halfW = Math.max(0.04, opts?.halfWidths?.[i] ?? halfH * 1.15);
    const step = halfW * 2 * 1.08; // slight contact gap
    const rad = baseR + tier * tierDepth;
    const maxArc = span * rad;

    if (cursor + step > maxArc && cursor > 0) {
      tier += 1;
      cursor = 0;
    }

    const rndA = opts?.rnds?.[i * 2] ?? 0.5;
    const rndB = opts?.rnds?.[i * 2 + 1] ?? 0.5;
    const radJit = (rndA - 0.5) * 2 * RING_PILE_RADIAL_JIT;
    const r = baseR + tier * tierDepth + radJit;
    const ang = start + (cursor + halfW) / Math.max(1e-6, r);
    cursor += step;

    const ox = Math.cos(ang);
    const oz = Math.sin(ang);
    // Mild stacking: every 3rd chip rides slightly on neighbors.
    const stackLift = (i % 3 === 2 ? halfH * 0.9 : 0) + tier * 0.02;
    const y = groundBase + halfH + RING_PILE_GROUND_PAD + stackLift;
    const roll = (rndB - 0.5) * 2 * RING_PILE_ROLL_JIT;

    const sizeX = opts?.sizeXs?.[i] ?? halfW * 2;
    const sizeY = opts?.sizeYs?.[i] ?? halfH * 4; // grain defaults longer than cross-section
    const sizeZ = opts?.sizeZs?.[i] ?? halfW * 2;
    const orient = ringPileSimToWorldAxes({
      angle: ang,
      roll,
      sizeX,
      sizeY,
      sizeZ,
      isXThinner: opts?.isXThinners?.[i],
    });

    slots.push({
      x: ox * r,
      y,
      z: oz * r,
      yaw: ang,
      tier,
      roll,
      isXThinner: orient.isXThinner,
      axisX: orient.axisX,
      axisY: orient.axisY,
      axisZ: orient.axisZ,
    });
  }
  return slots;
}

export interface FracturePlan {
  /** 0 = do not fracture (too_light). Target piece budget for cleave recursion. */
  fragmentCount: number;
  /** Lateral split impulse along the cleave-plane normal (not radial burst). */
  impulse: number;
  /**
   * Face-to-face gap as a fraction of log diameter (H5 multiplies by measured diameter).
   * Each half slides about half of this along pushDir.
   */
  wedgeGap: number;
  /** Bounce pop height in metres. */
  popHeight: number;
  /** Scripted bounce duration (ms). */
  bounceMs: number;
  /** Impact seed concentration radius (local units; used by Voronoi fallback). */
  impactRadius: number;
  /** Whether to leave a shallow nick instead of fracturing. */
  nickOnly: boolean;
  /** Messier scatter for too_heavy (still directional). */
  messy: boolean;
  /** Directional split style — gates planar cleave vs nick. */
  splitStyle: SplitStyle;
}

const SWEET_PIECES = 2;
const HEAVY_BASE = 3;
const MAX_FRAGMENTS = 4;
const WEAK_CAP = 3;
const MIN_RECHOP = 2;

/** Soft cap on simultaneous physics fragments in the scene.
 * Needs headroom for stump wedges + ground pile (reference keeps tossing chips).
 */
export const MAX_LIVE_FRAGMENTS = 56;
/** Despawn chips smaller than this bbox diagonal. */
export const TINY_CHIP_DIAGONAL = 0.18;

/**
 * Horizontal cleave-plane normal (XZ) from aim vs log center.
 * Plane is vertical (contains world up + radial-ish grain split).
 * Normal points sideways so halves separate left/right of the cut.
 */
export function cleaveNormalXZ(
  aimX: number,
  aimZ: number,
  centerX: number,
  centerZ: number,
): readonly [number, number] {
  const dx = aimX - centerX;
  const dz = aimZ - centerZ;
  // Plane contains +Y and the radial vector → normal ⊥ radial in XZ
  let nx = -dz;
  let nz = dx;
  const len = Math.hypot(nx, nz);
  if (len < 1e-8) return [1, 0];
  return [nx / len, nz / len];
}

/**
 * Vertical cleave plane from camera horizontal facing.
 * Plane contains facing + world up → normal is ⊥ facing in XZ (split L/R on screen).
 */
export function cleaveNormalFromCameraFacing(
  fwdX: number,
  fwdZ: number,
): readonly [number, number] {
  let nx = fwdZ;
  let nz = -fwdX;
  const len = Math.hypot(nx, nz);
  if (len < 1e-8) return [1, 0];
  return [nx / len, nz / len];
}

/** Rotate a unit XZ cleave normal 90° CCW (vertical family → horizontal family). */
export function rotateCleaveNormal90(nx: number, nz: number): readonly [number, number] {
  const len = Math.hypot(nx, nz);
  if (len < 1e-8) return [0, 1];
  const x = nx / len;
  const z = nz / len;
  return [-z, x];
}

/** Successful chops in one direction before the plane yaws 90°. */
export const CHOPS_BEFORE_ORIENT_ROTATE = 4;

/**
 * Track same-direction successful chops; after N, rotate the cleave normal 90°.
 * `too_light` / nick does not count.
 */
export function advanceOrientChopCount(
  successCount: number,
  nx: number,
  nz: number,
  chopsBeforeRotate: number = CHOPS_BEFORE_ORIENT_ROTATE,
): { count: number; nx: number; nz: number; rotated: boolean } {
  const next = successCount + 1;
  if (next < chopsBeforeRotate) {
    return { count: next, nx, nz, rotated: false };
  }
  const [rx, rz] = rotateCleaveNormal90(nx, nz);
  return { count: 0, nx: rx, nz: rz, rotated: true };
}

/**
 * Decide cleave budget + lateral impulse from resolveChop outcome.
 * Sweet → clean 2-way planar split; too_heavy → more pieces, still sideways.
 */
export function planFracture(input: FracturePlanInput): FracturePlan {
  const { outcome, weakDevice = false, axe, generation = 0 } = input;

  if (outcome === 'too_light') {
    return {
      fragmentCount: 0,
      impulse: 0,
      wedgeGap: 0,
      popHeight: 0,
      bounceMs: BOUNCE_DURATION_MS,
      impactRadius: 0.12,
      nickOnly: true,
      messy: false,
      splitStyle: 'nick',
    };
  }

  const weight = axe?.weight ?? 0.5;
  const genScale = generation <= 0 ? 1 : generation === 1 ? 0.7 : 0.5;

  const messy = outcome === 'too_heavy';
  let fragmentCount: number;
  if (!messy) {
    // Prefer exactly two halves on a successful planar cleave.
    fragmentCount = SWEET_PIECES;
  } else {
    // Reference: even heavy/multi chops stay as upright wedges in a cluster —
    // prefer one extra nick over a fireworks piece dump.
    let base = Math.round(HEAVY_BASE * (0.95 + 0.15 * weight) * genScale);
    const cap = weakDevice ? WEAK_CAP : MAX_FRAGMENTS;
    fragmentCount = clampInt(base, generation > 0 ? MIN_RECHOP : 2, Math.min(cap, 3));
  }

  // Tiny lateral nudge for any residual impulse bookkeeping (bodies stay static while bouncing).
  const impulse =
    outcome === 'too_heavy' ? 0.06 + weight * 0.04 : 0.04 + weight * 0.02;

  // Face gap ≈ 0.2× diameter on first chop; later chops open a bit less.
  const gapFrac =
    FACE_GAP_DIAMETER_FRAC *
    (outcome === 'too_heavy' ? 1.1 : 1) *
    (generation > 0 ? 0.7 : 1);

  return {
    fragmentCount,
    impulse: impulse * (generation > 0 ? 0.65 : 1),
    wedgeGap: gapFrac,
    popHeight: BOUNCE_POP_HEIGHT * (generation > 0 ? 0.7 : 1),
    bounceMs: BOUNCE_DURATION_MS,
    impactRadius: outcome === 'too_heavy' ? 0.24 : 0.18,
    nickOnly: false,
    messy,
    splitStyle: messy ? 'cleave_messy' : 'cleave',
  };
}

/** Pieces smaller than this (bbox diagonal) are not re-choppable. */
export const MIN_RECHOP_DIAGONAL = 0.28;
/** Soft cap so multi-tap can produce several parallel upright slices.
 * Large pieces (vol > FIREWOOD_VOL_MAX) ignore this — they stay splittable
 * until the volume/aspect firewood gate tosses them.
 */
export const MAX_RECHOP_GENERATION = 5;

export function isRechopWorthy(
  bboxDiagonal: number,
  generation: number,
  volumeInches?: number,
): boolean {
  if (bboxDiagonal < MIN_RECHOP_DIAGONAL) return false;
  // Reference: vol > 500 stays on stump and remains splittable.
  if (volumeInches !== undefined && volumeInches > FIREWOOD_VOL_MAX) return true;
  // Rescued slender mid-volume pieces: allow a few more chops while thick enough.
  if (volumeInches !== undefined && volumeInches > FIREWOOD_VOL_ABS_MIN) return true;
  if (generation >= MAX_RECHOP_GENERATION) return false;
  return true;
}

/**
 * AABB volume in cubic inches (reference `aw` = size product × 0.7 / ld³).
 */
export function volumeInchesFromBBox(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  fill: number = VOLUME_BBOX_FILL,
): number {
  const cubicMetres = Math.max(0, sizeX) * Math.max(0, sizeY) * Math.max(0, sizeZ) * fill;
  return cubicMetres / (INCH * INCH * INCH);
}

/**
 * Horizontal aspect ratio (reference `hT`): PCA major/minor extent in XZ.
 * `xs`/`zs` are local-space vertex coordinates (same frame as geometry attribute).
 */
export function horizontalAspectXZ(xs: ArrayLike<number>, zs: ArrayLike<number>): number {
  const n = Math.min(xs.length, zs.length);
  if (n <= 0) return 1;

  let meanX = 0;
  let meanZ = 0;
  for (let i = 0; i < n; i++) {
    meanX += xs[i]!;
    meanZ += zs[i]!;
  }
  meanX /= n;
  meanZ /= n;

  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dz = zs[i]! - meanZ;
    xx += dx * dx;
    xz += dx * dz;
    zz += dz * dz;
  }

  const trace = xx + zz;
  const det = xx * zz - xz * xz;
  const lambda = (trace + Math.sqrt(Math.max(0, trace * trace - 4 * det))) / 2;
  let ax: number;
  let az: number;
  if (Math.abs(xz) > 1e-10) {
    ax = xz;
    az = lambda - xx;
  } else {
    ax = 1;
    az = 0;
  }
  const len = Math.hypot(ax, az) || 1;
  ax /= len;
  az /= len;
  const bx = -az;
  const bz = ax;

  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dz = zs[i]! - meanZ;
    const a = dx * ax + dz * az;
    const b = dx * bx + dz * bz;
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }
  const extentA = maxA - minA;
  const extentB = maxB - minB;
  if (extentA < 1e-10 || extentB < 1e-10) return 1;
  return Math.max(extentA, extentB) / Math.min(extentA, extentB);
}

/** Bbox fallback when vertex lists are unavailable: max(x,z) / min(x,z). */
export function horizontalAspectFromSize(sizeX: number, sizeZ: number): number {
  const a = Math.max(1e-10, Math.abs(sizeX));
  const b = Math.max(1e-10, Math.abs(sizeZ));
  return Math.max(a, b) / Math.min(a, b);
}

/**
 * Reference firewood gate (screen.toys `performSplit`):
 * - vol ≤ 250 → firewood (toss)
 * - vol ≤ 500 AND aspect ≤ 3 → firewood (toss)
 * - vol in (250, 500] AND aspect > 3 → rescue (stay on stump)
 * - vol > 500 → stay on stump
 */
export function isFirewoodByVolumeAspect(
  volumeInches: number,
  horizontalAspect: number,
): boolean {
  if (volumeInches > FIREWOOD_VOL_MAX) return false;
  if (volumeInches <= FIREWOOD_VOL_ABS_MIN) return true;
  // (250, 500]: slender pieces are rescued for another orientation.
  return horizontalAspect <= FIREWOOD_ASPECT_RESCUE;
}

/**
 * Convenience: bbox sizes → firewood? (uses bbox XZ aspect fallback).
 * Prefer `isFirewoodByVolumeAspect` + `horizontalAspectXZ` when geometry is available.
 */
export function isFirewoodChip(sizeX: number, sizeY: number, sizeZ: number): boolean {
  const volumeInches = volumeInchesFromBBox(sizeX, sizeY, sizeZ);
  const aspect = horizontalAspectFromSize(sizeX, sizeZ);
  return isFirewoodByVolumeAspect(volumeInches, aspect);
}

/** Thickness along a unit direction, in inches (`extentMetres / INCH`). */
export function thicknessInchesAlong(extentMetres: number): number {
  return Math.max(0, extentMetres) / INCH;
}

/** True when piece is thinner than Xu*2 = 5″ along the cleave normal. */
export function isTooThinToSplit(thicknessInches: number): boolean {
  return thicknessInches < MIN_SPLIT_THICKNESS_IN;
}

/**
 * Option A — too-thin click decision (current cleave dir already measured):
 * - current thick enough → chop normally
 * - current thin AND (perp also thin OR already firewood by vol/aspect) → toss to ground
 * - current thin AND perp still thick AND not yet firewood → yaw ~90°, stay on stump
 */
export type TooThinChopDecision = 'chop' | 'yaw' | 'toss';

export function decideTooThinChop(input: {
  currentThicknessIn: number;
  perpThicknessIn: number;
  alreadyFirewood: boolean;
}): TooThinChopDecision {
  if (!isTooThinToSplit(input.currentThicknessIn)) return 'chop';
  if (isTooThinToSplit(input.perpThicknessIn) || input.alreadyFirewood) return 'toss';
  return 'yaw';
}

/** Convenience: when already inside a too-thin branch, should we toss? */
export function shouldTossOnTooThin(input: {
  otherDirTooThin: boolean;
  alreadyFirewood: boolean;
}): boolean {
  return input.otherDirTooThin || input.alreadyFirewood;
}

/**
 * Initial azimuth velocity so geometric damping totals ≈ ±90°.
 * Per frame: yaw += v; v *= AZIMUTH_NUDGE_DAMP → Σ = v0 / (1 - damp) = ±π/2.
 */
export function azimuthNudgeVelocity(sign: number): number {
  const s = sign < 0 ? -1 : 1;
  return ((Math.PI / 180) * 90 * (1 - AZIMUTH_NUDGE_DAMP)) * s;
}

/**
 * Per-side slide distance so both halves create `gapFrac * diameter` face gap.
 */
export function lateralOffsetFromDiameter(diameter: number, gapFrac: number): number {
  const d = Math.max(0.05, diameter);
  const frac = Math.max(0, gapFrac);
  return (frac * d) / 2;
}

/** Smoothstep ease in [0,1] — shared by stump bounce + firewood tip-drop. */
export function easeSmoothstep(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

/** Normalize an XZ push hint; fall back to a unit vector if degenerate. */
export function normalizePushXZ(
  hintX: number,
  hintZ: number,
  fallbackAngle = 0,
): { ox: number; oz: number } {
  const len = Math.hypot(hintX, hintZ);
  if (len < 1e-4) {
    return { ox: Math.cos(fallbackAngle), oz: Math.sin(fallbackAngle) };
  }
  return { ox: hintX / len, oz: hintZ / len };
}

/**
 * Ground rest pose for a tip-dropped firewood chip beside the stump.
 * Continuous from the current stump pose — no radial teleport “pop”.
 */
export function tipDropRestPose(input: {
  fromX: number;
  fromZ: number;
  dirX: number;
  dirZ: number;
  /** Half-extent of the thinnest axis after tip (metres). */
  restHalfHeight: number;
  restRadial: number;
  restRadialJit?: number;
  /** Unit random in [0,1) for radial jitter (injectable for tests). */
  rnd?: number;
  groundPad?: number;
}): { toX: number; toY: number; toZ: number; ox: number; oz: number; restRadial: number } {
  const { ox, oz } = normalizePushXZ(input.dirX, input.dirZ);
  const jit = Math.max(0, input.restRadialJit ?? 0);
  const rnd = input.rnd ?? 0.5;
  const restRadial = Math.max(0.42, input.restRadial + rnd * jit);
  // Prefer sliding farther out from current radial so the path never pulls inward.
  const fromR = Math.hypot(input.fromX, input.fromZ);
  const targetR = Math.max(restRadial, fromR + 0.08);
  const pad = input.groundPad ?? TIP_DROP_GROUND_PAD;
  // Mid-anim estimate only — final rest is AABB-settled after tip quaternion.
  const toY = Math.max(0.04, input.restHalfHeight + pad);
  return {
    toX: ox * targetR,
    toY,
    toZ: oz * targetR,
    ox,
    oz,
    restRadial: targetR,
  };
}

/**
 * Sample a scripted tip-drop pose at progress u∈[0,1].
 * Lateral slide + soft arc + outward tip (no abrupt velocity set).
 */
export function sampleTipDropPose(input: {
  u: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  tipRad: number;
  arcHeight?: number;
}): { x: number; y: number; z: number; tipRad: number; ease: number } {
  const ease = easeSmoothstep(input.u);
  const arc = (input.arcHeight ?? TIP_DROP_ARC_HEIGHT) * Math.sin(Math.PI * Math.min(1, Math.max(0, input.u)));
  return {
    x: input.fromX + (input.toX - input.fromX) * ease,
    y: input.fromY + (input.toY - input.fromY) * ease + arc,
    z: input.fromZ + (input.toZ - input.fromZ) * ease,
    tipRad: input.tipRad * ease,
    ease,
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
