import type { IInput, PointerListener, PointerSample } from '../types';

/** Pointer Events stub for mobile-friendly H5 input. */
export class H5Input implements IInput {
  private target: EventTarget | null = null;
  private listeners = new Set<PointerListener>();

  private onDown = (e: Event) => this.emit(e as PointerEvent, 'down');
  private onMove = (e: Event) => this.emit(e as PointerEvent, 'move');
  private onUp = (e: Event) => this.emit(e as PointerEvent, 'up');
  private onCancel = (e: Event) => this.emit(e as PointerEvent, 'cancel');

  attach(target: EventTarget): void {
    this.detach();
    this.target = target;
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onCancel);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener('pointerdown', this.onDown);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerup', this.onUp);
    this.target.removeEventListener('pointercancel', this.onCancel);
    this.target = null;
  }

  onPointer(listener: PointerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(e: PointerEvent, phase: PointerSample['phase']): void {
    const el = e.currentTarget as HTMLElement | null;
    const rect = el?.getBoundingClientRect?.();
    const w = rect?.width || 1;
    const h = rect?.height || 1;
    const x = e.clientX - (rect?.left ?? 0);
    const y = e.clientY - (rect?.top ?? 0);
    const sample: PointerSample = {
      phase,
      x,
      y,
      nx: x / w,
      ny: y / h,
      pointerId: e.pointerId,
    };
    for (const listener of this.listeners) listener(sample);
  }
}
