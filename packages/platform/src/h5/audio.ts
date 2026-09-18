import type { IAudio } from '../types';

export type H5AudioPlayOpts = {
  volume?: number;
  loop?: boolean;
  /** Playback rate multiplier (1 = original). */
  playbackRate?: number;
};

export type H5AudioOptions = {
  /**
   * Map logical sound ids → one or more URLs (variants).
   * Unknown ids are no-ops (same as the old stub).
   */
  bank?: Record<string, string[]>;
  /** Optional URL resolver (e.g. Vite `base`). */
  resolveUrl?: (path: string) => string;
};

type ActiveLoop = {
  source: AudioBufferSourceNode;
  gain: GainNode;
};

/**
 * Web Audio H5 backend.
 *
 * Timing / mix (reverse-engineered from screen.toys/firewood behavior — no
 * proprietary audio copied): soft looping outdoor BGM (~0.4), chop SFX at
 * blade impact with random-no-repeat variants + slight pitch/volume jitter.
 */
export class H5Audio implements IAudio {
  private muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly bank: Record<string, string[]>;
  private readonly resolveUrl: (path: string) => string;
  private readonly lastVariant = new Map<string, number>();
  private readonly loops = new Map<string, ActiveLoop>();
  private unlocked = false;
  private bgStarted = false;
  private ready: Promise<void> | null = null;
  private wasBackgrounded = false;

  constructor(opts: H5AudioOptions = {}) {
    this.bank = opts.bank ?? {};
    this.resolveUrl = opts.resolveUrl ?? ((p) => p);
  }

  /** Preload every buffer in the bank (safe to call multiple times). */
  preload(): Promise<void> {
    if (!this.ready) this.ready = this.loadAll();
    return this.ready;
  }

  /**
   * Resume AudioContext after a user gesture (required by browser autoplay
   * policy / mobile). Idempotent.
   */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* ignore — may still be blocked until a real gesture */
      }
    }
    this.unlocked = ctx.state === 'running';
    if (this.unlocked && this.wasBackgrounded) {
      this.wasBackgrounded = false;
      this.restartLoop('bgm');
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  play(id: string, opts?: H5AudioPlayOpts): void {
    if (this.muted) return;
    const urls = this.bank[id];
    if (!urls || urls.length === 0) return;

    void this.preload().then(() => {
      if (this.muted) return;
      void this.unlock().then(() => {
        if (this.muted) return;
        const buffer = this.pickBuffer(id, urls);
        if (!buffer) return;

        const loop = !!opts?.loop;
        const volume = clamp(opts?.volume ?? 1, 0, 1);
        const rate = clamp(opts?.playbackRate ?? 1, 0.5, 2);

        if (loop) {
          this.startLoop(id, buffer, volume);
          if (id === 'bgm') this.bgStarted = true;
          return;
        }

        this.playOneShot(buffer, volume, rate);
      });
    });
  }

  stop(id: string): void {
    const active = this.loops.get(id);
    if (!active) return;
    try {
      active.source.stop();
    } catch {
      /* already stopped */
    }
    try {
      active.source.disconnect();
      active.gain.disconnect();
    } catch {
      /* ignore */
    }
    this.loops.delete(id);
    if (id === 'bgm') this.bgStarted = false;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
    if (muted) {
      // Keep loop nodes but silence via master; no need to tear down.
      return;
    }
    // Unmute: if BGM was requested earlier, ensure it is audible.
    if (this.bgStarted && !this.loops.has('bgm')) {
      this.play('bgm', { loop: true, volume: 0.4 });
    }
  }

  /** Start outdoor BGM if not already playing (first gesture). */
  ensureBgm(volume = 0.4): void {
    if (this.muted) {
      this.bgStarted = true;
      return;
    }
    this.play('bgm', { loop: true, volume });
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ensureContext();
    const entries = Object.entries(this.bank);
    await Promise.all(
      entries.map(async ([, urls]) => {
        for (const url of urls) {
          const abs = this.resolveUrl(url);
          if (this.buffers.has(abs)) continue;
          try {
            const res = await fetch(abs);
            if (!res.ok) continue;
            const arr = await res.arrayBuffer();
            const buf = await ctx.decodeAudioData(arr.slice(0));
            this.buffers.set(abs, buf);
          } catch {
            console.warn('[h5-audio] failed to load', abs);
          }
        }
      }),
    );

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.wasBackgrounded = true;
        } else if (this.unlocked) {
          void this.unlock();
        }
      });
    }
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private pickBuffer(id: string, urls: string[]): AudioBuffer | null {
    const idx = pickRandomNoRepeat(urls.length, this.lastVariant.get(id) ?? -1);
    this.lastVariant.set(id, idx);
    const abs = this.resolveUrl(urls[idx]!);
    return this.buffers.get(abs) ?? null;
  }

  private playOneShot(buffer: AudioBuffer, volume: number, rate: number): void {
    const ctx = this.ensureContext();
    if (!this.master) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.master);
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
    source.start(0);
  }

  private startLoop(id: string, buffer: AudioBuffer, volume: number): void {
    if (this.loops.has(id)) return;
    const ctx = this.ensureContext();
    if (!this.master) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.master);
    source.start(0);
    this.loops.set(id, { source, gain });
  }

  private restartLoop(id: string): void {
    if (!this.bgStarted && id === 'bgm') return;
    const prev = this.loops.get(id);
    const volume = prev?.gain.gain.value ?? 0.4;
    if (prev) {
      try {
        prev.source.stop();
      } catch {
        /* ignore */
      }
      this.loops.delete(id);
    }
    const urls = this.bank[id];
    if (!urls?.length) return;
    const buffer = this.pickBuffer(id, urls);
    if (!buffer) return;
    this.startLoop(id, buffer, volume);
  }
}

/** Pick a random index in [0, n), avoiding `last` when n > 1. */
export function pickRandomNoRepeat(n: number, last: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 0;
  let next = Math.floor(Math.random() * n);
  let guard = 0;
  while (next === last && guard++ < 8) {
    next = Math.floor(Math.random() * n);
  }
  return next;
}

/** Slight pitch/volume jitter so repeated chops don’t sound identical. */
export function chopPlaybackJitter(outcome: 'sweet' | 'too_heavy' | 'too_light' | string): {
  volume: number;
  playbackRate: number;
} {
  const pitch = 0.94 + Math.random() * 0.12; // ~0.94–1.06
  const volJitter = 0.88 + Math.random() * 0.14; // ~0.88–1.02
  if (outcome === 'too_heavy') {
    return { volume: Math.min(1, 0.95 * volJitter), playbackRate: pitch * 0.96 };
  }
  if (outcome === 'too_light') {
    return { volume: 0.42 * volJitter, playbackRate: pitch * 1.06 };
  }
  // sweet + default
  return { volume: 0.72 * volJitter, playbackRate: pitch };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
