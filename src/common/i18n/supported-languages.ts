/**
 * Supported UI languages for users and content (ISO 639-1).
 * Initial MVP: Russian (ru), English (en), German (de).
 *
 * Mirrors the client-side `lib/i18n.ts` SUPPORTED_LANGUAGES.
 */
export const SUPPORTED_LANGUAGES = ['ru', 'en', 'de'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'ru';

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Coerce an arbitrary language input (possibly BCP 47 like "en-US",
 * or undefined) to a supported ISO 639-1 language, falling back to
 * `DEFAULT_LANGUAGE`.
 */
export function coerceLanguage(value: unknown): SupportedLanguage {
  if (typeof value !== 'string') return DEFAULT_LANGUAGE;
  const code = value.slice(0, 2).toLowerCase();
  return isSupportedLanguage(code) ? code : DEFAULT_LANGUAGE;
}
