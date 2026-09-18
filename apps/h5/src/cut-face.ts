/**
 * Cut-face material reclassification + bark-edge UV projection.
 *
 * three-pinata only emits 2 material groups (outer / cut). After a vertical
 * cleave we reclassify triangles into 3 slots like screen.toys/firewood:
 *   0 = bark (side), 1 = endgrain (caps), 2 = inner side-grain (cut faces)
 *
 * CASE1 (new cleave): U across chord → bark-edge atlas; V bottom→top along
 * log height. Sub-cases A/B/C (from ref bundled JS) place bark strips only
 * where the cut meets true bark rim verts:
 *   A — bark on both chord ends → full atlas U∈[0,1]
 *   B — bark on one end only → sample atlas from that bark edge inward
 *   C — no bark rim (interior re-split) → sample grain mid-strip only
 *
 * CASE2 (re-split): skip verts not on the current plane so older cut UVs stay.
 *
 * IMPORTANT: do NOT classify exterior mantle as "inner" via |n·cleavePlane|.
 * Cut faces come from pinata's cut group (materialIndex 1); caps use |ny|.
 */

export type FaceKind = 'bark' | 'endgrain' | 'inner';

/** Ref-style CASE1 sub-type for bark-edge atlas sampling. */
export type BarkEdgeCase = 'A' | 'B_left' | 'B_right' | 'C';

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
 *
 * Ref `insidegrain.jpg` keeps bark on only ~2–4% of U each side; 12% made
 * thick dark columns that read as a “bark band” on split faces.
 */
export const BARK_EDGE_U_FRAC = 0.03;

/**
 * Normalize chord U / height V independently to [0,1]² (raw face coords).
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
 * Which atlas window to use given bark-rim presence on the chord.
 * Mirrors screen.toys CASE A / B / C (logic only — no their textures).
 */
export function classifyBarkEdgeCase(
  hasLeftBark: boolean,
  hasRightBark: boolean,
): BarkEdgeCase {
  if (hasLeftBark && hasRightBark) return 'A';
  if (hasLeftBark) return 'B_left';
  if (hasRightBark) return 'B_right';
  return 'C';
}

/**
 * Map normalized chord U∈[0,1] into the bark-edge atlas.
 *
 * @param chordCover `le` in ref — min(1, faceChord / estimatedFullChord).
 *   <1 when the face is narrower than a diameter (wedge / off-center).
 */
export function applyBarkEdgeCaseU(
  uNorm: number,
  barkCase: BarkEdgeCase,
  chordCover = 1,
): number {
  const u = Math.max(0, Math.min(1, uNorm));
  const le = Math.max(0, Math.min(1, chordCover));
  switch (barkCase) {
    case 'A':
      // Full diameter: bark L + grain mid + bark R.
      return u;
    case 'B_left':
      // Bark only on the low-U end → sample [0, le] (left bark → grain).
      return u * le;
    case 'B_right':
      // Bark only on the high-U end → sample [1-le, 1].
      return 1 - (1 - u) * le;
    case 'C':
      // Interior face: grain mid-strip only (skip both bark rims).
      return (1 - le) / 2 + u * le;
    default:
      return u;
  }
}

/**
 * Estimate chord coverage vs a full diameter (ref `le`).
 * When unknown, prefer 1 (CASE A full span) — thin atlas bark keeps interiors pale.
 */
export function estimateChordCover(
  faceChord: number,
  fullChordEstimate: number,
): number {
  const face = Math.max(0, faceChord);
  const full = Math.max(1e-6, fullChordEstimate);
  return Math.min(1, face / full);
}

/**
 * True when `materials[2]` is the side-grain inner slot from a prior
 * `reclassifyPieceMaterials` pass — not CylinderGeometry's bottom endgrain.
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
 * fills. Prefer sealing so the bark-edge atlas reads on a clean plane;
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
