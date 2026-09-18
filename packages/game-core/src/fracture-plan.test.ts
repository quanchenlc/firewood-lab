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
  RING_PILE_SLOT_WIDTH,
  RING_PILE_MAX_STACK_H,
  RING_PILE_RADIAL_JIT,
  TIP_DROP_ANGLE_DEG,
  TIP_DROP_ANGLE_JIT_DEG,
  TIP_DROP_ANGLE_MIN_DEG,
  TIP_DROP_ANGLE_MAX_DEG,
  TIP_DROP_ARC_HEIGHT,
  TIP_DROP_DURATION_MS,
  TIP_DROP_DURATION_JIT_MS,
  TIP_DROP_REST_RADIAL,
  TIP_DROP_REST_RADIAL_JIT,
  TIP_DROP_REST_TANGENTIAL_JIT,
  TIP_DROP_HINGE_TANGENTIAL_JIT,
  TIP_DROP_PUSH_AZIMUTH_JIT_DEG,
  TIP_DROP_ROLL_JIT_DEG,
  TIP_DROP_YAW_JIT_DEG,
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
  appendRingPileSlots,
  createRingPileOccupancy,
  clearRingPileOccupancy,
  pickRingPileNextSlot,
  rotateOffsetAroundAxis,
  sampleTipDropPose,
  sampleTipDropAngleDeg,
  jitterPushAzimuthOutward,
  settlePositionY,
  shouldTossOnTooThin,
  thicknessInchesAlong,
  tipDropHingePoint,
  tipDropOutwardAxis,
  tipDropRestPose,
  volumeInchesFromBBox,
  YARD_GROUND_Y,
  GROUND_SETTLE_EPS,
  ringPileSimToWorldAxes,
  pickLocalGrainAxis,
  isCrossSectionXThinner,
  basisDeterminant,
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

  it('Package M: rest tangential offset sits perpendicular to push', () => {
    const rest = tipDropRestPose({
      fromX: 0.12,
      fromZ: 0,
      dirX: 1,
      dirZ: 0,
      restHalfHeight: 0.06,
      restRadial: TIP_DROP_REST_RADIAL,
      restRadialJit: 0,
      rnd: 0,
      restTangential: 0.06,
    });
    assert.ok(Math.abs(rest.toZ + 0.06) < 1e-9 || Math.abs(rest.toZ - 0.06) < 1e-9 || Math.abs(rest.toZ) > 0.05);
    // push=+X → tangent=(0,0,-1) for +tang? We use (oz, -ox)= (0,-1) for +tang on Z.
    // to = ox*R + oz*tang, oz*R - ox*tang → (R, -tang) for push +X.
    assert.ok(Math.abs(rest.toZ - -0.06) < 1e-9);
    assert.ok(rest.toX >= TIP_DROP_REST_RADIAL - 1e-6);
  });

  it('Package M: hinge tangential nudges hinge sideways', () => {
    const h = tipDropHingePoint({
      centerX: 0.28,
      centerY: 0.5,
      centerZ: 0,
      dirX: 1,
      dirZ: 0,
      bottomY: 0.34,
      halfX: 0.1,
      halfZ: 0.1,
      hingeTangential: 0.04,
    });
    assert.ok(Math.abs(h.hingeZ - -0.04) < 1e-9);
  });

  it('sampleTipDropAngleDeg stays in [70,90] with Package M jitter', () => {
    for (const rnd of [0, 0.5, 0.999]) {
      const a = sampleTipDropAngleDeg(rnd);
      assert.ok(a >= TIP_DROP_ANGLE_MIN_DEG && a <= TIP_DROP_ANGLE_MAX_DEG);
    }
    assert.equal(sampleTipDropAngleDeg(0.5), TIP_DROP_ANGLE_DEG);
  });

  it('jitterPushAzimuthOutward keeps outward hemisphere (dot>0)', () => {
    for (let i = 0; i < 20; i++) {
      const j = jitterPushAzimuthOutward(1, 0, TIP_DROP_PUSH_AZIMUTH_JIT_DEG, i / 20);
      assert.ok(j.ox * 1 + j.oz * 0 > 0, `got (${j.ox},${j.oz})`);
    }
  });

  it('Option B: hinge tip is continuous, outward, and has no mid-arc lift', () => {
    assert.equal(TIP_DROP_ARC_HEIGHT, 0);

    const hingeX = 0.2;
    const hingeY = 0.34;
    const hingeZ = 0;
    const fromX = 0.1;
    const fromY = 0.5;
    const fromZ = 0;
    const toX = 0.6;
    const toY = 0.08;
    const toZ = 0;
    const tipRad = Math.PI / 2;

    const start = sampleTipDropPose({
      u: 0,
      fromX,
      fromY,
      fromZ,
      toX,
      toY,
      toZ,
      tipRad,
      hingeX,
      hingeY,
      hingeZ,
      dirX: 1,
      dirZ: 0,
      arcHeight: TIP_DROP_ARC_HEIGHT,
    });
    assert.ok(Math.abs(start.x - fromX) < 1e-9);
    assert.ok(Math.abs(start.y - fromY) < 1e-9);
    assert.ok(Math.abs(start.tipRad) < 1e-9);

    const mid = sampleTipDropPose({
      u: 0.5,
      fromX,
      fromY,
      fromZ,
      toX,
      toY,
      toZ,
      tipRad,
      hingeX,
      hingeY,
      hingeZ,
      dirX: 1,
      dirZ: 0,
      arcHeight: TIP_DROP_ARC_HEIGHT,
    });
    assert.ok(mid.tipRad > 0 && mid.tipRad < tipRad);
    // Top tips with push (+X): mid center should move outward past start.
    assert.ok(mid.x > fromX);
    // Pure hinge — no CoM arc lift above the hinge-rotated path (arcHeight=0).
    const axis = tipDropOutwardAxis(1, 0);
    const midRot = rotateOffsetAroundAxis(
      fromX - hingeX,
      fromY - hingeY,
      fromZ - hingeZ,
      axis.ax,
      axis.ay,
      axis.az,
      mid.tipRad,
    );
    const endRot = rotateOffsetAroundAxis(
      fromX - hingeX,
      fromY - hingeY,
      fromZ - hingeZ,
      axis.ax,
      axis.ay,
      axis.az,
      tipRad,
    );
    const slideY = toY - (hingeY + endRot.y);
    const expectedY = hingeY + midRot.y + slideY * mid.ease;
    assert.ok(Math.abs(mid.y - expectedY) < 1e-9);

    const end = sampleTipDropPose({
      u: 1,
      fromX,
      fromY,
      fromZ,
      toX,
      toY,
      toZ,
      tipRad,
      hingeX,
      hingeY,
      hingeZ,
      dirX: 1,
      dirZ: 0,
      arcHeight: TIP_DROP_ARC_HEIGHT,
    });
    assert.ok(Math.abs(end.x - toX) < 1e-9);
    assert.ok(Math.abs(end.y - toY) < 1e-9);
    assert.ok(Math.abs(end.tipRad - tipRad) < 1e-9);
  });

  it('outward tip axis is tangential (cross up×push); +θ tips top with push', () => {
    const a = tipDropOutwardAxis(1, 0);
    assert.ok(Math.abs(a.ax) < 1e-9);
    assert.ok(Math.abs(a.ay) < 1e-9);
    assert.ok(Math.abs(a.az + 1) < 1e-9);
    // Hinge at outer edge; center inward+up → after +90° center is outward of hinge.
    const r = rotateOffsetAroundAxis(-0.1, 0.16, 0, a.ax, a.ay, a.az, Math.PI / 2);
    assert.ok(r.x > 0, `expected outward x, got ${r.x}`);
    assert.ok(r.y > 0);
  });

  it('tipDropHingePoint sits on bottom outer edge; inward chips soft-clamp to lip', () => {
    // Outer face already past the lip → hinge stays on the piece edge.
    const edge = tipDropHingePoint({
      centerX: 0.28,
      centerY: 0.5,
      centerZ: 0,
      dirX: 1,
      dirZ: 0,
      bottomY: 0.34,
      halfX: 0.1,
      halfZ: 0.1,
      stumpLipRadius: 0.34,
    });
    assert.ok(Math.abs(edge.hingeX - (0.28 + 0.1)) < 1e-9);
    assert.ok(Math.abs(edge.hingeY - 0.34) < 1e-9);

    const inward = tipDropHingePoint({
      centerX: 0.05,
      centerY: 0.5,
      centerZ: 0,
      dirX: 1,
      dirZ: 0,
      bottomY: 0.34,
      halfX: 0.06,
      halfZ: 0.06,
      stumpLipRadius: 0.34,
    });
    assert.ok(Math.abs(inward.hingeX - 0.34) < 1e-9);
    assert.ok(Math.abs(inward.hingeZ) < 1e-9);
  });

  it('normalizePushXZ falls back when degenerate', () => {
    const n = normalizePushXZ(0, 0, 0);
    assert.ok(Math.abs(n.ox - 1) < 1e-9);
    assert.ok(Math.abs(n.oz) < 1e-9);
  });

  it('tip-drop Package M constants stay in a natural short-settle band', () => {
    assert.ok(TIP_DROP_DURATION_MS >= 280 && TIP_DROP_DURATION_MS <= 420);
    assert.ok(TIP_DROP_DURATION_JIT_MS >= 150 && TIP_DROP_DURATION_JIT_MS <= 220);
    assert.ok(TIP_DROP_ANGLE_DEG >= 70 && TIP_DROP_ANGLE_DEG <= 90);
    assert.equal(TIP_DROP_ANGLE_JIT_DEG, 10);
    assert.equal(TIP_DROP_YAW_JIT_DEG, 22);
    assert.equal(TIP_DROP_ROLL_JIT_DEG, 10);
    assert.ok(TIP_DROP_REST_RADIAL >= 0.55 && TIP_DROP_REST_RADIAL <= 0.85);
    assert.ok(Math.abs(TIP_DROP_REST_RADIAL_JIT - 0.24) < 1e-9);
    assert.ok(Math.abs(TIP_DROP_REST_TANGENTIAL_JIT - 0.06) < 1e-9);
    assert.ok(Math.abs(TIP_DROP_HINGE_TANGENTIAL_JIT - 0.04) < 1e-9);
    assert.equal(TIP_DROP_PUSH_AZIMUTH_JIT_DEG, 12);
    assert.ok(TIP_DROP_SCATTER_RADIAL > TIP_DROP_REST_RADIAL);
    assert.equal(TIP_DROP_ARC_HEIGHT, 0);
  });
});

describe('settlePositionY (AABB-min ground settle)', () => {
  it('lifts origin so box.min sits on groundY + eps', () => {
    // Mesh origin above lowest point (typical tipped chip): min.y = -0.08 at y=0.12
    // → dy = 0 + 0.0015 - (-0.08) = 0.0815 → new min ≈ eps
    const dy = settlePositionY(-0.08, YARD_GROUND_Y);
    assert.ok(Math.abs(dy - (YARD_GROUND_Y + GROUND_SETTLE_EPS - -0.08)) < 1e-12);
    assert.ok(Math.abs((-0.08 + dy) - GROUND_SETTLE_EPS) < 1e-12);
  });

  it('lowers when thin-axis heuristic overshot (floating chip)', () => {
    // After tip, mesh at toY=0.08 but true lowest point is box.min.y=0.04
    const dy = settlePositionY(0.04, 0, GROUND_SETTLE_EPS);
    assert.ok(dy < 0);
    assert.ok(Math.abs(0.04 + dy - GROUND_SETTLE_EPS) < 1e-12);
  });

  it('eps stays in 1–2 mm band; yard ground matches physics plane', () => {
    assert.equal(YARD_GROUND_Y, 0);
    assert.ok(GROUND_SETTLE_EPS >= 0.001 && GROUND_SETTLE_EPS <= 0.002);
  });

  it('supports stacked ring lift via elevated groundY', () => {
    const stackGround = 0.05;
    const dy = settlePositionY(-0.03, stackGround);
    assert.ok(Math.abs(-0.03 + dy - (stackGround + GROUND_SETTLE_EPS)) < 1e-12);
  });

  it('no-op when already flush (min already at ground+eps)', () => {
    const minY = YARD_GROUND_Y + GROUND_SETTLE_EPS;
    assert.ok(Math.abs(settlePositionY(minY)) < 1e-12);
  });

  it('handles eccentric pinata: large origin↔lowest gap after ~78° tip', () => {
    // Upright heuristic restHalfHeight*pad ≈ 0.08, but after tip true contact
    // needs +0.05 more lift from current wrong Y where min floats at +0.05
    const floatingMinY = 0.05;
    const dy = settlePositionY(floatingMinY);
    assert.ok(dy < -0.04);
    assert.ok(Math.abs(floatingMinY + dy - GROUND_SETTLE_EPS) < 1e-12);
  });

  it('works with negative groundY if callers opt in', () => {
    const dy = settlePositionY(-0.02, -0.01, 0.001);
    assert.ok(Math.abs(-0.02 + dy - (-0.01 + 0.001)) < 1e-12);
  });

  it('zero box min at origin → position.y becomes ground+eps', () => {
    assert.equal(settlePositionY(0, 0, 0.0015), 0.0015);
  });

  it('symmetric: raising then reading min recovers eps', () => {
    const cases = [-0.12, -0.05, 0, 0.02, 0.07];
    for (const minY of cases) {
      const newMin = minY + settlePositionY(minY, 0, 0.0015);
      assert.ok(Math.abs(newMin - 0.0015) < 1e-12, `minY=${minY}`);
    }
  });

  it('custom eps overrides default', () => {
    assert.ok(Math.abs(settlePositionY(-0.1, 0, 0.002) - 0.102) < 1e-12);
  });
});

describe('planRingPileSlots (reference FirewoodPile arc)', () => {
  it('matches reference radius / arc / XC / stack-H constants', () => {
    assert.ok(Math.abs(RING_PILE_RADIUS - 60 * INCH) < 1e-12);
    assert.ok(Math.abs(RING_PILE_START_ANGLE - (320 * Math.PI) / 180) < 1e-12);
    assert.ok(Math.abs(RING_PILE_ARC_SPAN - (230 * Math.PI) / 180) < 1e-12);
    assert.ok(Math.abs(RING_PILE_TIER_DEPTH - 18 * INCH) < 1e-12);
    assert.ok(Math.abs(RING_PILE_SLOT_WIDTH - 5 * INCH) < 1e-12);
    assert.ok(Math.abs(RING_PILE_MAX_STACK_H - 18 * INCH) < 1e-12);
    assert.ok(Math.abs(RING_PILE_RADIAL_JIT - 1 * INCH) < 1e-12);
  });

  it('packs a tight crescent from arc start (not sparse 230° beads)', () => {
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
    assert.ok(maxR - minR < 0.12, `expected neat band, spread=${maxR - minR}`);

    // Compact crescent: angular span ≪ full arcSpan (≈4.01 rad).
    const angs = slots.map((s) => s.yaw);
    const angSpan = Math.max(...angs) - Math.min(...angs);
    assert.ok(angSpan < 0.9, `crescent should be tight, angSpan=${angSpan}`);
    assert.ok(angSpan > 0.05, `expected some arc extent, angSpan=${angSpan}`);

    // Ground-level neighbors sit ~XC apart along the arc.
    const ground = slots.filter((s) => s.slotGridY === 0).sort((a, b) => b.slotX - a.slotX);
    assert.ok(ground.length >= 2, 'expected multiple ground slots');
    for (let i = 1; i < ground.length; i++) {
      const dSlot = Math.abs(ground[i]!.slotX - ground[i - 1]!.slotX);
      assert.ok(Math.abs(dSlot - 1) < 1e-9, `ground slot step=${dSlot}`);
    }

    // Prefer stacking: with ≥3 pieces, at least one rides on neighbors.
    assert.ok(
      slots.some((s) => s.slotGridY >= 1),
      'expected stacked layer (slotGridY≥1)',
    );

    // Stays a ground pile (under max stack H), never on stump top (~0.5m+).
    for (const s of slots) {
      assert.ok(s.y < RING_PILE_MAX_STACK_H, `y=${s.y} exceeds max stack`);
      assert.ok(s.y > 0.02);
      assert.equal(s.tier, 0);
    }
    const groundYMax = Math.max(...slots.filter((s) => s.slotGridY === 0).map((s) => s.y));
    assert.ok(groundYMax < 0.12, `ground layer should sit low, maxY=${groundYMax}`);
  });

  it('overflow spills to outer tier (larger radius)', () => {
    // Tiny arc capacity forces `_needsTierAdvance` after a few ground slots.
    const n = 12;
    const slots = planRingPileSlots(n, {
      arcSpan: 0.2,
      halfHeights: Array.from({ length: n }, () => 0.05),
      halfWidths: Array.from({ length: n }, () => 0.05),
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

  it('ring rest axes are right-handed and grain lies horizontal', () => {
    const slots = planRingPileSlots(4, {
      halfHeights: [0.05, 0.05, 0.05, 0.05],
      halfWidths: [0.06, 0.06, 0.06, 0.06],
      sizeXs: [0.22, 0.12, 0.22, 0.12],
      sizeYs: [0.4, 0.4, 0.4, 0.4],
      sizeZs: [0.18, 0.25, 0.18, 0.25],
      rnds: Array.from({ length: 8 }, () => 0.5),
    });
    for (const s of slots) {
      const det = basisDeterminant(s.axisX, s.axisY, s.axisZ);
      assert.ok(det > 0.85, `expected RH basis, det=${det}`);
      // Local grain (Y) world Y-component must be small → side-lying, not stump-vertical.
      assert.ok(
        Math.abs(s.axisY[1]) < 0.2,
        `grain axisY.y=${s.axisY[1]} should be near horizontal`,
      );
    }
    assert.equal(slots[0]!.isXThinner, false);
    assert.equal(slots[1]!.isXThinner, true);
  });

  it('pickRingPileNextSlot stacks on adjacent pairs before extending far', () => {
    const filled = new Set<string>(['0.0,0', '-1.0,0']);
    const tops = new Map<string, number>([
      ['0.0,0', 0.1],
      ['-1.0,0', 0.1],
    ]);
    const next = pickRingPileNextSlot(filled, tops, -1);
    assert.equal(next.x, -0.5);
    assert.equal(next.y, 1);
  });

  it('appendRingPileSlots is append-only (prior slots stay; occupancy grows)', () => {
    const occ = createRingPileOccupancy();
    const halves = Array.from({ length: 4 }, () => 0.05);
    const rnds = Array.from({ length: 14 }, () => 0.5);
    const first = appendRingPileSlots(4, occ, {
      halfHeights: halves,
      halfWidths: halves,
      rnds,
    });
    assert.equal(first.length, 4);
    assert.equal(occ.filledSlots.size, 4);
    const snapshot = first.map((s) => ({ x: s.x, y: s.y, z: s.z, slotX: s.slotX, slotGridY: s.slotGridY }));
    const second = appendRingPileSlots(3, occ, {
      halfHeights: Array.from({ length: 3 }, () => 0.05),
      halfWidths: Array.from({ length: 3 }, () => 0.05),
      rnds: rnds.slice(8),
    });
    assert.equal(second.length, 3);
    assert.equal(occ.filledSlots.size, 7);
    // First batch world poses unchanged (we only returned new slots).
    for (let i = 0; i < snapshot.length; i++) {
      assert.equal(snapshot[i]!.x, first[i]!.x);
      assert.equal(snapshot[i]!.y, first[i]!.y);
      assert.equal(snapshot[i]!.z, first[i]!.z);
    }
    // New slots use distinct grid keys.
    const keys = new Set([
      ...first.map((s) => `${s.slotX.toFixed(1)},${s.slotGridY}`),
      ...second.map((s) => `${s.slotX.toFixed(1)},${s.slotGridY}`),
    ]);
    assert.equal(keys.size, 7);
  });

  it('clearRingPileOccupancy resets for a fresh pile', () => {
    const occ = createRingPileOccupancy();
    appendRingPileSlots(2, occ, {
      halfHeights: [0.05, 0.05],
      halfWidths: [0.05, 0.05],
      rnds: [0.5, 0.5, 0.5, 0.5],
    });
    assert.ok(occ.filledSlots.size > 0);
    clearRingPileOccupancy(occ);
    assert.equal(occ.filledSlots.size, 0);
    assert.equal(occ.tier, 0);
    assert.equal(occ.minGx, 1);
  });
});

describe('ringPileSimToWorldAxes (reference _simToWorld parity)', () => {
  const ang = (320 * Math.PI) / 180;
  const radial = [Math.cos(ang), 0, Math.sin(ang)] as const;
  const up = [0, 1, 0] as const;
  const tangent = [
    up[1] * radial[2] - up[2] * radial[1],
    up[2] * radial[0] - up[0] * radial[2],
    up[0] * radial[1] - up[1] * radial[0],
  ] as const;

  it('non-thin branch: right-handed, grain→−radial, Z→up (after πY)', () => {
    const o = ringPileSimToWorldAxes({
      angle: ang,
      roll: 0,
      sizeX: 0.25,
      sizeY: 0.4,
      sizeZ: 0.18,
    });
    assert.equal(o.isXThinner, false);
    assert.equal(o.grainAxis, 1);
    assert.ok(basisDeterminant(o.axisX, o.axisY, o.axisZ) > 0.9);
    // After π about Y: grain Y → −radial
    assert.ok(Math.abs(o.axisY[0] - -radial[0]) < 1e-9);
    assert.ok(Math.abs(o.axisY[2] - -radial[2]) < 1e-9);
    assert.ok(Math.abs(o.axisY[1]) < 1e-9);
    assert.ok(Math.abs(o.axisZ[0] - up[0]) < 1e-9);
    assert.ok(Math.abs(o.axisZ[1] - up[1]) < 1e-9);
    // X → +tangent after πY (reference makeBasis(−T,R,U) then Ryπ)
    assert.ok(Math.abs(o.axisX[0] - tangent[0]) < 1e-9);
    assert.ok(Math.abs(o.axisX[2] - tangent[2]) < 1e-9);
  });

  it('thin-axis branch: local X → world up, grain still horizontal', () => {
    const o = ringPileSimToWorldAxes({
      angle: ang,
      roll: 0,
      sizeX: 0.12,
      sizeY: 0.4,
      sizeZ: 0.28,
    });
    assert.equal(o.isXThinner, true);
    assert.ok(basisDeterminant(o.axisX, o.axisY, o.axisZ) > 0.9);
    assert.ok(Math.abs(o.axisX[1] - 1) < 1e-9, 'thin X maps to world up');
    assert.ok(Math.abs(o.axisY[1]) < 1e-9, 'grain Y stays horizontal');
    assert.ok(Math.hypot(o.axisY[0], o.axisY[2]) > 0.9);
  });

  it('left-handed +tangent basis is rejected (det would be negative)', () => {
    // Document the bug we fixed: makeBasis(+T, R, U) is left-handed.
    const badDet = basisDeterminant(tangent, radial, up);
    assert.ok(badDet < -0.9, `+tangent basis must be LH, det=${badDet}`);
    const good = ringPileSimToWorldAxes({ angle: ang, sizeX: 0.2, sizeY: 0.4, sizeZ: 0.2 });
    assert.ok(basisDeterminant(good.axisX, good.axisY, good.axisZ) > 0.9);
  });

  it('isCrossSectionXThinner / pickLocalGrainAxis helpers', () => {
    assert.equal(isCrossSectionXThinner(0.1, 0.2), true);
    assert.equal(isCrossSectionXThinner(0.3, 0.2), false);
    assert.equal(pickLocalGrainAxis(0.2, 0.5, 0.2), 1);
    assert.equal(pickLocalGrainAxis(0.6, 0.2, 0.2), 0);
    assert.equal(pickLocalGrainAxis(0.2, 0.2, 0.7), 2);
  });

  it('AABB remapping keeps longest local axis horizontal when grain ≠ Y', () => {
    const o = ringPileSimToWorldAxes({
      angle: ang,
      roll: 0,
      sizeX: 0.55,
      sizeY: 0.18,
      sizeZ: 0.2,
    });
    assert.equal(o.grainAxis, 0);
    // Local X (grain) world Y component small.
    assert.ok(Math.abs(o.axisX[1]) < 0.2, `grain X.y=${o.axisX[1]}`);
    assert.ok(basisDeterminant(o.axisX, o.axisY, o.axisZ) > 0.85);
  });
});
