import { MEETING_NAMES, PART_NAMES } from '../common/i18n/push-strings';
import { SupportedLanguage } from '../common/i18n/supported-languages';

/**
 * THE EVENING DIGEST: what a person is told about their own assignments.
 *
 * Decided 1–2 October 2026, after an audit found that an assignment was
 * announced once — when the programme was published or changed — and never
 * again, and that on the weekend meeting it was usually not announced at all
 * because the change had been applied «тихо».
 *
 *   - A part is recalled 21, 14, 7, 3 and 1 day before, around 18:00.
 *     Lionel's own ladder: the nearer the meeting, the oftener.
 *   - A duty (microphones, attendants, sound) is recalled 7 and 1 day before:
 *     nobody prepares three weeks to carry a microphone.
 *   - A person may choose the short ladder (7 and 1) for parts as well. The
 *     evening before cannot be switched off here.
 *   - ONE message an evening, whatever falls due: three parts and a duty are
 *     one digest, not four notifications.
 *   - A step already passed is not caught up. Somebody assigned ten days
 *     ahead hears at seven.
 *   - THE FIRST WORD ABOUT AN ITEM SAYS «ВАМ НАЗНАЧЕНО». «Применить тихо»
 *     means silent NOW, not silent for ever: the person learns from the next
 *     step, and it must not read as a reminder of something they never heard.
 *   - An item that was announced and is no longer theirs is said too —
 *     otherwise a brother prepares a part that was given to somebody else.
 *
 * Everything here is pure: dates in, lines out. What was already said is a
 * list of marks the caller keeps.
 */

export type Ladder = 'full' | 'short';
export type ItemType = 'part' | 'duty';
export type MeetingKindOf = 'midweek' | 'weekend';

export const PART_STEPS: Record<Ladder, readonly number[]> = {
  full: [21, 14, 7, 3, 1],
  short: [7, 1],
};
export const DUTY_STEPS: readonly number[] = [7, 1];

export function stepsFor(type: ItemType, ladder: Ladder): readonly number[] {
  return type === 'duty' ? DUTY_STEPS : PART_STEPS[ladder];
}

/** Something a person holds at a meeting. */
export interface ReminderItem {
  type: ItemType;
  /** The assignment's or the duty's own id. */
  id: string;
  /** The meeting's calendar day, visit shifts included. */
  date: string;
  kind: MeetingKindOf;
  /** How to name it WITHOUT a language: resolved by labelOf. */
  labelKey: string;
  labelTitle: string | null;
  /** The person is the assistant on this part, not its main assignee. */
  assistant: boolean;
  /** Microphone number and the like, 1-based; null when there is one. */
  slot: number | null;
}

/** What the person has already been told about. */
export interface ReminderMark {
  type: ItemType;
  id: string;
  date: string;
  kind: MeetingKindOf;
  labelKey: string;
  labelTitle: string | null;
  assistant: boolean;
  slot: number | null;
}

export interface DigestLine {
  tone: 'new' | 'reminder' | 'cancelled';
  item: ReminderItem | ReminderMark;
  daysLeft: number;
}

export interface DigestPlan {
  lines: DigestLine[];
  /** Items to record as told (new ones, and reminded ones whose day moved). */
  mark: ReminderItem[];
  /** Marks to drop: said to be cancelled, or simply past. */
  forget: ReminderMark[];
}

const DAY = 24 * 60 * 60 * 1000;

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round(
    (Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) /
      DAY,
  );
}

const keyOf = (x: { type: ItemType; id: string }) => `${x.type}:${x.id}`;

/**
 * What to say to one person this evening.
 *
 * `items` is everything they hold from today on; `marks` is everything they
 * were told. The two together are enough — no clock, no database.
 */
export function planDigest(input: {
  today: string;
  ladder: Ladder;
  items: ReminderItem[];
  marks: ReminderMark[];
}): DigestPlan {
  const { today, ladder } = input;
  const markByKey = new Map(input.marks.map((m) => [keyOf(m), m]));
  const held = new Set(input.items.map(keyOf));

  const lines: DigestLine[] = [];
  const mark: ReminderItem[] = [];
  const forget: ReminderMark[] = [];

  for (const item of input.items) {
    const daysLeft = daysBetween(today, item.date);
    const told = markByKey.get(keyOf(item));
    // The meeting moved (a visit week, an event): keep the mark on the day
    // the item is on now, or a later «cancelled» would name the wrong day.
    if (told && told.date !== item.date) mark.push(item);
    if (daysLeft < 1) continue;
    if (!stepsFor(item.type, ladder).includes(daysLeft)) continue;
    lines.push({ tone: told ? 'reminder' : 'new', item, daysLeft });
    if (!told) mark.push(item);
  }

  for (const m of input.marks) {
    if (held.has(keyOf(m))) continue;
    forget.push(m);
    const daysLeft = daysBetween(today, m.date);
    // Taken away before the day: say so. A mark whose day has passed is just
    // history and goes without a word.
    if (daysLeft >= 1) lines.push({ tone: 'cancelled', item: m, daysLeft });
  }

  lines.sort(
    (a, b) =>
      a.item.date.localeCompare(b.item.date) ||
      Number(a.tone === 'cancelled') - Number(b.tone === 'cancelled'),
  );
  return { lines, mark, forget };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const DUTY_NAMES: Record<SupportedLanguage, Record<string, string>> = {
  ru: {
    security: 'Распорядитель у входа',
    attendant: 'Распорядитель в зале',
    microphone: 'Микрофон',
    av: 'Аудио/Видео',
    zoom: 'Видеосвязь (Zoom)',
    stage: 'Сцена',
    ventilation: 'Проветривание',
    custom: 'Обязанность',
  },
  en: {
    security: 'Entrance attendant',
    attendant: 'Hall attendant',
    microphone: 'Microphone',
    av: 'Audio/Video',
    zoom: 'Video conferencing (Zoom)',
    stage: 'Stage',
    ventilation: 'Ventilation',
    custom: 'Duty',
  },
  de: {
    security: 'Ordner am Eingang',
    attendant: 'Ordner im Saal',
    microphone: 'Mikrofon',
    av: 'Audio/Video',
    zoom: 'Videokonferenz (Zoom)',
    stage: 'Bühne',
    ventilation: 'Lüftung',
    custom: 'Aufgabe',
  },
};

/**
 * Parts named by what the person DOES, not by the title they carry.
 *
 * A prayer's title is the song beside it; the Watchtower conductor's is the
 * article, the speaker's is the theme of the talk. «Вам назначено: Доверяйте
 * Иегове» tells a brother nothing about what he was asked to do; «Изучение
 * «Сторожевой башни» — ведущий» does. The student parts are the other way
 * round: their title IS the name («Начинайте разговор»), and the table has
 * only «Совершенствуй своё служение 2».
 */
const ROLE_NAMED = new Set<string>([
  'midweek_chairman',
  'midweek_opening_prayer',
  'midweek_closing_prayer',
  'treasures_talk',
  'spiritual_gems',
  'bible_reading',
  'cbs_conductor',
  'cbs_reader',
  'weekend_chairman',
  'weekend_opening_prayer',
  'weekend_closing_prayer',
  'public_talk_speaker',
  'watchtower_conductor',
  'watchtower_reader',
  'co_service_talk',
  'co_concluding_talk',
]);

interface Words {
  assigned: string;
  tomorrow: string;
  upcoming: string;
  cancelledTitle: string;
  newPrefix: string;
  cancelledPrefix: string;
  cancelledTail: string;
  assistant: string;
  part: string;
  when: (days: number) => string;
}

const WORDS: Record<SupportedLanguage, Words> = {
  ru: {
    assigned: 'Вам назначено',
    tomorrow: 'Завтра у вас',
    upcoming: 'Ваши ближайшие задания',
    cancelledTitle: 'Назначение отменено',
    newPrefix: 'Новое: ',
    cancelledPrefix: 'Отменено: ',
    cancelledTail: 'готовиться не нужно',
    assistant: 'помощник',
    part: 'часть программы',
    when: (d) =>
      d === 1
        ? 'завтра'
        : d === 7
          ? 'через неделю'
          : d === 14
            ? 'через 2 недели'
            : d === 21
              ? 'через 3 недели'
              : `через ${d} ${d >= 2 && d <= 4 ? 'дня' : 'дней'}`,
  },
  en: {
    assigned: 'You have been assigned',
    tomorrow: 'Tomorrow you have',
    upcoming: 'Your coming assignments',
    cancelledTitle: 'Assignment cancelled',
    newPrefix: 'New: ',
    cancelledPrefix: 'Cancelled: ',
    cancelledTail: 'no need to prepare',
    assistant: 'assistant',
    part: 'a part',
    when: (d) =>
      d === 1
        ? 'tomorrow'
        : d === 7
          ? 'in a week'
          : d === 14
            ? 'in 2 weeks'
            : d === 21
              ? 'in 3 weeks'
              : `in ${d} days`,
  },
  de: {
    assigned: 'Dir wurde zugeteilt',
    tomorrow: 'Morgen hast du',
    upcoming: 'Deine nächsten Aufgaben',
    cancelledTitle: 'Aufgabe entfällt',
    newPrefix: 'Neu: ',
    cancelledPrefix: 'Entfällt: ',
    cancelledTail: 'keine Vorbereitung nötig',
    assistant: 'Partner',
    part: 'ein Programmpunkt',
    when: (d) =>
      d === 1
        ? 'morgen'
        : d === 7
          ? 'in einer Woche'
          : d === 14
            ? 'in 2 Wochen'
            : d === 21
              ? 'in 3 Wochen'
              : `in ${d} Tagen`,
  },
};

/** «Чт 22 октября» — the weekday carries half the meaning of a date. */
export function shortDay(dateISO: string, lang: SupportedLanguage): string {
  try {
    const d = new Date(`${dateISO}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat(lang, {
      weekday: 'short',
      timeZone: 'UTC',
    })
      .format(d)
      .replace(/\.$/, '');
    const day = new Intl.DateTimeFormat(lang, {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(d);
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}`;
  } catch {
    return dateISO;
  }
}

/** The name of a part or a duty, in the reader's language. */
export function labelOf(
  x: Pick<
    ReminderItem,
    'type' | 'labelKey' | 'labelTitle' | 'assistant' | 'slot'
  >,
  lang: SupportedLanguage,
): string {
  const w = WORDS[lang];
  const title = x.labelTitle?.trim();
  let name: string;
  if (x.type === 'duty') {
    name = title || DUTY_NAMES[lang][x.labelKey] || DUTY_NAMES[lang].custom;
    if (x.slot) name = `${name} ${x.slot}`;
  } else {
    const role = PART_NAMES[lang][x.labelKey];
    // The imported title is «<name of the part>: <first note, up to 120
    // characters>». On a locked screen only the name belongs.
    const head = title ? title.split(': ')[0].trim() : '';
    // A part with neither a title nor a known key is still a part: saying so
    // is better than printing `bible_reading` at somebody.
    name = (ROLE_NAMED.has(x.labelKey) ? role : head) || role || head || w.part;
  }
  return x.assistant ? `${name} (${w.assistant})` : name;
}

export interface DigestText {
  title: string;
  body: string;
}

/**
 * The digest as a person reads it. Null when there is nothing to say.
 *
 * The heading says what KIND of evening this is, because that is all a locked
 * screen shows: an assignment heard for the first time, tomorrow's meeting, a
 * cancellation, or simply what is coming.
 */
export function writeDigest(
  lines: DigestLine[],
  lang: SupportedLanguage,
): DigestText | null {
  if (lines.length === 0) return null;
  const w = WORDS[lang];
  const live = lines.filter((l) => l.tone !== 'cancelled');
  const allNew = live.length > 0 && lines.every((l) => l.tone === 'new');
  const allCancelled = live.length === 0;
  const allTomorrow =
    live.length > 0 &&
    lines.every((l) => l.tone !== 'cancelled' && l.daysLeft === 1);

  const title = allCancelled
    ? w.cancelledTitle
    : allNew
      ? w.assigned
      : allTomorrow
        ? w.tomorrow
        : w.upcoming;

  const body = lines
    .map((l) => {
      const day = shortDay(l.item.date, lang);
      const name = labelOf(l.item, lang);
      if (l.tone === 'cancelled') {
        const lead = allCancelled ? '' : w.cancelledPrefix;
        return `${lead}${day}: ${name} — ${w.cancelledTail}`;
      }
      const meeting = MEETING_NAMES[l.item.kind][lang];
      // In a mixed digest the first word about an item is marked as such; in
      // one that is all news the heading already says it.
      const lead = l.tone === 'new' && !allNew ? w.newPrefix : '';
      // «Завтра у вас» has said when; any other heading has not.
      const when = title === w.tomorrow ? '' : ` (${w.when(l.daysLeft)})`;
      return `${lead}${day}, ${meeting}: ${name}${when}`;
    })
    .join('\n');

  return { title, body };
}
