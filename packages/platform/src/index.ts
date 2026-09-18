export type {
  IAudio,
  IStorage,
  IAssetLoader,
  IInput,
  PointerPhase,
  PointerSample,
  PointerListener,
  PlatformKit,
} from './types';

export {
  createH5Platform,
  H5Audio,
  H5Storage,
  H5AssetLoader,
  H5Input,
  chopPlaybackJitter,
  pickRandomNoRepeat,
} from './h5/index';
export type { H5AudioOptions, H5AudioPlayOpts, CreateH5PlatformOptions } from './h5/index';
