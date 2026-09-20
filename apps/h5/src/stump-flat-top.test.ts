/**
 * Option C stump top: clip body + sawn endgrain cut face (no naive Y-squash pad).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  applyStumpSawnTop,
  clipStumpBodyToCutPlane,
  flattenStumpTopToPlane,
  measureStumpTopRadius,
  orientStumpUpright,
  stumpFaceFractions,
} from './stump-flat-top.ts';

describe('stump sawn cut face (Option C)', () => {
  it('clips body verts to the cut plane without rewriting materials', () => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([
      -0.2, 0.0, -0.2, 0.2, 0.0, -0.2, 0.2, 0.0, 0.2, -0.2, 0.0, 0.2,
      -0.18, 0.2, -0.18, 0.18, 0.2, 0.18,
      -0.12, 0.4, -0.1, 0.1, 0.38, -0.08, 0.0, 0.32, 0.0, 0.12, 0.4, 0.1,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    const root = new THREE.Group();
    root.add(mesh);

    const topY = 0.36;
    const n = clipStumpBodyToCutPlane(root, topY, { inset: 0 });
    assert.ok(n >= 3, 'should clip several top verts');

    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    assert.ok(box.max.y <= topY + 1e-5, `maxY=${box.max.y} expected ≤ ${topY}`);
  });

  it('adds an opaque chopping-block-cut-face (not seating-pad name)', () => {
    const geo = new THREE.ConeGeometry(0.25, 0.4, 12);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.position.y = 0.2;
    mesh.name = 'chopping-block-body';
    const root = new THREE.Group();
    root.name = 'chopping-block';
    root.add(mesh);

    const { clipped, radius } = applyStumpSawnTop(root, 0.36, null, {
      minRadius: 0.2,
      radiusScale: 0.94,
    });
    assert.ok(clipped >= 1);
    assert.ok(radius >= 0.2);

    const names: string[] = [];
    root.traverse((o) => names.push(o.name));
    assert.ok(names.includes('chopping-block-cut-face'));
    assert.ok(!names.includes('chopping-block-seat'));

    const face = root.getObjectByName('chopping-block-cut-face') as THREE.Mesh;
    assert.ok(face?.isMesh);
    const mat = face.material as THREE.MeshStandardMaterial;
    assert.equal(mat.transparent, false);
    // Top of disc ≈ seating plane.
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(face);
    assert.ok(Math.abs(box.max.y - 0.36) < 0.002, `cut top ${box.max.y}`);
  });

  it('legacy flattenStumpTopToPlane still clips without adding a disc', () => {
    const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.position.y = 0.2;
    const root = new THREE.Group();
    root.add(mesh);
    flattenStumpTopToPlane(root, 0.36);

    const names: string[] = [];
    root.traverse((o) => names.push(o.name));
    assert.ok(!names.includes('chopping-block-cut-face'));
    assert.ok(!names.includes('chopping-block-seat'));
  });

  it('measureStumpTopRadius reads the silhouette near the cut', () => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.35, 0.4, 16),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.y = 0.2;
    const root = new THREE.Group();
    root.add(mesh);
    root.updateMatrixWorld(true);
    const r = measureStumpTopRadius(root, 0.4, { band: 0.08 });
    assert.ok(r > 0.25 && r < 0.4, `radius=${r}`);
  });

  it('orientStumpUpright leaves an already-upright stump alone', () => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.4, 20),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.y = 0.2;
    const root = new THREE.Group();
    root.add(mesh);
    root.updateMatrixWorld(true);
    const before = stumpFaceFractions(root);
    const rotated = orientStumpUpright(root);
    assert.equal(rotated, false);
    assert.ok(before.up >= before.down - 1e-6, `up=${before.up} down=${before.down}`);
  });

  it('orientStumpUpright flips an inverted stump so the cut faces +Y', () => {
    // Cone: wide base faces −Y by default → down dominates (cut face on the ground).
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.4, 20),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.y = 0.2;
    const root = new THREE.Group();
    root.add(mesh);
    root.updateMatrixWorld(true);
    const before = stumpFaceFractions(root);
    assert.ok(before.down > before.up, `inverted down=${before.down} up=${before.up}`);
    const rotated = orientStumpUpright(root);
    assert.equal(rotated, true);
    const after = stumpFaceFractions(root);
    assert.ok(after.up > after.down, `after up=${after.up} down=${after.down}`);
  });
});
