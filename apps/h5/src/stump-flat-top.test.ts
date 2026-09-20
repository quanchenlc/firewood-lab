/**
 * Stump top flatten: mesh itself becomes the horizontal cut face (no pad/disc).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { flattenStumpTopToPlane } from './stump-flat-top.ts';

describe('flattenStumpTopToPlane', () => {
  it('projects the highest band onto a world-horizontal plane', () => {
    // Irregular “stump”: base at y=0, peaks around y=0.40 with dips in between.
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([
      // base ring
      -0.2, 0.0, -0.2, 0.2, 0.0, -0.2, 0.2, 0.0, 0.2, -0.2, 0.0, 0.2,
      // mid bark
      -0.18, 0.2, -0.18, 0.18, 0.2, 0.18,
      // top peaks + valley (valley must rise into the plane)
      -0.12, 0.4, -0.1, 0.1, 0.38, -0.08, 0.0, 0.32, 0.0, 0.12, 0.4, 0.1,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    const root = new THREE.Group();
    root.add(mesh);

    const topY = 0.36;
    const n = flattenStumpTopToPlane(root, topY, { band: 0.1 });
    assert.ok(n >= 3, 'should flatten several top verts');

    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    assert.ok(Math.abs(box.max.y - topY) < 1e-5, `maxY=${box.max.y} expected ${topY}`);

    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    let onPlane = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(v.y - topY) < 1e-5) onPlane += 1;
      // Nothing should sit above the cut plane.
      assert.ok(v.y <= topY + 1e-5, `vert ${i} above plane: ${v.y}`);
    }
    assert.ok(onPlane >= 3, 'flat cut face has coplanar verts');
  });

  it('does not add a separate seating disc child', () => {
    const geo = new THREE.ConeGeometry(0.25, 0.4, 12);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.position.y = 0.2;
    const root = new THREE.Group();
    root.name = 'chopping-block';
    root.add(mesh);
    flattenStumpTopToPlane(root, 0.36, { bandFrac: 0.2 });

    const names: string[] = [];
    root.traverse((o) => names.push(o.name));
    assert.ok(!names.includes('chopping-block-seat'));
    assert.equal(
      root.children.filter((c) => (c as THREE.Mesh).isMesh).length,
      1,
      'only the stump body mesh',
    );
  });

  it('keeps lower bark verts below the cut band', () => {
    const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.position.y = 0.2; // [0, 0.4]
    const root = new THREE.Group();
    root.add(mesh);
    flattenStumpTopToPlane(root, 0.36, { band: 0.06 });

    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    let low = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (v.y < 0.15) low += 1;
    }
    assert.ok(low >= 4, 'base verts remain near the ground');
  });
});
