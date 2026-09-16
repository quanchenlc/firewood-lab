import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOUNCE_DISTANCE_INCHES,
  BOUNCE_DURATION_MS,
  BOUNCE_POP_HEIGHT_INCHES,
  cleaveNormalXZ,
  INCH,
  isFirewoodChip,
  isRechopWorthy,
  planFracture,
} from './fracture-plan.ts';

describe('planFracture', () => {
  it('too_light is nick-only with zero fragments', () => {
    const p = planFracture({ outcome: 'too_light' });
    assert.equal(p.fragmentCount, 0);
    assert.equal(p.nickOnly, true);
    assert.equal(p.messy, false);
    assert.equal(p.splitStyle, 'nick');
    assert.equal(p.wedgeGap, 0);
    assert.equal(p.popHeight, 0);
  });

  it('sweet is a clean 2-way directional cleave with ~1 inch bounce', () => {
    const p = planFracture({
      outcome: 'sweet',
      axe: { weight: 0.5, edge: 0.6 },
    });
    assert.equal(p.fragmentCount, 2);
    assert.equal(p.nickOnly, false);
    assert.equal(p.messy, false);
    assert.equal(p.splitStyle, 'cleave');
    assert.ok(p.impulse > 0);
    assert.ok(p.impulse < 0.35, 'sweet impulse stays a wedged nudge, not a burst');
    // Reference: distanceInches=1 → ld=0.0254 m per side
    assert.ok(Math.abs(p.wedgeGap - BOUNCE_DISTANCE_INCHES * INCH) < 1e-9);
    assert.ok(Math.abs(p.popHeight - BOUNCE_POP_HEIGHT_INCHES * INCH) < 1e-9);
    assert.equal(p.bounceMs, BOUNCE_DURATION_MS);
  });

  it('too_heavy is messier with more fragments than sweet, still cleave', () => {
    const axe = { weight: 0.7, edge: 0.85 };
    const sweet = planFracture({ outcome: 'sweet', axe });
    const heavy = planFracture({ outcome: 'too_heavy', axe });
    assert.ok(heavy.fragmentCount >= sweet.fragmentCount);
    assert.ok(heavy.impulse > sweet.impulse);
    assert.ok(heavy.wedgeGap > sweet.wedgeGap);
    assert.equal(heavy.messy, true);
    assert.equal(heavy.splitStyle, 'cleave_messy');
    assert.ok(heavy.impulse < 0.45, 'heavy still not a fireworks dump');
    assert.ok(heavy.fragmentCount <= 3);
  });

  it('weakDevice caps fragment count', () => {
    const p = planFracture({
      outcome: 'too_heavy',
      weakDevice: true,
      axe: { weight: 1, edge: 1 },
    });
    assert.ok(p.fragmentCount <= 6);
  });

  it('later generations reduce heavy fragment budget', () => {
    const g0 = planFracture({ outcome: 'too_heavy', generation: 0 });
    const g1 = planFracture({ outcome: 'too_heavy', generation: 1 });
    assert.ok(g1.fragmentCount <= g0.fragmentCount);
  });
});

describe('cleaveNormalXZ', () => {
  it('returns a unit normal perpendicular to the radial in XZ', () => {
    const [nx, nz] = cleaveNormalXZ(1, 0, 0, 0);
    assert.ok(Math.abs(Math.hypot(nx, nz) - 1) < 1e-9);
    // radial = (1,0) → normal = (0,1) or (0,-1) depending on cross convention
    assert.ok(Math.abs(nx) < 1e-9);
    assert.ok(Math.abs(Math.abs(nz) - 1) < 1e-9);
  });

  it('falls back when aim is on the axis', () => {
    const [nx, nz] = cleaveNormalXZ(0, 0, 0, 0);
    assert.ok(Math.abs(Math.hypot(nx, nz) - 1) < 1e-9);
  });
});

describe('isRechopWorthy', () => {
  it('rejects tiny or over-generated pieces', () => {
    assert.equal(isRechopWorthy(0.2, 0), false);
    assert.equal(isRechopWorthy(0.5, 5), false);
    assert.equal(isRechopWorthy(0.5, 2), true);
    assert.equal(isRechopWorthy(0.5, 0), true);
  });
});

describe('isFirewoodChip', () => {
  it('keeps upright half-log proportions on the stump', () => {
    // Half cylinder-ish: ~0.4 × 0.7 × 0.4
    assert.equal(isFirewoodChip(0.4, 0.7, 0.4), false);
  });

  it('flags tiny chips and pancake flakes as firewood', () => {
    assert.equal(isFirewoodChip(0.08, 0.05, 0.08), true);
    assert.equal(isFirewoodChip(0.5, 0.08, 0.4), true);
  });
});
