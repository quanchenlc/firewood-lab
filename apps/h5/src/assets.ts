import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { Axe, Species } from '@firewood/game-core';
import { assetUrl } from './asset-url';
import { SIDEGRAIN_DIFF, SIDEGRAIN_NOR, speciesInsidegrainPaths } from './cut-face';
import { STUMP_HEIGHT, STUMP_TOP_RADIUS } from './log-dimensions';

/** Mild albedo tint so shared bark-edge cut atlas reads per-species (keep pale). */
const SIDEGRAIN_TINT: Record<string, number> = {
  pinus: 0xfff6e8,
  'quercus-serrata': 0xf8e8d4,
  cryptomeria: 0xfaf0dc,
  platanus: 0xf7edd8,
  'eucalyptus-globulus': 0xf0e8d4,
  toona: 0xf8e0c8,
};

export type ProgressFn = (ratio: number, label: string) => void;

const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
const rgbeLoader = new RGBELoader();

function loadTexture(url: string, colorSpace?: THREE.ColorSpace): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    texLoader.load(
      assetUrl(url),
      (tex) => {
        if (colorSpace) tex.colorSpace = colorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        let aniso = 4;
        if (typeof navigator !== 'undefined') {
          const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
          const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
          if (mobile || (typeof mem === 'number' && mem <= 4)) aniso = 2;
        }
        tex.anisotropy = aniso;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

export interface SpeciesMaterials {
  bark: THREE.MeshStandardMaterial;
  endgrain: THREE.MeshStandardMaterial;
  /** Outer materials for cylinder groups: [side, top, bottom] */
  outer: THREE.MeshStandardMaterial[];
  /** Bark-edge cut atlas for vertical chop faces (grain mid + bark L/R). */
  inner: THREE.MeshStandardMaterial;
  dispose(): void;
}

export async function loadSpeciesMaterials(species: Species): Promise<SpeciesMaterials> {
  const maps = species.maps;
  const tint = SIDEGRAIN_TINT[species.id] ?? 0xf0e0d0;
  if (!maps?.barkDiff) {
    const bark = new THREE.MeshStandardMaterial({
      color: 0x8b5a2b,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    const end = new THREE.MeshStandardMaterial({
      color: 0xd4b896,
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    const face = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
    return {
      bark,
      endgrain: end,
      outer: [bark, end, end],
      inner: face,
      dispose() {
        bark.dispose();
        end.dispose();
        face.dispose();
      },
    };
  }

  const insidePaths = maps.insidegrainDiff
    ? { diff: maps.insidegrainDiff, nor: maps.insidegrainNor }
    : speciesInsidegrainPaths(species.id);
  const faceDiffUrl = insidePaths.diff ?? SIDEGRAIN_DIFF;
  const faceNorUrl = insidePaths.nor ?? SIDEGRAIN_NOR;

  const [diff, nor, rough, endMap, faceMap, faceNor] = await Promise.all([
    loadTexture(maps.barkDiff, THREE.SRGBColorSpace),
    maps.barkNor ? loadTexture(maps.barkNor) : Promise.resolve(null),
    maps.barkRough ? loadTexture(maps.barkRough) : Promise.resolve(null),
    maps.endgrain ? loadTexture(maps.endgrain, THREE.SRGBColorSpace) : Promise.resolve(null),
    loadTexture(faceDiffUrl, THREE.SRGBColorSpace).catch(() =>
      loadTexture(SIDEGRAIN_DIFF, THREE.SRGBColorSpace).catch(() => null),
    ),
    faceNorUrl
      ? loadTexture(faceNorUrl).catch(() => loadTexture(SIDEGRAIN_NOR).catch(() => null))
      : Promise.resolve(null),
  ]);

  diff.repeat.set(1.2, 1);
  if (nor) nor.repeat.copy(diff.repeat);
  if (rough) rough.repeat.copy(diff.repeat);

  // Caps: one ring pattern per face — clamp so UV edges don't tile a bullseye.
  if (endMap) {
    endMap.wrapS = endMap.wrapT = THREE.ClampToEdgeWrapping;
    endMap.repeat.set(1, 1);
  }
  // Side-grain / bark-edge atlas: CASE1 UVs span [0,1]²; clamp avoids tiling.
  if (faceMap) {
    faceMap.wrapS = faceMap.wrapT = THREE.ClampToEdgeWrapping;
    faceMap.repeat.set(1, 1);
  }
  if (faceNor) {
    faceNor.wrapS = faceNor.wrapT = THREE.ClampToEdgeWrapping;
    faceNor.repeat.set(1, 1);
  }

  // Outer bark: photographic albedo+normal, cylindrical UVs, strong bump
  // (ref outsidebark normalScale≈2). DoubleSide so thin mantle never drops out.
  const bark = new THREE.MeshStandardMaterial({
    map: diff,
    normalMap: nor ?? undefined,
    normalScale: nor ? new THREE.Vector2(2, 2) : undefined,
    roughnessMap: rough ?? undefined,
    roughness: rough ? 1 : 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const endgrain = new THREE.MeshStandardMaterial({
    map: endMap ?? undefined,
    color: endMap ? 0xffffff : 0xd4b896,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  // Cut faces: bark-edge atlas (thin bark L/R + longitudinal grain mid).
  const inner = new THREE.MeshStandardMaterial({
    map: faceMap ?? undefined,
    normalMap: faceNor ?? undefined,
    normalScale: faceNor ? new THREE.Vector2(0.35, 0.35) : undefined,
    color: faceMap ? tint : 0xc4a574,
    roughness: 0.7,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  return {
    bark,
    endgrain,
    outer: [bark, endgrain, endgrain.clone()],
    inner,
    dispose() {
      diff.dispose();
      nor?.dispose();
      rough?.dispose();
      endMap?.dispose();
      faceMap?.dispose();
      faceNor?.dispose();
      bark.dispose();
      endgrain.dispose();
      inner.dispose();
    },
  };
}

export async function loadGltf(url: string): Promise<THREE.Group> {
  const gltf = await gltfLoader.loadAsync(assetUrl(url));
  const root = gltf.scene;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return root;
}

/** Fit model into a target size (max axis) and return it. */
export function normalizeModel(root: THREE.Object3D, maxSize: number): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  root.scale.multiplyScalar(maxSize / longest);
  return root;
}

/**
 * Chopping-block stump (劈柴台): scanned CC0 stump GLB packs.
 * Prefer real chopping-block / cut-log photogrammetry — never screen.toys assets.
 */
export interface PlantedStump {
  root: THREE.Object3D;
  /** World Y of the flat chopping face (horizontal seating plane). */
  topY: number;
  /** Approximate top radius for physics / yard layout. */
  topRadius: number;
  /** Visual stump height after planting. */
  height: number;
  /** Content pack id when known. */
  packId?: string;
}

/** Default scanned CC0 chopping stump (Blendkit Log Chopping Stump 2). */
export const CHOPPING_STUMP_GLB = 'assets/models/stump/log_chopping_stump.glb';

/**
 * Subtle horizontal seating plane so the choppable log rests flush.
 * Warm end-grain map + high roughness — not a bright plastic disc.
 */
async function makeSeatingDisc(radius: number): Promise<THREE.Mesh> {
  const endMap = await loadTexture('assets/endgrain/toona.png', THREE.SRGBColorSpace).catch(
    () => null,
  );
  if (endMap) {
    endMap.wrapS = endMap.wrapT = THREE.ClampToEdgeWrapping;
    endMap.repeat.set(1, 1);
  }
  const mat = new THREE.MeshStandardMaterial({
    map: endMap ?? undefined,
    // Dusty sawn wood — slightly darker than bare endgrain so it nests into bark.
    color: endMap ? 0xd8c4a0 : 0xa88b62,
    roughness: 0.97,
    metalness: 0,
    // Soften so the disc reads as wood, not a UI chip.
    transparent: true,
    opacity: 0.92,
    depthWrite: true,
  });
  // Thin cylinder (not a zero-thickness plane) so contact shadows stay readable.
  const geo = new THREE.CylinderGeometry(radius, radius * 0.98, 0.012, 48, 1, false);
  const disc = new THREE.Mesh(geo, mat);
  disc.name = 'chopping-block-seat';
  disc.castShadow = false;
  disc.receiveShadow = true;
  return disc;
}

/**
 * Load + plant a scanned chopping stump under the log.
 * Scales so top height ≈ STUMP_HEIGHT and plan radius ≈ STUMP_TOP_RADIUS
 * (larger footprint than the prior 0.34 m top), then adds a level seating face.
 */
export async function plantChoppingStump(
  url: string = CHOPPING_STUMP_GLB,
  opts?: { packId?: string },
): Promise<PlantedStump> {
  const model = await loadGltf(url);
  const root = new THREE.Group();
  root.name = 'chopping-block';
  if (opts?.packId) root.userData.packId = opts.packId;

  // Natural size before planting (glTF Y-up).
  model.updateMatrixWorld(true);
  const nat = new THREE.Box3().setFromObject(model);
  const natSize = nat.getSize(new THREE.Vector3());
  const h = Math.max(natSize.y, 1e-4);
  const halfXZ = 0.5 * Math.max(natSize.x, natSize.z, 1e-4);

  // Hit stump top Y + seating radius used by log / collider (larger footprint).
  const scaleY = STUMP_HEIGHT / h;
  const scaleXZ = STUMP_TOP_RADIUS / halfXZ;
  model.scale.set(scaleXZ, scaleY, scaleXZ);
  model.updateMatrixWorld(true);

  // Bottom on ground (y=0), XZ centered on origin.
  const box = new THREE.Box3().setFromObject(model);
  model.position.x -= (box.min.x + box.max.x) * 0.5;
  model.position.z -= (box.min.z + box.max.z) * 0.5;
  model.position.y -= box.min.y;

  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (!std?.isMeshStandardMaterial) continue;
      // Scanned albedo already carries bark / cut-top variation.
      std.metalness = 0;
      if (std.roughness < 0.7) std.roughness = 0.85;
    }
  });
  // Stable name for shadow / debug probes (first mesh only).
  let namedBody = false;
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (namedBody || !mesh.isMesh) return;
    mesh.name = 'chopping-block-body';
    namedBody = true;
  });

  root.add(model);
  root.updateMatrixWorld(true);
  const planted = new THREE.Box3().setFromObject(root);
  // Sink irregular peaks a few mm under the seating plane so the log sits flush.
  const seatY = STUMP_HEIGHT;
  const peak = planted.max.y;
  if (peak > seatY + 0.002) {
    model.position.y -= peak - seatY + 0.004;
  }

  const seat = await makeSeatingDisc(STUMP_TOP_RADIUS * 0.92);
  seat.position.y = seatY - 0.006;
  root.add(seat);

  root.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(root);
  const topY = seatY;
  const topRadius = Math.max(
    Math.abs(finalBox.min.x),
    Math.abs(finalBox.max.x),
    Math.abs(finalBox.min.z),
    Math.abs(finalBox.max.z),
    STUMP_TOP_RADIUS * 0.95,
  );

  return {
    root,
    topY,
    topRadius,
    height: Math.max(topY - finalBox.min.y, STUMP_HEIGHT * 0.9),
    packId: opts?.packId,
  };
}

/** @deprecated Use plantChoppingStump — kept as a thin alias for call sites. */
export async function buildChoppingBlock(
  _stumpModel?: THREE.Object3D,
): Promise<PlantedStump> {
  return plantChoppingStump();
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      std.map?.dispose();
      std.normalMap?.dispose();
      std.roughnessMap?.dispose();
      std.aoMap?.dispose();
      std.dispose?.();
    }
  });
}

export { disposeObject3D };

/** Lean outdoor ground + daytime sky (Poly Haven CC0, mobile-friendly). */
export interface YardTextures {
  groundDiff: THREE.Texture;
  groundNor: THREE.Texture | null;
  /** Equirect sky (JPG preferred; HDR optional). */
  sky: THREE.Texture | null;
}

export async function loadYardTextures(): Promise<YardTextures> {
  const [groundDiff, groundNor, sky] = await Promise.all([
    loadTexture('assets/ground/forest_ground_04/diff.jpg', THREE.SRGBColorSpace),
    loadTexture('assets/ground/forest_ground_04/nor.jpg').catch(() => null),
    // Tonemapped equirect JPG as a sky-dome map (UV). More reliable than
    // scene.background EquirectangularReflectionMapping on mobile / software GL.
    loadTexture(
      'assets/sky/kloofendal_48d_partly_cloudy_puresky/sky_2k.jpg',
      THREE.SRGBColorSpace,
    )
      .then((tex) => {
        tex.mapping = THREE.UVMapping;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.repeat.set(1, 1);
        return tex;
      })
      .catch(async () => {
        try {
          const tex = await rgbeLoader.loadAsync(
            assetUrl('assets/sky/kloofendal_48d_partly_cloudy_puresky/sky_1k.hdr'),
          );
          tex.mapping = THREE.EquirectangularReflectionMapping;
          return tex;
        } catch {
          return null;
        }
      }),
  ]);
  groundDiff.repeat.set(5.5, 5.5);
  if (groundNor) groundNor.repeat.copy(groundDiff.repeat);
  return { groundDiff, groundNor, sky };
}

export async function preloadContentAssets(
  speciesList: Species[],
  axesList: Axe[],
  onProgress: ProgressFn,
  opts?: {
    stumpModel?: string;
    stumpPackId?: string;
    /** Warm additional stump pack GLBs in parallel (lazy swap later). */
    warmStumpModels?: string[];
  },
): Promise<{
  choppingBlock: PlantedStump;
  axes: Map<string, THREE.Group>;
  yard: YardTextures;
}> {
  const tasks: Array<() => Promise<void>> = [];
  const axes = new Map<string, THREE.Group>();
  let choppingBlock!: PlantedStump;
  let yard!: YardTextures;

  tasks.push(async () => {
    onProgress(0.05, '劈柴台…');
    choppingBlock = await plantChoppingStump(opts?.stumpModel ?? CHOPPING_STUMP_GLB, {
      packId: opts?.stumpPackId,
    });
  });

  if (opts?.warmStumpModels?.length) {
    for (const url of opts.warmStumpModels) {
      if (url === (opts?.stumpModel ?? CHOPPING_STUMP_GLB)) continue;
      tasks.push(async () => {
        // Touch-load so pack switches feel instant.
        await loadGltf(url).catch(() => null);
      });
    }
  }

  tasks.push(async () => {
    onProgress(0.12, '地面与天空…');
    yard = await loadYardTextures();
  });

  for (const axe of axesList) {
    if (!axe.model) continue;
    const id = axe.id;
    const url = axe.model;
    tasks.push(async () => {
      onProgress(0.2, `斧头 ${axe.name}…`);
      const g = await loadGltf(url);
      normalizeModel(g, axe.id === 'maul' ? 0.95 : 0.75);
      axes.set(id, g);
    });
  }

  // Warm first species maps (others lazy on switch)
  const first = speciesList.find((s) => s.id === 'toona') ?? speciesList[0]!;
  tasks.push(async () => {
    onProgress(0.55, `树皮 ${first.name}…`);
    // Touch-load via Image to warm HTTP cache; materials built later
    if (first.maps?.barkDiff) {
      await Promise.all(
        [
          first.maps.barkDiff,
          first.maps.barkNor,
          first.maps.barkRough,
          first.maps.endgrain,
          first.maps.insidegrainDiff ?? speciesInsidegrainPaths(first.id).diff,
          first.maps.insidegrainNor ?? speciesInsidegrainPaths(first.id).nor,
          SIDEGRAIN_DIFF,
          SIDEGRAIN_NOR,
        ]
          .filter(Boolean)
          .map(
            (u) =>
              new Promise<void>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve();
                img.onerror = () => reject(new Error(`Failed ${u}`));
                img.src = assetUrl(u!);
              }),
          ),
      );
    }
  });

  let done = 0;
  for (const task of tasks) {
    await task();
    done += 1;
    onProgress(0.15 + (done / tasks.length) * 0.8, '加载中…');
  }
  onProgress(1, '就绪');
  return { choppingBlock, axes, yard };
}
