import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AZIMUTH_NUDGE_DAMP,
  BOUNCE_DURATION_MS,
  BOUNCE_POP_HEIGHT,
  cleaveNormalXZ,
  cleaveNormalFromCameraFacing,
  rotateCleaveNormal90,
  advanceOrientChopCount,
  CHOPS_BEFORE_ORIENT_ROTATE,
  FACE_GAP_DIAMETER_FRAC,
  FIREWOOD_ASPECT_RESCUE,
  FIREWOOD_VOL_ABS_MIN,
  FIREWOOD_VOL_MAX,
  INCH,
  MIN_SPLIT_THICKNESS_IN,
  RING_PILE_ARC_SPAN,
  RING_PILE_RADIUS,
  RING_PILE_START_ANGLE,
  RING_PILE_TIER_DEPTH,
  TIP_DROP_ANGLE_DEG,
  TIP_DROP_ARC_HEIGHT,
  TIP_DROP_DURATION_MS,
  TIP_DROP_REST_RADIAL,
  TIP_DROP_REST_RADIAL_JIT,
  TIP_DROP_SCATTER_RADIAL,
  azimuthNudgeVelocity,
  horizontalAspectFromSize,
  horizontalAspectXZ,
  decideTooThinChop,
  isFirewoodByVolumeAspect,
  isFirewoodChip,
  isRechopWorthy,
  isTooThinToSplit,
  lateralOffsetFromDiameter,
  normalizePushXZ,
  planFracture,
  planRingPileSlots,
  sampleTipDropPose,
  shouldTossOnTooThin,
  thicknessInchesAlong,
  tipDropRestPose,
  volumeInchesFromBBox,
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

  it('sweet is a clean 2-way cleave with modest face-gap frac', () => {
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
    // Modest crack: face gap ≈ 0.15–0.25× log diameter (wedgeGap stores the fraction).
    assert.ok(Math.abs(p.wedgeGap - FACE_GAP_DIAMETER_FRAC) < 1e-9);
    assert.ok(p.wedgeGap >= 0.15 && p.wedgeGap <= 0.25);
    assert.ok(Math.abs(p.popHeight - BOUNCE_POP_HEIGHT) < 1e-9);
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

describe('lateralOffsetFromDiameter', () => {
  it('splits face-gap frac across both halves', () => {
    // diameter 0.8, gap 0.2 → each side 0.08
    assert.ok(Math.abs(lateralOffsetFromDiameter(0.8, 0.2) - 0.08) < 1e-9);
  });
});

describe('cleaveNormalFromCameraFacing', () => {
  it('returns a unit normal perpendicular to horizontal facing', () => {
    // Facing +Z → normal along ±X
    const [nx, nz] = cleaveNormalFromCameraFacing(0, 1);
    assert.ok(Math.abs(Math.hypot(nx, nz) - 1) < 1e-9);
    assert.ok(Math.abs(Math.abs(nx) - 1) < 1e-9);
    assert.ok(Math.abs(nz) < 1e-9);
  });

  it('falls back when facing is vertical-degenerate', () => {
    const [nx, nz] = cleaveNormalFromCameraFacing(0, 0);
    assert.ok(Math.abs(Math.hypot(nx, nz) - 1) < 1e-9);
  });

  it('orbit facing change must not reuse a stale locked normal', () => {
    // Simulate: first chop used facing +Z; user then orbits to look +X.
    const locked = cleaveNormalFromCameraFacing(0, 1);
    const liveAfterOrbit = cleaveNormalFromCameraFacing(1, 0);
    const same =
      Math.abs(locked[0] - liveAfterOrbit[0]) < 1e-9 &&
      Math.abs(locked[1] - liveAfterOrbit[1]) < 1e-9;
    assert.equal(
      same,
      false,
      'live camera facing after orbit must recompute a different cleave normal',
    );
    // Dot ≈ 0 → perpendicular families (vertical cut vs horizontal cut on screen).
    assert.ok(Math.abs(locked[0] * liveAfterOrbit[0] + locked[1] * liveAfterOrbit[1]) < 1e-9);
  });
});

describe('rotateCleaveNormal90 / advanceOrientChopCount', () => {
  it('rotates 90° CCW', () => {
    const [nx, nz] = rotateCleaveNormal90(1, 0);
    assert.ok(Math.abs(nx) < 1e-9);
    assert.ok(Math.abs(nz - 1) < 1e-9);
  });

  it('rotates after CHOPS_BEFORE_ORIENT_ROTATE successes', () => {
    let count = 0;
    let nx = 1;
    let nz = 0;
    let rotated = false;
    for (let i = 0; i < CHOPS_BEFORE_ORIENT_ROTATE - 1; i++) {
      const r = advanceOrientChopCount(count, nx, nz);
      count = r.count;
      nx = r.nx;
      nz = r.nz;
      rotated = r.rotated;
      assert.equal(rotated, false);
    }
    const last = advanceOrientChopCount(count, nx, nz);
    assert.equal(last.rotated, true);
    assert.equal(last.count, 0);
    assert.ok(Math.abs(last.nx) < 1e-9);
    assert.ok(Math.abs(last.nz - 1) < 1e-9);
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
  it('rejects tiny pieces; keeps large-volume pieces choppable past gen cap', () => {
    assert.equal(isRechopWorthy(0.2, 0), false);
    assert.equal(isRechopWorthy(0.5, 5), false);
    assert.equal(isRechopWorthy(0.5, 2), true);
    assert.equal(isRechopWorthy(0.5, 0), true);
    // vol > 500 → still splittable even at high generation
    assert.equal(isRechopWorthy(0.5, 8, FIREWOOD_VOL_MAX + 10), true);
    // rescued mid-volume also stays choppable
    assert.equal(isRechopWorthy(0.5, 8, 400), true);
  });
});

describe('volume / aspect firewood gate', () => {
  it('volumeInchesFromBBox uses fill × / INCH³', () => {
    // 0.1³ m × 0.7 / 0.0254³ ≈ 42.73 in³
    const v = volumeInchesFromBBox(0.1, 0.1, 0.1);
    assert.ok(Math.abs(v - 42.73) < 0.1);
  });

  it('isFirewoodByVolumeAspect matches reference thresholds', () => {
    // ≤250 → always firewood
    assert.equal(isFirewoodByVolumeAspect(FIREWOOD_VOL_ABS_MIN, 10), true);
    assert.equal(isFirewoodByVolumeAspect(100, 1), true);
    // (250, 500] + aspect ≤ 3 → firewood
    assert.equal(isFirewoodByVolumeAspect(400, FIREWOOD_ASPECT_RESCUE), true);
    assert.equal(isFirewoodByVolumeAspect(400, 2), true);
    // (250, 500] + aspect > 3 → rescue (stay)
    assert.equal(isFirewoodByVolumeAspect(400, 3.1), false);
    // >500 → stay
    assert.equal(isFirewoodByVolumeAspect(FIREWOOD_VOL_MAX + 1, 1), false);
  });

  it('keeps large half-log on stump; tiny cube becomes firewood', () => {
    // Half cylinder-ish: ~0.4 × 0.7 × 0.4 → thousands of in³
    assert.equal(isFirewoodChip(0.4, 0.7, 0.4), false);
    // ~0.08³ m × 0.7 ≈ 219 in³ ≤ 250 → firewood
    assert.equal(isFirewoodChip(0.08, 0.08, 0.08), true);
  });

  it('rescues slender mid-volume pieces via horizontalAspectXZ', () => {
    // Elongated in X, thin in Z → high aspect
    const xs = [-0.2, 0.2, -0.2, 0.2];
    const zs = [-0.03, -0.03, 0.03, 0.03];
    const aspect = horizontalAspectXZ(xs, zs);
    assert.ok(aspect > FIREWOOD_ASPECT_RESCUE);
    assert.equal(horizontalAspectFromSize(0.4, 0.06) > 3, true);
  });
});

describe('too-thin / azimuth nudge', () => {
  it('flags thickness under Xu*2 = 5 inches', () => {
    assert.equal(MIN_SPLIT_THICKNESS_IN, 5);
    assert.equal(isTooThinToSplit(4.9), true);
    assert.equal(isTooThinToSplit(5), false);
    assert.ok(Math.abs(thicknessInchesAlong(5 * 0.0254) - 5) < 1e-9);
  });

  it('azimuth nudge velocity integrates to ~±90° under damping', () => {
    const v0 = azimuthNudgeVelocity(1);
    let yaw = 0;
    let v = v0;
    for (let i = 0; i < 200; i++) {
      yaw += v;
      v *= AZIMUTH_NUDGE_DAMP;
    }
    assert.ok(Math.abs(yaw - Math.PI / 2) < 1e-6);
    assert.ok(azimuthNudgeVelocity(-1) < 0);
  });
});

describe('option A decideTooThinChop', () => {
  it('thick enough along current dir → chop', () => {
    assert.equal(
      decideTooThinChop({
        currentThicknessIn: 6,
        perpThicknessIn: 4,
        alreadyFirewood: true,
      }),
      'chop',
    );
  });

  it('both horizontal dirs too thin → toss', () => {
    assert.equal(
      decideTooThinChop({
        currentThicknessIn: 4,
        perpThicknessIn: 4.5,
        alreadyFirewood: false,
      }),
      'toss',
    );
    assert.equal(
      shouldTossOnTooThin({ otherDirTooThin: true, alreadyFirewood: false }),
      true,
    );
  });

  it('already firewood-sized → toss even if perp still thick', () => {
    assert.equal(
      decideTooThinChop({
        currentThicknessIn: 3,
        perpThicknessIn: 8,
        alreadyFirewood: true,
      }),
      'toss',
    );
    assert.equal(
      shouldTossOnTooThin({ otherDirTooThin: false, alreadyFirewood: true }),
      true,
    );
  });

  it('only current dir thin + not firewood → yaw', () => {
    assert.equal(
      decideTooThinChop({
        currentThicknessIn: 4,
        perpThicknessIn: 8,
        alreadyFirewood: false,
      }),
      'yaw',
    );
    assert.equal(
      shouldTossOnTooThin({ otherDirTooThin: false, alreadyFirewood: false }),
      false,
    );
  });
});

describe('tipDropRestPose / sampleTipDropPose', () => {
  it('rest radial stays beside stump (≥0.42) and never pulls inward', () => {
    const rest = tipDropRestPose({
      fromX: 0.12,
      fromZ: 0,
      dirX: 1,
      dirZ: 0,
      restHalfHeight: 0.06,
      restRadial: TIP_DROP_REST_RADIAL,
      restRadialJit: TIP_DROP_REST_RADIAL_JIT,
      rnd: 0,
    });
    assert.ok(rest.restRadial >= TIP_DROP_REST_RADIAL);
    assert.ok(rest.toX >= 0.42);
    assert.ok(Math.abs(rest.toZ) < 1e-9);
    assert.ok(rest.toY >= 0.04);
  });

  it('sample is continuous from→to with outward tip and soft mid arc', () => {
    const start = sampleTipDropPose({
      u: 0,
      fromX: 0.1,
      fromY: 0.5,
      fromZ: 0,
      toX: 0.6,
      toY: 0.08,
      toZ: 0,
      tipRad: Math.PI / 2,
      arcHeight: TIP_DROP_ARC_HEIGHT,
    });
    assert.ok(Math.abs(start.x - 0.1) < 1e-9);
    assert.ok(Math.abs(start.tipRad) < 1e-9);

    const mid = sampleTipDropPose({
      u: 0.5,
      fromX: 0.1,
      fromY: 0.5,
      fromZ: 0,
      toX: 0.6,
      toY: 0.08,
      toZ: 0,
      tipRad: Math.PI / 2,
      arcHeight: TIP_DROP_ARC_HEIGHT,
    });
    assert.ok(mid.x > 0.1 && mid.x < 0.6);
    assert.ok(mid.tipRad > 0 && mid.tipRad < Math.PI / 2);
    // Soft arc lifts mid Y above the pure lerp.
    const lerpY = 0.5 + (0.08 - 0.5) * mid.ease;
    assert.ok(mid.y > lerpY);

    const end = sampleTipDropPose({
      u: 1,
      fromX: 0.1,
      fromY: 0.5,
      fromZ: 0,
      toX: 0.6,
      toY: 0.08,
      toZ: 0,
      tipRad: Math.PI / 2,
      arcHeight: TIP_DROP_ARC_HEIGHT,
    });
    assert.ok(Math.abs(end.x - 0.6) < 1e-9);
    assert.ok(Math.abs(end.y - 0.08) < 1e-9);
    assert.ok(Math.abs(end.tipRad - Math.PI / 2) < 1e-9);
  });

  it('normalizePushXZ falls back when degenerate', () => {
    const n = normalizePushXZ(0, 0, 0);
    assert.ok(Math.abs(n.ox - 1) < 1e-9);
    assert.ok(Math.abs(n.oz) < 1e-9);
  });

  it('tip-drop duration/angle constants stay in a natural short-settle band', () => {
    assert.ok(TIP_DROP_DURATION_MS >= 280 && TIP_DROP_DURATION_MS <= 420);
    assert.ok(TIP_DROP_ANGLE_DEG >= 60 && TIP_DROP_ANGLE_DEG <= 95);
    assert.ok(TIP_DROP_REST_RADIAL >= 0.55 && TIP_DROP_REST_RADIAL <= 0.85);
    assert.ok(TIP_DROP_SCATTER_RADIAL > TIP_DROP_REST_RADIAL);
  });
});

describe('planRingPileSlots (reference FirewoodPile arc)', () => {
  it('matches reference radius / arc constants (60×ld, 320°, 230°)', () => {
    assert.ok(Math.abs(RING_PILE_RADIUS - 60 * INCH) < 1e-12);
    assert.ok(Math.abs(RING_PILE_START_ANGLE - (320 * Math.PI) / 180) < 1e-12);
    assert.ok(Math.abs(RING_PILE_ARC_SPAN - (230 * Math.PI) / 180) < 1e-12);
    assert.ok(Math.abs(RING_PILE_TIER_DEPTH - 18 * INCH) < 1e-12);
  });

  it('places a neat annular band clear of the stump top', () => {
    const halves = Array.from({ length: 10 }, () => 0.05);
    const rnds = Array.from({ length: 20 }, () => 0.5);
    const slots = planRingPileSlots(10, { halfHeights: halves, halfWidths: halves, rnds });
    assert.equal(slots.length, 10);

    const stumpR = 0.32;
    const radii = slots.map((s) => Math.hypot(s.x, s.z));
    const minR = Math.min(...radii);
    const maxR = Math.max(...radii);
    assert.ok(minR > stumpR + 0.5, `ring must clear stump, minR=${minR}`);
    // Tight annular band (not a messy scatter).
    assert.ok(maxR - minR < 0.15, `expected neat band, spread=${maxR - minR}`);

    // Packed along arc — consecutive angular gaps roughly match piece width / R.
    const angs = slots.map((s) => s.yaw);
    for (let i = 1; i < angs.length; i++) {
      const gap = angs[i]! - angs[i - 1]!;
      assert.ok(gap > 0.04 && gap < 0.12, `packed gap=${gap}`);
    }

    // No piece on stump top (y is ground-level half-thickness).
    for (const s of slots) {
      assert.ok(s.y < 0.2, `y=${s.y} looks like stump height`);
      assert.ok(s.y > 0.04);
      assert.equal(s.tier, 0);
    }
  });

  it('overflow spills to outer tier (larger radius)', () => {
    // Narrow arc + wide pieces → forces a second tier quickly.
    const n = 8;
    const slots = planRingPileSlots(n, {
      arcSpan: 0.6,
      halfHeights: Array.from({ length: n }, () => 0.06),
      halfWidths: Array.from({ length: n }, () => 0.08),
      rnds: Array.from({ length: n * 2 }, () => 0.5),
    });
    const tier0 = slots.filter((s) => s.tier === 0);
    const tier1 = slots.filter((s) => s.tier === 1);
    assert.ok(tier0.length >= 1);
    assert.ok(tier1.length >= 1, 'expected overflow to outer tier');
    const r0 = Math.hypot(tier0[0]!.x, tier0[0]!.z);
    const r1 = Math.hypot(tier1[0]!.x, tier1[0]!.z);
    assert.ok(r1 > r0 + RING_PILE_TIER_DEPTH * 0.5);
  });
});
