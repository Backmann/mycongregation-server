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
