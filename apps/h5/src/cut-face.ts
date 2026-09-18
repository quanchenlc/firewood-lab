/**
 * Cut-face material reclassification + aspect-correct UV projection.
 *
 * three-pinata only emits 2 material groups (outer / cut). After a vertical
 * cleave we reclassify triangles into 3 slots like screen.toys/firewood:
 *   0 = bark (side), 1 = endgrain (caps), 2 = inner side-grain (cut faces)
 *
 * UVs on new cut faces use a cut-plane projection with a *uniform* world-space
 * scale (V along log height / grain) — never independent u/v → [0,1]² stretch.
 */

export type FaceKind = 'bark' | 'endgrain' | 'inner';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Classify a triangle by its face normal + cleave-plane normal (Y-up log). */
export function classifyFaceNormal(
  faceNormal: Vec3,
  planeNormal: Vec3,
  opts?: { capThreshold?: number; cutThreshold?: number },
): FaceKind {
  const capT = opts?.capThreshold ?? 0.65;
  const cutT = opts?.cutThreshold ?? 0.55;
  const ny = Math.abs(faceNormal.y);
  if (ny >= capT) return 'endgrain';

  // Horizontal cleave normal in XZ
  let px = planeNormal.x;
  let pz = planeNormal.z;
  const plen = Math.hypot(px, pz);
  if (plen < 1e-8) {
    px = 1;
    pz = 0;
  } else {
    px /= plen;
    pz /= plen;
  }
  const cutAlign = Math.abs(faceNormal.x * px + faceNormal.z * pz);
  if (cutAlign >= cutT && ny < capT) return 'inner';
  return 'bark';
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

/** Shared photographic side-grain maps (Poly Haven ash_veneer, CC0). */
export const SIDEGRAIN_DIFF = 'assets/facegrain/sidegrain_diff.jpg';
export const SIDEGRAIN_NOR = 'assets/facegrain/sidegrain_nor.jpg';
