import type { ChopOutcome } from './chop-types.ts';
import type { Axe, Species } from './types.ts';

export type { ChopOutcome } from './chop-types';
export type { Axe, Species } from './types';

export interface ResolveChopInput {
  /** Power slider position in [0, 1]. */
  slider01: number;
  species: Pick<Species, 'hardness'>;
  axe: Pick<Axe, 'weight' | 'sharpness' | 'precision'>;
}

/** Force scale from axe stats (same as resolveChop). */
export function axeForceScale(axe: Pick<Axe, 'weight' | 'sharpness'>): number {
  return 0.55 + 0.35 * axe.weight + 0.1 * axe.sharpness;
}

export function sweetHalfWindow(axe: Pick<Axe, 'precision'>): number {
  // Slightly wider than v1 for clearer Camp+Toona teachability on mobile.
  return 0.07 + 0.11 * axe.precision;
}

/**
 * Slider01 range that maps to sweet for the current species/axe.
 * Useful for HUD zone markers / live preview.
 */
export function getSweetSliderRange(
  species: Pick<Species, 'hardness'>,
  axe: Pick<Axe, 'weight' | 'sharpness' | 'precision'>,
): { lo: number; hi: number; scale: number; target: number } {
  const scale = Math.max(1e-6, axeForceScale(axe));
  const target = clamp01(species.hardness);
  const half = sweetHalfWindow(axe);
  const lo = clamp01((target - half) / scale);
  const hi = clamp01((target + half) / scale);
  return { lo, hi, scale, target };
}

/**
 * Maps slider force vs wood hardness (modulated by axe) into a chop band.
 *
 * Effective force grows with slider, axe weight, and a touch of sharpness.
 * Sweet window width scales with axe precision around the wood's hardness.
 */
export function resolveChop({
  slider01,
  species,
  axe,
}: ResolveChopInput): ChopOutcome {
  const t = clamp01(slider01);
  const force = clamp01(t * axeForceScale(axe));
  const target = clamp01(species.hardness);
  const halfWindow = sweetHalfWindow(axe);

  if (force < target - halfWindow) return 'too_light';
  if (force > target + halfWindow) return 'too_heavy';
  return 'sweet';
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
