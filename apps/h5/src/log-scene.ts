import * as THREE from 'three';
import type { ChopOutcome } from '@firewood/game-core';

export interface LogScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  logGroup: THREE.Group;
  logMesh: THREE.Mesh;
  stump: THREE.Mesh;
  ground: THREE.Mesh;
  marker: THREE.Mesh;
  halves: THREE.Group;
  raycastables: THREE.Object3D[];
  setOrbit(yaw: number, pitch: number): void;
  getOrbit(): { yaw: number; pitch: number };
  placeMarker(point: THREE.Vector3, normal: THREE.Vector3): void;
  clearMarker(): void;
  setWholeVisible(visible: boolean): void;
  playSplit(aimPoint: THREE.Vector3): void;
  resetLog(): void;
  punchScale(amount?: number): void;
  setShake(intensity: number): void;
  update(dt: number): void;
  resize(): void;
  dispose(): void;
}

const LOG_COLOR = 0x8b5a2b;
const RING_COLOR = 0xd4b896;
const STUMP_COLOR = 0x5c3d24;

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

  const hemi = new THREE.HemisphereLight(0xfff0dd, 0x3a2a1c, 1.05);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe2c0, 1.15);
  key.position.set(3.2, 5.2, 2.4);
  scene.add(key);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 56),
    new THREE.MeshStandardMaterial({ color: 0x2f241b, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
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

  const logGroup = new THREE.Group();
  logGroup.position.set(0, 0.95, 0);
  scene.add(logGroup);

  const logMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.45, 1.15, 28),
    new THREE.MeshStandardMaterial({ color: LOG_COLOR, roughness: 0.85 }),
  );
  logMesh.rotation.z = Math.PI / 2;
  logMesh.userData.role = 'log';
  logGroup.add(logMesh);

  const ringL = new THREE.Mesh(
    new THREE.CircleGeometry(0.41, 28),
    new THREE.MeshStandardMaterial({ color: RING_COLOR, roughness: 0.9 }),
  );
  ringL.position.set(-0.575, 0, 0);
  ringL.rotation.y = Math.PI / 2;
  logGroup.add(ringL);

  const ringR = ringL.clone();
  ringR.position.set(0.575, 0, 0);
  ringR.rotation.y = -Math.PI / 2;
  logGroup.add(ringR);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 16, 16),
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
    new THREE.RingGeometry(0.08, 0.12, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe0a8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
  );
  marker.add(markerRing);

  const halves = new THREE.Group();
  halves.visible = false;
  scene.add(halves);

  const halfGeo = new THREE.CylinderGeometry(0.42, 0.45, 0.56, 20, 1, false, 0, Math.PI);
  const halfMatA = new THREE.MeshStandardMaterial({ color: LOG_COLOR, roughness: 0.85 });
  const halfMatB = new THREE.MeshStandardMaterial({ color: LOG_COLOR, roughness: 0.85 });
  const halfA = new THREE.Mesh(halfGeo, halfMatA);
  const halfB = new THREE.Mesh(halfGeo, halfMatB);
  halfA.rotation.z = Math.PI / 2;
  halfB.rotation.z = Math.PI / 2;
  halfB.rotation.y = Math.PI;
  halves.add(halfA, halfB);

  let shake = 0;
  let punch = 0;
  let splitT = -1;
  const splitVel = [
    new THREE.Vector3(-1.2, 0.9, 0.35),
    new THREE.Vector3(1.2, 0.85, -0.3),
  ];

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

  function setWholeVisible(visible: boolean): void {
    logGroup.visible = visible;
  }

  function playSplit(aimPoint: THREE.Vector3): void {
    setWholeVisible(false);
    clearMarker();
    halves.visible = true;
    halves.position.copy(logGroup.position);
    halfA.position.set(0, 0, 0);
    halfB.position.set(0, 0, 0);
    halfA.rotation.set(0, 0, Math.PI / 2);
    halfB.rotation.set(0, Math.PI, Math.PI / 2);
    const bias = aimPoint.clone().sub(logGroup.position).normalize();
    splitVel[0]!.set(-1.15 - bias.x * 0.2, 1.05, 0.4);
    splitVel[1]!.set(1.15 + bias.x * 0.2, 0.95, -0.35);
    splitT = 0;
  }

  function resetLog(): void {
    halves.visible = false;
    splitT = -1;
    halfA.position.set(0, 0, 0);
    halfB.position.set(0, 0, 0);
    logGroup.scale.set(1, 1, 1);
    logGroup.visible = true;
    clearMarker();
    const mat = logMesh.material as THREE.MeshStandardMaterial;
    mat.color.setHex(LOG_COLOR);
    mat.emissive?.setHex(0x000000);
  }

  function punchScale(amount = 0.12): void {
    punch = amount;
  }

  function setShake(intensity: number): void {
    shake = intensity;
  }

  function update(dt: number): void {
    if (shake > 0) shake = Math.max(0, shake - dt * 2.8);
    if (punch > 0) {
      punch = Math.max(0, punch - dt * 1.8);
      const s = 1 + punch;
      logGroup.scale.set(s, s, s);
    } else if (logGroup.visible) {
      logGroup.scale.set(1, 1, 1);
    }

    if (splitT >= 0) {
      splitT += dt;
      const g = 2.6;
      for (let i = 0; i < 2; i++) {
        const mesh = halves.children[i] as THREE.Mesh;
        const v = splitVel[i]!;
        mesh.position.x += v.x * dt;
        mesh.position.y += v.y * dt;
        mesh.position.z += v.z * dt;
        v.y -= g * dt;
        mesh.rotation.x += (i === 0 ? -1 : 1) * dt * 2.2;
        mesh.rotation.z += dt * 1.4;
      }
    }

    markerRing.rotation.z += dt * 2.5;
    applyCamera();
  }

  function dispose(): void {
    renderer.dispose();
  }

  resize();
  applyCamera();

  return {
    scene,
    camera,
    renderer,
    logGroup,
    logMesh,
    stump,
    ground,
    marker,
    halves,
    raycastables: [logMesh],
    setOrbit(y, p) {
      yaw = y;
      pitch = p;
    },
    getOrbit: () => ({ yaw, pitch }),
    placeMarker,
    clearMarker,
    setWholeVisible,
    playSplit,
    resetLog,
    punchScale,
    setShake,
    update,
    resize,
    dispose,
  };
}

export function tintLog(mesh: THREE.Mesh, outcome: ChopOutcome): void {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  if (outcome === 'sweet') {
    mat.color.setHex(0x7a9a5a);
    mat.emissive.setHex(0x1e3318);
  } else if (outcome === 'too_light') {
    mat.color.setHex(0xb89a4a);
    mat.emissive.setHex(0x3a3010);
  } else {
    mat.color.setHex(0xa85a42);
    mat.emissive.setHex(0x3a1810);
  }
  mat.emissiveIntensity = 0.45;
}
