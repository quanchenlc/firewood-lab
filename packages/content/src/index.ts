import type { Axe, Species } from '@firewood/game-core';
import axesJson from '../data/axes.json';
import speciesJson from '../data/species.json';

export const species = speciesJson as Species[];
export const axes = axesJson as Axe[];

export function getSpeciesById(id: string): Species | undefined {
  return species.find((s) => s.id === id);
}

export function getAxeById(id: string): Axe | undefined {
  return axes.find((a) => a.id === id);
}

export { default as speciesData } from '../data/species.json';
export { default as axesData } from '../data/axes.json';
