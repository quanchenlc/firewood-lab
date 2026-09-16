/**
 * Pure fracture planning — no DOM / Three / physics.
 * Maps chop outcome (+ optional axe stats) to fragment budgets & impulse.
 *
 * Directional cleave: prefer a vertical chop plane through the aim point
 * (grain-aligned / planar split) over isotropic Voronoi burst.
 *
 * Settle feel mirrors reverse-engineered screen.toys/firewood `performSplit`
 * bounce (logic only — not assets): ~1 inch lateral / side, ~2 inch pop, ~150ms.
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

/** Metres per inch — screen.toys uses `ld = 0.0254`. */
export const INCH = 0.0254;
/** Lateral offset per stump piece along pushDir (reference `distanceInches=1`). */
export const BOUNCE_DISTANCE_INCHES = 1;
/** Peak pop height during settle bounce (reference `popHeightInches=2`). */
export const BOUNCE_POP_HEIGHT_INCHES = 2;
/** Scripted bounce duration in ms (reference ~150ms animator). */
export const BOUNCE_DURATION_MS = 150;
/** Random yaw jitter applied to each stump half (±degrees). */
export const BOUNCE_YAW_JITTER_DEG = 2;

export interface FracturePlan {
  /** 0 = do not fracture (too_light). Target piece budget for cleave recursion. */
  fragmentCount: number;
  /** Lateral split impulse along the cleave-plane normal (not radial burst). */
  impulse: number;
  /**
   * World-space lateral offset along pushDir / cleave normal (metres).
   * Reference: `1 * ld` with `ld = 0.0254` (≈ 1 inch) per side.
   */
  wedgeGap: number;
  /** Bounce pop height in metres (reference ≈ 2 inches). */
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

/** Soft cap on simultaneous physics fragments in the scene. */
export const MAX_LIVE_FRAGMENTS = 28;
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

  // Reference performSplit: distanceInches=1, popHeightInches=2 (heavy opens a hair more).
  const distanceInches =
    outcome === 'too_heavy' ? BOUNCE_DISTANCE_INCHES * (1.15 + weight * 0.1) : BOUNCE_DISTANCE_INCHES;
  const popInches =
    outcome === 'too_heavy'
      ? BOUNCE_POP_HEIGHT_INCHES * 1.1
      : BOUNCE_POP_HEIGHT_INCHES;
  const genGap = generation > 0 ? 0.7 : 1;

  return {
    fragmentCount,
    impulse: impulse * (generation > 0 ? 0.65 : 1),
    wedgeGap: distanceInches * INCH * genGap,
    popHeight: popInches * INCH * genGap,
    bounceMs: BOUNCE_DURATION_MS,
    impactRadius: outcome === 'too_heavy' ? 0.24 : 0.18,
    nickOnly: false,
    messy,
    splitStyle: messy ? 'cleave_messy' : 'cleave',
  };
}

/** Pieces smaller than this (bbox diagonal) are not re-choppable. */
export const MIN_RECHOP_DIAGONAL = 0.28;
/** Soft cap so multi-tap can produce several parallel upright slices. */
export const MAX_RECHOP_GENERATION = 5;

export function isRechopWorthy(bboxDiagonal: number, generation: number): boolean {
  if (generation >= MAX_RECHOP_GENERATION) return false;
  return bboxDiagonal >= MIN_RECHOP_DIAGONAL;
}

/**
 * Reference firewood gate: too-small or bad aspect → physics pile throw.
 * Main upright halves stay on the stump with scripted bounce.
 */
export function isFirewoodChip(sizeX: number, sizeY: number, sizeZ: number): boolean {
  const diag = Math.hypot(sizeX, sizeY, sizeZ);
  if (diag < MIN_RECHOP_DIAGONAL * 0.85) return true;
  const horiz = Math.hypot(sizeX, sizeZ);
  const aspect = sizeY / Math.max(1e-6, horiz);
  // Pancake flakes or needle shards leave the stump.
  if (aspect < 0.32 || aspect > 3.6) return true;
  if (horiz < 0.14) return true;
  return false;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
