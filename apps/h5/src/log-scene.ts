import * as THREE from 'three';
import { DestructibleMesh } from '@dgreenheck/three-pinata';
import {
  AZIMUTH_NUDGE_DAMP,
  azimuthNudgeVelocity,
  type ChopOutcome,
  type FracturePlan,
  type Species,
} from '@firewood/game-core';
import {
  loadSpeciesMaterials,
  type PlantedStump,
  type SpeciesMaterials,
  type YardTextures,
} from './assets';
import { createFractureWorld, type FractureWorld, type PhysFragment } from './fracture-world';
import {
  CAM_LOOK_AT_Y,
  CAM_RADIUS,
  applyBarkIrregularity,
  camLookAtY,
  sampleLogRound,
  type LogRoundDims,
  STUMP_BOT_RADIUS,
} from './log-dimensions';
import { enableSunShadows, setShadowFlags } from './shadows';

export interface LogScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  logMesh: DestructibleMesh;
  fracture: FractureWorld;
  getRaycastTargets(): THREE.Object3D[];
  setOrbit(yaw: number, pitch: number): void;
  getOrbit(): { yaw: number; pitch: number };
  /**
   * Smooth ~90° azimuth nudge (reference `nudgeAzimuth`).
   * `sign` from click left (−1) / right (+1) of screen center.
   */
  nudgeAzimuth(sign: number): void;
  placeMarker(point: THREE.Vector3, normal: THREE.Vector3): void;
  clearMarker(): void;
  /** Horizontal camera facing in XZ (for cleave plane from view). */
  getCameraFacingXZ(): { x: number; z: number };
  scatterAndRecycle(): void;
  isRecycling(): boolean;
  playNick(aimPoint: THREE.Vector3): void;
  fractureAt(
    target: DestructibleMesh,
    aimPoint: THREE.Vector3,
    plan: FracturePlan,
    generation: number,
    opts?: { planeNormal?: THREE.Vector3 },
  ): PhysFragment[];
  /** Largest re-choppable fragment, or null. */
  pickNextChopTarget(): { mesh: DestructibleMesh; point: THREE.Vector3; generation: number } | null;
  /** World-space cleave normal used for the last successful split (if any). */
  lastCleaveNormal: THREE.Vector3 | null;
  debugFreezeAxeImpact(): void;
  debugAxePose(): {
    pos: number[];
    quat: number[];
    handleDir: number[];
    bitDir: number[];
    handleDotUp: number;
  };
  resetLog(opts?: { keepPile?: boolean }): void;
  /** Current upright-round dims (metres + bark seed). */
  getRoundDims(): LogRoundDims;
  setSpecies(species: Species): Promise<void>;
  setAxeVisual(root: THREE.Object3D | null): void;
  playAxeSwing(aimPoint: THREE.Vector3, opts?: { rebound?: boolean }): void;
  punchScale(amount?: number): void;
  setShake(intensity: number): void;
  update(dt: number): void;
  resize(): void;
  dispose(): void;
  findFragment(mesh: THREE.Object3D): PhysFragment | undefined;
}

/**
 * Fracture proxy: low-poly cylinder (Voronoi/slice-friendly).
 * Rest pose is upright — cut face up, axis near world +Y (like screen.toys/firewood).
 * Visual stump is a separate dense GLB underneath — too heavy to fracture directly (~33k verts).
 * Dimensions: see `log-dimensions.ts` — resampled each round (height / radius / bark).
 */
function buildLogGeometry(dims: LogRoundDims): THREE.BufferGeometry {
  // CylinderGeometry default: axis = +Y, caps on top/bottom (end-grain).
  // 32×8 matches reference `ow` density so bark + plan lobes read in silhouette.
  const geo = new THREE.CylinderGeometry(dims.radiusTop, dims.radiusBot, dims.height, 32, 8);
  applyBarkIrregularity(geo, dims);
  return geo;
}

/**
 * Poly Haven axes: longest axis = handle. Normalize so:
 * - handle along local +Y (butt up)
 * - bit / head toward local -Y
 * - thinnest axis → local +X (blade faces ±X) for a vertical bit silhouette
 */
function orientAxeGrip(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  // Map longest bbox axis onto +Y (handle).
  if (size.x >= size.y && size.x >= size.z) {
    root.rotateZ(-Math.PI / 2);
  } else if (size.z >= size.y && size.z >= size.x) {
    root.rotateX(Math.PI / 2);
  }
  root.updateMatrixWorld(true);

  let box2 = new THREE.Box3().setFromObject(root);
  let size2 = box2.getSize(new THREE.Vector3());
  // Thinnest horizontal axis → +X so the blade plane is YZ (vertical bit).
  if (size2.z < size2.x) {
    root.rotateY(Math.PI / 2);
    root.updateMatrixWorld(true);
    box2 = new THREE.Box3().setFromObject(root);
    size2 = box2.getSize(new THREE.Vector3());
  }

  const center = box2.getCenter(new THREE.Vector3());
  const upExtent = box2.max.y - center.y;
  const downExtent = center.y - box2.min.y;
  // Heavier/head end usually has more radial mass; prefer bit at -Y.
  if (upExtent >= downExtent * 0.92) {
    root.rotateZ(Math.PI);
  }

  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(root);
  const c3 = box3.getCenter(new THREE.Vector3());
  root.position.x -= c3.x;
  root.position.y -= c3.y;
  root.position.z -= c3.z;
}

/** Deterministic LCG so chip layout is stable across reloads. */
function yardRand(seed: { n: number }): number {
  seed.n = (seed.n * 1664525 + 1013904223) >>> 0;
  return seed.n / 0xffffffff;
}

/**
 * Lean wood chips + bark scraps around the chopping block (instanced, no extra textures).
 * Keeps mobile draw calls low while breaking the "stump in a void" look.
 */
function addYardDebris(scene: THREE.Scene, opts: { weak: boolean }): void {
  const count = opts.weak ? 28 : 42;
  const seed = { n: 0xc0ffee41 };
  const chipGeo = new THREE.BoxGeometry(1, 1, 1);
  const barkMat = new THREE.MeshStandardMaterial({
    color: 0x7a5338,
    roughness: 0.92,
    metalness: 0,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0xdfc08a,
    roughness: 0.85,
    metalness: 0,
  });
  const chipInst = new THREE.InstancedMesh(chipGeo, barkMat, count);
  const faceInst = new THREE.InstancedMesh(chipGeo, faceMat, Math.max(8, Math.floor(count * 0.35)));
  const dummy = new THREE.Object3D();
  let faceIdx = 0;

  for (let i = 0; i < count; i++) {
    const ang = yardRand(seed) * Math.PI * 2;
    // Prefer a ring around the stump; keep clear of the log footprint.
    const rad = STUMP_BOT_RADIUS + 0.35 + yardRand(seed) * 2.2 + (i % 5) * 0.08;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    const sx = 0.05 + yardRand(seed) * 0.11;
    const sy = 0.012 + yardRand(seed) * 0.028;
    const sz = 0.03 + yardRand(seed) * 0.09;
    dummy.position.set(x, sy * 0.5 + 0.002, z);
    dummy.rotation.set(
      (yardRand(seed) - 0.5) * 0.55,
      yardRand(seed) * Math.PI * 2,
      (yardRand(seed) - 0.5) * 0.7,
    );
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    chipInst.setMatrixAt(i, dummy.matrix);

    // A subset of brighter face-grain flakes for visual variety.
    if (faceIdx < faceInst.count && yardRand(seed) > 0.55) {
      dummy.position.y += 0.004;
      dummy.scale.set(sx * 0.85, sy * 0.7, sz * 1.1);
      dummy.updateMatrix();
      faceInst.setMatrixAt(faceIdx, dummy.matrix);
      faceIdx += 1;
    }
  }

  // Hide unused face instances by collapsing them.
  for (let i = faceIdx; i < faceInst.count; i++) {
    dummy.position.set(0, -10, 0);
    dummy.scale.set(0.001, 0.001, 0.001);
    dummy.updateMatrix();
    faceInst.setMatrixAt(i, dummy.matrix);
  }
  chipInst.instanceMatrix.needsUpdate = true;
  faceInst.instanceMatrix.needsUpdate = true;
  chipInst.frustumCulled = true;
  faceInst.frustumCulled = true;
  // Soft contact under yard chips — InstancedMesh shadow is one draw.
  chipInst.castShadow = true;
  faceInst.castShadow = true;
  scene.add(chipInst);
  scene.add(faceInst);

  // A few larger bark scraps (individual meshes, low count).
  const scrapCount = opts.weak ? 4 : 7;
  const scrapGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.045, 6, 1, false, 0, Math.PI);
  const scrapMat = new THREE.MeshStandardMaterial({
    color: 0x4a3220,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  for (let i = 0; i < scrapCount; i++) {
    const ang = yardRand(seed) * Math.PI * 2;
    const rad = STUMP_BOT_RADIUS + 0.65 + yardRand(seed) * 1.5;
    const scrap = new THREE.Mesh(scrapGeo, scrapMat);
    scrap.position.set(Math.cos(ang) * rad, 0.02, Math.sin(ang) * rad);
    scrap.rotation.set(
      Math.PI / 2 + (yardRand(seed) - 0.5) * 0.4,
      yardRand(seed) * Math.PI * 2,
      (yardRand(seed) - 0.5) * 0.5,
    );
    scrap.scale.setScalar(0.75 + yardRand(seed) * 0.7);
    scrap.castShadow = true;
    scene.add(scrap);
  }
}

export function createLogScene(
  canvas: HTMLCanvasElement,
  choppingBlock: PlantedStump,
  opts: { weakDevice?: boolean; yard?: YardTextures } = {},
): LogScene {
  const weak = !!opts.weakDevice;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !weak,
    alpha: true,
    powerPreference: weak ? 'low-power' : 'high-performance',
  });
  const maxDpr = weak ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Daytime outdoor feel — slight warm lift only (no proprietary color grade).
  renderer.toneMappingExposure = weak ? 1.48 : 1.66;

  const scene = new THREE.Scene();
  // Soft daylight haze — pushed out so the equirect sky stays readable.
  scene.fog = new THREE.Fog(0xb9cce0, 16, 38);
  scene.background = new THREE.Color(0xb9cce0);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);
  let yaw = 0.7;
  let pitch = 0.38;
  /** Per-frame damped yaw velocity for too-thin camera nudge. */
  let azimuthVelocity = 0;
  const lookAt = new THREE.Vector3(0, CAM_LOOK_AT_Y, 0);
  const camRadius = CAM_RADIUS;
  /** Current upright round — resampled on each reset / species rebuild. */
  let roundDims: LogRoundDims = sampleLogRound();

  // Bright outdoor lighting — hemi/fill kept moderate so sun shadows stay readable
  // on the yard (too much bounce washed contact under stump / chips).
  scene.add(new THREE.HemisphereLight(0xfff4e4, 0x7f9a62, weak ? 1.15 : 1.32));
  const key = new THREE.DirectionalLight(0xffefd4, weak ? 2.35 : 2.9);
  key.position.set(3.6, 6.8, 2.6);
  scene.add(key);
  // Real shadowMap (not ContactShadows) — map size / type tuned for mobile H5.
  enableSunShadows(renderer, scene, key, { weakDevice: weak });
  const fill = new THREE.DirectionalLight(0xc2daf5, weak ? 0.42 : 0.55);
  fill.position.set(-3.2, 2.8, -2.4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xeef4ff, 0.28);
  rim.position.set(-1.5, 3.8, 4.5);
  scene.add(rim);

  // Textured forest ground (lean 1K maps). Fall back to tinted plane if missing.
  const yard = opts.yard;
  if (yard?.sky) {
    // Sky dome (inward sphere) — daytime outdoor, not flat fog void.
    // Prefer mesh map over scene.background equirect for mobile/software GL.
    if (yard.sky.mapping === THREE.EquirectangularReflectionMapping) {
      scene.background = yard.sky;
    } else {
      const skyDome = new THREE.Mesh(
        new THREE.SphereGeometry(48, weak ? 24 : 40, weak ? 12 : 20),
        new THREE.MeshBasicMaterial({
          map: yard.sky,
          side: THREE.BackSide,
          depthWrite: false,
          fog: false,
        }),
      );
      skyDome.frustumCulled = false;
      scene.add(skyDome);
      scene.background = new THREE.Color(0x8fb0d4);
    }
    // Very light haze only — keep clouds readable on mobile.
    scene.fog = new THREE.Fog(0xc8d4e6, 32, 75);
  }

  const groundMat = new THREE.MeshStandardMaterial({
    map: yard?.groundDiff,
    normalMap: yard?.groundNor ?? undefined,
    // Slight warm lift so the rocky albedo reads as daytime dirt/grass.
    color: yard?.groundDiff ? 0xf3ecdf : 0x8ea56a,
    roughness: 0.92,
    metalness: 0,
  });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(7.2, weak ? 48 : 64), groundMat);
  ground.rotation.x = -Math.PI / 2;
  // Align with tip-drop / ring AABB settle + physics Plane (YARD_GROUND_Y = 0).
  ground.position.y = 0;
  // Contact shadows under stump / log / firewood — was false so pieces looked pasted.
  ground.receiveShadow = true;
  scene.add(ground);

  addYardDebris(scene, { weak });

  // Hierarchy: ground → stump chopping block (flat cut top) → upright round on face.
  // Stump sits directly on the yard texture (no packed-earth pad blob).
  const planted = choppingBlock;
  const stump = planted.root;
  scene.add(stump);
  stump.updateMatrixWorld(true);
  const stumpTopY = planted.topY;
  let logCenterY = stumpTopY + roundDims.height * 0.5 + 0.002;
  lookAt.y = camLookAtY(roundDims, stumpTopY);

  let mats: SpeciesMaterials | null = null;
  let logMesh = createLogProxy(false);
  scene.add(logMesh);

  // First-person axe: hidden at rest; appears only during the vertical swing.
  const axeAnchor = new THREE.Group();
  axeAnchor.visible = false;
  scene.add(axeAnchor);
  let axeSwingT = -1;
  /** -2 = frozen for debug screenshots (skip auto-advance). */
  let axeFrozen = false;
  let axeRebound = false;
  const axeSwingAim = new THREE.Vector3();
  const axeImpactPos = new THREE.Vector3();
  const axeRaisedPos = new THREE.Vector3();
  /** Horizontal axis to pitch around during the vertical top→down swing. */
  const axeSwingAxis = new THREE.Vector3(1, 0, 0);
  const axeGripQuat = new THREE.Quaternion();
  let axeFade = 1;
  let lastCleaveNormal: THREE.Vector3 | null = null;
  /** Extra scale while swinging so the FP grip fills the lower view. */
  const AXE_FP_SCALE = 2.35;

  const _swingQuat = new THREE.Quaternion();
  const _pitchQuat = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  const _tmp = new THREE.Vector3();
  const _basis = new THREE.Matrix4();
  const _camRight = new THREE.Vector3();
  const _camUp = new THREE.Vector3();
  const _camFwd = new THREE.Vector3();

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 14, 14),
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
    new THREE.RingGeometry(0.045, 0.07, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffe0a8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    }),
  );
  marker.add(markerRing);

  const nickMark = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 1, transparent: true }),
  );
  nickMark.visible = false;
  scene.add(nickMark);

  const fracture = createFractureWorld({
    stumpSupportY: stumpTopY,
    stumpHeight: planted.height,
    stumpRadius: planted.topRadius,
  });
  fracture.setStumpSupportY(stumpTopY);
  fracture.fitStumpCollider({
    topY: stumpTopY,
    height: planted.height,
    radius: planted.topRadius,
  });
  let shake = 0;
  let punch = 0;
  let nickT = -1;

  function createLogProxy(resample = false): DestructibleMesh {
    if (resample) roundDims = sampleLogRound();
    logCenterY = stumpTopY + roundDims.height * 0.5 + 0.002;
    lookAt.y = camLookAtY(roundDims, stumpTopY);
    const outer = mats?.outer ?? [
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.9 }),
    ];
    const inner =
      mats?.inner ??
      new THREE.MeshStandardMaterial({
        color: 0xc4a574,
        roughness: 0.9,
        side: THREE.DoubleSide,
      });
    const mesh = new DestructibleMesh(buildLogGeometry(roundDims), outer[0]!, inner);
    mesh.material = outer;
    mesh.userData.barkMat = outer[0];
    mesh.userData.endgrainMat = outer[1] ?? outer[0];
    mesh.userData.innerMat = inner;
    mesh.position.set(0, logCenterY, 0);
    mesh.userData.role = 'log';
    mesh.userData.generation = 0;
    mesh.userData.logDims = { ...roundDims };
    // Choppable round casts onto stump top + yard ground.
    setShadowFlags(mesh, { cast: true, receive: true });
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function placeMarker(_point: THREE.Vector3, _normal: THREE.Vector3): void {
    // Aim marker removed — chop plane comes from camera facing.
    marker.visible = false;
  }

  function clearMarker(): void {
    marker.visible = false;
  }

  function getCameraFacingXZ(): { x: number; z: number } {
    camera.getWorldDirection(_camFwd);
    const fx = _camFwd.x;
    const fz = _camFwd.z;
    const len = Math.hypot(fx, fz);
    if (len < 1e-8) return { x: 0, z: 1 };
    return { x: fx / len, z: fz / len };
  }

  function scatterAndRecycle(): void {
    fracture.scatterToGround();
    // Let tip-drop finish, then pull into the annular ring pile (ref radius ≈ 60×ld).
    window.setTimeout(() => {
      fracture.recycleToRing({ groundY: 0 });
    }, 720);
  }

  function isRecycling(): boolean {
    return fracture.isRecycling();
  }

  function getRaycastTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    // Whole log is aimable only until it has been registered as a tossed chip.
    if (logMesh.visible && logMesh.parent && !findFragment(logMesh)) {
      targets.push(logMesh);
    }
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
    opts?: { planeNormal?: THREE.Vector3 },
  ): PhysFragment[] {
    clearMarker();
    nickMark.visible = false;
    const created = fracture.fractureMesh(target, aimPoint, plan, generation, scene, opts);
    if (created.length > 0) {
      const n = opts?.planeNormal;
      if (n) {
        lastCleaveNormal = new THREE.Vector3(n.x, 0, n.z).normalize();
      } else {
        // Infer from first bounce entry if present.
        const b = created[0]?.bounce;
        if (b) lastCleaveNormal = new THREE.Vector3(b.normalX, 0, b.normalZ).normalize();
      }
    }
    if (target === logMesh) logMesh.visible = false;
    return created;
  }

  function pickNextChopTarget(): {
    mesh: DestructibleMesh;
    point: THREE.Vector3;
    generation: number;
  } | null {
    const candidates = fracture.fragments.filter((f) => f.splittable && f.mesh.visible);
    if (candidates.length === 0) {
      if (logMesh.visible && logMesh.parent && !findFragment(logMesh)) {
        return {
          mesh: logMesh,
          point: new THREE.Vector3(0, logCenterY + roundDims.height * 0.15, 0),
          generation: 0,
        };
      }
      return null;
    }
    let best = candidates[0]!;
    let bestDiag = 0;
    for (const f of candidates) {
      const box = new THREE.Box3().setFromObject(f.mesh);
      const diag = box.getSize(new THREE.Vector3()).length();
      if (diag > bestDiag) {
        bestDiag = diag;
        best = f;
      }
    }
    const box = new THREE.Box3().setFromObject(best.mesh);
    const center = box.getCenter(new THREE.Vector3());
    // Strike through mid-height of the standing wedge (parallel to locked plane).
    center.y = (box.min.y + box.max.y) * 0.5;
    return { mesh: best.mesh, point: center, generation: best.generation };
  }

  function resetLog(opts?: { keepPile?: boolean }): void {
    if (opts?.keepPile) fracture.clearStumpPieces();
    else fracture.clearFragments();
    nickMark.visible = false;
    nickT = -1;
    lastCleaveNormal = null;
    hideAxe();
    clearMarker();
    if (logMesh.parent) logMesh.removeFromParent();
    fracture.disposeMesh(logMesh);
    logMesh = createLogProxy(true);
    scene.add(logMesh);
  }

  async function setSpecies(species: Species): Promise<void> {
    const next = await loadSpeciesMaterials(species);
    mats?.dispose();
    mats = next;
    // Rebuild DestructibleMesh so three-pinata keeps mapped outer/inner materials
    // (private material refs are set at construction time).
    if (logMesh.visible && logMesh.parent && logMesh.userData.role === 'log') {
      if (logMesh.parent) logMesh.removeFromParent();
      fracture.disposeMesh(logMesh);
      logMesh = createLogProxy(false);
      scene.add(logMesh);
    }
  }

  function setAxeOpacity(opacity: number): void {
    axeAnchor.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const raw of mats) {
        const mat = raw as THREE.MeshStandardMaterial;
        if (!mat) continue;
        mat.transparent = opacity < 0.999;
        mat.opacity = opacity;
        mat.depthWrite = opacity > 0.85;
      }
    });
  }

  /**
   * First-person grip: hands/butt at bottom of screen, bit toward the log (up).
   * local +Y → screen-down (butt); local -Y (bit) → screen-up toward log.
   * Swing pitches around camera-right (pure vertical plane).
   */
  function buildVerticalGripQuat(out: THREE.Quaternion): void {
    camera.getWorldDirection(_camFwd);
    _camRight.crossVectors(_camFwd, _up);
    if (_camRight.lengthSq() < 1e-8) _camRight.set(1, 0, 0);
    else _camRight.normalize();
    _camUp.crossVectors(_camRight, _camFwd).normalize();
    // Prefer near-world-up so the handle reads vertical (no 45° screen lean).
    _camUp.lerp(_up, 0.92).normalize();
    _camFwd.crossVectors(_camUp, _camRight).normalize();
    _camRight.crossVectors(_camFwd, _camUp).normalize();
    // Flip Y: butt toward screen-bottom (-camUp), bit toward log (+camUp).
    _tmp.copy(_camUp).multiplyScalar(-1);
    _basis.makeBasis(_camRight, _tmp, _camFwd);
    out.setFromRotationMatrix(_basis);
    axeSwingAxis.copy(_camRight);
  }

  function setAxeVisual(root: THREE.Object3D | null): void {
    while (axeAnchor.children.length) axeAnchor.remove(axeAnchor.children[0]!);
    if (!root) return;
    const clone = root.clone(true);
    orientAxeGrip(clone);
    // Grip convention: handle +Y, bit -Y, thin axis +X (blade faces ±X → vertical edge-on).
    axeAnchor.add(clone);
    axeAnchor.visible = false;
    axeAnchor.scale.setScalar(AXE_FP_SCALE);
    axeFade = 1;
    setAxeOpacity(1);
  }

  function playAxeSwing(aimPoint: THREE.Vector3, opts?: { rebound?: boolean }): void {
    axeSwingAim.copy(aimPoint);
    axeRebound = !!opts?.rebound;
    axeFrozen = false;
    applyCamera();
    buildVerticalGripQuat(axeGripQuat);

    // Camera basis for first-person placement (lower-center of the view).
    camera.getWorldDirection(_camFwd);
    _camRight.crossVectors(_camFwd, _up);
    if (_camRight.lengthSq() < 1e-8) _camRight.set(1, 0, 0);
    else _camRight.normalize();
    _camUp.crossVectors(_camRight, _camFwd).normalize();
    // Keep handle nearly world-vertical on screen.
    _camUp.lerp(_up, 0.92).normalize();
    _camFwd.crossVectors(_camUp, _camRight).normalize();
    _camRight.crossVectors(_camFwd, _camUp).normalize();

    // Impact: lower-center of the frame, between camera and log.
    const camDist = 1.25;
    axeImpactPos
      .copy(camera.position)
      .addScaledVector(_camFwd, camDist)
      .addScaledVector(_camUp, -0.48)
      .addScaledVector(_camRight, 0.02);
    // Slight pull toward the aim so the strike reads into the wood.
    axeImpactPos.lerp(aimPoint, 0.18);
    axeImpactPos.y = Math.max(axeImpactPos.y, aimPoint.y + 0.12);

    // Raised: straight up along camera-up (vertical plane only).
    axeRaisedPos.copy(axeImpactPos).addScaledVector(_camUp, 0.9);

    axeAnchor.visible = true;
    axeAnchor.scale.setScalar(AXE_FP_SCALE);
    axeSwingT = 0;
    axeFade = 1;
    setAxeOpacity(1);
  }

  function applyAxeSwingPose(pitchRad: number): void {
    // pitchRad < 0 = raised (bit tilted back toward camera); 0 = vertical handle+bit.
    _pitchQuat.setFromAxisAngle(axeSwingAxis, pitchRad);
    _swingQuat.multiplyQuaternions(_pitchQuat, axeGripQuat);
    axeAnchor.quaternion.copy(_swingQuat);
  }

  function hideAxe(): void {
    axeSwingT = -1;
    axeFrozen = false;
    axeRebound = false;
    axeAnchor.visible = false;
    axeFade = 1;
    setAxeOpacity(1);
  }

  function punchScale(amount = 0.12): void {
    punch = amount;
  }

  function setShake(intensity: number): void {
    shake = intensity;
  }

  function update(dt: number): void {
    if (typeof document !== 'undefined' && document.hidden) {
      // Still advance scripted bounce / physics so splits settle even if the tab
      // is backgrounded (automated tests / focus changes).
      fracture.step(dt, weak);
      fracture.sync();
      applyCamera();
      return;
    }
    fracture.step(dt, weak);
    fracture.sync();
    if (Math.random() < 0.05) fracture.prune();

    // Too-thin nudge: integrate damped azimuth toward ~±90° total.
    if (Math.abs(azimuthVelocity) > 1e-6) {
      yaw += azimuthVelocity;
      azimuthVelocity *= AZIMUTH_NUDGE_DAMP;
      if (Math.abs(azimuthVelocity) < 1e-4) azimuthVelocity = 0;
    }

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

    if (axeFrozen) {
      axeAnchor.position.copy(axeImpactPos);
      applyAxeSwingPose(0);
      axeAnchor.visible = true;
      setAxeOpacity(1);
    } else if (axeSwingT >= 0) {
      axeSwingT += dt;
      // Successful strike: hold briefly at impact then fade — no upward bounce.
      const tRaise = 0.18;
      const tHold = axeRebound ? 0.28 : 0.26;
      const tEnd = axeRebound ? 0.58 : 0.42;
      const raisedPitch = -0.62; // lean back in the vertical swing plane only
      const impactPitch = 0; // fully vertical at impact
      if (axeSwingT < tRaise) {
        const u = axeSwingT / tRaise;
        const ease = u * u * (3 - 2 * u);
        axeAnchor.position.lerpVectors(axeRaisedPos, axeImpactPos, ease);
        applyAxeSwingPose(raisedPitch + (impactPitch - raisedPitch) * ease);
        axeFade = 1;
        setAxeOpacity(1);
        axeAnchor.visible = true;
      } else if (axeSwingT < tHold) {
        if (axeRebound) {
          // Bounce back up along the vertical strike path — stump geometry unchanged.
          const u = (axeSwingT - tRaise) / Math.max(1e-6, tHold - tRaise);
          const bounce = Math.sin(Math.min(1, u) * Math.PI);
          axeAnchor.position.lerpVectors(axeImpactPos, axeRaisedPos, bounce * 0.72);
          applyAxeSwingPose(impactPitch + raisedPitch * bounce * 0.85);
        } else {
          axeAnchor.position.copy(axeImpactPos);
          applyAxeSwingPose(impactPitch);
        }
        axeFade = 1;
        setAxeOpacity(1);
        axeAnchor.visible = true;
      } else if (axeSwingT < tEnd) {
        const u = (axeSwingT - tHold) / (tEnd - tHold);
        if (axeRebound) {
          axeAnchor.position.lerpVectors(axeRaisedPos, axeImpactPos, 1 - u);
          applyAxeSwingPose(impactPitch);
        } else {
          // Slide slightly down/out of frame while fading — no pop back up.
          axeAnchor.position.copy(axeImpactPos).addScaledVector(_camUp, -0.12 * u);
          applyAxeSwingPose(impactPitch);
        }
        axeFade = 1 - u;
        setAxeOpacity(Math.max(0.05, axeFade));
        axeAnchor.visible = true;
      } else {
        hideAxe();
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
      // Manual orbit cancels residual nudge so drag stays responsive.
      azimuthVelocity = 0;
    },
    getOrbit: () => ({ yaw, pitch }),
    nudgeAzimuth(sign: number) {
      azimuthVelocity = azimuthNudgeVelocity(sign);
    },
    placeMarker,
    clearMarker,
    getCameraFacingXZ,
    scatterAndRecycle,
    isRecycling,
    playNick,
    fractureAt,
    resetLog,
    getRoundDims: () => ({ ...roundDims }),
    setSpecies,
    setAxeVisual,
    playAxeSwing,
    punchScale,
    setShake,
    update,
    resize,
    dispose,
    findFragment,
    pickNextChopTarget,
    get lastCleaveNormal() {
      return lastCleaveNormal;
    },
    debugFreezeAxeImpact() {
      const aim = new THREE.Vector3(0, logCenterY + roundDims.height * 0.2, 0);
      playAxeSwing(aim, { rebound: false });
      axeSwingT = 0.25;
      axeFrozen = true;
      axeAnchor.position.copy(axeImpactPos);
      applyAxeSwingPose(0);
      axeAnchor.visible = true;
      axeFade = 1;
      setAxeOpacity(1);
    },
    debugAxePose() {
      axeAnchor.updateMatrixWorld(true);
      const q = axeAnchor.getWorldQuaternion(new THREE.Quaternion());
      const handleDir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const bitDir = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
      return {
        pos: axeAnchor.position.toArray(),
        quat: axeAnchor.quaternion.toArray(),
        handleDir: handleDir.toArray(),
        bitDir: bitDir.toArray(),
        handleDotUp: handleDir.dot(new THREE.Vector3(0, 1, 0)),
        visible: axeAnchor.visible,
      };
    },
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
