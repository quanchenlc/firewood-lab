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
 *
 * Package M (Medium randomness) — keep Option B bottom-hinge outward tip +
 * ARC_HEIGHT=0 + AABB settle; widen yaw/tip/roll/duration/rest/hinge/push jit.
 */
/** Tip-over duration (ms) — longer than stump bounce so the tip reads clearly. */
export const TIP_DROP_DURATION_MS = 330;
/** Extra random duration jitter (ms). Package M ≈180. */
export const TIP_DROP_DURATION_JIT_MS = 180;
/** Peak tip angle (degrees) — fall onto a side, not a full tumble. */
export const TIP_DROP_ANGLE_DEG = 80;
/** Symmetric tip jitter (±deg); final angle clamped to [70, 90]. */
export const TIP_DROP_ANGLE_JIT_DEG = 10;
/** Hard clamp band for tip angle after jitter. */
export const TIP_DROP_ANGLE_MIN_DEG = 70;
export const TIP_DROP_ANGLE_MAX_DEG = 90;
/** Yaw while tipping (±degrees). Package M ≈22. */
export const TIP_DROP_YAW_JIT_DEG = 22;
/** Roll about push axis (±degrees), eased with tip. Package M ≈10. */
export const TIP_DROP_ROLL_JIT_DEG = 10;
/**
 * Mid-arc lift (metres). Option B tip-drop is a pure stump-lip hinge — keep 0
 * so chips lean over the edge instead of a center-of-mass fling with lift.
 */
export const TIP_DROP_ARC_HEIGHT = 0;
/**
 * Rest radial band beside the stump (metres from origin).
 * Stump visual R≈0.34 / collider ≥0.35 — keep chips clear of the top face
 * and far enough that a tipped AABB does not re-intersect the cylinder.
 */
export const TIP_DROP_REST_RADIAL = 0.66;
/** Package M radial jitter ≈0.24. */
export const TIP_DROP_REST_RADIAL_JIT = 0.24;
/** Tangential rest offset (±metres) perpendicular to push. Package M ≈0.06. */
export const TIP_DROP_REST_TANGENTIAL_JIT = 0.06;
/** Tangential hinge offset (±metres). Package M ≈0.04. */
export const TIP_DROP_HINGE_TANGENTIAL_JIT = 0.04;
/** Push azimuth jitter (±degrees); forced outward (dot with base push > 0). */
export const TIP_DROP_PUSH_AZIMUTH_JIT_DEG = 12;
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
 *   arcSpan         = 230°  (capacity before outer tier — NOT even spacing)
 *   tierDepthSpacing = 18 * ld ≈ 0.457 m
 *   slot width XC   = 5 * ld  (discrete grid; pieces pack side-by-side)
 *   max stack H     = 18 * ld (prefer stacking up before extending the arc)
 *   radial jit      = ±1 * ld
 *
 * Reference packs from the start of the arc with `_getValidSlots` (extend
 * left / stack on adjacent pairs) — a tight crescent, not a sparse 230° bead.
 */
export const RING_PILE_RADIUS = 60 * INCH;
export const RING_PILE_START_ANGLE = (320 * Math.PI) / 180;
export const RING_PILE_ARC_SPAN = (230 * Math.PI) / 180;
export const RING_PILE_TIER_DEPTH = 18 * INCH;
export const RING_PILE_SLOT_WIDTH = 5 * INCH;
/** Extra radial jitter (±) — reference `_simToWorld` uses ±1×ld. */
export const RING_PILE_RADIAL_JIT = 1 * INCH;
/** Soft cap before `_advanceTier` (reference also gates stack height). */
export const RING_PILE_MAX_STACK_H = 18 * INCH;
/** Legacy alias — arc capacity is `arcSpan * radius`, not a fixed count. */
export const RING_PILE_MAX_PER_TIER = 14;
/** Ground clearance pad above half-thickness (metres). */
export const RING_PILE_GROUND_PAD = 0.008;
/** Soft roll jitter (±radians) — reference physics spawn uses ~±0.08. */
export const RING_PILE_ROLL_JIT = 0.05;
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
  /** Discrete sim-grid X (units of XC); 0 at arc start, negative as pile grows. */
  slotX: number;
  /** Discrete stack level (0 = ground). */
  slotGridY: number;
  /** Physical base height above ground before piece half-thickness (metres). */
  physicalBaseY: number;
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
 * Pick next discrete slot like reference FirewoodPile `_getValidSlots`:
 * prefer stacking on adjacent ground pairs, else extend the arc leftward.
 */
export function pickRingPileNextSlot(
  filledSlots: Set<string>,
  slotTops: Map<string, number>,
  minGx: number,
  maxStackH: number = RING_PILE_MAX_STACK_H,
): { x: number; y: number } {
  if (filledSlots.size === 0) return { x: 0, y: 0 };
  const candidates: Array<{ x: number; y: number }> = [{ x: minGx - 1, y: 0 }];
  for (const key of filledSlots) {
    const parts = key.split(',');
    const r = parseFloat(parts[0]!);
    const gy = parseInt(parts[1]!, 10);
    const leftKey = `${(r - 1).toFixed(1)},${gy}`;
    if (!filledSlots.has(leftKey)) continue;
    const midX = r - 0.5;
    const upY = gy + 1;
    const upKey = `${midX.toFixed(1)},${upY}`;
    if (filledSlots.has(upKey)) continue;
    const topA = slotTops.get(`${r.toFixed(1)},${gy}`) ?? 0;
    const topB = slotTops.get(leftKey) ?? 0;
    if (Math.max(topA, topB) < maxStackH) {
      candidates.push({ x: midX, y: upY });
    }
  }
  candidates.sort((a, b) => b.y - a.y || Math.abs(a.x) - Math.abs(b.x));
  return candidates[0]!;
}

/** Mutable XC-grid occupancy — persists across rounds so stacked pieces stay put. */
export interface RingPileOccupancy {
  filledSlots: Set<string>;
  slotTops: Map<string, number>;
  minGx: number;
  maxGx: number;
  tier: number;
}

export function createRingPileOccupancy(): RingPileOccupancy {
  return {
    filledSlots: new Set(),
    slotTops: new Map(),
    minGx: 1,
    maxGx: -1,
    tier: 0,
  };
}

export function clearRingPileOccupancy(occ: RingPileOccupancy): void {
  occ.filledSlots.clear();
  occ.slotTops.clear();
  occ.minGx = 1;
  occ.maxGx = -1;
  occ.tier = 0;
}

export type RingPilePlanOpts = {
  radius?: number;
  startAngle?: number;
  arcSpan?: number;
  tierDepth?: number;
  maxPerTier?: number;
  maxStackH?: number;
  slotWidth?: number;
  groundYBase?: number;
  /** Per-piece half-thickness (metres) for ground Y; defaults to 0.05. */
  halfHeights?: number[];
  /** Approximate half-width along the arc (metres); unused for XC grid (kept for API). */
  halfWidths?: number[];
  /** Local AABB sizes for `_simToWorld` thin-axis / grain (metres). */
  sizeXs?: number[];
  sizeYs?: number[];
  sizeZs?: number[];
  /** Per-piece thin-axis override (length ≥ count). */
  isXThinners?: boolean[];
  /** Injected [0,1) samples for jitter (length ≥ count*2 preferred). */
  rnds?: number[];
};

/**
 * Append `count` new slots into an existing occupancy table (reference append-only).
 * Mutates `occ`. Already-filled slots are not reassigned.
 */
export function appendRingPileSlots(
  count: number,
  occ: RingPileOccupancy,
  opts?: RingPilePlanOpts,
): RingPileSlot[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const baseR = opts?.radius ?? RING_PILE_RADIUS;
  const start = opts?.startAngle ?? RING_PILE_START_ANGLE;
  const span = opts?.arcSpan ?? RING_PILE_ARC_SPAN;
  const tierDepth = opts?.tierDepth ?? RING_PILE_TIER_DEPTH;
  const xc = opts?.slotWidth ?? RING_PILE_SLOT_WIDTH;
  const maxStackH = opts?.maxStackH ?? RING_PILE_MAX_STACK_H;
  const groundBase = opts?.groundYBase ?? 0;
  const slots: RingPileSlot[] = [];

  const resetTierGrid = (): void => {
    occ.filledSlots.clear();
    occ.slotTops.clear();
    occ.minGx = 1;
    occ.maxGx = -1;
  };

  for (let i = 0; i < n; i++) {
    const sizeX = opts?.sizeXs?.[i] ?? (opts?.halfWidths?.[i] ?? 0.06) * 2;
    const sizeY = opts?.sizeYs?.[i] ?? (opts?.halfHeights?.[i] ?? 0.05) * 4;
    const sizeZ = opts?.sizeZs?.[i] ?? (opts?.halfWidths?.[i] ?? 0.06) * 2;
    // Reference T = min(size.x, size.z) — thin cross-section → world-up thickness.
    const T = Math.max(
      0.04,
      opts?.halfHeights?.[i] != null
        ? opts.halfHeights[i]! * 2
        : Math.min(sizeX, sizeZ),
    );

    let slot = pickRingPileNextSlot(occ.filledSlots, occ.slotTops, occ.minGx, maxStackH);
    const rad = baseR + occ.tier * tierDepth;
    const maxArc = span * rad;
    // Arc capacity exceeded → outer tier (reference `_needsTierAdvance`).
    if (occ.filledSlots.size > 0 && Math.abs(slot.x * xc) >= maxArc) {
      occ.tier += 1;
      resetTierGrid();
      slot = pickRingPileNextSlot(occ.filledSlots, occ.slotTops, occ.minGx, maxStackH);
    }

    let physicalBaseY = 0;
    if (slot.y > 0) {
      const leftTop = occ.slotTops.get(`${(slot.x - 0.5).toFixed(1)},${slot.y - 1}`) ?? 0;
      const rightTop = occ.slotTops.get(`${(slot.x + 0.5).toFixed(1)},${slot.y - 1}`) ?? 0;
      physicalBaseY = Math.max(leftTop, rightTop);
    }

    const key = `${slot.x.toFixed(1)},${slot.y}`;
    occ.filledSlots.add(key);
    occ.slotTops.set(key, physicalBaseY + T);
    occ.maxGx = Math.max(occ.maxGx, slot.x);
    occ.minGx = Math.min(occ.minGx, slot.x);

    const rndA = opts?.rnds?.[i * 2] ?? 0.5;
    const rndB = opts?.rnds?.[i * 2 + 1] ?? 0.5;
    const radJit = (rndA - 0.5) * 2 * RING_PILE_RADIAL_JIT;
    const tierR = baseR + occ.tier * tierDepth;
    const simX = slot.x * xc;
    // Reference: angle = startAngle + simX / (radius + tierDepth)
    const ang = start + simX / Math.max(1e-6, tierR);
    const r = tierR + radJit;
    const ox = Math.cos(ang);
    const oz = Math.sin(ang);
    const y = groundBase + physicalBaseY + T * 0.5 + RING_PILE_GROUND_PAD;
    const roll = (rndB - 0.5) * 2 * RING_PILE_ROLL_JIT;

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
      tier: occ.tier,
      roll,
      isXThinner: orient.isXThinner,
      slotX: slot.x,
      slotGridY: slot.y,
      physicalBaseY,
      axisX: orient.axisX,
      axisY: orient.axisY,
      axisZ: orient.axisZ,
    });
  }
  return slots;
}

/**
 * Plan neat crescent/annulus slots for finished firewood around the stump.
 * Mirrors reference FirewoodPile slot grid (XC units) + `_simToWorld` mapping:
 * pack side-by-side from arc start, stack up on adjacent pairs, overflow → outer tier.
 * Never places inside the stump footprint (radius ≫ stump ~0.34).
 *
 * Fresh plan from empty occupancy. For multi-round append, use
 * `appendRingPileSlots` with a persisted `RingPileOccupancy`.
 */
export function planRingPileSlots(
  count: number,
  opts?: RingPilePlanOpts,
): RingPileSlot[] {
  return appendRingPileSlots(count, createRingPileOccupancy(), opts);
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
 * Package M: optional tangential offset perpendicular to push.
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
  /** Tangential rest offset (metres); + = left of push looking outward. */
  restTangential?: number;
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
  // Tangent = cross(up, push) = (oz, 0, -ox) — same as tip axis.
  const tang = input.restTangential ?? 0;
  return {
    toX: ox * targetR + oz * tang,
    toY,
    toZ: oz * targetR - ox * tang,
    ox,
    oz,
    restRadial: targetR,
  };
}

/**
 * Sample tip angle with Package M symmetric jitter, clamped to [min,max].
 */
export function sampleTipDropAngleDeg(
  rnd = Math.random(),
  base = TIP_DROP_ANGLE_DEG,
  jit = TIP_DROP_ANGLE_JIT_DEG,
  minDeg = TIP_DROP_ANGLE_MIN_DEG,
  maxDeg = TIP_DROP_ANGLE_MAX_DEG,
): number {
  const signed = (rnd * 2 - 1) * jit;
  return Math.min(maxDeg, Math.max(minDeg, base + signed));
}

/**
 * Jitter push azimuth by ±maxDeg, then force the result to stay outward
 * (dot with the original push > 0). Retries a few times; falls back to base.
 */
export function jitterPushAzimuthOutward(
  dirX: number,
  dirZ: number,
  maxDeg = TIP_DROP_PUSH_AZIMUTH_JIT_DEG,
  rnd = Math.random(),
): { ox: number; oz: number } {
  const base = normalizePushXZ(dirX, dirZ);
  const maxRad = (Math.abs(maxDeg) * Math.PI) / 180;
  // Map rnd∈[0,1) → signed angle in [-max, +max].
  let best = base;
  for (let i = 0; i < 4; i++) {
    const t = i === 0 ? rnd : (rnd + i * 0.27) % 1;
    const ang = (t * 2 - 1) * maxRad;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const ox = base.ox * c - base.oz * s;
    const oz = base.ox * s + base.oz * c;
    const len = Math.hypot(ox, oz) || 1;
    const cand = { ox: ox / len, oz: oz / len };
    if (cand.ox * base.ox + cand.oz * base.oz > 0) {
      best = cand;
      break;
    }
  }
  return best;
}

/**
 * Outward tip axis (tangential): cross(up, push) so +θ tips the top with push.
 * Axis is horizontal and perpendicular to the outward slide direction.
 */
export function tipDropOutwardAxis(
  dirX: number,
  dirZ: number,
): { ax: number; ay: number; az: number } {
  const { ox, oz } = normalizePushXZ(dirX, dirZ);
  // cross((0,1,0), (ox,0,oz)) = (oz, 0, -ox)
  return { ax: oz, ay: 0, az: -ox };
}

/**
 * AABB half-extent along a unit XZ direction (distance from center to face).
 */
export function aabbExtentAlongXZ(
  dirX: number,
  dirZ: number,
  halfX: number,
  halfZ: number,
): number {
  const { ox, oz } = normalizePushXZ(dirX, dirZ);
  const hx = Math.max(1e-4, halfX);
  const hz = Math.max(1e-4, halfZ);
  let t = Infinity;
  if (Math.abs(ox) > 1e-8) t = Math.min(t, hx / Math.abs(ox));
  if (Math.abs(oz) > 1e-8) t = Math.min(t, hz / Math.abs(oz));
  if (!Number.isFinite(t)) return Math.min(hx, hz);
  return Math.max(0.02, t);
}

/**
 * Stump-lip hinge: bottom outer edge of the piece in the push direction.
 * Y sits on the piece underside (≈ stump top); XZ at the outward AABB face,
 * softly pulled out to the stump lip when the chip starts well inside the top.
 */
export function tipDropHingePoint(input: {
  centerX: number;
  centerY: number;
  centerZ: number;
  dirX: number;
  dirZ: number;
  /** World Y of the piece underside (AABB min.y). */
  bottomY: number;
  halfX: number;
  halfZ: number;
  /** Stump top radius — hinge nudged toward lip when piece is inward. */
  stumpLipRadius?: number;
  /** Tangential hinge offset (metres); + = left of push looking outward. */
  hingeTangential?: number;
}): { hingeX: number; hingeY: number; hingeZ: number; ox: number; oz: number } {
  const { ox, oz } = normalizePushXZ(input.dirX, input.dirZ);
  const extent = aabbExtentAlongXZ(ox, oz, input.halfX, input.halfZ);
  let hingeX = input.centerX + ox * extent;
  let hingeZ = input.centerZ + oz * extent;
  const lipR = input.stumpLipRadius;
  if (lipR != null && lipR > 0) {
    const hR = Math.hypot(hingeX, hingeZ);
    // Pieces near the center: place hinge on the stump lip along push.
    if (hR < lipR * 0.85) {
      hingeX = ox * lipR;
      hingeZ = oz * lipR;
    }
  }
  const tang = input.hingeTangential ?? 0;
  if (tang !== 0) {
    hingeX += oz * tang;
    hingeZ -= ox * tang;
  }
  // Contact plane ≈ stump top / piece bottom — never above the mesh center.
  const hingeY = Math.min(input.bottomY, input.centerY - 0.01);
  return { hingeX, hingeY, hingeZ, ox, oz };
}

/** Rotate offset (ox,oy,oz) by `rad` around unit axis (ax,ay,az) — Rodrigues. */
export function rotateOffsetAroundAxis(
  ox: number,
  oy: number,
  oz: number,
  ax: number,
  ay: number,
  az: number,
  rad: number,
): { x: number; y: number; z: number } {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dot = ax * ox + ay * oy + az * oz;
  // R·v = v·c + (a×v)·s + a·(a·v)·(1−c)
  const cx = ay * oz - az * oy;
  const cy = az * ox - ax * oz;
  const cz = ax * oy - ay * ox;
  const oneMinus = 1 - c;
  return {
    x: ox * c + cx * s + ax * dot * oneMinus,
    y: oy * c + cy * s + ay * dot * oneMinus,
    z: oz * c + cz * s + az * dot * oneMinus,
  };
}

/**
 * Sample a scripted tip-drop pose at progress u∈[0,1].
 * Option B: rotate about stump-lip hinge, then ease an outward slide.
 *   pos = hinge + R(θ)·(center−hinge) + outwardSlide·ease
 *   θ   = tipRad·ease
 * Arc height defaults to 0 (no mid-flight lift).
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
  hingeX: number;
  hingeY: number;
  hingeZ: number;
  /** Outward push hint — defines the tangential tip axis. */
  dirX: number;
  dirZ: number;
  /** @deprecated Option B keeps 0; retained for call-site compat. */
  arcHeight?: number;
}): { x: number; y: number; z: number; tipRad: number; ease: number } {
  const ease = easeSmoothstep(input.u);
  const theta = input.tipRad * ease;
  const { ax, ay, az } = tipDropOutwardAxis(input.dirX, input.dirZ);

  const offX = input.fromX - input.hingeX;
  const offY = input.fromY - input.hingeY;
  const offZ = input.fromZ - input.hingeZ;
  const rotated = rotateOffsetAroundAxis(offX, offY, offZ, ax, ay, az, theta);

  // Slide vector chosen so u=1 lands exactly on the rest target (pre AABB settle).
  const endRot = rotateOffsetAroundAxis(offX, offY, offZ, ax, ay, az, input.tipRad);
  const slideX = input.toX - (input.hingeX + endRot.x);
  const slideY = input.toY - (input.hingeY + endRot.y);
  const slideZ = input.toZ - (input.hingeZ + endRot.z);

  const arc =
    (input.arcHeight ?? TIP_DROP_ARC_HEIGHT) *
    Math.sin(Math.PI * Math.min(1, Math.max(0, input.u)));

  return {
    x: input.hingeX + rotated.x + slideX * ease,
    y: input.hingeY + rotated.y + slideY * ease + arc,
    z: input.hingeZ + rotated.z + slideZ * ease,
    tipRad: theta,
    ease,
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
