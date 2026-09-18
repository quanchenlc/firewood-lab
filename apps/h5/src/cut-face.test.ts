/**
 * Unit tests for cut-face classification + bark-edge UV helpers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyBarkEdgeCaseU,
  aspectCorrectUv,
  barkEdgeCutUv,
  BARK_EDGE_U_FRAC,
  classifyBarkEdgeCase,
  classifyExteriorNormal,
  classifyFaceNormal,
  cutFaceCoverageRatio,
  cutTriAreaInPlane,
  estimateChordCover,
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

describe('barkEdgeCutUv (CASE1 normalize)', () => {
  it('maps chord U and height V independently to [0,1]', () => {
    const bl = barkEdgeCutUv(0, 0, 0, 0.4, 0, 1.2);
    const tr = barkEdgeCutUv(0.4, 1.2, 0, 0.4, 0, 1.2);
    const mid = barkEdgeCutUv(0.2, 0.6, 0, 0.4, 0, 1.2);
    assert.equal(bl.u, 0);
    assert.equal(bl.v, 0);
    assert.equal(tr.u, 1);
    assert.equal(tr.v, 1);
    assert.ok(Math.abs(mid.u - 0.5) < 1e-9);
    assert.ok(Math.abs(mid.v - 0.5) < 1e-9);
  });

  it('atlas bark-edge fraction stays thin (~2–4%, ref-like)', () => {
    assert.ok(BARK_EDGE_U_FRAC >= 0.02 && BARK_EDGE_U_FRAC <= 0.05);
  });
});

describe('classifyBarkEdgeCase + applyBarkEdgeCaseU', () => {
  it('A/B/C from left/right bark flags', () => {
    assert.equal(classifyBarkEdgeCase(true, true), 'A');
    assert.equal(classifyBarkEdgeCase(true, false), 'B_left');
    assert.equal(classifyBarkEdgeCase(false, true), 'B_right');
    assert.equal(classifyBarkEdgeCase(false, false), 'C');
  });

  it('CASE A: full atlas — center samples grain mid, ends near bark rims', () => {
    assert.equal(applyBarkEdgeCaseU(0, 'A', 1), 0);
    assert.equal(applyBarkEdgeCaseU(0.5, 'A', 1), 0.5);
    assert.equal(applyBarkEdgeCaseU(1, 'A', 1), 1);
    // Center must NOT land on a bark rim (U≈0 or U≈1).
    const mid = applyBarkEdgeCaseU(0.5, 'A', 1);
    assert.ok(mid > BARK_EDGE_U_FRAC && mid < 1 - BARK_EDGE_U_FRAC);
  });

  it('CASE B_left: pith→bark face samples from left bark into grain', () => {
    const le = 0.6;
    assert.ok(Math.abs(applyBarkEdgeCaseU(0, 'B_left', le) - 0) < 1e-9);
    assert.ok(Math.abs(applyBarkEdgeCaseU(1, 'B_left', le) - le) < 1e-9);
    // Outer end is grain, not the right-hand bark strip.
    assert.ok(applyBarkEdgeCaseU(1, 'B_left', le) < 1 - BARK_EDGE_U_FRAC);
  });

  it('CASE B_right: samples toward right bark', () => {
    const le = 0.6;
    assert.ok(Math.abs(applyBarkEdgeCaseU(1, 'B_right', le) - 1) < 1e-9);
    assert.ok(Math.abs(applyBarkEdgeCaseU(0, 'B_right', le) - (1 - le)) < 1e-9);
  });

  it('CASE C: interior face stays in grain mid-strip (no bark band)', () => {
    const le = 0.5;
    const lo = applyBarkEdgeCaseU(0, 'C', le);
    const hi = applyBarkEdgeCaseU(1, 'C', le);
    const mid = applyBarkEdgeCaseU(0.5, 'C', le);
    assert.ok(lo > BARK_EDGE_U_FRAC);
    assert.ok(hi < 1 - BARK_EDGE_U_FRAC);
    assert.ok(Math.abs(mid - 0.5) < 1e-9);
    // Entire span avoids bark rims.
    for (let t = 0; t <= 10; t++) {
      const u = applyBarkEdgeCaseU(t / 10, 'C', le);
      assert.ok(u >= BARK_EDGE_U_FRAC && u <= 1 - BARK_EDGE_U_FRAC, `u=${u}`);
    }
  });
});

describe('estimateChordCover', () => {
  it('clamps face/full to [0,1]', () => {
    assert.equal(estimateChordCover(1, 2), 0.5);
    assert.equal(estimateChordCover(3, 2), 1);
    assert.equal(estimateChordCover(0, 2), 0);
  });
});

describe('hasReclassifiedInnerSlot', () => {
  const bark = { id: 'bark' };
  const end = { id: 'end' };
  const inner = { id: 'inner' };

  it('fresh cylinder [bark, end, end] is NOT an inner slot', () => {
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
  it('seals sparse fills; skips only when dense + very high coverage', () => {
    assert.equal(shouldSealCutFace(0), true);
    assert.equal(shouldSealCutFace(7), true);
    assert.equal(shouldSealCutFace(15), true);
    assert.equal(shouldSealCutFace(30), true);
    assert.equal(shouldSealCutFace(60), false);
    assert.equal(shouldSealCutFace(60, 0.5), true);
    assert.equal(shouldSealCutFace(20, 0.97), false);
    assert.equal(shouldSealCutFace(20, 0.9), true);
  });
});

describe('cutFaceCoverageRatio', () => {
  it('flags sparse fill as a hole', () => {
    assert.ok(cutFaceCoverageRatio(0.02, 0.12) < 0.85);
    assert.ok(cutFaceCoverageRatio(0.12, 0.12) >= 0.99);
  });
});

describe('cutTriAreaInPlane', () => {
  it('returns half base×height for axis-aligned right triangle', () => {
    const a = cutTriAreaInPlane(
      0, 0, 0,
      2, 0, 0,
      0, 0, 2,
      1, 0, 0,
      0, 0, 1,
    );
    assert.ok(Math.abs(a - 2) < 1e-9);
  });
});
