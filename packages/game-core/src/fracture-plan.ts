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

export interface FracturePlan {
  /** 0 = do not fracture (too_light). */
  fragmentCount: number;
  /** Radial scatter strength applied to fragment bodies. */
  impulse: number;
  /** Impact seed concentration radius (local units). */
  impactRadius: number;
  /** Whether to leave a shallow nick instead of fracturing. */
  nickOnly: boolean;
  /** Messier scatter for too_heavy. */
  messy: boolean;
}

const SWEET_BASE = 10;
const HEAVY_BASE = 16;
const MAX_FRAGMENTS = 22;
const WEAK_CAP = 12;
const MIN_RECHOP = 4;

/**
 * Decide Voronoi fragment budget + impulse from resolveChop outcome.
 */
export function planFracture(input: FracturePlanInput): FracturePlan {
  const { outcome, weakDevice = false, axe, generation = 0 } = input;

  if (outcome === 'too_light') {
    return {
      fragmentCount: 0,
      impulse: 0,
      impactRadius: 0.12,
      nickOnly: true,
      messy: false,
    };
  }

  const weight = axe?.weight ?? 0.5;
  const edge = axe?.edge ?? 0.6;
  const genScale = generation <= 0 ? 1 : generation === 1 ? 0.55 : 0.35;

  let base = outcome === 'too_heavy' ? HEAVY_BASE : SWEET_BASE;
  base = Math.round(base * (0.85 + 0.25 * weight + 0.1 * edge) * genScale);

  let cap = weakDevice ? WEAK_CAP : MAX_FRAGMENTS;
  if (generation > 0) cap = Math.min(cap, 10);

  const fragmentCount = clampInt(base, generation > 0 ? MIN_RECHOP : 6, cap);
  const impulse =
    outcome === 'too_heavy'
      ? 2.4 + weight * 1.4
      : 1.35 + weight * 0.7;
  const impactRadius = outcome === 'too_heavy' ? 0.42 : 0.28;

  return {
    fragmentCount,
    impulse: impulse * (generation > 0 ? 0.75 : 1),
    impactRadius,
    nickOnly: false,
    messy: outcome === 'too_heavy',
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
