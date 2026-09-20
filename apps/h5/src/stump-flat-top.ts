import * as THREE from 'three';

/**
 * Option C stump top: stop naive Y-band squash.
 *
 * After the stump is planted, replace the irregular top with a real horizontal
 * sawn face: clip body verts to the cut plane, then add an opaque end-grain
 * disc with planar UVs welded to the silhouette (not a floating seating pad).
 */

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Area-weighted upward / downward / side face fractions (world space). */
export function stumpFaceFractions(root: THREE.Object3D): {
  up: number;
  down: number;
  side: number;
} {
  root.updateMatrixWorld(true);
  let up = 0;
  let down = 0;
  let side = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | null;
    if (!pos) return;
    const idx = mesh.geometry.index;
    const mw = mesh.matrixWorld;
    const triCount = idx ? idx.count / 3 : Math.floor(pos.count / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      _a.fromBufferAttribute(pos, i0).applyMatrix4(mw);
      _b.fromBufferAttribute(pos, i1).applyMatrix4(mw);
      _c.fromBufferAttribute(pos, i2).applyMatrix4(mw);
      _ab.subVectors(_b, _a);
      _ac.subVectors(_c, _a);
      _n.crossVectors(_ab, _ac);
      const area = _n.length() * 0.5;
      if (area < 1e-12) continue;
      _n.normalize();
      if (_n.y > 0.7) up += area;
      else if (_n.y < -0.7) down += area;
      else side += area;
    }
  });
  const tot = up + down + side || 1;
  return { up: up / tot, down: down / tot, side: side / tot };
}

/**
 * Conservative uprighting for curated packs.
 * Only rotates when the downward face clearly dominates the upward one
 * (typical of an inverted or side-lying scan). Stocky chopping blocks with a
 * readable +Y cut are left alone.
 */
export function orientStumpUpright(root: THREE.Object3D): boolean {
  root.updateMatrixWorld(true);
  const base = stumpFaceFractions(root);
  // Already reading as cut-top-up — do not tip a stocky block onto its side.
  if (base.up >= base.down) {
    return false;
  }

  const candidates: Array<{ axis: 'x' | 'z'; angle: number }> = [
    { axis: 'x', angle: Math.PI / 2 },
    { axis: 'x', angle: -Math.PI / 2 },
    { axis: 'x', angle: Math.PI },
    { axis: 'z', angle: Math.PI / 2 },
    { axis: 'z', angle: -Math.PI / 2 },
  ];

  let bestUp = base.up;
  let best: { axis: 'x' | 'z'; angle: number } | null = null;
  const q0 = root.quaternion.clone();

  for (const c of candidates) {
    root.quaternion.copy(q0);
    const axis =
      c.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    root.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, c.angle));
    root.updateMatrixWorld(true);
    const f = stumpFaceFractions(root);
    if (f.up > bestUp + 0.05 && f.up > f.down) {
      bestUp = f.up;
      best = c;
    }
  }

  root.quaternion.copy(q0);
  if (!best) {
    root.updateMatrixWorld(true);
    return false;
  }
  const axis =
    best.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  root.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, best.angle));
  root.updateMatrixWorld(true);
  return true;
}

/**
 * Clip / project body verts so nothing sits above the cut plane.
 * Returns how many verts were moved (not a material/UV rewrite).
 */
export function clipStumpBodyToCutPlane(
  root: THREE.Object3D,
  topY: number,
  opts?: { inset?: number },
): number {
  const inset = opts?.inset ?? 0.0015;
  const planeY = topY - inset;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4();
  let clipped = 0;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (mesh.name === 'chopping-block-cut-face') return;
    const src = mesh.geometry;
    const posAttr = src.getAttribute('position') as THREE.BufferAttribute | null;
    if (!posAttr || posAttr.count < 3) return;

    const geo = src.clone();
    mesh.geometry = geo;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    mesh.updateMatrixWorld(true);
    inv.copy(mesh.matrixWorld).invert();

    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (_v.y <= planeY) continue;
      _v.y = planeY;
      _v.applyMatrix4(inv);
      pos.setXYZ(i, _v.x, _v.y, _v.z);
      clipped += 1;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  });

  root.updateMatrixWorld(true);
  return clipped;
}

/** Horizontal silhouette radius of the stump near the cut plane. */
export function measureStumpTopRadius(
  root: THREE.Object3D,
  topY: number,
  opts?: { band?: number },
): number {
  root.updateMatrixWorld(true);
  const band = opts?.band ?? 0.06;
  const lo = topY - band;
  let maxR = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (mesh.name === 'chopping-block-cut-face') return;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (_v.y < lo || _v.y > topY + 0.02) continue;
      maxR = Math.max(maxR, Math.hypot(_v.x, _v.z));
    }
  });
  return maxR;
}

/**
 * Opaque sawn cut face: end-grain disc with planar UVs, flush on `topY`.
 * Sits in the stump silhouette (slightly inset) — not a translucent pad above.
 */
export function makeSawnCutFace(
  radius: number,
  endMap: THREE.Texture | null,
): THREE.Mesh {
  const map = endMap?.clone() ?? null;
  if (map) {
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    map.repeat.set(1, 1);
    map.needsUpdate = true;
  }
  const mat = new THREE.MeshStandardMaterial({
    ...(map ? { map } : {}),
    // Weathered chopping-block face — muted multiply so rings read as wood.
    color: map ? 0x6e5738 : 0x5c4a32,
    roughness: 0.99,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  // Very thin disc; visually the stump's own cut, not a thick pad.
  const geo = new THREE.CylinderGeometry(radius, radius * 0.99, 0.006, 48, 1, false);
  // Planar UVs on the top cap already come from CylinderGeometry; reinforce
  // ring-centered mapping so endgrain bullseye sits on the cut face.
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0.002) continue; // top ring / cap
    const u = pos.getX(i) / (2 * radius) + 0.5;
    const v = pos.getZ(i) / (2 * radius) + 0.5;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;

  const disc = new THREE.Mesh(geo, mat);
  disc.name = 'chopping-block-cut-face';
  disc.castShadow = false;
  disc.receiveShadow = true;
  return disc;
}

/**
 * Apply Option C top treatment: clip body to plane + attach sawn endgrain face.
 * @returns verts clipped + cut-face radius used
 */
export function applyStumpSawnTop(
  root: THREE.Object3D,
  topY: number,
  endMap: THREE.Texture | null,
  opts?: { minRadius?: number; radiusScale?: number },
): { clipped: number; radius: number } {
  // Remove any previous cut face (pack swaps).
  const stale: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === 'chopping-block-cut-face' || o.name === 'chopping-block-seat') {
      stale.push(o);
    }
  });
  for (const o of stale) {
    o.parent?.remove(o);
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) (m as THREE.Material)?.dispose?.();
  }

  const clipped = clipStumpBodyToCutPlane(root, topY, { inset: 0.002 });
  const measured = measureStumpTopRadius(root, topY, { band: 0.05 });
  const minR = opts?.minRadius ?? 0.22;
  const scale = opts?.radiusScale ?? 0.96;
  const radius = Math.max(minR, measured * scale);

  const face = makeSawnCutFace(radius, endMap);
  // Flush: disc center slightly below topY so the top surface == topY.
  face.position.y = topY - 0.004;
  root.add(face);
  root.updateMatrixWorld(true);
  return { clipped, radius };
}

/** @deprecated Kept for call-site compatibility; prefer applyStumpSawnTop. */
export function flattenStumpTopToPlane(
  root: THREE.Object3D,
  topY: number,
  _opts?: { band?: number; bandFrac?: number },
): number {
  return clipStumpBodyToCutPlane(root, topY, { inset: 0 });
}
