import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { DestructibleMesh, FractureOptions, SliceOptions } from '@dgreenheck/three-pinata';
import {
  BOUNCE_TILT_DEG,
  BOUNCE_YAW_JITTER_DEG,
  cleaveNormalXZ,
  INCH,
  isFirewoodChip,
  isRechopWorthy,
  lateralOffsetFromDiameter,
  MAX_LIVE_FRAGMENTS,
  MIN_RECHOP_DIAGONAL,
  TINY_CHIP_DIAGONAL,
  type FracturePlan,
} from '@firewood/game-core';

/**
 * Scripted settle bounce — mirrors screen.toys/firewood `performSplit` animator
 * (logic reverse-engineered; no assets copied). Live reference: bipartition with
 * an obvious lateral 错开 ≈ half the log diameter, pieces stay upright on stump.
 */
export interface BounceAnim {
  /** Horizontal push direction (impact → piece centroid, y=0). */
  pushX: number;
  pushZ: number;
  /** Cleave-plane normal (for multi-chop lock inference). */
  normalX: number;
  normalZ: number;
  distance: number;
  popHeight: number;
  tiltMult: number;
  yawRad: number;
  startAt: number;
  durationMs: number;
  delayMs: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  /** Upright orientation captured at bounce start. */
  baseQuat: THREE.Quaternion;
}

export interface PhysFragment {
  mesh: DestructibleMesh;
  body: CANNON.Body;
  generation: number;
  splittable: boolean;
  bornAt: number;
  /** After this timestamp, freeze residual motion so pieces stay on the stump. */
  settleUntil: number;
  /** True when piece is a stump half (scripted bounce), false for pile-thrown firewood. */
  onStump: boolean;
  /** Scripted bounce (non-firewood stump pieces). */
  bounce?: BounceAnim;
}

export interface FractureWorld {
  world: CANNON.World;
  fragments: PhysFragment[];
  /** Last cleave debug (diameter / side offset) for feel tuning. */
  lastCleaveDebug: {
    diameter: number;
    gapFrac: number;
    sideOffset: number;
    pieceCount: number;
  } | null;
  sync(): void;
  /** Fixed-step physics; returns whether a step ran. */
  step(dt: number, weakDevice: boolean): void;
  clearFragments(): void;
  prune(): void;
  fractureMesh(
    mesh: DestructibleMesh,
    worldImpact: THREE.Vector3,
    plan: FracturePlan,
    generation: number,
    scene: THREE.Scene,
    opts?: { planeNormal?: THREE.Vector3 },
  ): PhysFragment[];
  disposeMesh(mesh: THREE.Object3D, disposeMaterials?: boolean): void;
}

export function detectWeakDevice(): boolean {
  try {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const ua = navigator.userAgent;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
    return mobile || cores <= 4 || (typeof mem === 'number' && mem <= 4);
  } catch {
    return true;
  }
}

function smoothstep(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

export function createFractureWorld(): FractureWorld {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -11.5, 0),
  });
  world.allowSleep = true;
  world.quatNormalizeFast = true;
  world.defaultContactMaterial.friction = 0.72;
  world.defaultContactMaterial.restitution = 0.02;
  world.defaultContactMaterial.contactEquationStiffness = 1e7;
  world.defaultContactMaterial.contactEquationRelaxation = 4;

  const woodMat = new CANNON.Material('wood');
  const groundMat = new CANNON.Material('ground');
  world.addContactMaterial(
    new CANNON.ContactMaterial(woodMat, groundMat, {
      friction: 0.85,
      restitution: 0.015,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3,
    }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(woodMat, woodMat, {
      friction: 0.55,
      restitution: 0.04,
    }),
  );

  const ground = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
    material: groundMat,
  });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  // Heavier static stump stack: wide cylinder + thick top pad for chips to rest on
  const stump = new CANNON.Body({
    mass: 0,
    material: groundMat,
    position: new CANNON.Vec3(0, 0.22, 0),
  });
  stump.addShape(new CANNON.Cylinder(0.78, 0.92, 0.44, 10));
  stump.addShape(new CANNON.Box(new CANNON.Vec3(0.7, 0.05, 0.7)), new CANNON.Vec3(0, 0.24, 0));
  world.addBody(stump);

  const fragments: PhysFragment[] = [];
  let lastCleaveDebug: FractureWorld['lastCleaveDebug'] = null;
  let accumulator = 0;
  const FIXED = 1 / 60;
  const up = new THREE.Vector3(0, 1, 0);
  const sliceOpts = new SliceOptions();
  /** World Y of the chopping-block top — stump pieces snap here so they don't hover. */
  const STUMP_SUPPORT_Y = 0.52;
  const _tiltQ = new THREE.Quaternion();
  const _yawQ = new THREE.Quaternion();
  const _outQ = new THREE.Quaternion();
  const _tiltAxis = new THREE.Vector3();

  function bboxDiagonal(mesh: THREE.Mesh): number {
    const box = new THREE.Box3().setFromObject(mesh);
    return box.getSize(new THREE.Vector3()).length();
  }

  function makeBodyFromMesh(mesh: THREE.Mesh, massScale: number, onStump: boolean): CANNON.Body {
    mesh.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(mesh);
    const wsize = worldBox.getSize(new THREE.Vector3());
    const half = new CANNON.Vec3(
      Math.max(0.04, wsize.x * 0.46),
      Math.max(0.04, wsize.y * 0.46),
      Math.max(0.04, wsize.z * 0.46),
    );
    const volume = Math.max(0.002, wsize.x * wsize.y * wsize.z);
    // Stump halves are posed by the bounce animator (static). Firewood chips are dynamic.
    const mass = onStump ? 0 : Math.max(0.08, volume * 220 * massScale);

    return new CANNON.Body({
      mass,
      type: onStump ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC,
      shape: new CANNON.Box(half),
      material: woodMat,
      position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
      quaternion: new CANNON.Quaternion(
        mesh.quaternion.x,
        mesh.quaternion.y,
        mesh.quaternion.z,
        mesh.quaternion.w,
      ),
      linearDamping: onStump ? 1 : 0.78,
      angularDamping: onStump ? 1 : 0.88,
      allowSleep: true,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit: 0.12,
    });
  }

  function disposeMesh(obj: THREE.Object3D, disposeMaterials = false): void {
    obj.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (!disposeMaterials) return;
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
  }

  function removeFragment(index: number): void {
    const f = fragments[index];
    if (!f) return;
    world.removeBody(f.body);
    f.mesh.removeFromParent();
    disposeMesh(f.mesh, true);
    fragments.splice(index, 1);
  }

  function clearFragments(): void {
    while (fragments.length) removeFragment(0);
  }

  function prune(): void {
    // Drop tiny chips and enforce live cap (oldest non-splittable first)
    for (let i = fragments.length - 1; i >= 0; i--) {
      const f = fragments[i]!;
      const diag = bboxDiagonal(f.mesh);
      if (diag < TINY_CHIP_DIAGONAL && !f.splittable) {
        removeFragment(i);
      }
    }
    while (fragments.length > MAX_LIVE_FRAGMENTS) {
      const idx = fragments.findIndex((f) => !f.splittable);
      removeFragment(idx >= 0 ? idx : 0);
    }
    // Cull anything that fell through the world
    for (let i = fragments.length - 1; i >= 0; i--) {
      if (fragments[i]!.body.position.y < -2) removeFragment(i);
    }
  }

  /**
   * Vertical chop plane through impact: halves separate along ±normal (sides),
   * then gravity takes over — not a spherical Voronoi burst.
   */
  function buildCleaveNormal(mesh: THREE.Object3D, worldImpact: THREE.Vector3): THREE.Vector3 {
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const [nx, nz] = cleaveNormalXZ(worldImpact.x, worldImpact.z, center.x, center.z);
    return new THREE.Vector3(nx, 0, nz);
  }

  /** Prefer exactly two largest leaves when the budget is 2 (sweet first chop). */
  function preferTwoHalves(pieces: DestructibleMesh[], budget: number): DestructibleMesh[] {
    if (budget !== 2 || pieces.length <= 2) return pieces;
    const ranked = [...pieces].sort((a, b) => bboxDiagonal(b) - bboxDiagonal(a));
    const keep = ranked.slice(0, 2);
    for (const drop of ranked.slice(2)) {
      drop.removeFromParent();
      disposeMesh(drop, true);
    }
    return keep;
  }

  /** Recursively planar-slice until we hit the piece budget (messy) or once (sweet). */
  function cleavePieces(
    root: DestructibleMesh,
    worldImpact: THREE.Vector3,
    planeNormal: THREE.Vector3,
    plan: FracturePlan,
    keepParallel: boolean,
  ): DestructibleMesh[] {
    const primary = root.sliceWorld(planeNormal, worldImpact, sliceOpts);
    if (!plan.messy || plan.fragmentCount <= 2 || primary.length === 0) {
      return preferTwoHalves(primary, plan.fragmentCount);
    }

    const leaves: DestructibleMesh[] = [];
    const queue: DestructibleMesh[] = [...primary];

    while (queue.length > 0 && leaves.length + queue.length < plan.fragmentCount) {
      // Split largest remaining piece next
      queue.sort((a, b) => bboxDiagonal(b) - bboxDiagonal(a));
      const piece = queue.shift()!;
      const diag = bboxDiagonal(piece);
      if (diag < MIN_RECHOP_DIAGONAL * 0.85) {
        leaves.push(piece);
        continue;
      }

      // Locked multi-chop: stay in the same vertical plane family (parallel slices).
      const angle = keepParallel ? 0 : (Math.random() - 0.5) * (plan.messy ? 0.55 : 0.25);
      const n2 = planeNormal.clone().applyAxisAngle(up, angle).normalize();
      n2.y = 0;
      if (n2.lengthSq() < 1e-8) n2.copy(planeNormal);
      else n2.normalize();

      const origin = worldImpact
        .clone()
        .add(n2.clone().multiplyScalar((Math.random() - 0.5) * (keepParallel ? 0.04 : 0.1)));
      origin.y = worldImpact.y;

      try {
        piece.updateMatrixWorld(true);
        const sub = piece.sliceWorld(n2, origin, sliceOpts);
        if (sub.length >= 2) {
          disposeMesh(piece, false);
          queue.push(...sub);
        } else {
          leaves.push(piece);
        }
      } catch {
        leaves.push(piece);
      }
    }

    leaves.push(...queue);
    return leaves;
  }

  /** Fallback: 2.5D Voronoi extruded along grain (Y) with seeds biased to two sides of the plane. */
  function voronoiCleaveFallback(
    mesh: DestructibleMesh,
    worldImpact: THREE.Vector3,
    planeNormal: THREE.Vector3,
    plan: FracturePlan,
  ): DestructibleMesh[] {
    mesh.updateMatrixWorld(true);
    const localImpact = mesh.worldToLocal(worldImpact.clone());
    const localNormal = planeNormal
      .clone()
      .transformDirection(new THREE.Matrix4().copy(mesh.matrixWorld).invert())
      .normalize();
    localNormal.y = 0;
    if (localNormal.lengthSq() < 1e-8) localNormal.set(1, 0, 0);
    else localNormal.normalize();

    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const count = Math.max(2, plan.fragmentCount);
    const seedPoints: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const along = (Math.random() - 0.5) * size.x * 0.35;
      const lateral = side * (0.04 + Math.random() * 0.12);
      const y = localImpact.y + (Math.random() - 0.5) * size.y * 0.35;
      const tangent = new THREE.Vector3(-localNormal.z, 0, localNormal.x);
      seedPoints.push(
        localImpact
          .clone()
          .add(localNormal.clone().multiplyScalar(lateral))
          .add(tangent.multiplyScalar(along))
          .setY(y),
      );
    }

    const options = new FractureOptions({
      fractureMethod: 'voronoi',
      fragmentCount: count,
      seed: Math.floor(Math.random() * 1e9),
      voronoiOptions: {
        mode: '2.5D',
        seedPoints,
        impactPoint: localImpact,
        impactRadius: plan.impactRadius,
        projectionAxis: 'y',
      },
    });

    return preferTwoHalves(mesh.fracture(options), plan.fragmentCount);
  }

  /** Neighbor stump pieces get a distance-falloff outward nudge (reference performSplit). */
  function nudgeNeighbors(worldImpact: THREE.Vector3, planeNormal: THREE.Vector3): void {
    const falloffR = 0.85;
    for (const f of fragments) {
      if (!f.onStump || f.bounce) continue;
      const dx = f.body.position.x - worldImpact.x;
      const dz = f.body.position.z - worldImpact.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-5) continue;
      const falloff = Math.max(0, 1 - dist / falloffR);
      if (falloff <= 0) continue;
      // Prefer push away from cut along horizontal impact→piece, with a bit of plane normal.
      let px = dx / dist;
      let pz = dz / dist;
      const alongN = px * planeNormal.x + pz * planeNormal.z;
      if (Math.abs(alongN) < 0.2) {
        px = planeNormal.x * Math.sign(alongN || 1);
        pz = planeNormal.z * Math.sign(alongN || 1);
      }
      const nudge = 0.35 * INCH * falloff;
      f.body.position.x += px * nudge;
      f.body.position.z += pz * nudge;
      f.mesh.position.set(f.body.position.x, f.body.position.y, f.body.position.z);
    }
  }

  /** Soft overlap resolve among settled stump pieces (skip active bounce). */
  function resolveStumpOverlaps(): void {
    const n = fragments.length;
    for (let i = 0; i < n; i++) {
      const a = fragments[i]!;
      if (!a.onStump || a.bounce) continue;
      const abox = new THREE.Box3().setFromObject(a.mesh);
      const ac = abox.getCenter(new THREE.Vector3());
      const as = abox.getSize(new THREE.Vector3());
      for (let j = i + 1; j < n; j++) {
        const b = fragments[j]!;
        if (!b.onStump || b.bounce) continue;
        const bbox = new THREE.Box3().setFromObject(b.mesh);
        if (!abox.intersectsBox(bbox)) continue;
        const bc = bbox.getCenter(new THREE.Vector3());
        let dx = bc.x - ac.x;
        let dz = bc.z - ac.z;
        let len = Math.hypot(dx, dz);
        if (len < 1e-6) {
          dx = 1;
          dz = 0;
          len = 1;
        }
        const bs = bbox.getSize(new THREE.Vector3());
        const overlapX = (as.x + bs.x) * 0.5 - Math.abs(bc.x - ac.x);
        const overlapZ = (as.z + bs.z) * 0.5 - Math.abs(bc.z - ac.z);
        const push = Math.max(0, Math.min(overlapX, overlapZ)) * 0.35 + 0.002;
        const nx = dx / len;
        const nz = dz / len;
        a.body.position.x -= nx * push * 0.5;
        a.body.position.z -= nz * push * 0.5;
        a.mesh.position.set(a.body.position.x, a.body.position.y, a.body.position.z);
        b.body.position.x += nx * push * 0.5;
        b.body.position.z += nz * push * 0.5;
        b.mesh.position.set(b.body.position.x, b.body.position.y, b.body.position.z);
      }
    }
  }

  function applyBouncePose(f: PhysFragment, now: number): boolean {
    const b = f.bounce;
    if (!b) return false;
    const localT = now - b.startAt - b.delayMs;
    if (localT < 0) {
      f.body.position.set(b.baseX, b.baseY, b.baseZ);
      f.mesh.position.set(b.baseX, b.baseY, b.baseZ);
      f.mesh.quaternion.copy(b.baseQuat);
      f.body.quaternion.set(b.baseQuat.x, b.baseQuat.y, b.baseQuat.z, b.baseQuat.w);
      return true;
    }
    const u = Math.min(1, localT / Math.max(1, b.durationMs));
    const ease = smoothstep(u);
    // Slide sideways — primary motion matching reference upright 错开.
    const x = b.baseX + b.pushX * b.distance * ease;
    const z = b.baseZ + b.pushZ * b.distance * ease;
    // Subtle pop then settle (keep tip-free; lateral slide dominates).
    const pop = b.popHeight * Math.sin(Math.PI * u);
    const y = b.baseY + pop;

    // Near-zero tip (reference stays upright); tiny yaw fades in.
    const tiltRad = b.tiltMult * (BOUNCE_TILT_DEG * Math.PI / 180) * Math.sin(Math.PI * u);
    _tiltAxis.set(-b.pushZ, 0, b.pushX);
    if (_tiltAxis.lengthSq() < 1e-8) _tiltAxis.set(1, 0, 0);
    else _tiltAxis.normalize();
    _tiltQ.setFromAxisAngle(_tiltAxis, tiltRad);
    _yawQ.setFromAxisAngle(up, b.yawRad * ease);
    _outQ.copy(b.baseQuat).multiply(_yawQ).multiply(_tiltQ);

    f.body.position.set(x, y, z);
    f.mesh.position.set(x, y, z);
    f.mesh.quaternion.copy(_outQ);
    f.body.quaternion.set(_outQ.x, _outQ.y, _outQ.z, _outQ.w);

    if (u >= 1) {
      // Final settle: upright on stump at full lateral offset.
      const fx = b.baseX + b.pushX * b.distance;
      const fz = b.baseZ + b.pushZ * b.distance;
      _yawQ.setFromAxisAngle(up, b.yawRad);
      _outQ.copy(b.baseQuat).multiply(_yawQ);
      f.body.position.set(fx, b.baseY, fz);
      f.mesh.position.set(fx, b.baseY, fz);
      f.mesh.quaternion.copy(_outQ);
      f.body.quaternion.set(_outQ.x, _outQ.y, _outQ.z, _outQ.w);
      f.bounce = undefined;
    }
    return true;
  }

  /** Horizontal diameter of the piece about to be cleaved (pre-slice). */
  function meshDiameterXZ(mesh: THREE.Object3D): number {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    return Math.max(0.25, size.x, size.z);
  }

  function registerPieces(
    pieces: DestructibleMesh[],
    worldImpact: THREE.Vector3,
    planeNormal: THREE.Vector3,
    plan: FracturePlan,
    generation: number,
    scene: THREE.Scene,
    logDiameter: number,
  ): PhysFragment[] {
    const created: PhysFragment[] = [];
    const now = performance.now();
    const settleMs = plan.bounceMs + 40;
    // plan.wedgeGap is face-gap fraction of diameter; each half slides half of that.
    const sideOffset = lateralOffsetFromDiameter(logDiameter, plan.wedgeGap);
    lastCleaveDebug = {
      diameter: logDiameter,
      gapFrac: plan.wedgeGap,
      sideOffset,
      pieceCount: pieces.length,
    };

    nudgeNeighbors(worldImpact, planeNormal);

    for (let i = 0; i < pieces.length; i++) {
      const fragment = pieces[i]!;
      scene.add(fragment);
      fragment.updateMatrixWorld(true);

      const box0 = new THREE.Box3().setFromObject(fragment);
      const size0 = box0.getSize(new THREE.Vector3());
      const center0 = box0.getCenter(new THREE.Vector3());
      const firewood = isFirewoodChip(size0.x, size0.y, size0.z);
      const onStump = !firewood;

      const body = makeBodyFromMesh(fragment, plan.messy ? 1.15 : 1.35, onStump);

      // Prefer ±cleave normal so halves mirror-slide apart (reference upright 错开).
      // Fall back to impact→centroid if the piece sits on the plane.
      let side = Math.sign(
        (center0.x - worldImpact.x) * planeNormal.x + (center0.z - worldImpact.z) * planeNormal.z,
      );
      if (side === 0) side = i % 2 === 0 ? 1 : -1;
      let pushX = planeNormal.x * side;
      let pushZ = planeNormal.z * side;
      const pushLen = Math.hypot(pushX, pushZ);
      if (pushLen < 1e-5) {
        pushX = side;
        pushZ = 0;
      } else {
        pushX /= pushLen;
        pushZ /= pushLen;
      }

      // Keep slice orientation as-is (Y-up cylinder halves stay upright on the stump).
      body.quaternion.set(
        fragment.quaternion.x,
        fragment.quaternion.y,
        fragment.quaternion.z,
        fragment.quaternion.w,
      );

      if (onStump) {
        // Snap bottoms onto the stump top so halves sit on the block.
        fragment.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(fragment);
        const settleY = STUMP_SUPPORT_Y - box.min.y;
        body.position.y += settleY;
        fragment.position.y = body.position.y;
      }

      const baseX = body.position.x;
      const baseY = body.position.y;
      const baseZ = body.position.z;
      const baseQuat = fragment.quaternion.clone();

      // Snap immediately to the final lateral offset so the 错开 is correct even
      // if the bounce animator misses frames; animate the slide from closed→open.
      const finalX = baseX + pushX * sideOffset;
      const finalZ = baseZ + pushZ * sideOffset;

      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);

      if (!onStump) {
        // Firewood chips: light physics toss toward a side pile (not main halves).
        const tossSide =
          Math.sign(pushX * planeNormal.x + pushZ * planeNormal.z) || (i % 2 === 0 ? 1 : -1);
        body.velocity.set(
          pushX * (1.2 + Math.random() * 0.6) + planeNormal.x * tossSide * 0.4,
          1.4 + Math.random() * 0.8,
          pushZ * (1.2 + Math.random() * 0.6) + planeNormal.z * tossSide * 0.4,
        );
        body.angularVelocity.set(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 4,
        );
      } else {
        // Start closed at base; first animator tick slides toward final.
        body.position.set(baseX, baseY, baseZ);
        fragment.position.set(baseX, baseY, baseZ);
      }

      world.addBody(body);

      const childGen = generation + 1;
      const diag = bboxDiagonal(fragment);
      const yawRad =
        ((Math.random() * 2 - 1) * BOUNCE_YAW_JITTER_DEG * Math.PI) / 180;

      const entry: PhysFragment = {
        mesh: fragment,
        body,
        generation: childGen,
        splittable: onStump && isRechopWorthy(diag, childGen),
        bornAt: now,
        settleUntil: now + settleMs,
        onStump,
        bounce: onStump
          ? {
              pushX,
              pushZ,
              normalX: planeNormal.x,
              normalZ: planeNormal.z,
              distance: sideOffset,
              popHeight: plan.popHeight,
              tiltMult: 1,
              yawRad,
              startAt: now,
              durationMs: plan.bounceMs,
              delayMs: 0,
              baseX,
              baseY,
              baseZ,
              baseQuat,
            }
          : undefined,
      };
      // Record intended final for safety settle.
      fragment.userData.finalXZ = { x: finalX, z: finalZ };
      fragment.userData.phys = entry;
      fragment.userData.role = 'fragment';
      fragment.userData.generation = childGen;
      fragments.push(entry);
      created.push(entry);
    }

    // Overlap resolve only for settled stump pieces — bouncing halves already
    // get the designed ~half-diameter face gap from lateralOffsetFromDiameter.
    resolveStumpOverlaps();
    return created;
  }

  function fractureMesh(
    mesh: DestructibleMesh,
    worldImpact: THREE.Vector3,
    plan: FracturePlan,
    generation: number,
    scene: THREE.Scene,
    opts?: { planeNormal?: THREE.Vector3 },
  ): PhysFragment[] {
    if (plan.fragmentCount <= 0 || plan.nickOnly) return [];

    mesh.updateMatrixWorld(true);
    const logDiameter = meshDiameterXZ(mesh);
    const locked = opts?.planeNormal;
    const planeNormal = locked
      ? new THREE.Vector3(locked.x, 0, locked.z).normalize()
      : buildCleaveNormal(mesh, worldImpact);
    if (planeNormal.lengthSq() < 1e-8) planeNormal.set(1, 0, 0);

    const existingIdx = fragments.findIndex((f) => f.mesh === mesh);
    if (existingIdx >= 0) {
      removeFragment(existingIdx);
    }

    let pieces: DestructibleMesh[] = [];
    try {
      pieces = cleavePieces(mesh, worldImpact, planeNormal, plan, !!locked);
    } catch (err) {
      console.warn('[fracture] planar cleave failed, trying grain-biased Voronoi', err);
      try {
        pieces = voronoiCleaveFallback(mesh, worldImpact, planeNormal, plan);
      } catch (err2) {
        console.error('[fracture] cleave fallback failed', err2);
        return [];
      }
    }

    if (pieces.length === 0) return [];

    const created = registerPieces(
      pieces,
      worldImpact,
      planeNormal,
      plan,
      generation,
      scene,
      logDiameter,
    );

    mesh.visible = false;
    mesh.removeFromParent();
    mesh.geometry?.dispose();
    prune();
    return created;
  }

  function step(dt: number, weakDevice: boolean): void {
    const maxSub = weakDevice ? 2 : 3;
    accumulator += Math.min(0.05, dt);
    let steps = 0;
    while (accumulator >= FIXED && steps < maxSub) {
      world.step(FIXED);
      accumulator -= FIXED;
      steps += 1;
    }
    // Prevent spiral of death
    if (accumulator > FIXED * 2) accumulator = 0;

    const now = performance.now();
    for (const f of fragments) {
      if (applyBouncePose(f, now)) continue;

      if (f.body.type === CANNON.Body.STATIC) continue;
      if (now < f.settleUntil) continue;
      if (f.body.sleepState === CANNON.Body.SLEEPING) continue;
      const speed = f.body.velocity.length();
      const spin = f.body.angularVelocity.length();
      if (speed < 0.55 && spin < 1.2) {
        f.body.velocity.set(0, 0, 0);
        f.body.angularVelocity.set(0, 0, 0);
        f.body.sleep();
      } else {
        f.body.velocity.x *= 0.35;
        f.body.velocity.z *= 0.35;
        f.body.velocity.y = Math.min(f.body.velocity.y, 0.05);
        f.body.angularVelocity.scale(0.25);
      }
    }
  }

  function sync(): void {
    for (const f of fragments) {
      if (f.bounce) continue; // bounce owns pose this frame
      f.mesh.position.set(f.body.position.x, f.body.position.y, f.body.position.z);
      f.mesh.quaternion.set(
        f.body.quaternion.x,
        f.body.quaternion.y,
        f.body.quaternion.z,
        f.body.quaternion.w,
      );
    }
  }

  return {
    world,
    fragments,
    get lastCleaveDebug() {
      return lastCleaveDebug;
    },
    sync,
    step,
    clearFragments,
    prune,
    fractureMesh,
    disposeMesh,
  };
}
