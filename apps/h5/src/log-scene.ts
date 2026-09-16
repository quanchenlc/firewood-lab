import * as THREE from 'three';
import { DestructibleMesh } from '@dgreenheck/three-pinata';
import type { ChopOutcome, FracturePlan } from '@firewood/game-core';
import { createFractureWorld, type FractureWorld, type PhysFragment } from './fracture-world';

export interface LogScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  logMesh: DestructibleMesh;
  fracture: FractureWorld;
  getRaycastTargets(): THREE.Object3D[];
  setOrbit(yaw: number, pitch: number): void;
  getOrbit(): { yaw: number; pitch: number };
  placeMarker(point: THREE.Vector3, normal: THREE.Vector3): void;
  clearMarker(): void;
  playNick(aimPoint: THREE.Vector3): void;
  fractureAt(
    target: DestructibleMesh,
    aimPoint: THREE.Vector3,
    plan: FracturePlan,
    generation: number,
  ): PhysFragment[];
  resetLog(): void;
  punchScale(amount?: number): void;
  setShake(intensity: number): void;
  update(dt: number): void;
  resize(): void;
  dispose(): void;
  findFragment(mesh: THREE.Object3D): PhysFragment | undefined;
}

const LOG_COLOR = 0x8b5a2b;
const INNER_COLOR = 0xd4b896;
const STUMP_COLOR = 0x5c3d24;

function buildLogGeometry(): THREE.BufferGeometry {
  // Slightly lower radial segments for mobile Voronoi cost.
  const geo = new THREE.CylinderGeometry(0.42, 0.45, 1.15, 16, 4);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

export function createLogScene(canvas: HTMLCanvasElement): LogScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1410, 7, 16);
  scene.background = new THREE.Color(0x1a1410);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
  let yaw = 0.55;
  let pitch = 0.42;
  const lookAt = new THREE.Vector3(0, 0.55, 0);
  const camRadius = 4.2;

  scene.add(new THREE.HemisphereLight(0xfff0dd, 0x3a2a1c, 1.05));
  const key = new THREE.DirectionalLight(0xffe2c0, 1.15);
  key.position.set(3.2, 5.2, 2.4);
  scene.add(key);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 56),
    new THREE.MeshStandardMaterial({ color: 0x2f241b, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const stump = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.86, 0.45, 20),
    new THREE.MeshStandardMaterial({ color: STUMP_COLOR, roughness: 0.92 }),
  );
  stump.position.y = 0.225;
  scene.add(stump);

  const stumpTop = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 28),
    new THREE.MeshStandardMaterial({ color: 0xb8956a, roughness: 0.95 }),
  );
  stumpTop.rotation.x = -Math.PI / 2;
  stumpTop.position.y = 0.46;
  scene.add(stumpTop);

  const outerMat = new THREE.MeshStandardMaterial({ color: LOG_COLOR, roughness: 0.85 });
  const innerMat = new THREE.MeshStandardMaterial({ color: INNER_COLOR, roughness: 0.9 });

  let logMesh = new DestructibleMesh(buildLogGeometry(), outerMat, innerMat);
  logMesh.position.set(0, 0.95, 0);
  logMesh.userData.role = 'log';
  logMesh.userData.generation = 0;
  scene.add(logMesh);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 14, 14),
    new THREE.MeshStandardMaterial({
      color: 0xffd28a,
      emissive: 0xc47a2c,
      emissiveIntensity: 0.7,
      roughness: 0.4,
    }),
  );
  marker.visible = false;
  scene.add(marker);
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.11, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffe0a8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    }),
  );
  marker.add(markerRing);

  const nickMark = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 10, 10),
    new THREE.MeshStandardMaterial({
      color: 0x3a2a18,
      emissive: 0x22180c,
      emissiveIntensity: 0.35,
      roughness: 1,
    }),
  );
  nickMark.visible = false;
  scene.add(nickMark);

  const fracture = createFractureWorld();

  let shake = 0;
  let punch = 0;
  let nickT = -1;

  function applyCamera(): void {
    const cp = Math.max(0.18, Math.min(1.2, pitch));
    camera.position.set(
      Math.cos(yaw) * Math.cos(cp) * camRadius,
      Math.sin(cp) * camRadius + 0.35,
      Math.sin(yaw) * Math.cos(cp) * camRadius,
    );
    if (shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.position.z += (Math.random() - 0.5) * shake;
    }
    camera.lookAt(lookAt);
  }

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function placeMarker(point: THREE.Vector3, normal: THREE.Vector3): void {
    marker.visible = true;
    marker.position.copy(point);
    marker.lookAt(point.clone().add(normal));
  }

  function clearMarker(): void {
    marker.visible = false;
  }

  function getRaycastTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    if (logMesh.visible && logMesh.parent) targets.push(logMesh);
    for (const f of fracture.fragments) {
      if (f.splittable && f.mesh.visible) targets.push(f.mesh);
    }
    return targets;
  }

  function findFragment(mesh: THREE.Object3D): PhysFragment | undefined {
    return fracture.fragments.find((f) => f.mesh === mesh);
  }

  function playNick(aimPoint: THREE.Vector3): void {
    nickMark.visible = true;
    nickMark.position.copy(aimPoint);
    nickT = 0;
  }

  function fractureAt(
    target: DestructibleMesh,
    aimPoint: THREE.Vector3,
    plan: FracturePlan,
    generation: number,
  ): PhysFragment[] {
    clearMarker();
    nickMark.visible = false;
    const created = fracture.fractureMesh(target, aimPoint, plan, generation, scene);
    if (target === logMesh) {
      // Original log consumed; keep a placeholder reference for reset
      logMesh.visible = false;
    }
    return created;
  }

  function resetLog(): void {
    fracture.clearFragments();
    nickMark.visible = false;
    nickT = -1;
    clearMarker();

    if (logMesh.parent) logMesh.removeFromParent();
    fracture.disposeMesh(logMesh);

    const freshOuter = outerMat.clone();
    const freshInner = innerMat.clone();
    logMesh = new DestructibleMesh(buildLogGeometry(), freshOuter, freshInner);
    logMesh.position.set(0, 0.95, 0);
    logMesh.userData.role = 'log';
    logMesh.userData.generation = 0;
    scene.add(logMesh);
  }

  function punchScale(amount = 0.12): void {
    punch = amount;
  }

  function setShake(intensity: number): void {
    shake = intensity;
  }

  function update(dt: number): void {
    fracture.world.step(1 / 60, dt, 4);
    fracture.sync();

    if (shake > 0) shake = Math.max(0, shake - dt * 2.8);
    if (punch > 0) {
      punch = Math.max(0, punch - dt * 1.8);
      if (logMesh.visible) {
        const s = 1 + punch;
        logMesh.scale.set(s, s, s);
      }
    } else if (logMesh.visible) {
      logMesh.scale.set(1, 1, 1);
    }

    if (nickT >= 0) {
      nickT += dt;
      const mat = nickMark.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, 1 - nickT / 2.2);
      mat.transparent = true;
      if (nickT > 2.2) {
        nickMark.visible = false;
        nickT = -1;
      }
    }

    markerRing.rotation.z += dt * 2.5;
    applyCamera();
  }

  function dispose(): void {
    fracture.clearFragments();
    renderer.dispose();
  }

  resize();
  applyCamera();

  return {
    scene,
    camera,
    renderer,
    get logMesh() {
      return logMesh;
    },
    fracture,
    getRaycastTargets,
    setOrbit(y, p) {
      yaw = y;
      pitch = p;
    },
    getOrbit: () => ({ yaw, pitch }),
    placeMarker,
    clearMarker,
    playNick,
    fractureAt,
    resetLog,
    punchScale,
    setShake,
    update,
    resize,
    dispose,
    findFragment,
  };
}

export function tintLog(mesh: THREE.Mesh, outcome: ChopOutcome): void {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const raw of mats) {
    const mat = raw as THREE.MeshStandardMaterial;
    if (!mat?.color) continue;
    if (outcome === 'sweet') {
      mat.emissive?.setHex(0x1e3318);
    } else if (outcome === 'too_light') {
      mat.emissive?.setHex(0x3a3010);
    } else {
      mat.emissive?.setHex(0x3a1810);
    }
    if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0.4;
  }
}
