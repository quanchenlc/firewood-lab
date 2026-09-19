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
 * Kept for legacy tests / diagnostics.
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
 * Mirrors screen.toys insidegrain CASE A/B/C (logic only — no their textures):
 *   A → U = u
 *   B_left → U = u * le
 *   B_right → U = 1 - (1-u) * le
 *   C → mid-strip; ref `(1-le)/2+u*le` still hits bark when le≈1, so we
 *       prefer an explicit inset by `BARK_EDGE_U_FRAC` (optionally le-scaled
 *       *within* the grain band).
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
    case 'C': {
      // Interior face: never sample atlas bark strips.
      const inset = BARK_EDGE_U_FRAC;
      const grain = Math.max(1e-6, 1 - 2 * inset);
      const span = Math.max(1e-6, le * grain);
      const start = inset + (grain - span) * 0.5;
      return start + u * span;
    }
    default:
      return u;
  }
}

/**
 * Right-handed cut-plane frame matching pinata fill U/V:
 *   +X = tangent (U), +Y = bitangent (V), +Z = -localN
 * because `tangent × bitangent = -localN` for Y-up cleaves.
 *
 * Kept for UV-frame tests / diagnostics (no longer drives a PlaneGeometry seal).
 */
export function cutCapAxesFromCleave(
  tangent: Vec3,
  bitangent: Vec3,
  localN: Vec3,
): { x: Vec3; y: Vec3; z: Vec3 } {
  return {
    x: { x: tangent.x, y: tangent.y, z: tangent.z },
    y: { x: bitangent.x, y: bitangent.y, z: bitangent.z },
    z: { x: -localN.x, y: -localN.y, z: -localN.z },
  };
}

/** Point projected into the cut-plane tangent/bitangent frame. */
export interface PlanarPoint {
  i: number;
  u: number;
  v: number;
}

/**
 * Order cut-boundary verts into a closed contour by angle around the centroid
 * in the (tangent, bitangent) plane. Dedupes near-duplicates.
 *
 * Used to triangulate a flush seal from real bark-edge ∩ plane verts
 * (Option 1) instead of an AABB PlaneGeometry veneer.
 */
export function orderContourInPlane(
  points: PlanarPoint[],
  dupEps = 1e-4,
): number[] {
  if (points.length < 3) return points.map((p) => p.i);
  let cu = 0;
  let cv = 0;
  for (const p of points) {
    cu += p.u;
    cv += p.v;
  }
  cu /= points.length;
  cv /= points.length;
  const sorted = [...points].sort(
    (a, b) =>
      Math.atan2(a.v - cv, a.u - cu) - Math.atan2(b.v - cv, b.u - cu),
  );
  const out: PlanarPoint[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      Math.abs(prev.u - p.u) < dupEps &&
      Math.abs(prev.v - p.v) < dupEps
    ) {
      continue;
    }
    if (prev && prev.i === p.i) continue;
    out.push(p);
  }
  // Drop closing duplicate of first (same position).
  const first = out[0];
  const last = out[out.length - 1];
  if (
    out.length >= 2 &&
    first &&
    last &&
    Math.abs(first.u - last.u) < dupEps &&
    Math.abs(first.v - last.v) < dupEps
  ) {
    out.pop();
  }
  const ids = out.map((p) => p.i);
  return ids.length >= 3 ? ids : points.map((p) => p.i);
}

/**
 * Fan-triangulate an ordered contour through a centroid vertex index.
 *
 * @param flipWinding when true, reverse winding (fragment on -localN side).
 *   With `tangent × bitangent = -localN`, a CCW fan in (u,v) faces -localN;
 *   flip when the solid sits on the -localN half so the cap faces outward.
 */
export function fanTriangulateContour(
  contour: number[],
  centroidIndex: number,
  flipWinding: boolean,
): number[] {
  const tris: number[] = [];
  if (contour.length < 3) return tris;
  for (let i = 0; i < contour.length; i++) {
    const i0 = contour[i]!;
    const i1 = contour[(i + 1) % contour.length]!;
    if (i0 === i1 || i0 === centroidIndex || i1 === centroidIndex) continue;
    if (!flipWinding) tris.push(centroidIndex, i0, i1);
    else tris.push(centroidIndex, i1, i0);
  }
  return tris;
}

/**
 * Deterministic ±amp micro-displacement along `axis` for rough-cut feel.
 * Hash is stable for a given vertex index (no Math.random).
 */
export function roughCutOffset(vertIndex: number, amp = 0.0008): number {
  // Simple LCG-ish mix → [0,1)
  const h = (Math.imul(vertIndex ^ 0x9e3779b9, 0x85ebca6b) >>> 0) / 4294967296;
  return (h - 0.5) * 2 * amp;
}

/**
 * Whether a contour seal should be appended when pinata fill is sparse.
 * Same thresholds as the old rectangular cutCap path — dense high-coverage
 * fills skip the extra seal to avoid z-fighting.
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
 * Cut verts that are also referenced by exterior (bark / endgrain) tris.
 * These MUST be duplicated before writing CASE A/B/C UVs — otherwise outer
 * mantle cylindrical UVs are overwritten in place (side-texture smear).
 */
export function cutVertsSharedWithExterior(
  cutVerts: Iterable<number>,
  exteriorVerts: ReadonlySet<number>,
): number[] {
  const shared: number[] = [];
  for (const vi of cutVerts) {
    if (exteriorVerts.has(vi)) shared.push(vi);
  }
  return shared;
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

/** Shared photographic bark-edge cut atlas fallback (CC0 — see ATTRIBUTION). */
export const SIDEGRAIN_DIFF = 'assets/facegrain/barkedge_diff.jpg';
export const SIDEGRAIN_NOR = 'assets/facegrain/barkedge_nor.jpg';

/** Per-species insidegrain pack paths (outsidebark/insidegrain/top layout). */
export function speciesInsidegrainPaths(speciesId: string): {
  diff: string;
  nor: string;
} {
  return {
    diff: `assets/facegrain/${speciesId}/insidegrain_diff.jpg`,
    nor: `assets/facegrain/${speciesId}/insidegrain_nor.jpg`,
  };
}

/** Legacy pure side-grain maps (still generated by assets:pull for remix). */
export const SIDEGRAIN_PURE_DIFF = 'assets/facegrain/sidegrain_diff.jpg';
export const SIDEGRAIN_PURE_NOR = 'assets/facegrain/sidegrain_nor.jpg';
