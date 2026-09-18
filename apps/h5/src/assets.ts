import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { Axe, Species } from '@firewood/game-core';
import { assetUrl } from './asset-url';
import { SIDEGRAIN_DIFF, SIDEGRAIN_NOR } from './cut-face';
import {
  applyStumpOutlineIrregularity,
  STUMP_BOT_RADIUS,
  STUMP_HEIGHT,
  STUMP_TOP_RADIUS,
} from './log-dimensions';

/** Mild albedo tint so shared ash_veneer side-grain reads per-species. */
const SIDEGRAIN_TINT: Record<string, number> = {
  pinus: 0xfff0d8,
  'quercus-serrata': 0xf0d8b8,
  cryptomeria: 0xf5e2c4,
  platanus: 0xf2e4c8,
  'eucalyptus-globulus': 0xe8dcc0,
  toona: 0xf0c8a0,
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
  /** Longitudinal face-grain for vertical chop cut faces (not end-grain rings). */
  inner: THREE.MeshStandardMaterial;
  dispose(): void;
}

export async function loadSpeciesMaterials(species: Species): Promise<SpeciesMaterials> {
  const maps = species.maps;
  const tint = SIDEGRAIN_TINT[species.id] ?? 0xf0e0d0;
  if (!maps?.barkDiff) {
    const bark = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
    const end = new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.92 });
    const face = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.88,
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

  const [diff, nor, rough, endMap, faceMap, faceNor] = await Promise.all([
    loadTexture(maps.barkDiff, THREE.SRGBColorSpace),
    maps.barkNor ? loadTexture(maps.barkNor) : Promise.resolve(null),
    maps.barkRough ? loadTexture(maps.barkRough) : Promise.resolve(null),
    maps.endgrain ? loadTexture(maps.endgrain, THREE.SRGBColorSpace) : Promise.resolve(null),
    loadTexture(SIDEGRAIN_DIFF, THREE.SRGBColorSpace).catch(() => null),
    loadTexture(SIDEGRAIN_NOR).catch(() => null),
  ]);

  diff.repeat.set(1.2, 1);
  if (nor) nor.repeat.copy(diff.repeat);
  if (rough) rough.repeat.copy(diff.repeat);

  // Caps: one ring pattern per face — clamp so UV edges don't tile a bullseye.
  if (endMap) {
    endMap.wrapS = endMap.wrapT = THREE.ClampToEdgeWrapping;
    endMap.repeat.set(1, 1);
  }
  // Side-grain: aspect-correct cut-plane UVs; clamp avoids stripe tiling.
  if (faceMap) {
    faceMap.wrapS = faceMap.wrapT = THREE.ClampToEdgeWrapping;
    faceMap.repeat.set(1, 1);
  }
  if (faceNor) {
    faceNor.wrapS = faceNor.wrapT = THREE.ClampToEdgeWrapping;
    faceNor.repeat.set(1, 1);
  }

  const bark = new THREE.MeshStandardMaterial({
    map: diff,
    normalMap: nor ?? undefined,
    roughnessMap: rough ?? undefined,
    roughness: rough ? 1 : 0.85,
    metalness: 0,
  });

  const endgrain = new THREE.MeshStandardMaterial({
    map: endMap ?? undefined,
    color: endMap ? 0xffffff : 0xd4b896,
    roughness: 0.92,
    metalness: 0,
  });

  // Cut faces: photographic longitudinal side-grain (not procedural sin stripes).
  const inner = new THREE.MeshStandardMaterial({
    map: faceMap ?? undefined,
    normalMap: faceNor ?? undefined,
    color: faceMap ? tint : 0xc4a574,
    roughness: 0.88,
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
 * Chopping-block stump (劈柴台): flat cut top + bark cylinder.
 * Poly Haven tree_stump_02 is a wide root mound — wrong silhouette for
 * screen.toys/firewood — so we reuse its CC0 PBR maps on a block mesh.
 */
export interface PlantedStump {
  root: THREE.Object3D;
  /** World Y of the flat chopping face. */
  topY: number;
  /** Approximate top radius for physics / pad sizing. */
  topRadius: number;
  /** Visual stump height after planting. */
  height: number;
}

const STUMP_TEX = {
  diff: 'assets/models/stump/textures/tree_stump_02_diff_1k.jpg',
  nor: 'assets/models/stump/textures/tree_stump_02_nor_gl_1k.jpg',
  arm: 'assets/models/stump/textures/tree_stump_02_arm_1k.jpg',
};

/** Build a flat-top chopping block; `stumpModel` is kept only as a texture donor (optional). */
export async function buildChoppingBlock(
  _stumpModel?: THREE.Object3D,
): Promise<PlantedStump> {
  const [diff, nor, arm] = await Promise.all([
    loadTexture(STUMP_TEX.diff, THREE.SRGBColorSpace),
    loadTexture(STUMP_TEX.nor).catch(() => null),
    loadTexture(STUMP_TEX.arm).catch(() => null),
  ]);
  // Bark wraps the cylinder side; tighten repeat so rings read as trunk bark.
  diff.wrapS = diff.wrapT = THREE.RepeatWrapping;
  diff.repeat.set(1.15, 0.85);
  if (nor) {
    nor.wrapS = nor.wrapT = THREE.RepeatWrapping;
    nor.repeat.copy(diff.repeat);
  }
  if (arm) {
    arm.wrapS = arm.wrapT = THREE.RepeatWrapping;
    arm.repeat.copy(diff.repeat);
  }

  const barkMat = new THREE.MeshStandardMaterial({
    map: diff,
    normalMap: nor ?? undefined,
    roughnessMap: arm ?? undefined,
    roughness: arm ? 1 : 0.9,
    metalness: 0,
  });
  // Flat sawn face — end-grain rings so the chopping face reads clearly.
  const endMap = await loadTexture('assets/endgrain/toona.png', THREE.SRGBColorSpace).catch(
    () => null,
  );
  if (endMap) {
    endMap.wrapS = endMap.wrapT = THREE.ClampToEdgeWrapping;
    endMap.repeat.set(1, 1);
  }
  const cutMat = new THREE.MeshStandardMaterial({
    map: endMap ?? undefined,
    color: endMap ? 0xffffff : 0xc9a978,
    roughness: 0.88,
    metalness: 0,
  });

  // Matched to the smaller choppable round in `log-dimensions.ts`.
  // Organic silhouette (not a clean cylinder) — same plan-noise family as the log.
  const TOP_R = STUMP_TOP_RADIUS;
  const BOT_R = STUMP_BOT_RADIUS;
  const HEIGHT = STUMP_HEIGHT;
  const stumpSeed = 41;

  const root = new THREE.Group();
  root.name = 'chopping-block';

  const bodyGeo = new THREE.CylinderGeometry(TOP_R, BOT_R, HEIGHT, 32, 4);
  applyStumpOutlineIrregularity(bodyGeo, { height: HEIGHT, seed: stumpSeed });
  const body = new THREE.Mesh(bodyGeo, barkMat);
  body.position.y = HEIGHT * 0.5;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  const topGeo = new THREE.CircleGeometry(TOP_R * 0.995, 40);
  applyStumpOutlineIrregularity(topGeo, {
    height: HEIGHT,
    seed: stumpSeed,
    ampIn: 0.32,
    plane: 'xy',
  });
  const top = new THREE.Mesh(topGeo, cutMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = HEIGHT + 0.001;
  top.receiveShadow = true;
  root.add(top);

  // Thin rim bevel so the cut edge reads in daylight.
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(TOP_R * 0.97, 0.012, 6, 36),
    new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.95, metalness: 0 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = HEIGHT;
  root.add(rim);

  const topY = HEIGHT;
  return { root, topY, topRadius: TOP_R, height: HEIGHT };
}

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
    // Warm donor GLB (CC0 maps live under models/stump/textures), then build block mesh.
    await loadGltf('assets/models/stump/tree_stump_02_1k.gltf').catch(() => null);
    choppingBlock = await buildChoppingBlock();
  });

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
