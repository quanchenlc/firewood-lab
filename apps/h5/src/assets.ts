import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Axe, Species } from '@firewood/game-core';
import { assetUrl } from './asset-url';

export type ProgressFn = (ratio: number, label: string) => void;

const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

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

export async function preloadContentAssets(
  speciesList: Species[],
  axesList: Axe[],
  onProgress: ProgressFn,
): Promise<{
  stump: THREE.Group;
  axes: Map<string, THREE.Group>;
}> {
  const tasks: Array<() => Promise<void>> = [];
  const axes = new Map<string, THREE.Group>();
  let stump!: THREE.Group;

  tasks.push(async () => {
    onProgress(0.05, '树桩模型…');
    stump = await loadGltf('assets/models/stump/tree_stump_02_1k.gltf');
    normalizeModel(stump, 1.55);
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
  return { stump, axes };
}
