/**
 * Debug-stage interaction flags for H5 chop loop.
 *
 * When `DEBUG_DIRECT_CHOP` is on:
 * - No force / rhythm bar UI (`forceBarEnabled === false`)
 * - Single click on wood → immediate axe swing + split
 * - Cleave plane uses **live** camera facing at each chop (no locked normal,
 *   no 4-chop 90° rotate lock)
 * - Impact uses the exact raycast hit point from that click
 * - Force resolves as sweet (mid sweet-zone) so every on-wood hit splits
 *
 * Miss (click not on wood/log) still does nothing.
 *
 * Flip to `false` to restore the full aim → rhythm → confirm + 4-chop rotate loop.
 */
export const DEBUG_DIRECT_CHOP = true;

/** Rhythm / force bar is disabled while debug-direct-chop is active. */
export const forceBarEnabled = !DEBUG_DIRECT_CHOP;
