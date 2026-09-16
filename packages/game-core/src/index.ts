/**
 * Pure game logic — no DOM / window / wx.
 */

/** Tree species stats used by chop resolution. */
export interface Species {
  id: string;
  /** Display name (EN or locale key). */
  name: string;
  /** Scientific / common latin-style name. */
  scientificName: string;
  /** Wood hardness 0–1 (soft → hard). */
  hardness: number;
  /** Annual ring density 0–1 (loose → tight). */
  ringDensity: number;
  /** Short provenance / habitat note. */
  provenance: string;
  /** Learn-while-chopping tip. */
  tip: string;
}

/** Axe / maul stats used by chop resolution. */
export interface Axe {
  id: string;
  name: string;
  /** Relative mass / momentum contribution 0–1. */
  weight: number;
  /** Edge sharpness 0–1. */
  sharpness: number;
  /** Edge geometry bias (wedge vs thin) 0–1. */
  edge: number;
  /** Aim / sweet-spot forgiveness 0–1 (higher = wider window). */
  precision: number;
  tip: string;
}

export type ChopOutcome = 'too_light' | 'sweet' | 'too_heavy';

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

/** Placeholder for future Voronoi / fracture generation hooks. */
export interface FractureHookContext {
  species: Species;
  axe: Axe;
  outcome: ChopOutcome;
  aimNorm: { x: number; y: number };
}

export type FractureHook = (ctx: FractureHookContext) => void;
