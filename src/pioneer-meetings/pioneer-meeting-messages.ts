import { SupportedLanguage } from '../common/i18n/supported-languages';

/**
 * What the pioneers and those who conduct it are told — pure, in each
 * language, so every wording is read and tested in one place.
 */
export type MeetingNews =
  | 'created'
  | 'changed'
  | 'cancelled'
  | 'tomorrow'
  /** A week ahead, to the conducting elder alone: time to prepare. */
  | 'reminderWeek'
  /** A conductor was added or changed: the new one hears he conducts it. */
  | 'conductorNew'
  /** …and the one before hears he does not. */
  | 'conductorFreed';

export interface MeetingFacts {
  date: string;
  timeStart: string | null;
  timeEnd: string | null;
  place: string | null;
  /** Who conducts it, one or two, as the app writes people. */
  conductorNames: string[];
  /** For a conductor: the other one, if there is one. */
  partnerName?: string | null;
}

const LOCALE: Record<SupportedLanguage, string> = {
  ru: 'ru-RU',
  de: 'de-DE',
  en: 'en-GB',
};

function when(f: MeetingFacts, lang: SupportedLanguage): string {
  const day = new Intl.DateTimeFormat(LOCALE[lang], {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${f.date}T12:00:00Z`));
  const time = f.timeStart
    ? f.timeEnd
      ? `${f.timeStart}–${f.timeEnd}`
      : f.timeStart
    : null;
  return [day, time, f.place].filter(Boolean).join(' · ');
}

const T: Record<
  SupportedLanguage,
  {
    title: string;
    conductTitle: string;
    by: (names: string[]) => string;
    partner: (n: string) => string;
    created: string;
    conductCreated: string;
    changed: string;
    cancelled: string;
    tomorrow: string;
    week: string;
    freed: string;
  }
> = {
  ru: {
    title: 'Ежегодная встреча старейшин с пионерами',
    conductTitle: 'Вы проводите встречу с пионерами',
    by: (n) =>
      n.length > 1
        ? `Проводят ${n.slice(0, -1).join(', ')} и ${n[n.length - 1]}.`
        : `Проводит ${n[0]}.`,
    partner: (n) => `Второй проводящий — ${n}.`,
    created: 'Вы приглашены.',
    conductCreated: 'По плану S-211. Список приглашённых — в приложении.',
    changed: 'Встреча перенесена.',
    cancelled: 'Встреча отменена.',
    tomorrow: 'Завтра.',
    week: 'Через неделю — время подготовиться по плану S-211.',
    freed: 'Вы больше не проводите эту встречу.',
  },
  de: {
    title: 'Jährliches Treffen der Ältesten mit den Pionieren',
    conductTitle: 'Sie leiten das Treffen mit den Pionieren',
    by: (n) =>
      n.length > 1
        ? `Leitung: ${n.slice(0, -1).join(', ')} und ${n[n.length - 1]}.`
        : `Leitung: ${n[0]}.`,
    partner: (n) => `Gemeinsam mit ${n}.`,
    created: 'Sie sind eingeladen.',
    conductCreated:
      'Nach der Gliederung S-211. Die Eingeladenen stehen in der App.',
    changed: 'Das Treffen wurde verlegt.',
    cancelled: 'Das Treffen fällt aus.',
    tomorrow: 'Morgen.',
    week: 'In einer Woche — Zeit, sich nach S-211 vorzubereiten.',
    freed: 'Sie leiten dieses Treffen nicht mehr.',
  },
  en: {
    title: 'Annual meeting of the elders with the pioneers',
    conductTitle: 'You conduct the meeting with the pioneers',
    by: (n) =>
      n.length > 1
        ? `Conducted by ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}.`
        : `Conducted by ${n[0]}.`,
    partner: (n) => `Together with ${n}.`,
    created: 'You are invited.',
    conductCreated: 'On the outline S-211. Who is invited is in the app.',
    changed: 'The meeting has been moved.',
    cancelled: 'The meeting is canceled.',
    tomorrow: 'Tomorrow.',
    week: 'In a week — time to prepare on the outline S-211.',
    freed: 'You no longer conduct this meeting.',
  },
};

export function meetingText(
  news: MeetingNews,
  asConductor: boolean,
  f: MeetingFacts,
  lang: SupportedLanguage,
): { title: string; body: string } {
  const s = T[lang] ?? T.ru;
  const at = when(f, lang);
  const names = f.conductorNames.filter(Boolean);
  const by = names.length ? ` ${s.by(names)}` : '';
  const partner = f.partnerName ? ` ${s.partner(f.partnerName)}` : '';
  switch (news) {
    case 'created':
    case 'conductorNew':
      return asConductor
        ? {
            title: s.conductTitle,
            body: `${at}.${partner} ${s.conductCreated}`,
          }
        : { title: s.title, body: `${at}.${by} ${s.created}` };
    case 'changed':
      return {
        title: s.title,
        body: `${s.changed} ${at}.${asConductor ? '' : by}`,
      };
    case 'cancelled':
      return { title: s.title, body: `${s.cancelled} ${at}.` };
    case 'tomorrow':
      return {
        title: asConductor ? s.conductTitle : s.title,
        body: `${s.tomorrow} ${at}.${asConductor ? '' : by}`,
      };
    case 'reminderWeek':
      return { title: s.conductTitle, body: `${s.week} ${at}.${partner}` };
    case 'conductorFreed':
      return { title: s.title, body: `${s.freed} ${at}.` };
  }
}
