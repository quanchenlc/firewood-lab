import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata';
import {
  isRechopWorthy,
  MAX_LIVE_FRAGMENTS,
  TINY_CHIP_DIAGONAL,
  type FracturePlan,
} from '@firewood/game-core';

export interface PhysFragment {
  mesh: DestructibleMesh;
  body: CANNON.Body;
  generation: number;
  splittable: boolean;
  bornAt: number;
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

  function bboxDiagonal(mesh: THREE.Mesh): number {
    const box = new THREE.Box3().setFromObject(mesh);
    return box.getSize(new THREE.Vector3()).length();
  }

  function makeBodyFromMesh(mesh: THREE.Mesh, massScale: number): CANNON.Body {
    mesh.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(mesh);
    const wsize = worldBox.getSize(new THREE.Vector3());
    const half = new CANNON.Vec3(
      Math.max(0.04, wsize.x * 0.46),
      Math.max(0.04, wsize.y * 0.46),
      Math.max(0.04, wsize.z * 0.46),
    );
    const volume = Math.max(0.002, wsize.x * wsize.y * wsize.z);
    // Heavier chips settle sooner
    const mass = Math.max(0.08, volume * 220 * massScale);

    return new CANNON.Body({
      mass,
      shape: new CANNON.Box(half),
      material: woodMat,
      position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
      quaternion: new CANNON.Quaternion(
        mesh.quaternion.x,
        mesh.quaternion.y,
        mesh.quaternion.z,
        mesh.quaternion.w,
      ),
      linearDamping: 0.42,
      angularDamping: 0.55,
      allowSleep: true,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.25,
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

  function fractureMesh(
    mesh: DestructibleMesh,
    worldImpact: THREE.Vector3,
    plan: FracturePlan,
    generation: number,
    scene: THREE.Scene,
  ): PhysFragment[] {
    if (plan.fragmentCount <= 0) return [];

    mesh.updateMatrixWorld(true);
    const localImpact = mesh.worldToLocal(worldImpact.clone());

    const options = new FractureOptions({
      fractureMethod: 'voronoi',
      fragmentCount: plan.fragmentCount,
      seed: Math.floor(Math.random() * 1e9),
      voronoiOptions: {
        mode: '3D',
        impactPoint: localImpact,
        impactRadius: plan.impactRadius,
      },
    });

    const existingIdx = fragments.findIndex((f) => f.mesh === mesh);
    if (existingIdx >= 0) {
      removeFragment(existingIdx);
    }

    const created: PhysFragment[] = [];
    const now = performance.now();
    try {
      mesh.fracture(options, (fragment) => {
        scene.add(fragment);
        fragment.updateMatrixWorld(true);

        const body = makeBodyFromMesh(fragment, plan.messy ? 0.9 : 1.05);
        const away = new THREE.Vector3().subVectors(fragment.position, worldImpact);
        if (away.lengthSq() < 1e-6) {
          away.set(Math.random() - 0.5, 0.2, Math.random() - 0.5);
        }
        away.y = Math.max(0.05, away.y);
        away.normalize();

        // Prefer lateral split; keep upward kick small so pieces land on stump
        const boost = plan.impulse * (plan.messy ? 1.15 : 1);
        const jitter = plan.messy ? 0.28 : 0.12;
        const up = plan.messy ? 0.35 : 0.18;
        body.velocity.set(
          away.x * boost + (Math.random() - 0.5) * jitter * boost,
          up + Math.random() * 0.2,
          away.z * boost + (Math.random() - 0.5) * jitter * boost,
        );
        body.angularVelocity.set(
          (Math.random() - 0.5) * boost * 0.7,
          (Math.random() - 0.5) * boost * 0.45,
          (Math.random() - 0.5) * boost * 0.7,
        );
        // Lift slightly to reduce ground tunneling on spawn
        body.position.y += 0.04;
        world.addBody(body);

        const childGen = generation + 1;
        const diag = bboxDiagonal(fragment);
        const entry: PhysFragment = {
          mesh: fragment,
          body,
          generation: childGen,
          splittable: isRechopWorthy(diag, childGen),
          bornAt: now,
        };
        fragment.userData.phys = entry;
        fragment.userData.role = 'fragment';
        fragment.userData.generation = childGen;
        fragments.push(entry);
        created.push(entry);
      });
    } catch (err) {
      console.error('[fracture] Voronoi failed', err);
      return created;
    }

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
