import type { Axe, Species } from './types.ts';
import type { ChopOutcome } from './chop-types.ts';

/** Hook context for host apps wiring visual fracture. */
export interface FractureHookContext {
  species: Species;
  axe: Axe;
  outcome: ChopOutcome;
  aimNorm: { x: number; y: number };
}

export type FractureHook = (ctx: FractureHookContext) => void;
