import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata';
import {
  isRechopWorthy,
  type FracturePlan,
} from '@firewood/game-core';

export interface PhysFragment {
  mesh: DestructibleMesh;
  body: CANNON.Body;
  generation: number;
  splittable: boolean;
}

export interface FractureWorld {
  world: CANNON.World;
  fragments: PhysFragment[];
  sync(): void;
  clearFragments(): void;
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
    gravity: new CANNON.Vec3(0, -9.5, 0),
  });
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.55;
  world.defaultContactMaterial.restitution = 0.08;

  const ground = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
  });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  const stump = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Cylinder(0.7, 0.82, 0.45, 12),
    position: new CANNON.Vec3(0, 0.225, 0),
  });
  world.addBody(stump);

  const fragments: PhysFragment[] = [];

  function bboxDiagonal(mesh: THREE.Mesh): number {
    const box = new THREE.Box3().setFromObject(mesh);
    return box.getSize(new THREE.Vector3()).length();
  }

  function makeBodyFromMesh(mesh: THREE.Mesh, massScale: number): CANNON.Body {
    mesh.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(mesh);
    const wsize = worldBox.getSize(new THREE.Vector3());
    const half = new CANNON.Vec3(
      Math.max(0.035, wsize.x * 0.48),
      Math.max(0.035, wsize.y * 0.48),
      Math.max(0.035, wsize.z * 0.48),
    );
    const volume = Math.max(0.002, wsize.x * wsize.y * wsize.z);
    const mass = Math.max(0.05, volume * 160 * massScale);

    // three-pinata already centers geometry and places mesh at world centroid
    return new CANNON.Body({
      mass,
      shape: new CANNON.Box(half),
      position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
      quaternion: new CANNON.Quaternion(
        mesh.quaternion.x,
        mesh.quaternion.y,
        mesh.quaternion.z,
        mesh.quaternion.w,
      ),
      linearDamping: 0.25,
      angularDamping: 0.38,
      allowSleep: true,
      sleepSpeedLimit: 0.2,
      sleepTimeLimit: 0.4,
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

  function clearFragments(): void {
    for (const f of fragments) {
      world.removeBody(f.body);
      f.mesh.removeFromParent();
      disposeMesh(f.mesh, true);
    }
    fragments.length = 0;
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
      const existing = fragments[existingIdx]!;
      world.removeBody(existing.body);
      fragments.splice(existingIdx, 1);
    }

    const created: PhysFragment[] = [];
    try {
      mesh.fracture(options, (fragment) => {
        scene.add(fragment);
        fragment.updateMatrixWorld(true);

        const body = makeBodyFromMesh(fragment, plan.messy ? 0.85 : 1);
        const away = new THREE.Vector3().subVectors(fragment.position, worldImpact);
        if (away.lengthSq() < 1e-6) {
          away.set(Math.random() - 0.5, 0.7, Math.random() - 0.5);
        }
        away.normalize();
        const boost = plan.impulse * (plan.messy ? 1.4 : 1);
        const jitter = plan.messy ? 0.6 : 0.28;
        body.velocity.set(
          away.x * boost + (Math.random() - 0.5) * jitter * boost,
          Math.max(0.5, away.y * boost * 0.45) + 0.55 + Math.random() * 0.55,
          away.z * boost + (Math.random() - 0.5) * jitter * boost,
        );
        body.angularVelocity.set(
          (Math.random() - 0.5) * boost * 1.2,
          (Math.random() - 0.5) * boost,
          (Math.random() - 0.5) * boost * 1.2,
        );
        world.addBody(body);

        const childGen = generation + 1;
        const diag = bboxDiagonal(fragment);
        const entry: PhysFragment = {
          mesh: fragment,
          body,
          generation: childGen,
          splittable: isRechopWorthy(diag, childGen),
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

    return created;
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
    clearFragments,
    fractureMesh,
    disposeMesh,
  };
}
