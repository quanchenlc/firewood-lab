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
  STUMP_BOT_RADIUS,
  barkNoise,
  camLookAtY,
  defaultLogRound,
  logAabbSize,
  planSilhouetteScale,
  radialBarkOffsetMetres,
  sampleLogRound,
  samplePlanRadii,
  applyRandomMantleUOffset,
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

  it('chopping-block stump is stockier than tall (top < bot, height ~ half diameter)', () => {
    assert.ok(STUMP_TOP_RADIUS < STUMP_BOT_RADIUS, 'top should taper in vs bottom');
    assert.ok(STUMP_BOT_RADIUS - STUMP_TOP_RADIUS >= 0.04);
    const avgD = STUMP_TOP_RADIUS + STUMP_BOT_RADIUS;
    // height / avg diameter roughly ≤ 0.55 (stocky chopping block, not a post).
    assert.ok(STUMP_HEIGHT / avgD <= 0.55, `expected stocky H/D, got ${STUMP_HEIGHT / avgD}`);
    assert.ok(STUMP_HEIGHT >= 0.28 && STUMP_HEIGHT <= 0.85);
  });

  it('sampleLogRound matches tuned inch ranges (5.5–9 r, 13.5–17.5 h)', () => {
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
      // Leave margin for bark / plan silhouette so the round does not overhang.
      assert.ok(d.radiusBot * 1.35 + BARK_AMP_IN * INCH < STUMP_TOP_RADIUS);
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
    assert.ok(min > 0.7 && max < 1.35);
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
    assert.ok(ratio > 1.12, `expected imperfect circle ratio, got ${ratio.toFixed(3)}`);
    assert.ok(ratio < 1.65, `should stay stump-like, got ${ratio.toFixed(3)}`);
    // Cap-rim bark offset is non-zero (reference displaces rim verts).
    assert.notEqual(radialBarkOffsetMetres(0.3, 1, dims.barkSeed), 0);
  });

  it('stump outline does not explode closed-cylinder cap interiors', () => {
    // Regression (#26): additive bark/radial on near-axis cap verts → giant pancake.
    const topR = STUMP_TOP_RADIUS;
    const botR = STUMP_BOT_RADIUS;
    const h = STUMP_HEIGHT;
    const seed = 41;
    const ampIn = 0.3;
    let maxTopR = 0;
    let maxBotR = 0;
    // Mimic applyStumpOutlineIrregularity edge fade on cap samples (incl. near-axis).
    for (let ring = 1; ring <= 10; ring++) {
      const frac = ring / 10;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        for (const [y, refR, sink] of [
          [h * 0.5, topR, (r: number) => { maxTopR = Math.max(maxTopR, r); }],
          [-h * 0.5, botR, (r: number) => { maxBotR = Math.max(maxBotR, r); }],
        ] as const) {
          const radial = refR * frac;
          if (radial < 1e-4) continue;
          const heightFrac = Math.max(0, Math.min(1, (y + h * 0.5) / h));
          const plan = planSilhouetteScale(a, seed + 9);
          const bark = radialBarkOffsetMetres(a, heightFrac, seed, ampIn);
          const edge = Math.min(1, radial / Math.max(refR * 0.85, 1e-6));
          const targetR = radial * plan + bark * edge;
          sink(targetR);
        }
      }
    }
    assert.ok(maxTopR < topR * 1.55, `top cap exploded: ${maxTopR} vs ${topR}`);
    assert.ok(maxBotR < botR * 1.55, `bot cap exploded: ${maxBotR} vs ${botR}`);
  });
});

describe('applyRandomMantleUOffset', () => {
  it('offsets side-group U only; leaves cap verts untouched', () => {
    // Minimal fake: side indices 0,1,2 ; cap indices 3,4,5
    const u = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const geo = {
      groups: [
        { start: 0, count: 3, materialIndex: 0 },
        { start: 3, count: 3, materialIndex: 1 },
      ],
      index: { getX(i: number) { return i; } },
      getAttribute(name: string) {
        if (name !== 'uv') return undefined;
        return {
          count: u.length,
          getX(i: number) { return u[i]!; },
          setX(i: number, x: number) { u[i] = x; },
          needsUpdate: false,
        };
      },
    };
    const off = applyRandomMantleUOffset(geo, 0.25);
    assert.equal(off, 0.25);
    assert.ok(Math.abs(u[0]! - 0.35) < 1e-9);
    assert.ok(Math.abs(u[1]! - 0.45) < 1e-9);
    assert.ok(Math.abs(u[2]! - 0.55) < 1e-9);
    assert.equal(u[3], 0.4);
    assert.equal(u[4], 0.5);
    assert.equal(u[5], 0.6);
  });
});
