import type { IStorage } from '../types';

/** localStorage-backed stub with in-memory fallback. */
export class H5Storage implements IStorage {
  private memory = new Map<string, string>();

  private get store(): Storage | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  getItem(key: string): string | null {
    const s = this.store;
    if (s) return s.getItem(key);
    return this.memory.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    const s = this.store;
    if (s) {
      s.setItem(key, value);
      return;
    }
    this.memory.set(key, value);
  }

  removeItem(key: string): void {
    const s = this.store;
    if (s) {
      s.removeItem(key);
      return;
    }
    this.memory.delete(key);
  }
}
