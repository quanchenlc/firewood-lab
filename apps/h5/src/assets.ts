import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { Axe, Species } from '@firewood/game-core';
import { assetUrl } from './asset-url';

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

function facegrainUrlFromEndgrain(endgrainUrl: string): string {
  return endgrainUrl.replace(/\/endgrain\//, '/facegrain/');
}

export async function loadSpeciesMaterials(species: Species): Promise<SpeciesMaterials> {
  const maps = species.maps;
  if (!maps?.barkDiff) {
    const bark = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
    const end = new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.92 });
    const face = new THREE.MeshStandardMaterial({
      color: 0xc4a574,
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

  const faceUrl = maps.endgrain ? facegrainUrlFromEndgrain(maps.endgrain) : null;
  const [diff, nor, rough, endMap, faceMap] = await Promise.all([
    loadTexture(maps.barkDiff, THREE.SRGBColorSpace),
    maps.barkNor ? loadTexture(maps.barkNor) : Promise.resolve(null),
    maps.barkRough ? loadTexture(maps.barkRough) : Promise.resolve(null),
    maps.endgrain ? loadTexture(maps.endgrain, THREE.SRGBColorSpace) : Promise.resolve(null),
    faceUrl
      ? loadTexture(faceUrl, THREE.SRGBColorSpace).catch(() => null)
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
  if (faceMap) {
    faceMap.wrapS = faceMap.wrapT = THREE.ClampToEdgeWrapping;
    faceMap.repeat.set(0.85, 1.15);
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

  // Cut faces: longitudinal grain + DoubleSide (not end-grain rings).
  const inner = new THREE.MeshStandardMaterial({
    map: faceMap ?? undefined,
    color: faceMap ? 0xf0e0d0 : 0xc4a574,
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
 * Plant Poly Haven tree_stump_02 as a chopping block (劈柴台):
 * ground → stump with flat cut top → round log on that face.
 * Source mesh is wide/rooty; non-uniform scale makes it read as a stump, not a dirt hill.
 */
export interface PlantedStump {
  root: THREE.Object3D;
  /** World Y of the flat chopping face (raycast center). */
  topY: number;
  /** Approximate top radius for physics / pad sizing. */
  topRadius: number;
  /** Visual stump height after planting. */
  height: number;
}

export function plantChoppingStump(root: THREE.Object3D): PlantedStump {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const box0 = new THREE.Box3().setFromObject(root);
  const size0 = box0.getSize(new THREE.Vector3());
  const center0 = box0.getCenter(new THREE.Vector3());

  // Target: stump slightly wider than the upright round (~Ø0.8), block height ~0.55.
  const TARGET_DIAM = 1.08;
  const TARGET_HEIGHT = 0.56;
  const rawW = Math.max(size0.x, size0.z, 0.001);
  const sxz = TARGET_DIAM / rawW;
  const sy = TARGET_HEIGHT / Math.max(size0.y, 0.001);

  root.position.set(-center0.x, -center0.y, -center0.z);
  root.scale.set(sxz, sy, sxz);
  root.updateMatrixWorld(true);

  const box1 = new THREE.Box3().setFromObject(root);
  root.position.y -= box1.min.y;
  root.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(root);
  let topY = box2.max.y - 0.015;
  {
    // Prefer a center hit so bark nubs at the rim don't lift the log.
    const ray = new THREE.Raycaster(
      new THREE.Vector3(0, box2.max.y + 1.5, 0),
      new THREE.Vector3(0, -1, 0),
    );
    const hits = ray.intersectObject(root, true);
    if (hits[0]) topY = hits[0].point.y + 0.004;
  }

  const size2 = box2.getSize(new THREE.Vector3());
  const topRadius = Math.max(size2.x, size2.z) * 0.5 * 0.78;
  return { root, topY, topRadius, height: size2.y };
}

/** Lean outdoor ground + daytime sky (Poly Haven CC0, 1K). */
export interface YardTextures {
  groundDiff: THREE.Texture;
  groundNor: THREE.Texture | null;
  /** Equirect HDR (or null if missing) — used as scene.background. */
  sky: THREE.DataTexture | null;
}

export async function loadYardTextures(): Promise<YardTextures> {
  const [groundDiff, groundNor, sky] = await Promise.all([
    loadTexture('assets/ground/forest_ground_04/diff.jpg', THREE.SRGBColorSpace),
    loadTexture('assets/ground/forest_ground_04/nor.jpg').catch(() => null),
    rgbeLoader
      .loadAsync(assetUrl('assets/sky/kloofendal_43d_clear_puresky/sky_1k.hdr'))
      .then((tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return tex as THREE.DataTexture;
      })
      .catch(() => null),
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
  stump: THREE.Group;
  axes: Map<string, THREE.Group>;
  yard: YardTextures;
}> {
  const tasks: Array<() => Promise<void>> = [];
  const axes = new Map<string, THREE.Group>();
  let stump!: THREE.Group;
  let yard!: YardTextures;

  tasks.push(async () => {
    onProgress(0.05, '树桩模型…');
    // Raw GLB — plantChoppingStump() in the scene sets chopping-block proportions.
    stump = await loadGltf('assets/models/stump/tree_stump_02_1k.gltf');
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
          first.maps.endgrain?.replace(/\/endgrain\//, '/facegrain/'),
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
  return { stump, axes, yard };
}
