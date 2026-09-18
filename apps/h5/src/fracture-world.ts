import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { DestructibleMesh, FractureOptions, SliceOptions } from '@dgreenheck/three-pinata';
import {
  BOUNCE_TILT_DEG,
  BOUNCE_YAW_JITTER_DEG,
  cleaveNormalXZ,
  horizontalAspectFromSize,
  horizontalAspectXZ,
  INCH,
  isFirewoodByVolumeAspect,
  isRechopWorthy,
  isTooThinToSplit,
  MAX_LIVE_FRAGMENTS,
  MIN_RECHOP_DIAGONAL,
  planRingPileSlots,
  RING_PILE_GROUND_PAD,
  RING_PILE_RADIUS,
  RING_PILE_RECYCLE_JIT_MS,
  RING_PILE_RECYCLE_MS,
  RING_PILE_STAGGER_MS,
  sampleTipDropPose,
  settlePositionY,
  thicknessInchesAlong,
  tipDropRestPose,
  TIP_DROP_ANGLE_DEG,
  TIP_DROP_ANGLE_JIT_DEG,
  TIP_DROP_ARC_HEIGHT,
  TIP_DROP_DURATION_JIT_MS,
  TIP_DROP_DURATION_MS,
  TIP_DROP_GROUND_PAD,
  TIP_DROP_POST_SETTLE_MS,
  TIP_DROP_REST_RADIAL,
  TIP_DROP_REST_RADIAL_JIT,
  TIP_DROP_SCATTER_RADIAL,
  TIP_DROP_SCATTER_RADIAL_JIT,
  TIP_DROP_YAW_JIT_DEG,
  TINY_CHIP_DIAGONAL,
  volumeInchesFromBBox,
  YARD_GROUND_Y,
  type FracturePlan,
} from '@firewood/game-core';
import {
  aspectCorrectUv,
  classifyFaceNormal,
  projectionSpan,
} from './cut-face';

/** Scratch box for AABB ground settle (tip-drop + ring pile). */
const _settleBox = new THREE.Box3();

/**
 * Scripted settle bounce — mirrors screen.toys/firewood `performSplit` animator
 * (logic reverse-engineered; no assets copied). First chop: two upright halves
 * with a modest lateral crack (~0.2× diameter), resting on the stump.
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

/**
 * Scripted firewood tip-drop — short tip/slide onto nearby yard ground
 * (reference feel), not a cannon-es impulse arc. Optional soft physics after.
 */
export interface TipDropAnim {
  pushX: number;
  pushZ: number;
  startAt: number;
  durationMs: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  tipRad: number;
  yawRad: number;
  arcHeight: number;
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
  /** Scripted tip/slide onto yard ground (classified firewood). */
  tipDrop?: TipDropAnim;
  /** Scripted slide into the annular ring pile after round completion. */
  recycle?: {
    startAt: number;
    durationMs: number;
    fromX: number;
    fromY: number;
    fromZ: number;
    toX: number;
    toY: number;
    toZ: number;
    fromQx: number;
    fromQy: number;
    fromQz: number;
    fromQw: number;
    toQx: number;
    toQy: number;
    toQz: number;
    toQw: number;
  };
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
  /** Align wedged settle height to the visual stump top. */
  setStumpSupportY(y: number): void;
  /** Rebuild static stump collider to match the visual chopping block. */
  fitStumpCollider(opts: { topY: number; height: number; radius: number }): void;
  sync(): void;
  /** Fixed-step physics; returns whether a step ran. */
  step(dt: number, weakDevice: boolean): void;
  clearFragments(): void;
  /** Remove stump/splittable pieces; keep ring-pile chips. */
  clearStumpPieces(): void;
  prune(): void;
  /** Knock stump pieces off via scripted tip-drop (round complete). */
  scatterToGround(): void;
  /** After scatter, slide pieces into a neat annular pile around the stump. */
  recycleToRing(opts?: { radius?: number; groundY?: number }): void;
  /** True while any fragment is still recycling into the ring. */
  isRecycling(): boolean;
  fractureMesh(
    mesh: DestructibleMesh,
    worldImpact: THREE.Vector3,
    plan: FracturePlan,
    generation: number,
    scene: THREE.Scene,
    opts?: { planeNormal?: THREE.Vector3 },
  ): PhysFragment[];
  /**
   * True when the mesh is thinner than 5″ along the cleave normal
   * (reference too-thin gate — nudge camera instead of chopping).
   */
  isTooThinAlongNormal(mesh: THREE.Mesh, normal: THREE.Vector3): boolean;
  /** Thickness in inches along a world-space cleave normal. */
  thicknessInchesAlongNormal(mesh: THREE.Mesh, normal: THREE.Vector3): number;
  /** Volume/aspect firewood gate for a live mesh (same helpers as post-split). */
  isFirewoodMesh(mesh: THREE.Mesh): boolean;
  /**
   * Mark a stump piece (or whole log) as firewood and tip-drop it onto nearby
   * yard ground with the same scripted path used for classified chips.
   */
  tossAsFirewood(mesh: THREE.Mesh, opts?: { planeNormal?: THREE.Vector3 }): boolean;
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

export function createFractureWorld(
  opts?: { stumpSupportY?: number; stumpHeight?: number; stumpRadius?: number },
): FractureWorld {
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

  // Static chopping-block collider — rebuilt via fitStumpCollider to match visuals.
  const stump = new CANNON.Body({
    mass: 0,
    material: groundMat,
    position: new CANNON.Vec3(0, 0.28, 0),
  });
  world.addBody(stump);

  const fragments: PhysFragment[] = [];
  let lastCleaveDebug: FractureWorld['lastCleaveDebug'] = null;
  let accumulator = 0;
  const FIXED = 1 / 60;
  const up = new THREE.Vector3(0, 1, 0);
  const sliceOpts = new SliceOptions();
  // Pinata cut UVs are replaced in repairCutFace with aspect-correct projection.
  sliceOpts.textureScale.set(1, 1);
  /** World Y of the chopping-block top — measured from the visual stump mesh. */
  let stumpSupportY = opts?.stumpSupportY ?? 0.34;

  /**
   * Firewood exit feel — scripted tip/slide onto nearby yard ground
   * (reference screen.toys/firewood), not a box-impulse “gamey” toss.
   * Constants live in @firewood/game-core (TIP_DROP_*).
   */

  function fitStumpCollider(next: { topY: number; height: number; radius: number }): void {
    const height = Math.max(0.28, next.height);
    const radius = Math.max(0.35, next.radius);
    const topY = next.topY;
    // Center the cylinder so its top face sits at topY.
    const cylH = Math.min(height * 0.95, Math.max(0.24, topY - 0.02));
    const centerY = topY - cylH * 0.5;
    while (stump.shapes.length > 0) {
      stump.removeShape(stump.shapes[0]!);
    }
    stump.position.set(0, centerY, 0);
    // Slight taper: flat cut top, roots a bit wider.
    stump.addShape(new CANNON.Cylinder(radius, radius * 1.12, cylH, 12));
    stump.addShape(
      new CANNON.Box(new CANNON.Vec3(radius * 0.92, 0.045, radius * 0.92)),
      new CANNON.Vec3(0, cylH * 0.5 + 0.02, 0),
    );
    stump.updateBoundingRadius();
    // cannon-es Body AABB refresh
    stump.aabbNeedsUpdate = true;
    stumpSupportY = topY;
  }

  fitStumpCollider({
    topY: stumpSupportY,
    height: opts?.stumpHeight ?? 0.34,
    radius: opts?.stumpRadius ?? 0.34,
  });

  const _tiltQ = new THREE.Quaternion();
  const _yawQ = new THREE.Quaternion();
  const _outQ = new THREE.Quaternion();
  const _fromQ = new THREE.Quaternion();
  const _toQ = new THREE.Quaternion();
  const _tiltAxis = new THREE.Vector3();
  const _basis = new THREE.Matrix4();
  const _axisX = new THREE.Vector3();
  const _axisY = new THREE.Vector3();
  const _axisZ = new THREE.Vector3();

  function bboxDiagonal(mesh: THREE.Mesh): number {
    const box = new THREE.Box3().setFromObject(mesh);
    return box.getSize(new THREE.Vector3()).length();
  }

  /** Reference `hT`: PCA aspect of local XZ verts; bbox fallback. */
  function pieceHorizontalAspect(mesh: THREE.Mesh): number {
    const pos = mesh.geometry?.getAttribute('position');
    if (pos && pos.count > 0) {
      const xs = new Float32Array(pos.count);
      const zs = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        xs[i] = pos.getX(i);
        zs[i] = pos.getZ(i);
      }
      return horizontalAspectXZ(xs, zs);
    }
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    return horizontalAspectFromSize(size.x, size.z);
  }

  /** Local geometry AABB size (fallback to world size). */
  function localBBoxSize(mesh: THREE.Mesh, worldSize?: THREE.Vector3): THREE.Vector3 {
    const geom = mesh.geometry;
    if (geom) {
      if (!geom.boundingBox) geom.computeBoundingBox();
      const bb = geom.boundingBox;
      if (bb) {
        return new THREE.Vector3(
          Math.max(1e-6, bb.max.x - bb.min.x),
          Math.max(1e-6, bb.max.y - bb.min.y),
          Math.max(1e-6, bb.max.z - bb.min.z),
        );
      }
    }
    return worldSize?.clone() ?? new THREE.Vector3(0.1, 0.1, 0.1);
  }

  /** Classify stump vs firewood using volume (in³) + horizontal aspect. */
  function classifyFirewood(
    mesh: THREE.Mesh,
    worldSize: THREE.Vector3,
  ): { firewood: boolean; volumeInches: number; aspect: number } {
    // Match reference `aw(geometry)`: local geometry AABB × fill / INCH³
    const size = localBBoxSize(mesh, worldSize);
    const volumeInches = volumeInchesFromBBox(size.x, size.y, size.z);
    const aspect = pieceHorizontalAspect(mesh);
    const firewood = isFirewoodByVolumeAspect(volumeInches, aspect);
    if (firewood) {
      console.info(
        `[firewood] classify vol=${volumeInches.toFixed(1)} aspect=${aspect.toFixed(2)} firewood=true size=${size.x.toFixed(3)},${size.y.toFixed(3)},${size.z.toFixed(3)}`,
      );
    }
    return { firewood, volumeInches, aspect };
  }

  /**
   * Thickness along world cleave normal in inches (reference `pT`).
   * Projects geometry verts through matrixWorld onto the unit normal.
   */
  function thicknessInchesAlongNormal(mesh: THREE.Mesh, normal: THREE.Vector3): number {
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry?.getAttribute('position');
    if (!pos || pos.count === 0) {
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const n = normal.clone().normalize();
      const extent = Math.abs(size.x * n.x) + Math.abs(size.y * n.y) + Math.abs(size.z * n.z);
      return thicknessInchesAlong(extent);
    }
    const n = normal.clone().normalize();
    const v = new THREE.Vector3();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const d = v.dot(n);
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return thicknessInchesAlong(max - min);
  }

  /** Per-side slide so both halves open `gapFrac * diameter` face gap. */
  function sideOffsetFromPlan(diameter: number, gapFrac: number): number {
    // Inline (avoid any stale import binding): (frac * d) / 2
    const d = Math.max(0.05, diameter);
    const frac = Math.max(0, gapFrac);
    return (frac * d) / 2;
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
      // Firewood needs lower damping so the toss arc can clear the stump.
      linearDamping: onStump ? 1 : 0.38,
      angularDamping: onStump ? 1 : 0.48,
      allowSleep: true,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit: 0.12,
    });
  }

  function disposeMesh(obj: THREE.Object3D, disposeMaterials = false): void {
    obj.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      // Only dispose *cloned* seal mats — species bark/endgrain/inner are shared.
      if (child.userData?.role === 'cutCap') {
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) (mat as THREE.Material).dispose();
        return;
      }
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
    // Geometry + cutCap clones only — keep shared species materials alive.
    disposeMesh(f.mesh, false);
    fragments.splice(index, 1);
  }

  function clearFragments(): void {
    while (fragments.length) removeFragment(0);
  }

  function clearStumpPieces(): void {
    for (let i = fragments.length - 1; i >= 0; i--) {
      const f = fragments[i]!;
      if (f.onStump || f.splittable || f.bounce || f.recycle) {
        removeFragment(i);
      }
    }
  }

  function prune(): void {
    // Drop tiny chips and enforce live cap.
    for (let i = fragments.length - 1; i >= 0; i--) {
      const f = fragments[i]!;
      const diag = bboxDiagonal(f.mesh);
      if (diag < TINY_CHIP_DIAGONAL && !f.splittable && !f.onStump) {
        removeFragment(i);
      }
    }
    while (fragments.length > MAX_LIVE_FRAGMENTS) {
      // Prefer culling old ground-pile chips — never evict splittable stump
      // pieces first (those are mid-split and about to become firewood).
      let idx = fragments.findIndex((f) => !f.onStump && !f.splittable && !f.recycle);
      if (idx < 0) idx = fragments.findIndex((f) => !f.onStump);
      if (idx < 0) idx = fragments.findIndex((f) => f.onStump && !f.splittable);
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

  /**
   * three-pinata only preserves outer vs cut when `geometry.groups.length === 2`.
   * After our 3-material reclassify (bark/endgrain/inner), collapse so the next
   * slice keeps prior cut faces in the inner bucket instead of dumping them
   * into "outer" (which would lose side-grain on re-chop).
   */
  function preparePinataGroups(mesh: DestructibleMesh): void {
    const geo = mesh.geometry;
    const index = geo.index;
    if (!index) return;
    const mats = resolvePieceMaterials(mesh);

    const exterior: number[] = [];
    const interior: number[] = [];
    const groups = geo.groups;

    if (groups.length === 0) {
      for (let i = 0; i < index.count; i++) exterior.push(index.getX(i));
    } else if (groups.length === 2) {
      for (const g of groups) {
        const dest = (g.materialIndex ?? 0) === 1 ? interior : exterior;
        const end = g.start + g.count;
        for (let i = g.start; i < end; i++) dest.push(index.getX(i));
      }
    } else {
      // 3-slot layout from reclassify: 0=bark, 1=endgrain, 2=inner
      // Also handles CylinderGeometry [side, top, bottom] before first chop.
      for (const g of groups) {
        const mi = g.materialIndex ?? 0;
        const dest = mi === 2 ? interior : exterior;
        const end = g.start + g.count;
        for (let i = g.start; i < end; i++) dest.push(index.getX(i));
      }
    }

    const merged = new Uint32Array(exterior.length + interior.length);
    merged.set(exterior, 0);
    merged.set(interior, exterior.length);
    geo.setIndex(new THREE.BufferAttribute(merged, 1));
    geo.clearGroups();
    geo.addGroup(0, exterior.length, 0);
    if (interior.length > 0) geo.addGroup(exterior.length, interior.length, 1);

    // Pinata fragment materials are [outside, inside].
    mesh.material = [mats.bark, mats.inner];
    mesh.userData.barkMat = mats.bark;
    mesh.userData.endgrainMat = mats.endgrain;
    mesh.userData.innerMat = mats.inner;
  }

  /**
   * After three-pinata slice (2 materials): aspect-correct cut UVs + reclassify
   * tris into bark / endgrain / inner side-grain so caps keep rings and the
   * outer mantle keeps bark (cut faces come from pinata group 1 only).
   */
  function repairCutFace(
    mesh: DestructibleMesh,
    planeNormal: THREE.Vector3,
    planePoint?: THREE.Vector3,
  ): void {
    const geo = mesh.geometry;
    if (!geo?.attributes.position) return;

    mesh.updateMatrixWorld(true);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uvAttr = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const index = geo.index;
    if (!index || !uvAttr) return;

    // Ensure at least the pinata outer/cut grouping exists.
    if (!geo.groups.length) {
      geo.addGroup(0, index.count, 0);
    }

    const mats = resolvePieceMaterials(mesh);
    const n = planeNormal.clone().normalize();
    n.y = 0;
    if (n.lengthSq() < 1e-8) n.set(1, 0, 0);
    else n.normalize();
    // Local-space cleave normal (slice runs in mesh local frame).
    const localN = n
      .clone()
      .transformDirection(new THREE.Matrix4().copy(mesh.matrixWorld).invert())
      .normalize();
    localN.y = 0;
    if (localN.lengthSq() < 1e-8) localN.set(1, 0, 0);
    else localN.normalize();
    const tangent = new THREE.Vector3(-localN.z, 0, localN.x);
    const bitangent = up.clone();

    // Plane offset in local space — used to reproject only *this* cut's verts
    // when group 1 also holds older inner faces from prior chops.
    let planeD: number | null = null;
    if (planePoint) {
      const localPt = mesh.worldToLocal(planePoint.clone());
      planeD = localN.dot(localPt);
    }

    // Only reproject vertices from pinata's cut group (materialIndex 1) that
    // lie on the current cleave plane (skip older inner faces on re-chop).
    const pinataCut = geo.groups.find((g) => g.materialIndex === 1);
    const cutVerts = new Set<number>();
    let cutTriCount = 0;
    if (pinataCut && pinataCut.count > 0) {
      cutTriCount = Math.floor(pinataCut.count / 3);
      const end = pinataCut.start + pinataCut.count;
      const tmp = new THREE.Vector3();
      for (let i = pinataCut.start; i < end; i++) {
        const vi = index.getX(i);
        if (planeD !== null) {
          tmp.fromBufferAttribute(pos, vi);
          if (Math.abs(tmp.dot(localN) - planeD) > 0.025) continue;
        }
        cutVerts.add(vi);
      }
      // Fallback: if plane filter culled everything (e.g. matrix quirk), keep full cut group.
      if (cutVerts.size < 3) {
        for (let i = pinataCut.start; i < end; i++) cutVerts.add(index.getX(i));
      }
    }

    if (cutVerts.size >= 3) {
      let uMin = Infinity;
      let uMax = -Infinity;
      let vMin = Infinity;
      let vMax = -Infinity;
      const tmp = new THREE.Vector3();
      for (const vi of cutVerts) {
        tmp.fromBufferAttribute(pos, vi);
        const u = tmp.dot(tangent);
        const v = tmp.dot(bitangent);
        uMin = Math.min(uMin, u);
        uMax = Math.max(uMax, u);
        vMin = Math.min(vMin, v);
        vMax = Math.max(vMax, v);
      }
      const span = projectionSpan(uMax - uMin, vMax - vMin);
      for (const vi of cutVerts) {
        tmp.fromBufferAttribute(pos, vi);
        const mapped = aspectCorrectUv(tmp.dot(tangent), tmp.dot(bitangent), uMin, vMin, span);
        uvAttr.setXY(vi, mapped.u, mapped.v);
      }
      uvAttr.needsUpdate = true;
    }

    // Reclassify every triangle → bark / endgrain / inner (3 materials).
    reclassifyPieceMaterials(mesh, planeNormal, mats);

    // Hollow / sparse cut face only: synthesize a rectangular seal at the cut centroid.
    if (cutTriCount < 8) {
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const width = Math.max(0.15, Math.max(size.x, size.z) * 0.9);
      const height = Math.max(0.2, size.y * 0.95);
      const capGeo = new THREE.PlaneGeometry(width, height, 1, 1);
      // Aspect-correct plane UVs (PlaneGeometry is already 0–1; scale V by height/width).
      const sealSpan = projectionSpan(width, height);
      const sealUv = capGeo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < sealUv.count; i++) {
        const u0 = sealUv.getX(i);
        const v0 = sealUv.getY(i);
        sealUv.setXY(i, (u0 * width) / sealSpan, (v0 * height) / sealSpan);
      }
      sealUv.needsUpdate = true;
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), localN);
      const capMat =
        mats.inner && 'clone' in mats.inner
          ? (mats.inner.clone() as THREE.MeshStandardMaterial)
          : new THREE.MeshStandardMaterial({
              color: 0xc4a574,
              roughness: 0.88,
              side: THREE.DoubleSide,
            });
      if ('side' in capMat) capMat.side = THREE.DoubleSide;

      const localPos = new THREE.Vector3();
      if (cutVerts.size >= 3) {
        const avg = new THREE.Vector3();
        const tmp = new THREE.Vector3();
        for (const vi of cutVerts) {
          tmp.fromBufferAttribute(pos, vi);
          avg.add(tmp);
        }
        avg.multiplyScalar(1 / cutVerts.size);
        localPos.copy(avg);
      } else {
        const center = box.getCenter(new THREE.Vector3());
        const extent = Math.abs(localN.x) * size.x * 0.5 + Math.abs(localN.z) * size.z * 0.5;
        const toOrigin = new THREE.Vector3(-center.x, 0, -center.z);
        const sideSign = Math.sign(toOrigin.dot(localN)) || 1;
        const worldCapPos = center.clone().addScaledVector(localN, sideSign * extent * 0.92);
        mesh.worldToLocal(worldCapPos);
        localPos.copy(worldCapPos);
      }

      for (const child of [...mesh.children]) {
        if (child.userData?.role === 'cutCap') {
          mesh.remove(child);
          (child as THREE.Mesh).geometry?.dispose();
        }
      }

      const cap = new THREE.Mesh(capGeo, capMat);
      cap.quaternion.copy(quat);
      cap.position.copy(localPos);
      cap.userData.role = 'cutCap';
      cap.renderOrder = 1;
      mesh.add(cap);
    }

    if ('side' in mats.inner) {
      (mats.inner as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    }
  }

  /** Pull bark / endgrain / inner from userData or the current material array. */
  function resolvePieceMaterials(mesh: DestructibleMesh): {
    bark: THREE.Material;
    endgrain: THREE.Material;
    inner: THREE.Material;
  } {
    const ud = mesh.userData as {
      barkMat?: THREE.Material;
      endgrainMat?: THREE.Material;
      innerMat?: THREE.Material;
    };
    const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const bark = ud.barkMat ?? arr[0]!;
    const endgrain = ud.endgrainMat ?? (arr.length >= 3 ? arr[1]! : arr[0]!);
    const inner =
      ud.innerMat ??
      (arr.length >= 3 ? arr[2]! : arr.length >= 2 ? arr[1]! : arr[0]!);
    return { bark, endgrain, inner };
  }

  /**
   * Rebuild index groups: 0=bark, 1=endgrain caps (|ny|), 2=inner cut faces.
   * Inner faces come from pinata's cut group — never from |n·plane| on exterior.
   */
  function reclassifyPieceMaterials(
    mesh: DestructibleMesh,
    planeNormal: THREE.Vector3,
    mats: { bark: THREE.Material; endgrain: THREE.Material; inner: THREE.Material },
  ): void {
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const index = geo.index;
    if (!index) return;

    // Snapshot which index slots belong to pinata cut/inner (materialIndex 1)
    // before we rebuild groups.
    const cutIndexSlots = new Set<number>();
    for (const g of geo.groups) {
      if ((g.materialIndex ?? 0) !== 1) continue;
      const end = g.start + g.count;
      for (let i = g.start; i < end; i++) cutIndexSlots.add(i);
    }

    const barkIdx: number[] = [];
    const endIdx: number[] = [];
    const innerIdx: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const fn = new THREE.Vector3();
    const pn = { x: planeNormal.x, y: 0, z: planeNormal.z };

    for (let i = 0; i < index.count; i += 3) {
      const i0 = index.getX(i);
      const i1 = index.getX(i + 1);
      const i2 = index.getX(i + 2);
      const isCutGroup = cutIndexSlots.has(i);
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      fn.crossVectors(ab, ac);
      if (fn.lengthSq() < 1e-12) {
        if (isCutGroup) innerIdx.push(i0, i1, i2);
        else barkIdx.push(i0, i1, i2);
        continue;
      }
      fn.normalize();
      const kind = classifyFaceNormal({ x: fn.x, y: fn.y, z: fn.z }, pn, { isCutGroup });
      if (kind === 'endgrain') endIdx.push(i0, i1, i2);
      else if (kind === 'inner') innerIdx.push(i0, i1, i2);
      else barkIdx.push(i0, i1, i2);
    }

    const merged = new Uint32Array(barkIdx.length + endIdx.length + innerIdx.length);
    merged.set(barkIdx, 0);
    merged.set(endIdx, barkIdx.length);
    merged.set(innerIdx, barkIdx.length + endIdx.length);
    geo.setIndex(new THREE.BufferAttribute(merged, 1));
    geo.clearGroups();
    geo.addGroup(0, barkIdx.length, 0);
    geo.addGroup(barkIdx.length, endIdx.length, 1);
    geo.addGroup(barkIdx.length + endIdx.length, innerIdx.length, 2);

    mesh.material = [mats.bark, mats.endgrain, mats.inner];
    mesh.userData.barkMat = mats.bark;
    mesh.userData.endgrainMat = mats.endgrain;
    mesh.userData.innerMat = mats.inner;
  }

  /** Prefer exactly two largest leaves when the budget is 2 (sweet first chop). */
  function preferTwoHalves(pieces: DestructibleMesh[], budget: number): DestructibleMesh[] {
    if (budget !== 2 || pieces.length <= 2) return pieces;
    const ranked = [...pieces].sort((a, b) => bboxDiagonal(b) - bboxDiagonal(a));
    const keep = ranked.slice(0, 2);
    for (const drop of ranked.slice(2)) {
      drop.removeFromParent();
      disposeMesh(drop, false);
    }
    return keep;
  }

  /** Copy shared bark/endgrain/inner refs onto every leaf (pinata only keeps 2). */
  function inheritSpeciesMats(from: DestructibleMesh, to: DestructibleMesh[]): void {
    const mats = resolvePieceMaterials(from);
    for (const piece of to) {
      piece.userData.barkMat = mats.bark;
      piece.userData.endgrainMat = mats.endgrain;
      piece.userData.innerMat = mats.inner;
    }
  }

  /** Recursively planar-slice until we hit the piece budget (messy) or once (sweet). */
  function cleavePieces(
    root: DestructibleMesh,
    worldImpact: THREE.Vector3,
    planeNormal: THREE.Vector3,
    plan: FracturePlan,
    keepParallel: boolean,
  ): DestructibleMesh[] {
    preparePinataGroups(root);
    const primary = root.sliceWorld(planeNormal, worldImpact, sliceOpts);
    inheritSpeciesMats(root, primary);
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
        preparePinataGroups(piece);
        const sub = piece.sliceWorld(n2, origin, sliceOpts);
        if (sub.length >= 2) {
          inheritSpeciesMats(piece, sub);
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

    return preferTwoHalves(
      (() => {
        const pieces = mesh.fracture(options);
        inheritSpeciesMats(mesh, pieces);
        return pieces;
      })(),
      plan.fragmentCount,
    );
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
      const nudge = 0.18 * INCH * falloff;
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

  function applyTipDropPose(f: PhysFragment, now: number): boolean {
    const t = f.tipDrop;
    if (!t) return false;
    const localT = now - t.startAt;
    if (localT < 0) {
      f.body.position.set(t.fromX, t.fromY, t.fromZ);
      f.mesh.position.set(t.fromX, t.fromY, t.fromZ);
      f.mesh.quaternion.copy(t.baseQuat);
      f.body.quaternion.set(t.baseQuat.x, t.baseQuat.y, t.baseQuat.z, t.baseQuat.w);
      return true;
    }
    const u = Math.min(1, localT / Math.max(1, t.durationMs));
    const sample = sampleTipDropPose({
      u,
      fromX: t.fromX,
      fromY: t.fromY,
      fromZ: t.fromZ,
      toX: t.toX,
      toY: t.toY,
      toZ: t.toZ,
      tipRad: t.tipRad,
      arcHeight: t.arcHeight,
    });

    _tiltAxis.set(-t.pushZ, 0, t.pushX);
    if (_tiltAxis.lengthSq() < 1e-8) _tiltAxis.set(1, 0, 0);
    else _tiltAxis.normalize();
    _tiltQ.setFromAxisAngle(_tiltAxis, sample.tipRad);
    _yawQ.setFromAxisAngle(up, t.yawRad * sample.ease);
    _outQ.copy(t.baseQuat).multiply(_yawQ).multiply(_tiltQ);

    f.body.position.set(sample.x, sample.y, sample.z);
    f.mesh.position.set(sample.x, sample.y, sample.z);
    f.mesh.quaternion.copy(_outQ);
    f.body.quaternion.set(_outQ.x, _outQ.y, _outQ.z, _outQ.w);

    if (u >= 1) {
      // Final tip pose, then AABB-min settle onto yard ground (stump-piece pattern).
      // Thin-axis toY is only a mid-anim estimate — eccentric pinata AABBs float otherwise.
      _yawQ.setFromAxisAngle(up, t.yawRad);
      _tiltQ.setFromAxisAngle(_tiltAxis, t.tipRad);
      _outQ.copy(t.baseQuat).multiply(_yawQ).multiply(_tiltQ);
      f.mesh.position.set(t.toX, t.toY, t.toZ);
      f.mesh.quaternion.copy(_outQ);
      f.mesh.updateMatrixWorld(true);
      _settleBox.setFromObject(f.mesh);
      f.mesh.position.y += settlePositionY(_settleBox.min.y, YARD_GROUND_Y);
      f.body.position.set(f.mesh.position.x, f.mesh.position.y, f.mesh.position.z);
      f.body.quaternion.set(_outQ.x, _outQ.y, _outQ.z, _outQ.w);
      f.tipDrop = undefined;
      // STATIC handoff after correct Y — avoids stump bounce on re-enable.
      finishTipDropHandoff(f);
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
    const sideOffset = sideOffsetFromPlan(logDiameter, plan.wedgeGap);
    lastCleaveDebug = {
      diameter: logDiameter,
      gapFrac: plan.wedgeGap,
      sideOffset,
      pieceCount: pieces.length,
    };

    nudgeNeighbors(worldImpact, planeNormal);

    for (let i = 0; i < pieces.length; i++) {
      const fragment = pieces[i]!;
      repairCutFace(fragment, planeNormal, worldImpact);
      scene.add(fragment);
      fragment.updateMatrixWorld(true);

      const box0 = new THREE.Box3().setFromObject(fragment);
      const size0 = box0.getSize(new THREE.Vector3());
      const center0 = box0.getCenter(new THREE.Vector3());
      const { firewood, volumeInches } = classifyFirewood(fragment, size0);
      const onStump = !firewood;

      // Both stump bounce and firewood tip-drop are scripted — start STATIC.
      const body = makeBodyFromMesh(fragment, plan.messy ? 1.15 : 1.35, true);

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
        const settleY = stumpSupportY - box.min.y;
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

      if (onStump) {
        // Apply the designed lateral 错开 immediately so the gap is correct even
        // if animation frames are skipped; bounce still plays closed→open + pop.
        body.position.set(finalX, baseY, finalZ);
        fragment.position.set(finalX, baseY, finalZ);
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
        splittable: onStump && isRechopWorthy(diag, childGen, volumeInches),
        bornAt: now,
        // Tip-drop duration + short soft-physics window after handoff.
        settleUntil:
          now +
          (onStump
            ? settleMs
            : TIP_DROP_DURATION_MS + TIP_DROP_DURATION_JIT_MS + TIP_DROP_POST_SETTLE_MS),
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

      if (!onStump) {
        // Classified firewood: scripted tip/slide onto nearby yard ground.
        beginFirewoodTipDrop(entry, planeNormal, { x: pushX, z: pushZ });
      }

      // Record intended final for safety settle.
      fragment.userData.finalXZ = { x: finalX, z: finalZ };
      fragment.userData.phys = entry;
      fragment.userData.role = 'fragment';
      fragment.userData.generation = childGen;
      fragments.push(entry);
      created.push(entry);
    }

    // Overlap resolve only for settled stump pieces — bouncing halves already
    // get the designed modest face gap from lateralOffsetFromDiameter.
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
      if (f.recycle) {
        const r = f.recycle;
        const localT = now - r.startAt;
        if (localT < 0) continue;
        const u = Math.min(1, localT / Math.max(1, r.durationMs));
        const ease = u * u * (3 - 2 * u);
        const x = r.fromX + (r.toX - r.fromX) * ease;
        const y = r.fromY + (r.toY - r.fromY) * ease + Math.sin(Math.PI * u) * 0.28;
        const z = r.fromZ + (r.toZ - r.fromZ) * ease;
        _fromQ.set(r.fromQx, r.fromQy, r.fromQz, r.fromQw);
        _toQ.set(r.toQx, r.toQy, r.toQz, r.toQw);
        _outQ.copy(_fromQ).slerp(_toQ, ease);
        f.body.position.set(x, y, z);
        f.mesh.position.set(x, y, z);
        f.mesh.quaternion.copy(_outQ);
        f.body.quaternion.set(_outQ.x, _outQ.y, _outQ.z, _outQ.w);
        if (u >= 1) {
          f.body.position.set(r.toX, r.toY, r.toZ);
          f.mesh.position.set(r.toX, r.toY, r.toZ);
          f.mesh.quaternion.copy(_toQ);
          f.body.quaternion.set(_toQ.x, _toQ.y, _toQ.z, _toQ.w);
          f.recycle = undefined;
          f.body.sleep();
        }
        continue;
      }

      if (applyBouncePose(f, now)) continue;
      if (applyTipDropPose(f, now)) continue;

      if (f.body.type === CANNON.Body.STATIC) continue;
      if (now < f.settleUntil) continue;
      if (f.body.sleepState === CANNON.Body.SLEEPING) continue;
      const speed = f.body.velocity.length();
      const spin = f.body.angularVelocity.length();
      // Firewood chips: only soft-sleep when nearly stopped — never hard-dampen
      // mid-flight (old ×0.35 + vy cap parked chips on the stump top).
      if (speed < 0.4 && spin < 0.9) {
        f.body.velocity.set(0, 0, 0);
        f.body.angularVelocity.set(0, 0, 0);
        f.body.sleep();
      }
    }
  }

  function sync(): void {
    for (const f of fragments) {
      if (f.bounce || f.tipDrop || f.recycle) continue; // scripted pose owns this frame
      f.mesh.position.set(f.body.position.x, f.body.position.y, f.body.position.z);
      f.mesh.quaternion.set(
        f.body.quaternion.x,
        f.body.quaternion.y,
        f.body.quaternion.z,
        f.body.quaternion.w,
      );
    }
  }

  function freezeForScriptedPose(f: PhysFragment): void {
    f.body.velocity.set(0, 0, 0);
    f.body.angularVelocity.set(0, 0, 0);
    if (f.body.type !== CANNON.Body.STATIC) {
      f.body.type = CANNON.Body.STATIC;
      f.body.mass = 0;
      f.body.updateMassProperties();
    }
  }

  function finishTipDropHandoff(f: PhysFragment): void {
    // Stay STATIC on the scripted ground pose. Re-enabling DYNAMIC here made
    // large chips re-hit the stump collider and pop back onto the top.
    freezeForScriptedPose(f);
    f.body.position.set(
      f.mesh.position.x,
      f.mesh.position.y,
      f.mesh.position.z,
    );
    f.body.quaternion.set(
      f.mesh.quaternion.x,
      f.mesh.quaternion.y,
      f.mesh.quaternion.z,
      f.mesh.quaternion.w,
    );
    f.settleUntil = performance.now() + TIP_DROP_POST_SETTLE_MS;
    try {
      f.body.sleep();
    } catch {
      /* static bodies may already be asleep */
    }
  }

  /** Rest half-height estimate for mid-tip-drop arc (thin axis). Final Y uses AABB settle. */
  function tipRestHalfHeight(mesh: THREE.Mesh): number {
    mesh.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    return Math.max(0.03, Math.min(size.x, size.y, size.z) * 0.45);
  }

  /**
   * Scripted tip/slide onto nearby yard ground (post-split + option-A + scatter).
   * Continuous from the current stump pose — no radial teleport clear.
   */
  function beginFirewoodTipDrop(
    f: PhysFragment,
    planeNormal?: THREE.Vector3,
    pushHint?: { x: number; z: number },
    opts?: { scatter?: boolean },
  ): void {
    freezeForScriptedPose(f);
    f.bounce = undefined;
    f.recycle = undefined;
    f.onStump = false;
    f.splittable = false;

    let dirX = pushHint?.x ?? f.body.position.x;
    let dirZ = pushHint?.z ?? f.body.position.z;
    if (planeNormal) {
      const nx = planeNormal.x;
      const nz = planeNormal.z;
      const nLen = Math.hypot(nx, nz);
      if (nLen > 1e-8) {
        const side = Math.sign(dirX * (nx / nLen) + dirZ * (nz / nLen)) || 1;
        dirX = (nx / nLen) * side;
        dirZ = (nz / nLen) * side;
      }
    }

    const rest = tipDropRestPose({
      fromX: f.body.position.x,
      fromZ: f.body.position.z,
      dirX,
      dirZ,
      restHalfHeight: tipRestHalfHeight(f.mesh),
      restRadial: opts?.scatter ? TIP_DROP_SCATTER_RADIAL : TIP_DROP_REST_RADIAL,
      restRadialJit: opts?.scatter ? TIP_DROP_SCATTER_RADIAL_JIT : TIP_DROP_REST_RADIAL_JIT,
      rnd: Math.random(),
      groundPad: TIP_DROP_GROUND_PAD,
    });

    const tipDeg = TIP_DROP_ANGLE_DEG + Math.random() * TIP_DROP_ANGLE_JIT_DEG;
    const yawRad =
      ((Math.random() * 2 - 1) * TIP_DROP_YAW_JIT_DEG * Math.PI) / 180;
    const now = performance.now();
    const durationMs = TIP_DROP_DURATION_MS + Math.random() * TIP_DROP_DURATION_JIT_MS;

    f.tipDrop = {
      pushX: rest.ox,
      pushZ: rest.oz,
      startAt: now,
      durationMs,
      fromX: f.body.position.x,
      fromY: f.body.position.y,
      fromZ: f.body.position.z,
      toX: rest.toX,
      toY: rest.toY,
      toZ: rest.toZ,
      tipRad: (tipDeg * Math.PI) / 180,
      yawRad,
      arcHeight: TIP_DROP_ARC_HEIGHT,
      baseQuat: f.mesh.quaternion.clone(),
    };
    f.settleUntil = now + durationMs + TIP_DROP_POST_SETTLE_MS;
  }

  /**
   * Convert one stump piece (or the still-whole log) into firewood and tip-drop
   * onto nearby ground — option A bridge when too-thin + finished.
   */
  function tossAsFirewood(
    mesh: THREE.Mesh,
    opts?: { planeNormal?: THREE.Vector3 },
  ): boolean {
    const now = performance.now();
    let f = fragments.find((x) => x.mesh === mesh);
    if (!f) {
      // Whole log / unregistered mesh: register then tip-drop.
      if (!(mesh as DestructibleMesh).geometry) return false;
      const body = makeBodyFromMesh(mesh, 1.2, true);
      world.addBody(body);
      f = {
        mesh: mesh as DestructibleMesh,
        body,
        generation: (mesh.userData.generation as number) ?? 0,
        splittable: false,
        bornAt: now,
        settleUntil: now + TIP_DROP_DURATION_MS + TIP_DROP_POST_SETTLE_MS,
        onStump: false,
      };
      mesh.userData.phys = f;
      mesh.userData.role = 'fragment';
      fragments.push(f);
    } else {
      f.bounce = undefined;
      f.recycle = undefined;
      f.onStump = false;
      f.splittable = false;
    }
    beginFirewoodTipDrop(f, opts?.planeNormal);
    console.info('[firewood] tossAsFirewood tipDrop', {
      gen: f.generation,
      from: [f.tipDrop?.fromX, f.tipDrop?.fromY, f.tipDrop?.fromZ],
      to: [f.tipDrop?.toX, f.tipDrop?.toY, f.tipDrop?.toZ],
    });
    return true;
  }

  function isFirewoodMesh(mesh: THREE.Mesh): boolean {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    return classifyFirewood(mesh, size).firewood;
  }

  /** Convert stump halves to tip-drop firewood onto the yard (round complete). */
  function scatterToGround(): void {
    for (const f of fragments) {
      beginFirewoodTipDrop(f, undefined, undefined, { scatter: true });
    }
  }

  /** Slide every live fragment into a neat annular pile around the chopping block. */
  function recycleToRing(opts?: { radius?: number; groundY?: number }): void {
    const radius = opts?.radius ?? RING_PILE_RADIUS;
    const groundY = opts?.groundY ?? YARD_GROUND_Y;
    const now = performance.now();
    // Larger chips first → they form the crescent base (closer to ref settle order).
    const live = fragments
      .filter((f) => f.mesh.visible)
      .sort((a, b) => {
        const sa = localBBoxSize(a.mesh);
        const sb = localBBoxSize(b.mesh);
        return sb.x * sb.y * sb.z - sa.x * sa.y * sa.z;
      });
    const n = live.length;
    if (n === 0) return;

    const halfHeights: number[] = [];
    const halfWidths: number[] = [];
    const sizeXs: number[] = [];
    const sizeYs: number[] = [];
    const sizeZs: number[] = [];
    const rnds: number[] = [];
    for (let i = 0; i < n; i++) {
      const f = live[i]!;
      f.mesh.updateMatrixWorld(true);
      const worldSize = new THREE.Box3().setFromObject(f.mesh).getSize(new THREE.Vector3());
      // Local geom AABB for `_simToWorld` thin-axis / grain (world AABB for packing).
      const local = localBBoxSize(f.mesh, worldSize);
      sizeXs.push(local.x);
      sizeYs.push(local.y);
      sizeZs.push(local.z);
      // Reference T = min(size.x, size.z) — half-height for ground settle pad.
      const T = Math.max(0.04, Math.min(local.x, local.z));
      halfHeights.push(T * 0.5);
      // Arc packing uses XC grid; halfWidths kept for API / fallback size defaults.
      const sorted = [worldSize.x, worldSize.y, worldSize.z].sort((a, b) => a - b);
      halfWidths.push(Math.max(0.04, sorted[1]! * 0.48));
      rnds.push(Math.random(), Math.random());
    }
    const slots = planRingPileSlots(n, {
      radius,
      groundYBase: groundY,
      halfHeights,
      halfWidths,
      sizeXs,
      sizeYs,
      sizeZs,
      rnds,
    });

    for (let i = 0; i < n; i++) {
      const f = live[i]!;
      const slot = slots[i]!;
      f.bounce = undefined;
      f.tipDrop = undefined;
      f.onStump = false;
      f.splittable = false;
      // Freeze physics — recycle animator owns pose.
      f.body.velocity.set(0, 0, 0);
      f.body.angularVelocity.set(0, 0, 0);
      f.body.type = CANNON.Body.STATIC;
      f.body.mass = 0;
      f.body.updateMassProperties();

      _axisX.set(slot.axisX[0], slot.axisX[1], slot.axisX[2]);
      _axisY.set(slot.axisY[0], slot.axisY[1], slot.axisY[2]);
      _axisZ.set(slot.axisZ[0], slot.axisZ[1], slot.axisZ[2]);
      _basis.makeBasis(_axisX, _axisY, _axisZ);
      _toQ.setFromRotationMatrix(_basis);

      const fromX = f.body.position.x;
      const fromY = f.body.position.y;
      const fromZ = f.body.position.z;
      const fromQx = f.mesh.quaternion.x;
      const fromQy = f.mesh.quaternion.y;
      const fromQz = f.mesh.quaternion.z;
      const fromQw = f.mesh.quaternion.w;

      // AABB-min settle at final ring orientation; keep intentional stack lift
      // encoded above the thin-axis heuristic floor in planRingPileSlots.
      const halfH = halfHeights[i] ?? 0.05;
      const heuristicFloor = groundY + halfH + RING_PILE_GROUND_PAD;
      const stackExtra = Math.max(0, slot.y - heuristicFloor);
      f.mesh.position.set(slot.x, 0, slot.z);
      f.mesh.quaternion.copy(_toQ);
      f.mesh.updateMatrixWorld(true);
      _settleBox.setFromObject(f.mesh);
      const settledY = settlePositionY(_settleBox.min.y, groundY + stackExtra);
      // Restore current pose — recycle animator owns the lerp.
      f.mesh.position.set(fromX, fromY, fromZ);
      f.mesh.quaternion.set(fromQx, fromQy, fromQz, fromQw);

      f.recycle = {
        startAt: now + i * RING_PILE_STAGGER_MS,
        durationMs: RING_PILE_RECYCLE_MS + Math.random() * RING_PILE_RECYCLE_JIT_MS,
        fromX,
        fromY,
        fromZ,
        toX: slot.x,
        toY: settledY,
        toZ: slot.z,
        fromQx,
        fromQy,
        fromQz,
        fromQw,
        toQx: _toQ.x,
        toQy: _toQ.y,
        toQz: _toQ.z,
        toQw: _toQ.w,
      };
    }
  }

  function isRecycling(): boolean {
    return fragments.some((f) => !!f.recycle);
  }

  function isTooThinAlongNormal(mesh: THREE.Mesh, normal: THREE.Vector3): boolean {
    return isTooThinToSplit(thicknessInchesAlongNormal(mesh, normal));
  }

  return {
    world,
    fragments,
    get lastCleaveDebug() {
      return lastCleaveDebug;
    },
    setStumpSupportY(y: number) {
      stumpSupportY = y;
    },
    fitStumpCollider,
    sync,
    step,
    clearFragments,
    clearStumpPieces,
    prune,
    scatterToGround,
    recycleToRing,
    isRecycling,
    fractureMesh,
    isTooThinAlongNormal,
    thicknessInchesAlongNormal,
    isFirewoodMesh,
    tossAsFirewood,
    disposeMesh,
  };
}
