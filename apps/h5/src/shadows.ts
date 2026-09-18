import * as THREE from 'three';

/**
 * Mobile-friendly sun-shadow tuning for the chopping yard.
 * Prefer real shadowMap over ContactShadows blobs — keep map small on weak GPUs.
 */
export interface ShadowTune {
  /** Shadow map resolution (square). */
  mapSize: number;
  /** PCFSoft blur radius (ignored by BasicShadowMap). */
  radius: number;
  bias: number;
  normalBias: number;
  camNear: number;
  camFar: number;
  /** Orthographic half-extent covering stump + tip-drop ring. */
  camSize: number;
  type: typeof THREE.BasicShadowMap | typeof THREE.PCFSoftShadowMap;
}

/** Conservative defaults: readable contact, cheap enough for H5 phones. */
export function shadowTuneForDevice(weakDevice: boolean): ShadowTune {
  if (weakDevice) {
    return {
      mapSize: 512,
      radius: 1,
      bias: -0.00025,
      normalBias: 0.03,
      camNear: 0.4,
      camFar: 16,
      // Covers stump (~0.4) + tip-drop (~0.8) + ring pile (~1.5) with margin.
      camSize: 3.6,
      type: THREE.BasicShadowMap,
    };
  }
  return {
    mapSize: 1024,
    radius: 2.2,
    bias: -0.00018,
    normalBias: 0.02,
    camNear: 0.4,
    camFar: 18,
    // Slightly tighter frustum → denser texels / clearer contact near stump.
    camSize: 3.8,
    type: THREE.PCFSoftShadowMap,
  };
}

/**
 * Enable renderer shadowMap + configure the key (sun) directional light.
 * Call once after lights are created; adds `key.target` to the scene.
 */
export function enableSunShadows(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  key: THREE.DirectionalLight,
  opts: { weakDevice?: boolean } = {},
): ShadowTune {
  const tune = shadowTuneForDevice(!!opts.weakDevice);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = tune.type;

  key.castShadow = true;
  key.shadow.mapSize.set(tune.mapSize, tune.mapSize);
  key.shadow.bias = tune.bias;
  key.shadow.normalBias = tune.normalBias;
  key.shadow.radius = tune.radius;

  const cam = key.shadow.camera;
  cam.near = tune.camNear;
  cam.far = tune.camFar;
  cam.left = -tune.camSize;
  cam.right = tune.camSize;
  cam.top = tune.camSize;
  cam.bottom = -tune.camSize;
  cam.updateProjectionMatrix();

  // Aim at chopping-block height so contact under stump / chips stays in frustum.
  key.target.position.set(0, 0.22, 0);
  if (!key.target.parent) scene.add(key.target);

  return tune;
}

/** Mark a mesh tree for shadow cast/receive (fragments, log proxy, debris). */
export function setShadowFlags(
  root: THREE.Object3D,
  flags: { cast?: boolean; receive?: boolean } = { cast: true, receive: true },
): void {
  const cast = flags.cast ?? true;
  const receive = flags.receive ?? true;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
    }
  });
}
