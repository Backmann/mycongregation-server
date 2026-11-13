/**
 * The order to walk a business territory's list in (13 November 2026): from
 * the place farthest from the middle, always on to the nearest one not yet
 * reached — a path along the streets rather than a jump across the map.
 * Places without a point (added by hand without one) come last, by name.
 * Pure, so the numbers a holder sees can be checked.
 */
export interface Placed {
  id: string;
  name: string;
  lon: number | null;
  lat: number | null;
}

export function walkOrder<T extends Placed>(items: T[]): T[] {
  const located = items.filter((i) => i.lon !== null && i.lat !== null);
  const rest = items
    .filter((i) => i.lon === null || i.lat === null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (located.length === 0) return rest;
  const kx = Math.cos(((located[0].lat as number) * Math.PI) / 180);
  const d = (a: T, b: { lon: number; lat: number }) =>
    Math.hypot(((a.lon as number) - b.lon) * kx, (a.lat as number) - b.lat);
  const mid = {
    lon: located.reduce((s, i) => s + (i.lon as number), 0) / located.length,
    lat: located.reduce((s, i) => s + (i.lat as number), 0) / located.length,
  };
  // The start: farthest from the middle; ties by id, so the order is stable.
  const left = [...located].sort((a, b) => a.id.localeCompare(b.id));
  let at = left.reduce((best, i) => (d(i, mid) > d(best, mid) ? i : best));
  const out: T[] = [];
  while (left.length) {
    left.splice(left.indexOf(at), 1);
    out.push(at);
    if (!left.length) break;
    const here = { lon: at.lon as number, lat: at.lat as number };
    at = left.reduce((best, i) => (d(i, here) < d(best, here) ? i : best));
  }
  return [...out, ...rest];
}
