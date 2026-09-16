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

export { createH5Platform, H5Audio, H5Storage, H5AssetLoader, H5Input } from './h5/index';
