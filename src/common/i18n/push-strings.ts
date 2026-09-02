import { SupportedLanguage } from './supported-languages';

/**
 * Status name translations for use in push notification bodies.
 * Keys match `publisher_status` enum values stored in DB.
 */
const STATUS_NAMES: Record<string, Record<SupportedLanguage, string>> = {
  active: { en: 'Active', ru: 'Активный', de: 'Aktiv' },
  irregular: { en: 'Irregular', ru: 'Нерегулярный', de: 'Unregelmäßig' },
  inactive: { en: 'Inactive', ru: 'Неактивный', de: 'Inaktiv' },
};

export function translateStatus(
  status: string,
  lang: SupportedLanguage,
): string {
  return STATUS_NAMES[status]?.[lang] ?? status;
}

/**
 * Push notification string templates per language.
 * Mirrors the per-component STR pattern described in
 * `docs/architecture/internationalization.md` Layer A.
 */
/**
 * A status change is announced WITHOUT the publisher's name.
 *
 * The recipients are narrow and right — the overseer of that person's service
 * group, the secretary, the admins — but a push lands on a LOCK SCREEN, and a
 * phone lies on a table where a wife, a child or a visitor sees it. «Иванов
 * Пётр: активный → нерегулярный» is not a thing to leave lying in the open
 * about a brother.
 *
 * The transition itself stays: it tells the reader this is a decline worth
 * opening, and it names nobody. Who it concerns is inside the app, behind the
 * login, on the screen this notification leads to.
 */
type PushTemplate = {
  title: string;
  body: (params: { before: string; after: string }) => string;
};

type SchedulePublishedTemplate = {
  title: string;
  body: (params: { meeting: string; range: string }) => string;
};

type ScheduleChangedTemplate = {
  title: string;
  body: (params: { meeting: string; range: string; parts: string }) => string;
};

/** Localized meeting names used inside schedulePublished bodies. */
export const MEETING_NAMES: Record<
  'midweek' | 'weekend',
  Record<SupportedLanguage, string>
> = {
  midweek: {
    en: 'midweek meeting',
    ru: 'встреча среди недели',
    de: 'Zusammenkunft unter der Woche',
  },
  weekend: {
    en: 'weekend meeting',
    ru: 'встреча в выходные',
    de: 'Zusammenkunft am Wochenende',
  },
};

/**
 * Human names for the programme's parts, so a notification can say «Чтение
 * Библии» instead of `bible_reading`.
 *
 * The canonical list lives in the app's locale files; these are the same
 * strings, because a notification is written on the server and cannot ask the
 * app. When a key is missing here the notification says how MANY parts the
 * person has rather than showing a raw key — a name nobody can read is worse
 * than a count.
 */
export const PART_NAMES: Record<SupportedLanguage, Record<string, string>> = {
  ru: {
    midweek_chairman: 'Председатель встречи',
    midweek_opening_prayer: 'Вступительная молитва',
    treasures_talk: 'Сокровища из Слова Бога',
    spiritual_gems: 'Духовные жемчужины',
    bible_reading: 'Чтение Библии',
    apply_yourself_1: 'Совершенствуй своё служение 1',
    apply_yourself_2: 'Совершенствуй своё служение 2',
    apply_yourself_3: 'Совершенствуй своё служение 3',
    apply_yourself_4: 'Совершенствуй своё служение 4',
    living_christians_1: 'В жизни христианина 1',
    living_christians_2: 'В жизни христианина 2',
    cbs_conductor: 'Изучение Библии в собрании',
    cbs_reader: 'Чтец',
    midweek_closing_prayer: 'Заключительная молитва',
    weekend_chairman: 'Председатель встречи',
    weekend_opening_prayer: 'Вступительная молитва',
    public_talk_speaker: 'Публичная речь',
    watchtower_conductor: 'Изучение «Сторожевой башни» — ведущий',
    watchtower_reader: 'Изучение «Сторожевой башни» — чтец',
    weekend_closing_prayer: 'Заключительная молитва',
    co_service_talk: 'Служебная речь районного старейшины',
    co_concluding_talk: 'Заключительная речь',
    living_christians_extra: 'Христианская жизнь',
  },
  en: {
    midweek_chairman: 'Chairman',
    midweek_opening_prayer: 'Opening prayer',
    treasures_talk: "Treasures from God's Word",
    spiritual_gems: 'Digging for Spiritual Gems',
    bible_reading: 'Bible reading',
    apply_yourself_1: 'Apply Yourself 1',
    apply_yourself_2: 'Apply Yourself 2',
    apply_yourself_3: 'Apply Yourself 3',
    apply_yourself_4: 'Apply Yourself 4',
    living_christians_1: 'Living as Christians 1',
    living_christians_2: 'Living as Christians 2',
    cbs_conductor: 'Congregation Bible Study',
    cbs_reader: 'Congregation Bible Study — reader',
    midweek_closing_prayer: 'Closing prayer',
    weekend_chairman: 'Chairman',
    weekend_opening_prayer: 'Opening prayer',
    public_talk_speaker: 'Public talk',
    watchtower_conductor: 'Watchtower study — conductor',
    watchtower_reader: 'Watchtower study — reader',
    weekend_closing_prayer: 'Closing prayer',
    co_service_talk: 'Service talk (circuit overseer)',
    co_concluding_talk: 'Concluding talk',
    living_christians_extra: 'Living as Christians',
  },
  de: {
    midweek_chairman: 'Vorsitzender',
    midweek_opening_prayer: 'Anfangsgebet',
    treasures_talk: 'Schätze aus Gottes Wort',
    spiritual_gems: 'Nach geistigen Schätzen graben',
    bible_reading: 'Bibellesung',
    apply_yourself_1: 'Werde ein besserer Lehrer 1',
    apply_yourself_2: 'Werde ein besserer Lehrer 2',
    apply_yourself_3: 'Werde ein besserer Lehrer 3',
    apply_yourself_4: 'Werde geschickter im Predigtdienst 4',
    living_christians_1: 'Unser Leben als Christen 1',
    living_christians_2: 'Unser Leben als Christen 2',
    cbs_conductor: 'Bibelstudium der Versammlung',
    cbs_reader: 'Bibelstudium der Versammlung — Vorleser',
    midweek_closing_prayer: 'Schlussgebet',
    weekend_chairman: 'Vorsitzender',
    weekend_opening_prayer: 'Anfangsgebet',
    public_talk_speaker: 'Öffentlicher Vortrag',
    watchtower_conductor: 'Wachtturm-Studium — Leiter',
    watchtower_reader: 'Wachtturm-Studium — Vorleser',
    weekend_closing_prayer: 'Schlussgebet',
    co_service_talk: 'Dienstvortrag des Kreisaufsehers',
    co_concluding_talk: 'Schlussvortrag',
    living_christians_extra: 'Leben als Christ',
  },
};

/** What the person was given, as it should read in a notification. */
export type MyAssignmentTemplate = {
  title: string;
  body: (params: { meeting: string; range: string; parts: string }) => string;
  /** Used when no part name is known — never show a raw key to a person. */
  count: (params: { meeting: string; range: string; n: number }) => string;
};

/**
 * The Memorial, to the people written on its sheet.
 *
 * Two moments, and only two: the evening the programme is published, and the
 * evening before it is held. Nobody else hears either one — the congregation
 * is invited to the Memorial in the ordinary way, from the platform, and a
 * push saying «somebody has a part» to a person who has none is the broadcast
 * this project stopped sending on purpose.
 */
type MemorialTemplate = {
  title: string;
  body: (params: { day: string; parts: string }) => string;
};

export const PUSH_STRINGS: Record<
  SupportedLanguage,
  {
    statusChange: PushTemplate;
    schedulePublished: SchedulePublishedTemplate;
    scheduleChanged: ScheduleChangedTemplate;
    myAssignment: MyAssignmentTemplate;
    myAssignmentChanged: MyAssignmentTemplate;
    memorialPublished: MemorialTemplate;
    memorialTomorrow: MemorialTemplate;
  }
> = {
  en: {
    statusChange: {
      title: 'Status changed',
      body: ({ before, after }) => `${before} → ${after}`,
    },
    schedulePublished: {
      title: 'Programme updated',
      body: ({ meeting, range }) =>
        `The ${meeting} programme is published (${range})`,
    },
    scheduleChanged: {
      title: 'Programme changed',
      body: ({ meeting, range, parts }) =>
        parts
          ? `Changes to the ${meeting} programme (${range}): ${parts}`
          : `The ${meeting} programme changed (${range}). Please check assignments.`,
    },
    myAssignment: {
      title: 'You have an assignment',
      body: ({ meeting, range, parts }) => `${meeting}, ${range}: ${parts}`,
      count: ({ meeting, range, n }) =>
        `${meeting}, ${range}: ${n} assignment(s)`,
    },
    myAssignmentChanged: {
      title: 'Your assignment changed',
      body: ({ meeting, range, parts }) => `${meeting}, ${range}: ${parts}`,
      count: ({ meeting, range, n }) =>
        `${meeting}, ${range}: ${n} assignment(s) changed`,
    },
    memorialPublished: {
      title: 'Memorial programme published',
      body: ({ day, parts }) => `${day} — you have: ${parts}`,
    },
    memorialTomorrow: {
      title: 'The Memorial is tomorrow',
      body: ({ day, parts }) => `${day} — you have: ${parts}`,
    },
  },
  ru: {
    statusChange: {
      title: 'Статус изменён',
      body: ({ before, after }) => `${before} → ${after}`,
    },
    schedulePublished: {
      title: 'Программа обновлена',
      body: ({ meeting, range }) =>
        `Опубликована программа: ${meeting}, ${range}`,
    },
    scheduleChanged: {
      title: 'Программа изменена',
      body: ({ meeting, range, parts }) =>
        parts
          ? `Изменена программа: ${meeting}, ${range}. Изменено: ${parts}`
          : `Изменена программа: ${meeting}, ${range}. Проверьте назначения.`,
    },
    myAssignment: {
      title: 'Вам назначено',
      body: ({ meeting, range, parts }) => `${meeting}, ${range}: ${parts}`,
      count: ({ meeting, range, n }) =>
        `${meeting}, ${range}: назначений — ${n}`,
    },
    myAssignmentChanged: {
      title: 'Ваше назначение изменилось',
      body: ({ meeting, range, parts }) => `${meeting}, ${range}: ${parts}`,
      count: ({ meeting, range, n }) =>
        `${meeting}, ${range}: изменений — ${n}`,
    },
    memorialPublished: {
      title: 'Программа Вечери опубликована',
      body: ({ day, parts }) => `${day} — у вас: ${parts}`,
    },
    memorialTomorrow: {
      title: 'Завтра Вечеря воспоминания',
      body: ({ day, parts }) => `${day} — у вас: ${parts}`,
    },
  },
  de: {
    statusChange: {
      title: 'Status geändert',
      body: ({ before, after }) => `${before} → ${after}`,
    },
    schedulePublished: {
      title: 'Programm aktualisiert',
      body: ({ meeting, range }) =>
        `Das Programm wurde veröffentlicht: ${meeting}, ${range}`,
    },
    scheduleChanged: {
      title: 'Programm geändert',
      body: ({ meeting, range, parts }) =>
        parts
          ? `Änderungen am Programm: ${meeting}, ${range}. Geändert: ${parts}`
          : `Das Programm wurde geändert: ${meeting}, ${range}. Bitte Zuteilungen prüfen.`,
    },
    myAssignment: {
      title: 'Du hast eine Aufgabe',
      body: ({ meeting, range, parts }) => `${meeting}, ${range}: ${parts}`,
      count: ({ meeting, range, n }) => `${meeting}, ${range}: ${n} Aufgabe(n)`,
    },
    myAssignmentChanged: {
      title: 'Deine Aufgabe hat sich geändert',
      body: ({ meeting, range, parts }) => `${meeting}, ${range}: ${parts}`,
      count: ({ meeting, range, n }) =>
        `${meeting}, ${range}: ${n} Änderung(en)`,
    },
    memorialPublished: {
      title: 'Programm des Gedächtnismahls',
      body: ({ day, parts }) => `${day} — du hast: ${parts}`,
    },
    memorialTomorrow: {
      title: 'Morgen ist das Gedächtnismahl',
      body: ({ day, parts }) => `${day} — du hast: ${parts}`,
    },
  },
};

/** «3 – 9 августа» — the week a programme covers, in the reader's language. */
/**
 * One calendar day, spelled out: «2 апреля», «2 April».
 *
 * Same shape as formatWeekRange below, including the fallback: a locale the
 * runtime does not carry must not turn a reminder into an exception. The date
 * is read at midday so no timezone can move it to the day before.
 */
export function formatDay(dateISO: string, lang: SupportedLanguage): string {
  try {
    return new Intl.DateTimeFormat(lang, {
      day: 'numeric',
      month: 'long',
    }).format(new Date(`${dateISO}T12:00:00`));
  } catch {
    return dateISO;
  }
}

export function formatWeekRange(
  weekStartDate: string,
  lang: SupportedLanguage,
): string {
  try {
    const start = new Date(`${weekStartDate}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const fmt = new Intl.DateTimeFormat(lang, {
      day: 'numeric',
      month: 'long',
    });
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  } catch {
    return weekStartDate;
  }
}
