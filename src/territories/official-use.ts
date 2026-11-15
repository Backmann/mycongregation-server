/**
 * What the cadastre's word for a building means for us (14 November 2026):
 * a home, not a home, or unsure. The congregation calls on homes only —
 * never shops, workshops, schools or barns — but a home missed is a family
 * missed, while a shed visited costs a minute: whatever is not plainly
 * one or the other is «unsure», and unsure counts as a home.
 *
 * The words are ALKIS NW's «Gebäudefunktion» (map_houses.official, filled by
 * scripts/map-official.mjs). Null: the cadastre does not know the building.
 */
export type OfficialUse = 'home' | 'not' | 'unsure';

/** Homes: «Wohngebäude», «Gemischt genutztes Gebäude mit Wohnen», «Wohn- und Geschäftsgebäude», a farmhouse … */
const HOME = /wohn|bauernhaus|forsthaus/i;

/**
 * People may live there, or the cadastre does not say: care homes, holiday
 * houses, «Sonstiges» …
 */
const UNSURE =
  /sonstig|nicht zu spezifizieren|soziale zwecke|heim|pflege|heilanstalt|kloster|erholungszwecke|ferienhaus|wochenend|hotel|pension|gasthaus|beherbergung/i;

export function officialUse(fn: string | null | undefined): OfficialUse | null {
  const f = fn?.trim();
  if (!f) return null;
  if (HOME.test(f)) return 'home';
  if (UNSURE.test(f)) return 'unsure';
  return 'not';
}

export interface RuleHouse {
  osmId: string;
  official: string | null;
  officialId: string | null;
  numbers: string | null;
  areaM2: number;
  /** What the rule without the cadastre says (mark_homes today). */
  home: boolean;
}

/**
 * Homes by the cadastre (proposed, 15 November 2026): «not a home» is not
 * one; a home or unsure is one — but a building the map draws in several
 * pieces is not several homes. Every piece with a house number of its own
 * is a home (a semi-detached house is often one building in the cadastre,
 * two front doors on the map); pieces without a number are one with the
 * rest — only when no piece has a number, the biggest of them is the home.
 * A house the cadastre does not know keeps the rule without it.
 */
export function homesByCadastre(houses: RuleHouse[]): Map<string, boolean> {
  const numbersOf = (h: RuleHouse) =>
    (h.numbers ?? '')
      .split(';')
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
  // Per cadastre building: its pieces, best first (numbered, bigger, id).
  const groups = new Map<string, RuleHouse[]>();
  for (const h of houses) {
    if (!h.officialId || officialUse(h.official) === null) continue;
    const g = groups.get(h.officialId) ?? [];
    g.push(h);
    groups.set(h.officialId, g);
  }
  const home = new Set<RuleHouse>();
  for (const g of groups.values()) {
    g.sort(
      (a, b) =>
        numbersOf(b).length - numbersOf(a).length ||
        b.areaM2 - a.areaM2 ||
        (a.osmId < b.osmId ? -1 : 1),
    );
    const seen = new Set<string>();
    for (const h of g) {
      const ns = numbersOf(h);
      // A number of its own, not yet counted in this building: a home.
      if (ns.length && ns.some((n) => !seen.has(n))) {
        home.add(h);
        ns.forEach((n) => seen.add(n));
      }
    }
    if (!g.some((h) => home.has(h))) home.add(g[0]);
  }
  const out = new Map<string, boolean>();
  for (const h of houses) {
    const use = officialUse(h.official);
    if (use === null) out.set(h.osmId, h.home);
    else if (use === 'not') out.set(h.osmId, false);
    else out.set(h.osmId, !h.officialId || home.has(h));
  }
  return out;
}
