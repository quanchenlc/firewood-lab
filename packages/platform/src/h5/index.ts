import type { PlatformKit } from '../types';
import { H5AssetLoader } from './asset-loader';
import { H5Audio } from './audio';
import { H5Input } from './input';
import { H5Storage } from './storage';

export { H5AssetLoader, H5Audio, H5Input, H5Storage };

/** Factory for the H5 platform kit (stubs ready for real audio/assets). */
export function createH5Platform(): PlatformKit {
  return {
    audio: new H5Audio(),
    storage: new H5Storage(),
    assets: new H5AssetLoader(),
    input: new H5Input(),
  };
}
