/**
 * Cut-face material reclassification + aspect-correct UV projection.
 *
 * three-pinata only emits 2 material groups (outer / cut). After a vertical
 * cleave we reclassify triangles into 3 slots like screen.toys/firewood:
 *   0 = bark (side), 1 = endgrain (caps), 2 = inner side-grain (cut faces)
 *
 * UVs on new cut faces use a cut-plane projection with a *uniform* world-space
 * scale (V along log height / grain) — never independent u/v → [0,1]² stretch.
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
 * three-pinata's constrained Delaunay fill frequently leaves holes even when
 * `cutTriCount >= 8` (observed ~17% coverage with exactly 8 tris on irregular
 * bark). The old `cutTriCount < 8` gate skipped those cases → 破面.
 *
 * Always seal: a DoubleSide side-grain plane sized to the piece AABB covers
 * holes without regressing bark/endgrain on other groups.
 */
export function shouldSealCutFace(_cutTriCount: number): boolean {
  return true;
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

/** Shared photographic side-grain maps (Poly Haven ash_veneer, CC0). */
export const SIDEGRAIN_DIFF = 'assets/facegrain/sidegrain_diff.jpg';
export const SIDEGRAIN_NOR = 'assets/facegrain/sidegrain_nor.jpg';
