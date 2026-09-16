import * as THREE from 'three';
import { DestructibleMesh } from '@dgreenheck/three-pinata';
import type { ChopOutcome, FracturePlan, Species } from '@firewood/game-core';
import { loadSpeciesMaterials, type SpeciesMaterials } from './assets';
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
  setSpecies(species: Species): Promise<void>;
  setAxeVisual(root: THREE.Object3D | null): void;
  playAxeSwing(aimPoint: THREE.Vector3): void;
  punchScale(amount?: number): void;
  setShake(intensity: number): void;
  update(dt: number): void;
  resize(): void;
  dispose(): void;
  findFragment(mesh: THREE.Object3D): PhysFragment | undefined;
}

/**
 * Fracture proxy: low-poly cylinder (Voronoi-friendly).
 * Visual stump is a separate dense GLB underneath — too heavy to fracture directly (~33k verts).
 */
function buildLogGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.38, 0.4, 1.05, 20, 3);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

export function createLogScene(
  canvas: HTMLCanvasElement,
  stumpModel: THREE.Object3D,
): LogScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1410, 8, 18);
  scene.background = new THREE.Color(0x1a1410);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
  let yaw = 0.7;
  let pitch = 0.38;
  const lookAt = new THREE.Vector3(0, 0.55, 0);
  const camRadius = 4.4;

  scene.add(new THREE.HemisphereLight(0xfff0dd, 0x2a1e14, 0.85));
  const key = new THREE.DirectionalLight(0xffe2c0, 1.35);
  key.position.set(3.4, 5.5, 2.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb8c8e0, 0.35);
  fill.position.set(-3, 2, -2);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 56),
    new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Real stump GLB (visual only)
  const stump = stumpModel;
  stump.position.set(0, 0.26, 0);
  scene.add(stump);

  let mats: SpeciesMaterials | null = null;
  let logMesh = createLogProxy();
  scene.add(logMesh);

  const axeAnchor = new THREE.Group();
  axeAnchor.position.set(1.15, 0.85, 0.55);
  scene.add(axeAnchor);
  let axeSwingT = -1;
  let axeRestQuat = new THREE.Quaternion();

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 14, 14),
    new THREE.MeshStandardMaterial({
      color: 0xffd28a,
      emissive: 0xc47a2c,
      emissiveIntensity: 0.75,
      roughness: 0.4,
    }),
  );
  marker.visible = false;
  scene.add(marker);
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.065, 0.1, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffe0a8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    }),
  );
  marker.add(markerRing);

  const nickMark = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 1, transparent: true }),
  );
  nickMark.visible = false;
  scene.add(nickMark);

  const fracture = createFractureWorld();
  let shake = 0;
  let punch = 0;
  let nickT = -1;

  function createLogProxy(): DestructibleMesh {
    const outer = mats?.outer ?? [
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.9 }),
    ];
    const inner =
      mats?.inner ?? new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.9 });
    const mesh = new DestructibleMesh(buildLogGeometry(), outer[0]!, inner);
    mesh.material = outer;
    mesh.position.set(0, 0.92, 0);
    mesh.userData.role = 'log';
    mesh.userData.generation = 0;
    return mesh;
  }

  function applyCamera(): void {
    const cp = Math.max(0.18, Math.min(1.15, pitch));
    camera.position.set(
      Math.cos(yaw) * Math.cos(cp) * camRadius,
      Math.sin(cp) * camRadius + 0.4,
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
    if (target === logMesh) logMesh.visible = false;
    return created;
  }

  function resetLog(): void {
    fracture.clearFragments();
    nickMark.visible = false;
    nickT = -1;
    clearMarker();
    if (logMesh.parent) logMesh.removeFromParent();
    fracture.disposeMesh(logMesh);
    logMesh = createLogProxy();
    scene.add(logMesh);
  }

  async function setSpecies(species: Species): Promise<void> {
    const next = await loadSpeciesMaterials(species);
    mats?.dispose();
    mats = next;
    // Refresh proxy materials if still whole
    if (logMesh.visible && logMesh.parent && logMesh.userData.role === 'log') {
      logMesh.material = next.outer;
    }
  }

  function setAxeVisual(root: THREE.Object3D | null): void {
    while (axeAnchor.children.length) axeAnchor.remove(axeAnchor.children[0]!);
    if (!root) return;
    const clone = root.clone(true);
    clone.rotation.set(0.2, -0.6, 0.35);
    axeAnchor.add(clone);
    axeRestQuat.copy(axeAnchor.quaternion);
  }

  function playAxeSwing(aimPoint: THREE.Vector3): void {
    axeAnchor.lookAt(aimPoint);
    axeSwingT = 0;
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
      if (nickT > 2.2) {
        nickMark.visible = false;
        nickT = -1;
      }
    }

    if (axeSwingT >= 0) {
      axeSwingT += dt;
      const t = Math.min(1, axeSwingT / 0.28);
      axeAnchor.rotation.x = -0.9 * Math.sin(t * Math.PI);
      if (t >= 1) {
        axeSwingT = -1;
        axeAnchor.quaternion.copy(axeRestQuat);
        axeAnchor.rotation.set(0, 0, 0);
      }
    }

    markerRing.rotation.z += dt * 2.5;
    applyCamera();
  }

  function dispose(): void {
    fracture.clearFragments();
    mats?.dispose();
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
    setSpecies,
    setAxeVisual,
    playAxeSwing,
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
    if (!mat?.emissive) continue;
    if (outcome === 'sweet') mat.emissive.setHex(0x1e3318);
    else if (outcome === 'too_light') mat.emissive.setHex(0x3a3010);
    else mat.emissive.setHex(0x3a1810);
    mat.emissiveIntensity = 0.35;
  }
}
