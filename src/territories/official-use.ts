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
 * pieces is one home: the piece with a house number, else the biggest.
 * A house the cadastre does not know keeps the rule without it.
 */
export function homesByCadastre(houses: RuleHouse[]): Map<string, boolean> {
  const lead = new Map<string, RuleHouse>();
  const better = (a: RuleHouse, b: RuleHouse) => {
    const na = !!a.numbers?.trim();
    const nb = !!b.numbers?.trim();
    if (na !== nb) return na;
    if (a.areaM2 !== b.areaM2) return a.areaM2 > b.areaM2;
    return a.osmId < b.osmId;
  };
  for (const h of houses) {
    if (!h.officialId || officialUse(h.official) === null) continue;
    const l = lead.get(h.officialId);
    if (!l || better(h, l)) lead.set(h.officialId, h);
  }
  const out = new Map<string, boolean>();
  for (const h of houses) {
    const use = officialUse(h.official);
    if (use === null) out.set(h.osmId, h.home);
    else if (use === 'not') out.set(h.osmId, false);
    else out.set(h.osmId, !h.officialId || lead.get(h.officialId) === h);
  }
  return out;
}
