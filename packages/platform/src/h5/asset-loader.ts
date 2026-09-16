import type { IAssetLoader } from '../types';

/** fetch-based asset loader stub for H5. */
export class H5AssetLoader implements IAssetLoader {
  async loadText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load text: ${url} (${res.status})`);
    return res.text();
  }

  async loadJson<T = unknown>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load json: ${url} (${res.status})`);
    return res.json() as Promise<T>;
  }

  async loadArrayBuffer(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load buffer: ${url} (${res.status})`);
    return res.arrayBuffer();
  }
}
