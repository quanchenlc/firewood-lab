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
  const force = clamp01(t * (0.55 + 0.35 * axe.weight + 0.1 * axe.sharpness));
  const target = clamp01(species.hardness);
  const halfWindow = 0.06 + 0.1 * axe.precision;

  if (force < target - halfWindow) return 'too_light';
  if (force > target + halfWindow) return 'too_heavy';
  return 'sweet';
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
