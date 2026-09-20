import * as THREE from 'three';

/**
 * Flatten the stump mesh's own top into a world-horizontal cut plane.
 *
 * Detects the highest vertex band, projects those verts onto `topY`, and
 * recomputes normals. Keeps each mesh's original materials/UVs — no separate
 * seating disc (matches the idea of a scanned flat chopping face).
 *
 * @returns number of vertices projected onto the plane
 */
export function flattenStumpTopToPlane(
  root: THREE.Object3D,
  topY: number,
  opts?: { band?: number; bandFrac?: number },
): number {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const height = Math.max(box.max.y - box.min.y, 1e-4);
  const band =
    opts?.band ?? Math.max(0.035, height * (opts?.bandFrac ?? 0.14));
  const threshold = box.max.y - band;

  const world = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  let flattened = 0;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const src = mesh.geometry;
    const posAttr = src.getAttribute('position') as THREE.BufferAttribute | null;
    if (!posAttr || posAttr.count < 3) return;

    // Unique geometry so pack swaps / shared GLTF buffers stay intact.
    const geo = src.clone();
    mesh.geometry = geo;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    mesh.updateMatrixWorld(true);
    inv.copy(mesh.matrixWorld).invert();

    for (let i = 0; i < pos.count; i++) {
      world.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (world.y < threshold) continue;
      world.y = topY;
      world.applyMatrix4(inv);
      pos.setXYZ(i, world.x, world.y, world.z);
      flattened += 1;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  });

  root.updateMatrixWorld(true);
  return flattened;
}
