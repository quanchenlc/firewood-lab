/**
 * Resolve a public asset path against Vite `base` (e.g. `/firewood-lab/` on Pages).
 * Accepts paths like `/assets/...` or `assets/...`.
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const cleaned = path.replace(/^\/+/, '');
  return `${base}${cleaned}`;
}
