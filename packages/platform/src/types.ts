/** Platform capability contracts — implement per runtime (H5, WeChat mini-game, …). */

export interface IAudio {
  play(id: string, opts?: { volume?: number; loop?: boolean }): void;
  stop(id: string): void;
  setMuted(muted: boolean): void;
}

export interface IStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface IAssetLoader {
  loadText(url: string): Promise<string>;
  loadJson<T = unknown>(url: string): Promise<T>;
  loadArrayBuffer(url: string): Promise<ArrayBuffer>;
}

export type PointerPhase = 'down' | 'move' | 'up' | 'cancel';

export interface PointerSample {
  phase: PointerPhase;
  x: number;
  y: number;
  /** Normalized 0–1 relative to the bound element when available. */
  nx: number;
  ny: number;
  pointerId: number;
}

export type PointerListener = (sample: PointerSample) => void;

export interface IInput {
  /** Bind pointer listeners to an element (canvas or overlay). */
  attach(target: EventTarget): void;
  detach(): void;
  onPointer(listener: PointerListener): () => void;
}

export interface PlatformKit {
  audio: IAudio;
  storage: IStorage;
  assets: IAssetLoader;
  input: IInput;
}
