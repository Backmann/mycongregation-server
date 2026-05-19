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

export const PUSH_STRINGS: Record<
  SupportedLanguage,
  { statusChange: PushTemplate }
> = {
  en: {
    statusChange: {
      title: 'Status changed',
      body: ({ publisher, before, after }) =>
        `${publisher}: ${before} → ${after}`,
    },
  },
  ru: {
    statusChange: {
      title: 'Статус изменён',
      body: ({ publisher, before, after }) =>
        `${publisher}: ${before} → ${after}`,
    },
  },
  de: {
    statusChange: {
      title: 'Status geändert',
      body: ({ publisher, before, after }) =>
        `${publisher}: ${before} → ${after}`,
    },
  },
};
