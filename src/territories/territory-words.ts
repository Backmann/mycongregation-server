import { SupportedLanguage } from '../common/i18n/supported-languages';

/**
 * The words of the territory notices, in the reader's language
 * (11 November 2026). A notice on a locked screen names the territory and
 * the day, never a person.
 */

/** «11 марта» */
export function dayMonth(dateISO: string, lang: SupportedLanguage): string {
  try {
    return new Intl.DateTimeFormat(lang, {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${dateISO}T12:00:00Z`));
  } catch {
    return dateISO;
  }
}

type Words = { title: string; body: string };

/** «Вам выдан участок T07 · вернуть до 11 марта». */
export function assignedWords(
  number: string,
  dueOn: string | null,
  lang: SupportedLanguage,
): Words {
  const due = dueOn ? dayMonth(dueOn, lang) : null;
  switch (lang) {
    case 'en':
      return {
        title: `Territory ${number} is yours`,
        body: due
          ? `Return by ${due}. The map is under «Ministry → Territories».`
          : 'The map is under «Ministry → Territories».',
      };
    case 'de':
      return {
        title: `Gebiet ${number} ist Ihnen zugeteilt`,
        body: due
          ? `Zurück bis ${due}. Die Karte steht unter «Dienst → Gebiete».`
          : 'Die Karte steht unter «Dienst → Gebiete».',
      };
    default:
      return {
        title: `Вам выдан участок ${number}`,
        body: due
          ? `Вернуть до ${due}. Карта — в «Служение → Участки».`
          : 'Карта — в «Служение → Участки».',
      };
  }
}

/** Two weeks before the day. */
export function dueSoonWords(
  number: string,
  dueOn: string,
  lang: SupportedLanguage,
): Words {
  const due = dayMonth(dueOn, lang);
  switch (lang) {
    case 'en':
      return {
        title: `Territory ${number}: two weeks left`,
        body: `Return by ${due}. Worked through — mark it; need more time — ask once in the app.`,
      };
    case 'de':
      return {
        title: `Gebiet ${number}: noch zwei Wochen`,
        body: `Zurück bis ${due}. Bearbeitet — bitte markieren; mehr Zeit nötig — einmal in der App verlängern.`,
      };
    default:
      return {
        title: `Участок ${number}: осталось две недели`,
        body: `Вернуть до ${due}. Пройден — отметьте; нужно ещё время — продлите один раз в приложении.`,
      };
  }
}

/**
 * For the territory servant: a holder who has left the congregation still
 * holds a territory. Says nothing of why.
 */
export function takeBackWords(number: string, lang: SupportedLanguage): Words {
  switch (lang) {
    case 'en':
      return {
        title: `Territory ${number}: take it back`,
        body: 'Its holder is no longer in the congregation. Mark the return under «Territories».',
      };
    case 'de':
      return {
        title: `Gebiet ${number}: zurücknehmen`,
        body: 'Der Inhaber ist nicht mehr in der Versammlung. Rückgabe unter «Gebiete» eintragen.',
      };
    default:
      return {
        title: `Участок ${number}: принять обратно`,
        body: 'Держатель больше не в собрании. Отметьте возврат в разделе «Участки».',
      };
  }
}

/** For the territory servant: a group's overseer changed. */
export function handOnWords(number: string, lang: SupportedLanguage): Words {
  switch (lang) {
    case 'en':
      return {
        title: `Territory ${number}: the group has a new overseer`,
        body: 'Hand the group territory on to him under «Territories».',
      };
    case 'de':
      return {
        title: `Gebiet ${number}: neuer Gruppenaufseher`,
        body: 'Das Gruppengebiet unter «Gebiete» an ihn weitergeben.',
      };
    default:
      return {
        title: `Участок ${number}: у группы новый ответственный`,
        body: 'Передайте ему участок группы в разделе «Участки».',
      };
  }
}

/** For the keepers and the service committee: addresses up for review. */
export function noCallReviewWords(
  count: number,
  lang: SupportedLanguage,
): Words {
  switch (lang) {
    case 'en':
      return {
        title: `«Do not call» addresses to review: ${count}`,
        body: 'Two years have passed. Keep them or remove them under «Territories».',
      };
    case 'de':
      return {
        title: `«Nicht besuchen»-Adressen zur Prüfung: ${count}`,
        body: 'Zwei Jahre sind vorbei. Unter «Gebiete» behalten oder entfernen.',
      };
    default:
      return {
        title: `Адреса «не посещать» на пересмотр: ${count}`,
        body: 'Прошло два года. Оставьте или снимите их в разделе «Участки».',
      };
  }
}
