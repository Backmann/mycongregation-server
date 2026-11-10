import { SupportedLanguage } from '../common/i18n/supported-languages';

/**
 * The words of «Договориться о подготовке», in the reader's language.
 *
 * Names are never declined: the app has «Фамилия Имя» in the nominative and
 * nothing else, so every sentence is built to need no case («Белова Анна
 * предлагает…», «Гусева Вера: подходит»).
 */

export interface MomentOf {
  kind: string;
  date: string | null;
  time: string | null;
  meeting: string | null;
}

/** «ср, 25 ноября» */
export function dayWords(dateISO: string, lang: SupportedLanguage): string {
  try {
    const d = new Date(`${dateISO}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat(lang, {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(d);
    const day = new Intl.DateTimeFormat(lang, {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(d);
    return `${weekday.replace(/\.$/, '')}, ${day}`;
  } catch {
    return dateISO;
  }
}

const MOMENT: Record<
  SupportedLanguage,
  {
    afterMidweek: string;
    afterWeekend: string;
    before: string;
    service: string;
    self: string;
  }
> = {
  ru: {
    afterMidweek: 'после встречи в будний день',
    afterWeekend: 'после встречи в выходной день',
    before: 'перед встречей — последняя сверка',
    service: 'на встрече для проповеди',
    self: 'договориться самим',
  },
  en: {
    afterMidweek: 'after the midweek meeting',
    afterWeekend: 'after the weekend meeting',
    before: 'before the meeting — a last check',
    service: 'at the meeting for field service',
    self: 'arrange it yourselves',
  },
  de: {
    afterMidweek: 'nach der Zusammenkunft unter der Woche',
    afterWeekend: 'nach der Zusammenkunft am Wochenende',
    before: 'vor der Zusammenkunft — letzte Absprache',
    service: 'beim Treffen für den Predigtdienst',
    self: 'selbst absprechen',
  },
};

/** «после встречи в выходной день, вс, 22 ноября» */
export function momentWords(m: MomentOf, lang: SupportedLanguage): string {
  const w = MOMENT[lang];
  if (m.kind === 'self' || !m.date) return w.self;
  const day = dayWords(m.date, lang);
  if (m.kind === 'service')
    return `${w.service}, ${day}, ${m.time ?? ''}`.replace(/, $/, '');
  if (m.kind === 'before') return `${w.before}, ${day}`;
  return `${m.meeting === 'weekend' ? w.afterWeekend : w.afterMidweek}, ${day}`;
}

const TEXT: Record<
  SupportedLanguage,
  {
    proposes: (who: string, moment: string) => string;
    proposesSelf: (who: string) => string;
    counter: (who: string, moment: string) => string;
    agreed: (who: string, moment: string) => string;
    declined: (who: string) => string;
    tomorrow: (part: string, moment: string) => string;
    waiting: (who: string, part: string) => string;
    eveningTitle: string;
  }
> = {
  ru: {
    proposes: (who, m) => `${who} предлагает подготовиться вместе: ${m}.`,
    proposesSelf: (who) => `${who} предлагает договориться о подготовке.`,
    counter: (who, m) => `${who} предлагает другое время: ${m}.`,
    agreed: (who, m) => `${who}: подходит — ${m}.`,
    declined: (who) =>
      `${who}: не получится в эти дни. Договоритесь о подготовке лично.`,
    tomorrow: (part, m) => `Завтра — подготовка к «${part}» в паре: ${m}.`,
    waiting: (who, part) =>
      `Ждёт вашего ответа: ${who} предлагает подготовиться к «${part}».`,
    eveningTitle: 'Подготовка в паре',
  },
  en: {
    proposes: (who, m) => `${who} suggests preparing together: ${m}.`,
    proposesSelf: (who) => `${who} suggests arranging your preparation.`,
    counter: (who, m) => `${who} suggests another time: ${m}.`,
    agreed: (who, m) => `${who}: that works — ${m}.`,
    declined: (who) =>
      `${who}: not possible on those days. Arrange your preparation in person.`,
    tomorrow: (part, m) => `Tomorrow — preparing “${part}” together: ${m}.`,
    waiting: (who, part) =>
      `Waiting for your answer: ${who} suggests preparing “${part}”.`,
    eveningTitle: 'Preparing together',
  },
  de: {
    proposes: (who, m) => `${who} schlägt vor, gemeinsam vorzubereiten: ${m}.`,
    proposesSelf: (who) => `${who} möchte die Vorbereitung absprechen.`,
    counter: (who, m) => `${who} schlägt eine andere Zeit vor: ${m}.`,
    agreed: (who, m) => `${who}: passt — ${m}.`,
    declined: (who) =>
      `${who}: an diesen Tagen geht es nicht. Sprechen Sie die Vorbereitung bitte persönlich ab.`,
    tomorrow: (part, m) =>
      `Morgen — gemeinsame Vorbereitung auf „${part}“: ${m}.`,
    waiting: (who, part) =>
      `Wartet auf Ihre Antwort: ${who} schlägt vor, „${part}“ vorzubereiten.`,
    eveningTitle: 'Gemeinsam vorbereiten',
  },
};

export const pairWords = (lang: SupportedLanguage) => TEXT[lang];
