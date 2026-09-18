import type { PlatformKit } from '../types';
import { H5AssetLoader } from './asset-loader';
import { H5Audio, type H5AudioOptions } from './audio';
import { H5Input } from './input';
import { H5Storage } from './storage';

export { H5AssetLoader, H5Audio, H5Input, H5Storage };
export type { H5AudioOptions, H5AudioPlayOpts } from './audio';
export { chopPlaybackJitter, pickRandomNoRepeat } from './audio';

export type CreateH5PlatformOptions = {
  audio?: H5AudioOptions;
};

/** Factory for the H5 platform kit. */
export function createH5Platform(opts: CreateH5PlatformOptions = {}): PlatformKit {
  return {
    audio: new H5Audio(opts.audio),
    storage: new H5Storage(),
    assets: new H5AssetLoader(),
    input: new H5Input(),
  };
}
