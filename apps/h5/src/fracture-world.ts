import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { DestructibleMesh, FractureOptions, SliceOptions } from '@dgreenheck/three-pinata';
import {
  cleaveNormalXZ,
  isRechopWorthy,
  MAX_LIVE_FRAGMENTS,
  MIN_RECHOP_DIAGONAL,
  TINY_CHIP_DIAGONAL,
  type FracturePlan,
} from '@firewood/game-core';

export interface PhysFragment {
  mesh: DestructibleMesh;
  body: CANNON.Body;
  generation: number;
  splittable: boolean;
  bornAt: number;
  /** After this timestamp, freeze residual motion so pieces stay wedged on the stump. */
  settleUntil: number;
  /** Animated wedge open along cleave normal (screen.toys settle). */
  wedge?: {
    normalX: number;
    normalZ: number;
    side: number;
    fromGap: number;
    toGap: number;
    startAt: number;
    durationMs: number;
    baseX: number;
    baseY: number;
    baseZ: number;
  };
}

export interface FractureWorld {
  world: CANNON.World;
  fragments: PhysFragment[];
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
  let accumulator = 0;
  const FIXED = 1 / 60;
  const up = new THREE.Vector3(0, 1, 0);
  const sliceOpts = new SliceOptions();
  /** World Y of the chopping-block top — wedged pieces snap here so they don't hover. */
  const STUMP_SUPPORT_Y = 0.52;

  function bboxDiagonal(mesh: THREE.Mesh): number {
    const box = new THREE.Box3().setFromObject(mesh);
    return box.getSize(new THREE.Vector3()).length();
  }

  function makeBodyFromMesh(mesh: THREE.Mesh, massScale: number, wedged: boolean): CANNON.Body {
    mesh.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(mesh);
    const wsize = worldBox.getSize(new THREE.Vector3());
    const half = new CANNON.Vec3(
      Math.max(0.04, wsize.x * 0.46),
      Math.max(0.04, wsize.y * 0.46),
      Math.max(0.04, wsize.z * 0.46),
    );
    const volume = Math.max(0.002, wsize.x * wsize.y * wsize.z);
    // Wedged splits are posed in place (static) — free rigid bodies explode off the stump
    // when AABB boxes penetrate the static chopping block.
    const mass = wedged ? 0 : Math.max(0.08, volume * 220 * massScale);

    return new CANNON.Body({
      mass,
      type: wedged ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC,
      shape: new CANNON.Box(half),
      material: woodMat,
      position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
      quaternion: new CANNON.Quaternion(
        mesh.quaternion.x,
        mesh.quaternion.y,
        mesh.quaternion.z,
        mesh.quaternion.w,
      ),
      linearDamping: wedged ? 1 : 0.78,
      angularDamping: wedged ? 1 : 0.88,
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

  /** Recursively planar-slice until we hit the piece budget (messy) or once (sweet). */
  function cleavePieces(
    root: DestructibleMesh,
    worldImpact: THREE.Vector3,
    planeNormal: THREE.Vector3,
    plan: FracturePlan,
  ): DestructibleMesh[] {
    const primary = root.sliceWorld(planeNormal, worldImpact, sliceOpts);
    if (!plan.messy || plan.fragmentCount <= 2 || primary.length === 0) {
      return primary;
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

      const angle = (Math.random() - 0.5) * (plan.messy ? 0.55 : 0.25);
      const n2 = planeNormal.clone().applyAxisAngle(up, angle).normalize();
      n2.y = 0;
      if (n2.lengthSq() < 1e-8) n2.copy(planeNormal);
      else n2.normalize();

      const origin = worldImpact
        .clone()
        .add(n2.clone().multiplyScalar((Math.random() - 0.5) * 0.1));
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

    return mesh.fracture(options);
  }

  function registerPieces(
    pieces: DestructibleMesh[],
    worldImpact: THREE.Vector3,
    planeNormal: THREE.Vector3,
    plan: FracturePlan,
    generation: number,
    scene: THREE.Scene,
  ): PhysFragment[] {
    const created: PhysFragment[] = [];
    const now = performance.now();
    const settleMs = plan.messy ? 380 : 280;

    // Always wedged-on-block for first-break cleaves; never free-fly dump to the floor.
    const wedged = true;

    for (let i = 0; i < pieces.length; i++) {
      const fragment = pieces[i]!;
      scene.add(fragment);
      fragment.updateMatrixWorld(true);

      const body = makeBodyFromMesh(fragment, plan.messy ? 1.15 : 1.35, wedged);
      const offset = new THREE.Vector3().subVectors(fragment.position, worldImpact);
      let side = Math.sign(offset.dot(planeNormal));
      if (side === 0) side = i % 2 === 0 ? 1 : -1;

      // Keep slice orientation as-is (Y-up cylinder halves stay upright on the stump).
      body.quaternion.set(
        fragment.quaternion.x,
        fragment.quaternion.y,
        fragment.quaternion.z,
        fragment.quaternion.w,
      );

      // Snap bottoms onto the stump top so halves sit on the block.
      fragment.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(fragment);
      const settleY = STUMP_SUPPORT_Y - box.min.y;
      body.position.y += settleY;
      fragment.position.y = body.position.y;

      const baseX = body.position.x;
      const baseY = body.position.y;
      const baseZ = body.position.z;

      // Tight crack — later pieces in a messy split stay in the same cluster.
      const toGap = plan.wedgeGap * (plan.messy && i > 1 ? 1.15 : 1);

      // Start nearly closed; animate open so it feels like a settle, not a teleport.
      const fromGap = Math.min(0.004, toGap * 0.12);
      body.position.set(
        baseX + planeNormal.x * side * fromGap,
        baseY,
        baseZ + planeNormal.z * side * fromGap,
      );
      fragment.position.set(body.position.x, body.position.y, body.position.z);

      // No launch velocity — pose only.
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      world.addBody(body);

      const childGen = generation + 1;
      const diag = bboxDiagonal(fragment);
      const entry: PhysFragment = {
        mesh: fragment,
        body,
        generation: childGen,
        splittable: isRechopWorthy(diag, childGen),
        bornAt: now,
        settleUntil: now + settleMs,
        wedge: {
          normalX: planeNormal.x,
          normalZ: planeNormal.z,
          side,
          fromGap,
          toGap,
          startAt: now,
          durationMs: plan.messy ? 200 : 160,
          baseX,
          baseY,
          baseZ,
        },
      };
      fragment.userData.phys = entry;
      fragment.userData.role = 'fragment';
      fragment.userData.generation = childGen;
      fragments.push(entry);
      created.push(entry);
    }
    return created;
  }

  function fractureMesh(
    mesh: DestructibleMesh,
    worldImpact: THREE.Vector3,
    plan: FracturePlan,
    generation: number,
    scene: THREE.Scene,
  ): PhysFragment[] {
    if (plan.fragmentCount <= 0 || plan.nickOnly) return [];

    mesh.updateMatrixWorld(true);
    const planeNormal = buildCleaveNormal(mesh, worldImpact);

    const existingIdx = fragments.findIndex((f) => f.mesh === mesh);
    if (existingIdx >= 0) {
      removeFragment(existingIdx);
    }

    let pieces: DestructibleMesh[] = [];
    try {
      pieces = cleavePieces(mesh, worldImpact, planeNormal, plan);
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

    const created = registerPieces(pieces, worldImpact, planeNormal, plan, generation, scene);

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
      // Animate wedged crack opening along the cleave normal.
      if (f.wedge) {
        const w = f.wedge;
        const u = Math.min(1, (now - w.startAt) / Math.max(1, w.durationMs));
        const ease = u * u * (3 - 2 * u);
        const gap = w.fromGap + (w.toGap - w.fromGap) * ease;
        const x = w.baseX + w.normalX * w.side * gap;
        const z = w.baseZ + w.normalZ * w.side * gap;
        f.body.position.set(x, w.baseY, z);
        f.mesh.position.set(x, w.baseY, z);
        if (u >= 1) f.wedge = undefined;
        continue;
      }

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
    sync,
    step,
    clearFragments,
    prune,
    fractureMesh,
    disposeMesh,
  };
}
