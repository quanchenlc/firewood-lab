/**
 * Guard: choppable round stays small enough for FIREWOOD_VOL_* gates
 * (thresholds live in game-core and must not be raised to compensate).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BARK_AMP_IN,
  CAM_LOOK_AT_Y,
  CAM_RADIUS,
  INCH,
  LOG_HEIGHT,
  LOG_HEIGHT_IN_MAX,
  LOG_HEIGHT_IN_MIN,
  LOG_RADIUS_BOT,
  LOG_RADIUS_IN_MAX,
  LOG_RADIUS_IN_MIN,
  LOG_RADIUS_TOP,
  PLAN_ELLIPSE_AMP,
  PLAN_LOBE3_AMP,
  STUMP_HEIGHT,
  STUMP_TOP_RADIUS,
  barkNoise,
  camLookAtY,
  defaultLogRound,
  logAabbSize,
  planSilhouetteScale,
  radialBarkOffsetMetres,
  sampleLogRound,
  samplePlanRadii,
  type LogRoundDims,
} from './log-dimensions.ts';

/** Mirror of game-core `volumeInchesFromBBox` / VOLUME_BBOX_FILL / INCH (gates unchanged). */
const VOLUME_BBOX_FILL = 0.7;
const FIREWOOD_VOL_MAX = 500;

function volumeInchesFromBBox(x: number, y: number, z: number): number {
  return (x * y * z * VOLUME_BBOX_FILL) / (INCH * INCH * INCH);
}

function aabbVol(dims: LogRoundDims): number {
  const { x, y, z } = logAabbSize(dims);
  return volumeInchesFromBBox(x, y, z);
}

/** Deterministic LCG for reproducible sample sweeps. */
function lcg(seed: number): () => number {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 0xffffffff;
  };
}

describe('log-dimensions (firewood-scale round)', () => {
  it('default mid-round AABB×0.7 volume is low thousands in³ (not ~19k)', () => {
    const { x, y, z } = logAabbSize();
    const vol = volumeInchesFromBBox(x, y, z);
    assert.ok(vol > 1500 && vol < 4000, `expected ~2–3k in³, got ${vol.toFixed(0)}`);
    assert.ok(vol / 8 <= FIREWOOD_VOL_MAX, '8 equal pieces should reach ≤500 in³');
    assert.ok(vol / 16 <= FIREWOOD_VOL_MAX, '16 equal pieces should reach ≤500 in³');
  });

  it('round sits inside stump top with sensible first-person framing', () => {
    assert.ok(LOG_RADIUS_BOT < STUMP_TOP_RADIUS, 'log should not overhang stump top');
    assert.ok(LOG_RADIUS_TOP <= LOG_RADIUS_BOT);
    assert.ok(LOG_HEIGHT > 0.25 && LOG_HEIGHT < 0.5);
    assert.equal(CAM_LOOK_AT_Y, STUMP_HEIGHT + LOG_HEIGHT * 0.5);
    assert.ok(CAM_RADIUS > 2.4 && CAM_RADIUS < 3.6);
  });

  it('sampleLogRound matches reference inch ranges (4.5–8 r, 12–16 h)', () => {
    const rand = lcg(0xc0ffee41);
    for (let i = 0; i < 64; i++) {
      const d = sampleLogRound(rand);
      const rIn = d.radiusBot / INCH;
      const hIn = d.height / INCH;
      assert.ok(rIn >= LOG_RADIUS_IN_MIN - 1e-9 && rIn <= LOG_RADIUS_IN_MAX + 1e-9, `r=${rIn}`);
      assert.ok(hIn >= LOG_HEIGHT_IN_MIN - 1e-9 && hIn <= LOG_HEIGHT_IN_MAX + 1e-9, `h=${hIn}`);
      assert.ok(d.radiusTop <= d.radiusBot + 1e-12);
      assert.ok(d.radiusTop >= d.radiusBot * 0.88 - 1e-9);
      assert.ok(d.radiusBot < STUMP_TOP_RADIUS, 'sampled bot radius must fit stump');
    }
  });

  it('sampled rounds stay in a workable firewood AABB volume band', () => {
    const rand = lcg(42);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 128; i++) {
      const vol = aabbVol(sampleLogRound(rand));
      min = Math.min(min, vol);
      max = Math.max(max, vol);
      // Stay well under the old giant (~19k) and above a useless pebble.
      assert.ok(vol > 500 && vol < 4500, `vol=${vol.toFixed(0)}`);
      assert.ok(vol / 8 <= FIREWOOD_VOL_MAX * 1.05, '≈8 chops still reach firewood gate');
    }
    // Variety: not a single fixed cylinder.
    assert.ok(max - min > 400, `expected spread, got ${min.toFixed(0)}..${max.toFixed(0)}`);
  });

  it('camLookAtY tracks stump top + half height', () => {
    const d = defaultLogRound();
    assert.equal(camLookAtY(d, STUMP_HEIGHT), STUMP_HEIGHT + d.height * 0.5);
    assert.equal(camLookAtY(d, 0.5), 0.5 + d.height * 0.5);
  });

  it('barkNoise is bounded and seed-sensitive (reference rw style)', () => {
    assert.ok(Math.abs(barkNoise(0, 0)) <= 1.01);
    assert.ok(Math.abs(barkNoise(1.7, 42)) <= 1.01);
    assert.notEqual(barkNoise(1.2, 1), barkNoise(1.2, 2));
    assert.ok(BARK_AMP_IN > 0 && BARK_AMP_IN < 1);
  });

  it('plan silhouette is imperfect — not a constant circle', () => {
    const scales = [0, 0.4, 1.1, 2.0, 3.3, 4.5].map((a) => planSilhouetteScale(a, 12));
    const min = Math.min(...scales);
    const max = Math.max(...scales);
    assert.ok(max - min > 0.08, `expected visible ellipse/lobe spread, got ${min}..${max}`);
    assert.ok(PLAN_ELLIPSE_AMP > 0 && PLAN_LOBE3_AMP > 0);
    // Still roughly round (not a wild star).
    assert.ok(min > 0.75 && max < 1.25);
  });

  it('samplePlanRadii shows organic outline (max/min > 1.08)', () => {
    const dims = { ...defaultLogRound(), barkSeed: 77 };
    // Unit circle samples at mid-height.
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push({
        x: Math.cos(a) * dims.radiusBot,
        y: 0,
        z: Math.sin(a) * dims.radiusBot,
      });
    }
    const { min, max, ratio } = samplePlanRadii(pts, dims);
    assert.ok(min > 0 && max > min);
    assert.ok(ratio > 1.08, `expected imperfect circle ratio, got ${ratio.toFixed(3)}`);
    assert.ok(ratio < 1.45, `should stay stump-like, got ${ratio.toFixed(3)}`);
    // Cap-rim bark offset is non-zero (reference displaces rim verts).
    assert.notEqual(radialBarkOffsetMetres(0.3, 1, dims.barkSeed), 0);
  });
});
