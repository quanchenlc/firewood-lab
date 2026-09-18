/**
 * Unit tests for cut-face classification + aspect-correct UV helpers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aspectCorrectUv,
  classifyExteriorNormal,
  classifyFaceNormal,
  cutFaceCoverageRatio,
  hasReclassifiedInnerSlot,
  projectionSpan,
  shouldSealCutFace,
} from './cut-face.ts';

describe('classifyFaceNormal', () => {
  const plane = { x: 1, y: 0, z: 0 };

  it('caps (|ny| high) → endgrain', () => {
    assert.equal(classifyFaceNormal({ x: 0, y: 1, z: 0 }, plane), 'endgrain');
    assert.equal(classifyFaceNormal({ x: 0.1, y: -0.95, z: 0 }, plane), 'endgrain');
  });

  it('pinata cut-group tris → inner (explicit flag)', () => {
    assert.equal(
      classifyFaceNormal({ x: 1, y: 0, z: 0 }, plane, { isCutGroup: true }),
      'inner',
    );
    assert.equal(
      classifyFaceNormal({ x: -1, y: 0, z: 0 }, plane, { isCutGroup: true }),
      'inner',
    );
  });

  it('radial bark sides → bark', () => {
    assert.equal(classifyFaceNormal({ x: 0, y: 0, z: 1 }, plane), 'bark');
    assert.equal(classifyFaceNormal({ x: 0.2, y: 0.1, z: 0.95 }, plane), 'bark');
  });

  it('outer mantle facing away from cleave stays bark (not |n·plane| trap)', () => {
    // +X half: curved mantle normals span roughly -90°..+90° around +X.
    // Old |n·plane| heuristic tagged most of these as "inner".
    for (let a = -Math.PI / 2; a <= Math.PI / 2 + 1e-9; a += Math.PI / 16) {
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      assert.equal(
        classifyFaceNormal({ x: nx, y: 0, z: nz }, plane),
        'bark',
        `mantle angle ${(a * 180) / Math.PI}° should stay bark`,
      );
    }
  });

  it('cleave-aligned exterior without cut-group flag is still bark', () => {
    // Must not infer inner from normals alone — that is the post-#22 bark bug.
    assert.equal(classifyFaceNormal({ x: 1, y: 0, z: 0 }, plane), 'bark');
    assert.equal(classifyFaceNormal({ x: -0.9, y: 0.1, z: 0.1 }, plane), 'bark');
  });
});

describe('classifyExteriorNormal', () => {
  it('splits caps vs sides by |ny|', () => {
    assert.equal(classifyExteriorNormal({ x: 0, y: 1, z: 0 }), 'endgrain');
    assert.equal(classifyExteriorNormal({ x: 0.7, y: 0, z: 0.7 }), 'bark');
  });
});

describe('aspectCorrectUv', () => {
  it('uses uniform span (no independent u/v stretch)', () => {
    // Face is 2 wide × 1 tall → span=2; height maps to 0.5 not 1.
    const a = aspectCorrectUv(0, 0, 0, 0, projectionSpan(2, 1));
    const b = aspectCorrectUv(2, 1, 0, 0, projectionSpan(2, 1));
    assert.equal(a.u, 0);
    assert.equal(a.v, 0);
    assert.equal(b.u, 1);
    assert.equal(b.v, 0.5);
  });

  it('tall thin face keeps grain aspect', () => {
    const span = projectionSpan(0.4, 1.2);
    const top = aspectCorrectUv(0.4, 1.2, 0, 0, span);
    assert.ok(Math.abs(top.u - 0.4 / 1.2) < 1e-9);
    assert.equal(top.v, 1);
  });
});

describe('hasReclassifiedInnerSlot', () => {
  const bark = { id: 'bark' };
  const end = { id: 'end' };
  const inner = { id: 'inner' };

  it('fresh cylinder [bark, end, end] is NOT an inner slot', () => {
    // materialIndex 2 is the bottom endgrain — must not feed pinata interior.
    assert.equal(hasReclassifiedInnerSlot([bark, end, end], inner), false);
  });

  it('post-reclassify [bark, end, inner] IS an inner slot', () => {
    assert.equal(hasReclassifiedInnerSlot([bark, end, inner], inner), true);
  });

  it('two-slot pinata [bark, inner] is false (handled by groups.length===2)', () => {
    assert.equal(hasReclassifiedInnerSlot([bark, inner], inner), false);
  });
});

describe('shouldSealCutFace', () => {
  it('always seals — old cutTriCount<8 gate missed holed faces with 8+ tris', () => {
    // Regression: pinata left ~17% coverage with exactly 8 cut tris; <8 skipped seal.
    assert.equal(shouldSealCutFace(0), true);
    assert.equal(shouldSealCutFace(7), true);
    assert.equal(shouldSealCutFace(8), true);
    assert.equal(shouldSealCutFace(40), true);
  });
});

describe('cutFaceCoverageRatio', () => {
  it('flags sparse fill as a hole', () => {
    assert.ok(cutFaceCoverageRatio(0.02, 0.12) < 0.85);
    assert.ok(cutFaceCoverageRatio(0.12, 0.12) >= 0.99);
  });
});
