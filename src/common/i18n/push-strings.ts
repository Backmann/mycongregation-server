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
type PushTemplate = {
  title: string;
  body: (params: {
    publisher: string;
    before: string;
    after: string;
  }) => string;
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

export const PUSH_STRINGS: Record<
  SupportedLanguage,
  {
    statusChange: PushTemplate;
    schedulePublished: SchedulePublishedTemplate;
    scheduleChanged: ScheduleChangedTemplate;
  }
> = {
  en: {
    statusChange: {
      title: 'Status changed',
      body: ({ publisher, before, after }) =>
        `${publisher}: ${before} → ${after}`,
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
  },
  ru: {
    statusChange: {
      title: 'Статус изменён',
      body: ({ publisher, before, after }) =>
        `${publisher}: ${before} → ${after}`,
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
  },
  de: {
    statusChange: {
      title: 'Status geändert',
      body: ({ publisher, before, after }) =>
        `${publisher}: ${before} → ${after}`,
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
  },
};
