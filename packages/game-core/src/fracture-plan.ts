/**
 * Pure fracture planning — no DOM / Three / physics.
 * Maps chop outcome (+ optional axe stats) to fragment budgets & impulse.
 *
 * Directional cleave: prefer a vertical chop plane through the aim point
 * (grain-aligned / planar split) over isotropic Voronoi burst.
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

export interface FracturePlan {
  /** 0 = do not fracture (too_light). Target piece budget for cleave recursion. */
  fragmentCount: number;
  /** Lateral split impulse along the cleave-plane normal (not radial burst). */
  impulse: number;
  /**
   * World-space half-gap along the cleave normal — pieces nudge apart and
   * stay mostly wedged on the stump (screen.toys-style), not a physics dump.
   */
  wedgeGap: number;
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
const HEAVY_BASE = 5;
const MAX_FRAGMENTS = 8;
const WEAK_CAP = 6;
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
      impactRadius: 0.12,
      nickOnly: true,
      messy: false,
      splitStyle: 'nick',
    };
  }

  const weight = axe?.weight ?? 0.5;
  const edge = axe?.edge ?? 0.6;
  const genScale = generation <= 0 ? 1 : generation === 1 ? 0.7 : 0.5;

  const messy = outcome === 'too_heavy';
  let fragmentCount: number;
  if (!messy) {
    fragmentCount = SWEET_PIECES;
  } else {
    let base = Math.round(HEAVY_BASE * (0.9 + 0.2 * weight + 0.1 * edge) * genScale);
    const cap = weakDevice ? WEAK_CAP : MAX_FRAGMENTS;
    // Keep heavy chops directional but tighter — more nicks, not a floor dump.
    fragmentCount = clampInt(base, generation > 0 ? MIN_RECHOP : 3, Math.min(cap, 5));
  }

  // Tiny lateral nudge only — halves part a crack, stay on the block.
  const impulse =
    outcome === 'too_heavy' ? 0.14 + weight * 0.08 : 0.08 + weight * 0.04;
  // Visible crack width in world units (log radius ~0.38 → ~8–15% gap per side).
  const wedgeGap =
    outcome === 'too_heavy' ? 0.07 + weight * 0.025 : 0.04 + weight * 0.015;

  return {
    fragmentCount,
    impulse: impulse * (generation > 0 ? 0.7 : 1),
    wedgeGap: wedgeGap * (generation > 0 ? 0.75 : 1),
    impactRadius: outcome === 'too_heavy' ? 0.28 : 0.2,
    nickOnly: false,
    messy,
    splitStyle: messy ? 'cleave_messy' : 'cleave',
  };
}

/** Pieces smaller than this (bbox diagonal) are not re-choppable. */
export const MIN_RECHOP_DIAGONAL = 0.35;

export function isRechopWorthy(bboxDiagonal: number, generation: number): boolean {
  if (generation >= 2) return false;
  return bboxDiagonal >= MIN_RECHOP_DIAGONAL;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
