import type { SupportedLanguage } from '../common/i18n/supported-languages';

/**
 * WHAT A PERSON IS TOLD ABOUT A CIRCUIT OVERSEER'S VISIT (18 November 2026).
 *
 * Lionel's choice «C»: the planner publishes the week once; from then on it
 * speaks for itself — a person hears «вам назначено» at the publishing,
 * «изменено» ten minutes after the last edit of something of his, and «вы
 * больше не назначены» when it is taken from him. The evening reminders a
 * week before and the evening before are the digest's (assignment-reminders).
 *
 * Pure: items in, lines out; lines told and lines now in, a message out.
 * The service fetches, sends and remembers.
 */

/** One thing that is a person's at a visit, as he is told it. */
export interface CoNoticeLine {
  /** The item's id: what «the same thing, changed» means. */
  id: string;
  kind: string;
  /** With the overseer, with his wife, or — for a lunch or a call — none. */
  side: 'co' | 'wife' | null;
  withWife: boolean;
  date: string;
  time: string | null;
  place: string | null;
  /** Kept only where it names the slot (the kind of ministry, a call's family). */
  note: string | null;
}

export interface CoNoticeItem {
  id: string;
  kind: string;
  forWife: boolean;
  withWife: boolean;
  itemDate: string;
  startTime: string | null;
  placeKind: string | null;
  placeText: string | null;
  cartLocationName?: string | null;
  assigneePublisherId: string | null;
  note: string | null;
}

/** The Kingdom Hall with no address on the item: worded in each language. */
export const HALL = '§hall';

/** Where, in a few words: the stand's name, the address, or the hall. */
function placeOf(it: CoNoticeItem): string | null {
  if (it.placeKind === 'cart_location')
    return it.cartLocationName?.trim() || null;
  if (it.placeKind === 'custom') return it.placeText?.trim() || null;
  if (it.placeKind === 'kingdom_hall') return it.placeText?.trim() || HALL;
  return null;
}

/**
 * Each person's lines. Only people named by their card are told: a name
 * typed as text has no account to reach. Document reviews and the old empty
 * copies of the wife's lunches are nobody's.
 */
export function linesByPerson(
  items: CoNoticeItem[],
): Map<string, CoNoticeLine[]> {
  const out = new Map<string, CoNoticeLine[]>();
  for (const it of items) {
    if (!it.assigneePublisherId) continue;
    if (it.kind === 'document_review') continue;
    if (it.forWife && it.kind !== 'field_service') continue;
    const line: CoNoticeLine = {
      id: it.id,
      kind: it.kind,
      side: it.kind === 'field_service' ? (it.forWife ? 'wife' : 'co') : null,
      withWife: it.withWife,
      date: it.itemDate,
      time: it.startTime ? it.startTime.slice(0, 5) : null,
      place:
        it.kind === 'field_service' ||
        it.kind === 'pioneers' ||
        it.kind === 'elders'
          ? placeOf(it)
          : null,
      note:
        it.kind === 'field_service' || it.kind === 'pastoral'
          ? it.note?.trim() || null
          : null,
    };
    out.set(it.assigneePublisherId, [
      ...(out.get(it.assigneePublisherId) ?? []),
      line,
    ]);
  }
  for (const lines of out.values())
    lines.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time ?? '99').localeCompare(b.time ?? '99'),
    );
  return out;
}

export interface CoNoticeDiff {
  added: CoNoticeLine[];
  changed: { before: CoNoticeLine; after: CoNoticeLine }[];
  removed: CoNoticeLine[];
}

const SAME = (a: CoNoticeLine, b: CoNoticeLine) =>
  a.kind === b.kind &&
  a.side === b.side &&
  a.withWife === b.withWife &&
  a.date === b.date &&
  a.time === b.time &&
  a.place === b.place &&
  a.note === b.note;

/** What is new, what changed and what was taken away since he was told. */
export function diffLines(
  told: CoNoticeLine[],
  now: CoNoticeLine[],
): CoNoticeDiff {
  const before = new Map(told.map((l) => [l.id, l]));
  const after = new Map(now.map((l) => [l.id, l]));
  return {
    added: now.filter((l) => !before.has(l.id)),
    changed: now
      .filter((l) => before.has(l.id) && !SAME(before.get(l.id)!, l))
      .map((l) => ({ before: before.get(l.id)!, after: l })),
    removed: told.filter((l) => !after.has(l.id)),
  };
}

export const isEmptyDiff = (d: CoNoticeDiff) =>
  d.added.length + d.changed.length + d.removed.length === 0;

/** Who is visiting, as the words need him. */
export interface CoVisitor {
  /** «Пётр Иванов», or empty when the planner never filled the name in. */
  name: string;
  /** The wife's first name, or empty. */
  wife: string;
}

const WEEKDAYS: Record<SupportedLanguage, string[]> = {
  ru: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
};

/** «ср 24», «Wed 24», «Mi 24». */
export function dayOf(iso: string, lang: SupportedLanguage): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[lang][d.getUTCDay()]} ${d.getUTCDate()}`;
}

interface Words {
  titleNew: string;
  titleChanged: string;
  titleRemoved: string;
  titleMixed: string;
  serviceCo: (name: string) => string;
  serviceWife: (wife: string) => string;
  serviceTogether: (name: string) => string;
  lunch: (withWife: boolean) => string;
  lunchBox: string;
  pastoral: string;
  pioneers: string;
  elders: string;
  other: string;
  removed: string;
  was: (what: string) => string;
  newPrefix: string;
  hall: string;
}

const WORDS: Record<SupportedLanguage, Words> = {
  ru: {
    titleNew: 'Вам назначено — визит районного старейшины',
    titleChanged: 'Изменено — визит районного старейшины',
    titleRemoved: 'Вы больше не назначены — визит районного старейшины',
    titleMixed: 'Визит районного старейшины: изменения',
    serviceCo: (n) =>
      n
        ? `служение с районным старейшиной (${n})`
        : 'служение с районным старейшиной',
    serviceWife: (w) =>
      w
        ? `служение с женой районного старейшины (${w})`
        : 'служение с женой районного старейшины',
    serviceTogether: (n) =>
      n
        ? `служение с районным старейшиной (${n}) и его женой`
        : 'служение с районным старейшиной и его женой',
    lunch: (ww) =>
      ww
        ? 'обед у вас: районный старейшина с женой'
        : 'обед у вас для районного старейшины',
    lunchBox: 'ланч-бокс для районного старейшины',
    pastoral: 'пастырский визит с районным старейшиной',
    pioneers: 'встреча районного старейшины с пионерами',
    elders: 'встреча районного старейшины со старейшинами и помощниками',
    other: 'визит районного старейшины',
    removed: 'вы больше не назначены',
    was: (w) => `было: ${w}`,
    newPrefix: 'Новое: ',
    hall: 'Зал Царства',
  },
  en: {
    titleNew: "You have been assigned — circuit overseer's visit",
    titleChanged: "Changed — circuit overseer's visit",
    titleRemoved: "You are no longer assigned — circuit overseer's visit",
    titleMixed: "Circuit overseer's visit: changes",
    serviceCo: (n) =>
      n
        ? `field service with the circuit overseer ${n}`
        : 'field service with the circuit overseer',
    serviceWife: (w) =>
      w
        ? `field service with the circuit overseer's wife ${w}`
        : "field service with the circuit overseer's wife",
    serviceTogether: (n) =>
      n
        ? `field service with the circuit overseer ${n} and his wife`
        : 'field service with the circuit overseer and his wife',
    lunch: (ww) =>
      ww
        ? 'lunch at your home: the circuit overseer and his wife'
        : 'lunch at your home for the circuit overseer',
    lunchBox: 'lunch box for the circuit overseer',
    pastoral: 'shepherding call with the circuit overseer',
    pioneers: "the circuit overseer's meeting with the pioneers",
    elders:
      "the circuit overseer's meeting with the elders and ministerial servants",
    other: "circuit overseer's visit",
    removed: 'you are no longer assigned',
    was: (w) => `was: ${w}`,
    newPrefix: 'New: ',
    hall: 'Kingdom Hall',
  },
  de: {
    titleNew: 'Ihnen wurde zugeteilt — Besuch des Kreisaufsehers',
    titleChanged: 'Geändert — Besuch des Kreisaufsehers',
    titleRemoved: 'Nicht mehr zugeteilt — Besuch des Kreisaufsehers',
    titleMixed: 'Besuch des Kreisaufsehers: Änderungen',
    serviceCo: (n) =>
      n
        ? `Predigtdienst mit dem Kreisaufseher ${n}`
        : 'Predigtdienst mit dem Kreisaufseher',
    serviceWife: (w) =>
      w
        ? `Predigtdienst mit der Frau des Kreisaufsehers, ${w}`
        : 'Predigtdienst mit der Frau des Kreisaufsehers',
    serviceTogether: (n) =>
      n
        ? `Predigtdienst mit dem Kreisaufseher ${n} und seiner Frau`
        : 'Predigtdienst mit dem Kreisaufseher und seiner Frau',
    lunch: (ww) =>
      ww
        ? 'Mittagessen bei Ihnen: der Kreisaufseher mit seiner Frau'
        : 'Mittagessen bei Ihnen für den Kreisaufseher',
    lunchBox: 'Lunchbox für den Kreisaufseher',
    pastoral: 'Hirtenbesuch mit dem Kreisaufseher',
    pioneers: 'Zusammenkunft des Kreisaufsehers mit den Pionieren',
    elders:
      'Zusammenkunft des Kreisaufsehers mit den Ältesten und Dienstamtgehilfen',
    other: 'Besuch des Kreisaufsehers',
    removed: 'Sie sind nicht mehr zugeteilt',
    was: (w) => `vorher: ${w}`,
    newPrefix: 'Neu: ',
    hall: 'Königreichssaal',
  },
};

/** What a line is, in words: «служение с районным старейшиной Пётр Иванов». */
export function whatOf(
  l: Pick<CoNoticeLine, 'kind' | 'side' | 'withWife'>,
  v: CoVisitor,
  lang: SupportedLanguage,
): string {
  const w = WORDS[lang];
  switch (l.kind) {
    case 'field_service':
      if (l.side === 'wife') return w.serviceWife(v.wife);
      return l.withWife ? w.serviceTogether(v.name) : w.serviceCo(v.name);
    case 'lunch':
      return w.lunch(!!v.wife);
    case 'lunch_box':
      return w.lunchBox;
    case 'pastoral':
      return w.pastoral;
    case 'pioneers':
      return w.pioneers;
    case 'elders':
      return w.elders;
    default:
      return w.other;
  }
}

/** «ср 24 · 10:00» */
const whenOf = (l: CoNoticeLine, lang: SupportedLanguage) =>
  `${dayOf(l.date, lang)}${l.time ? ` · ${l.time}` : ''}`;

/** «ср 24 · 10:00 — служение с районным старейшиной, Зал Царства · по домам» */
/** «Зал Царства» in the reader's language. */
export const hallWord = (lang: SupportedLanguage) => WORDS[lang].hall;

const placeText = (p: string | null, lang: SupportedLanguage) =>
  p === HALL ? WORDS[lang].hall : p;

function lineText(l: CoNoticeLine, v: CoVisitor, lang: SupportedLanguage) {
  const where = [placeText(l.place, lang), l.note].filter(Boolean).join(' · ');
  return `${whenOf(l, lang)} — ${whatOf(l, v, lang)}${where ? `, ${where}` : ''}`;
}

/** The message for one person: null when nothing of his changed. */
export function messageOf(
  diff: CoNoticeDiff,
  v: CoVisitor,
  lang: SupportedLanguage,
): { title: string; body: string } | null {
  if (isEmptyDiff(diff)) return null;
  const w = WORDS[lang];
  const onlyNew = diff.changed.length === 0 && diff.removed.length === 0;
  const onlyChanged = diff.added.length === 0 && diff.removed.length === 0;
  const onlyRemoved = diff.added.length === 0 && diff.changed.length === 0;
  const title = onlyNew
    ? w.titleNew
    : onlyChanged
      ? w.titleChanged
      : onlyRemoved
        ? w.titleRemoved
        : w.titleMixed;
  type Row = { at: string; text: string };
  const rows: Row[] = [
    ...diff.added.map((l) => ({
      at: `${l.date}${l.time ?? ''}`,
      text: `${onlyNew ? '' : w.newPrefix}${lineText(l, v, lang)}`,
    })),
    ...diff.changed.map(({ before, after }) => {
      const was: string[] = [];
      if (before.date !== after.date || before.time !== after.time)
        was.push(whenOf(before, lang));
      if (before.place !== after.place && before.place)
        was.push(placeText(before.place, lang)!);
      return {
        at: `${after.date}${after.time ?? ''}`,
        text: `${lineText(after, v, lang)}${was.length ? ` (${w.was(was.join(', '))})` : ''}`,
      };
    }),
    ...diff.removed.map((l) => ({
      at: `${l.date}${l.time ?? ''}`,
      text: `${whenOf(l, lang)} — ${whatOf(l, v, lang)}: ${w.removed}`,
    })),
  ];
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return { title, body: rows.map((r) => r.text).join('\n') };
}

/** A short fingerprint of what is said, for the gateway's «said once» key. */
export function fingerprint(lines: CoNoticeLine[]): string {
  const s = JSON.stringify(
    lines.map((l) => [
      l.id,
      l.kind,
      l.side,
      l.withWife,
      l.date,
      l.time,
      l.place,
      l.note,
    ]),
  );
  let h = 5381;
  for (let i = 0; i < s.length; i += 1)
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
