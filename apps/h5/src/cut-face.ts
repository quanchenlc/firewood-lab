/**
 * Cut-face material reclassification + bark-edge UV projection.
 *
 * three-pinata only emits 2 material groups (outer / cut). After a vertical
 * cleave we reclassify triangles into 3 slots like screen.toys/firewood:
 *   0 = bark (side), 1 = endgrain (caps), 2 = inner side-grain (cut faces)
 *
 * CASE1 (new cleave): U across chord → bark-edge atlas A|B|C; V bottom→top
 * along log height. CASE2 (re-split): skip verts not on the current plane so
 * older cut UVs stay intact.
 *
 * IMPORTANT: do NOT classify exterior mantle as "inner" via |n·cleavePlane|.
 * On each half-log the outer bark normals point *away* from the cut, so
 * |n·plane| ≈ 1 across most of the curved mantle — that heuristic paints bark
 * with the side-grain / wrong slot and destroys the photographic bark look.
 * Cut faces come from pinata's cut group (materialIndex 1); caps use |ny|.
 */

export type FaceKind = 'bark' | 'endgrain' | 'inner';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ClassifyOpts {
  capThreshold?: number;
  /**
   * Triangle came from pinata's cut/inner group (materialIndex 1).
   * Required to tag inner faces — never infer from |n·plane| alone.
   */
  isCutGroup?: boolean;
}

/** Caps vs bark for exterior tris (Y-up log). */
export function classifyExteriorNormal(
  faceNormal: Vec3,
  opts?: { capThreshold?: number },
): 'bark' | 'endgrain' {
  const capT = opts?.capThreshold ?? 0.65;
  return Math.abs(faceNormal.y) >= capT ? 'endgrain' : 'bark';
}

/**
 * Classify a triangle after a cleave.
 * Prefer `isCutGroup` from pinata groups; exterior uses |ny| only.
 */
export function classifyFaceNormal(
  faceNormal: Vec3,
  _planeNormal: Vec3,
  opts?: ClassifyOpts,
): FaceKind {
  if (opts?.isCutGroup) return 'inner';
  return classifyExteriorNormal(faceNormal, { capThreshold: opts?.capThreshold });
}

/**
 * Aspect-correct planar UV: both axes share `span` (usually max(uSpan, vSpan)).
 * Returns u,v relative to (uMin, vMin) — does NOT independently normalize to [0,1]².
 * Kept for cutCap seal sizing / legacy tests.
 */
export function aspectCorrectUv(
  u: number,
  v: number,
  uMin: number,
  vMin: number,
  span: number,
): { u: number; v: number } {
  const s = Math.max(1e-6, span);
  return {
    u: (u - uMin) / s,
    v: (v - vMin) / s,
  };
}

/** Longer-axis span for aspect-correct projection. */
export function projectionSpan(uSpan: number, vSpan: number): number {
  return Math.max(1e-6, uSpan, vSpan);
}

/**
 * Fraction of the bark-edge atlas reserved for each bark rim (A / C).
 * Must match `scripts/barkedge-atlas.py` BARK_FRAC.
 */
export const BARK_EDGE_U_FRAC = 0.12;

/**
 * CASE1 cut-face UV (ref-style bark-edge atlas):
 *   V = bottom → top along log height (bitangent / +Y)
 *   U = across chord, sampling atlas A|B|C (thin bark L/R + grain middle)
 *
 * Independent normalize to [0,1]² so L/R bark strips land on the chord ends.
 */
export function barkEdgeCutUv(
  u: number,
  v: number,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
): { u: number; v: number } {
  const uSpan = Math.max(1e-6, uMax - uMin);
  const vSpan = Math.max(1e-6, vMax - vMin);
  return {
    u: (u - uMin) / uSpan,
    v: (v - vMin) / vSpan,
  };
}

/**
 * True when `materials[2]` is the side-grain inner slot from a prior
 * `reclassifyPieceMaterials` pass — not CylinderGeometry's bottom endgrain.
 *
 * Fresh logs use `material = [bark, endgrain, endgrain]` while `innerMat` lives
 * only in userData. Treating materialIndex 2 as "cut" on a fresh cylinder feeds
 * the bottom cap into pinata's interior group and contaminates cut triangulation.
 */
export function hasReclassifiedInnerSlot(
  materials: unknown,
  inner: unknown,
): boolean {
  if (inner == null) return false;
  const arr = Array.isArray(materials) ? materials : [materials];
  return arr.length >= 3 && arr[2] === inner;
}

/**
 * Whether to synthesize a rectangular cutCap seal over the cleave face.
 *
 * three-pinata's constrained Delaunay fill frequently leaves holes on sparse
 * fills. Prefer sealing so the bark-edge atlas reads on a clean A|B|C plane;
 * only skip when triangulation is both dense and high-coverage (avoids z-fight).
 */
export function shouldSealCutFace(
  cutTriCount: number,
  coverageRatio?: number,
): boolean {
  // Sparse / empty fill — always seal (regression: ≥8 tris still had holes).
  if (cutTriCount < 16) return true;
  if (coverageRatio != null) {
    // Only skip when fill is essentially complete.
    return coverageRatio < 0.95;
  }
  // Unknown coverage: seal unless the fill looks very dense.
  return cutTriCount < 48;
}

/**
 * Coverage of vertical cut tris vs the expected rectangle (height × span).
 * Used in tests / diagnostics; values ≪ 1 mean a visible hole.
 */
export function cutFaceCoverageRatio(
  alignedCutArea: number,
  expectedArea: number,
): number {
  return alignedCutArea / Math.max(1e-9, expectedArea);
}

/**
 * Triangle area in the cut-plane tangent/bitangent frame (for coverage).
 */
export function cutTriAreaInPlane(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  tx: number,
  ty: number,
  tz: number,
  bxAxis: number,
  byAxis: number,
  bzAxis: number,
): number {
  const au = ax * tx + ay * ty + az * tz;
  const av = ax * bxAxis + ay * byAxis + az * bzAxis;
  const bu = bx * tx + by * ty + bz * tz;
  const bv = bx * bxAxis + by * byAxis + bz * bzAxis;
  const cu = cx * tx + cy * ty + cz * tz;
  const cv = cx * bxAxis + cy * byAxis + cz * bzAxis;
  return Math.abs((bu - au) * (cv - av) - (cu - au) * (bv - av)) * 0.5;
}

/** Shared photographic bark-edge cut atlas (CC0 composite — see ATTRIBUTION). */
export const SIDEGRAIN_DIFF = 'assets/facegrain/barkedge_diff.jpg';
export const SIDEGRAIN_NOR = 'assets/facegrain/barkedge_nor.jpg';

/** Legacy pure side-grain maps (still generated by assets:pull for remix). */
export const SIDEGRAIN_PURE_DIFF = 'assets/facegrain/sidegrain_diff.jpg';
export const SIDEGRAIN_PURE_NOR = 'assets/facegrain/sidegrain_nor.jpg';
