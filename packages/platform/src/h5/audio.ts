import type { IAudio } from '../types';

/** Stub H5 audio — logs only until real SFX land. */
export class H5Audio implements IAudio {
  private muted = false;

  play(id: string, opts?: { volume?: number; loop?: boolean }): void {
    if (this.muted) return;
    console.debug('[h5-audio] play', id, opts);
  }

  stop(id: string): void {
    console.debug('[h5-audio] stop', id);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}
