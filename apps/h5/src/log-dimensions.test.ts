/**
 * Guard: choppable round stays small enough for FIREWOOD_VOL_* gates
 * (thresholds live in game-core and must not be raised to compensate).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAM_LOOK_AT_Y,
  CAM_RADIUS,
  LOG_HEIGHT,
  LOG_RADIUS_BOT,
  LOG_RADIUS_TOP,
  STUMP_HEIGHT,
  STUMP_TOP_RADIUS,
  logAabbSize,
} from './log-dimensions.ts';

/** Mirror of game-core `volumeInchesFromBBox` / VOLUME_BBOX_FILL / INCH (gates unchanged). */
const INCH = 0.0254;
const VOLUME_BBOX_FILL = 0.7;
const FIREWOOD_VOL_MAX = 500;

function volumeInchesFromBBox(x: number, y: number, z: number): number {
  return (x * y * z * VOLUME_BBOX_FILL) / (INCH * INCH * INCH);
}

describe('log-dimensions (firewood-scale round)', () => {
  it('full-log AABB×0.7 volume is low thousands in³ (not ~19k)', () => {
    const { x, y, z } = logAabbSize();
    const vol = volumeInchesFromBBox(x, y, z);
    assert.ok(vol > 1500 && vol < 4000, `expected ~2–3k in³, got ${vol.toFixed(0)}`);
    // Document equal-bipartition path to ≤500 under unchanged gates.
    assert.ok(vol / 8 <= FIREWOOD_VOL_MAX, '8 equal pieces should reach ≤500 in³');
    assert.ok(vol / 16 <= FIREWOOD_VOL_MAX, '16 equal pieces should reach ≤500 in³');
  });

  it('round sits inside stump top with sensible first-person framing', () => {
    assert.ok(LOG_RADIUS_BOT < STUMP_TOP_RADIUS, 'log should not overhang stump top');
    assert.ok(LOG_RADIUS_TOP <= LOG_RADIUS_BOT);
    assert.ok(LOG_HEIGHT > 0.25 && LOG_HEIGHT < 0.5);
    assert.equal(CAM_LOOK_AT_Y, STUMP_HEIGHT + LOG_HEIGHT * 0.5);
    assert.ok(CAM_RADIUS > 2.5 && CAM_RADIUS < 4.0);
  });
});
