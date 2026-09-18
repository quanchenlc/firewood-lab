/**
 * Unit tests for cut-face classification + aspect-correct UV helpers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aspectCorrectUv,
  classifyFaceNormal,
  projectionSpan,
} from './cut-face.ts';

describe('classifyFaceNormal', () => {
  const plane = { x: 1, y: 0, z: 0 };

  it('caps (|ny| high) → endgrain', () => {
    assert.equal(classifyFaceNormal({ x: 0, y: 1, z: 0 }, plane), 'endgrain');
    assert.equal(classifyFaceNormal({ x: 0.1, y: -0.95, z: 0 }, plane), 'endgrain');
  });

  it('faces aligned with cleave normal → inner', () => {
    assert.equal(classifyFaceNormal({ x: 1, y: 0, z: 0 }, plane), 'inner');
    assert.equal(classifyFaceNormal({ x: -0.9, y: 0.1, z: 0.1 }, plane), 'inner');
  });

  it('radial bark sides → bark', () => {
    assert.equal(classifyFaceNormal({ x: 0, y: 0, z: 1 }, plane), 'bark');
    assert.equal(classifyFaceNormal({ x: 0.2, y: 0.1, z: 0.95 }, plane), 'bark');
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
