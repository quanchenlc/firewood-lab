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
  /** Optional H5 material pack paths (public URL).
   * Three photo roles (ref outsidebark / insidegrain / top — CC0 only):
   *   bark*     = cylindrical outer bark (outsidebark)
   *   endgrain  = cap rings (top)
   *   insidegrain* = cut-face bark-edge atlas (insidegrain)
   */
  maps?: {
    barkDiff: string;
    barkNor?: string;
    barkRough?: string;
    endgrain?: string;
    /** Longitudinal split grain + thin bark L/R (CASE A/B/C atlas). */
    insidegrainDiff?: string;
    insidegrainNor?: string;
  };
  attribution?: Record<string, string>;
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
  /** Optional GLB/GLTF public URL for H5 axe visual. */
  model?: string;
  attribution?: Record<string, string>;
}
