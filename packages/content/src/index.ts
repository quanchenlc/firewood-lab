import type { Axe, Species, StumpPack } from '@firewood/game-core';
import axesJson from '../data/axes.json';
import speciesJson from '../data/species.json';
import stumpsJson from '../data/stumps.json';

export const species = speciesJson as Species[];
export const axes = axesJson as Axe[];
export const stumps = stumpsJson as StumpPack[];

export function getSpeciesById(id: string): Species | undefined {
  return species.find((s) => s.id === id);
}

export function getAxeById(id: string): Axe | undefined {
  return axes.find((a) => a.id === id);
}

export function getStumpById(id: string): StumpPack | undefined {
  return stumps.find((s) => s.id === id);
}

/** Pick a stump pack at random (optionally excluding the current id). */
export function pickRandomStump(excludeId?: string): StumpPack {
  const pool = excludeId ? stumps.filter((s) => s.id !== excludeId) : stumps;
  const list = pool.length > 0 ? pool : stumps;
  return list[Math.floor(Math.random() * list.length)]!;
}

export { default as speciesData } from '../data/species.json';
export { default as axesData } from '../data/axes.json';
export { default as stumpsData } from '../data/stumps.json';
