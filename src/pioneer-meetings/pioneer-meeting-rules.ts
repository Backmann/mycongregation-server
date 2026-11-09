import { PioneerType } from '../common/enums/pioneer-type.enum';

/**
 * The plain rules of the annual meeting with the pioneers — no database, so
 * they can be read and tested on their own.
 */

/** Who is invited: the permanent kinds serving in the field (not auxiliary). */
export const INVITED_KINDS: PioneerType[] = [
  PioneerType.REGULAR,
  PioneerType.SPECIAL,
  PioneerType.MISSIONARY,
];

/** The service year a day falls in: September opens the next one. */
export function serviceYearOfDay(day: string): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return m >= 9 ? y + 1 : y;
}

/**
 * The months the instructions name for it — December or January — of the
 * service year `serviceYear` (2027: December 2026 and January 2027).
 */
export function seasonOf(serviceYear: number): { from: string; to: string } {
  return { from: `${serviceYear - 1}-12-01`, to: `${serviceYear}-01-31` };
}

export function inSeason(day: string): boolean {
  const m = Number(day.slice(5, 7));
  return m === 12 || m === 1;
}

export interface SpellOnDay {
  publisherId: string;
  pioneerType: PioneerType | string;
  startMonth: string;
  endMonth: string | null;
}

/**
 * The card ids of those pioneering on `day` — the month decides, as in every
 * other place the spells are read.
 */
export function invitedOn(spells: SpellOnDay[], day: string): string[] {
  const month = day.slice(0, 7);
  const ids = new Set<string>();
  for (const s of spells) {
    if (!INVITED_KINDS.includes(s.pioneerType as PioneerType)) continue;
    if (String(s.startMonth).slice(0, 7) > month) continue;
    if (s.endMonth && String(s.endMonth).slice(0, 7) < month) continue;
    ids.add(s.publisherId);
  }
  return [...ids];
}

/** What is worth saying before the day — none of it forbids anything. */
export type MeetingWarning =
  /** Not in December or January, as the instructions ask. */
  | { kind: 'outsideSeason' }
  /** An assembly, a convention or the circuit overseer's visit that day. */
  | { kind: 'event'; eventType: string; title: string }
  /** One who conducts it is away that day (named: there may be two). */
  | { kind: 'conductorAway'; name?: string };

/** HH:mm, or nothing. */
export const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The four columns of the two conductor places (entity, 9 November 2026). */
export interface ConductorColumns {
  conductorPublisherId: string | null;
  conductorName: string | null;
  secondConductorPublisherId: string | null;
  secondConductorName: string | null;
}

/** One conductor: a card, or a name written by hand. */
export interface ConductorPlace {
  publisherId: string | null;
  name: string | null;
}

/** Who conducts it, in order: one or two places, never an empty one. */
export function conductorsOf(m: ConductorColumns): ConductorPlace[] {
  return [
    { publisherId: m.conductorPublisherId, name: m.conductorName },
    { publisherId: m.secondConductorPublisherId, name: m.secondConductorName },
  ]
    .map((c) => ({
      publisherId: c.publisherId || null,
      name: c.publisherId ? null : c.name?.trim() || null,
    }))
    .filter((c) => c.publisherId || c.name);
}

/** The cards of those who conduct it — they are invited by conducting. */
export function conductorIdsOf(m: ConductorColumns): string[] {
  return conductorsOf(m)
    .map((c) => c.publisherId)
    .filter((x): x is string => !!x);
}

/** A name written by hand, tidied: one space between words. */
export function tidyName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s+/g, ' ').trim();
}

/** The same person twice — by card, or by the same written name. */
export function repeats(places: ConductorPlace[]): boolean {
  const keys = places.map((c) =>
    c.publisherId
      ? `id:${c.publisherId}`
      : `name:${tidyName(c.name).toLowerCase()}`,
  );
  return new Set(keys).size !== keys.length;
}

/**
 * The season a meeting belongs to — the service year of its December and
 * January — or null for a day outside them. Once a season (Lionel, 9
 * November 2026: «встреча проходит один раз с декабря по январь»).
 */
export function seasonYearOf(day: string): number | null {
  return inSeason(day) ? serviceYearOfDay(day) : null;
}
