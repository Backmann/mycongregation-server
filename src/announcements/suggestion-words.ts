import type { SupportedLanguage } from '../common/i18n/supported-languages';

/**
 * The words of the suggested announcements, in the congregation's language
 * (announcements R-09, 26 November 2026).
 *
 * These are what the app offers by default; the writer edits the text before
 * adding it, and a congregation will be able to keep its own wording on the
 * «Templates» screen (R-05, R-09 step 4). They are read aloud from the
 * platform, so they are whole sentences in the congregation's language and
 * name no organisation.
 *
 * A missing fact is never guessed. A missing hour is left out and the words
 * say it will be told; a missing report stays a visible gap. Where it matters
 * the suggestion warns the writer, who fills it in or fixes the event.
 */
/** What of an event is not known yet (27 November 2026). */
export type Later = 'time' | 'place' | 'both';

export interface SuggestionWords {
  gapReport: string;
  /**
   * What is still to be told: the hour, the place or both — said after the
   * congregation's own words too, or it would just vanish (independent
   * check, 26 November 2026).
   */
  later: (what: Later) => string;
  /** {when} — «Суббота, 13 марта, 9:00». */
  generalCleaning: (p: { when: string; later?: Later }) => string;
  /**
   * {from}, {to} — the visit's days; {midweek} — the moved midweek meeting,
   * null when the week holds none (an assembly in the visit week).
   */
  coVisitAhead: (p: {
    from: string;
    to: string;
    midweek: string | null;
  }) => string;
  coVisitNext: (p: {
    from: string;
    to: string;
    midweek: string | null;
  }) => string;
  /**
   * {when} — the day, with the hour once it is known; {place} — the
   * event's address, when given. `later`: the hour is not known yet, and the
   * app's own words say it will be told (Lionel, 26 November 2026: the time
   * and the address of the Memorial are often not known weeks ahead).
   */
  memorialAhead: (p: {
    when: string;
    place?: string | null;
    later?: Later;
  }) => string;
  memorialNext: (p: {
    when: string;
    place?: string | null;
    later?: Later;
  }) => string;
  /** {name} — «Районный конгресс»; {dates} — «24 января» or «30 июля – 1 августа». */
  conventionAhead: (p: { name: string; dates: string }) => string;
  conventionNext: (p: { name: string; dates: string }) => string;
  circuitAssembly: string;
  regionalConvention: string;
  fieldServiceCancelled: (p: { when: string }) => string;
  fieldServiceMoved: (p: { when: string; from: string }) => string;
  fieldServiceNotice: (p: { when: string; notice: string }) => string;
  /** {month} — the month reported on, «ноябрь». */
  accountsMonth: (p: { month: string; report: string }) => string;
  /** {months} — «сентябрь – ноябрь». */
  accountsAudit: (p: { months: string }) => string;
  /**
   * Put on the chairman's list by the guidelines (R-04 (2), R-05): before a
   * circuit assembly, the programme on the screens. The link when the event
   * has one.
   */
  assemblyScreens: (p: { programUrl: string | null }) => string;
}

const LATER_RU = (what: Later): string =>
  what === 'both'
    ? 'Время и место сообщим позже.'
    : what === 'place'
      ? 'Место сообщим позже.'
      : 'Время сообщим позже.';
const LATER_EN = (what: Later): string =>
  what === 'both'
    ? 'The time and place will be announced.'
    : what === 'place'
      ? 'The place will be announced.'
      : 'The time will be announced.';
const LATER_DE = (what: Later): string =>
  what === 'both'
    ? 'Uhrzeit und Ort werden noch bekannt gegeben.'
    : what === 'place'
      ? 'Der Ort wird noch bekannt gegeben.'
      : 'Die Uhrzeit wird noch bekannt gegeben.';

export const SUGGESTION_WORDS: Record<SupportedLanguage, SuggestionWords> = {
  ru: {
    gapReport: '[текст отчёта]',
    later: LATER_RU,
    generalCleaning: ({ when, later }) =>
      `${when} — генеральная уборка Зала царства.${later ? ` ${LATER_RU(later)}` : ''} Приглашаются все.`,
    coVisitAhead: ({ from, to, midweek }) =>
      `С ${from} по ${to} — посещение районного старейшины.` +
      (midweek ? ` Встреча в будни на той неделе — ${midweek}.` : ''),
    coVisitNext: ({ from, to, midweek }) =>
      `На следующей неделе, с ${from} по ${to}, — посещение районного старейшины.` +
      (midweek ? ` Встреча в будни — ${midweek}.` : ''),
    memorialAhead: ({ when, place, later }) =>
      `Вечеря воспоминания — ${when}${place ? `, ${place}` : ''}.${later ? ` ${LATER_RU(later)}` : ''} Пригласим на неё всех, кого знаем.`,
    memorialNext: ({ when, place, later }) =>
      `На следующей неделе — Вечеря воспоминания: ${when}${place ? `, ${place}` : ''}.${later ? ` ${LATER_RU(later)}` : ''}`,
    conventionAhead: ({ name, dates }) =>
      `${name} — ${dates}. Запланируйте, пожалуйста, это время заранее.`,
    conventionNext: ({ name, dates }) =>
      `На следующей неделе — ${name.toLowerCase()} (${dates}). Скачайте заранее программу, возьмите с собой «Сторожевую башню» и приходите вовремя.`,
    circuitAssembly: 'Районный конгресс',
    regionalConvention: 'Региональный конгресс',
    fieldServiceCancelled: ({ when }) =>
      `${when}: встреча для проповеди отменяется.`,
    fieldServiceMoved: ({ when, from }) =>
      `${when}: встреча для проповеди (перенесена с ${from}).`,
    fieldServiceNotice: ({ when, notice }) =>
      `${when}, встреча для проповеди: ${notice}`,
    accountsMonth: ({ month, report }) =>
      `Отчёт о счетах собрания за ${month}: ${report}`,
    accountsAudit: ({ months }) =>
      `Проверка счетов собрания за ${months} проведена.`,
    assemblyScreens: ({ programUrl }) =>
      'Покажите на экранах программу районного конгресса: тему и ключевые речи.' +
      (programUrl ? `\nПрограмма: ${programUrl}` : ''),
  },
  en: {
    gapReport: '[report text]',
    later: LATER_EN,
    generalCleaning: ({ when, later }) =>
      `${when}: general cleaning of the Kingdom Hall.${later ? ` ${LATER_EN(later)}` : ''} Everyone is invited.`,
    coVisitAhead: ({ from, to, midweek }) =>
      `From ${from} to ${to}: the circuit overseer's visit.` +
      (midweek ? ` The midweek meeting that week: ${midweek}.` : ''),
    coVisitNext: ({ from, to, midweek }) =>
      `Next week, from ${from} to ${to}: the circuit overseer's visit.` +
      (midweek ? ` The midweek meeting: ${midweek}.` : ''),
    memorialAhead: ({ when, place, later }) =>
      `The Memorial: ${when}${place ? `, ${place}` : ''}.${later ? ` ${LATER_EN(later)}` : ''} Let us invite everyone we know.`,
    memorialNext: ({ when, place, later }) =>
      `Next week: the Memorial, ${when}${place ? `, ${place}` : ''}.${later ? ` ${LATER_EN(later)}` : ''}`,
    conventionAhead: ({ name, dates }) =>
      `${name}: ${dates}. Please plan this time in advance.`,
    conventionNext: ({ name, dates }) =>
      `Next week: the ${name.toLowerCase()} (${dates}). Download the program in advance, bring The Watchtower, and arrive on time.`,
    circuitAssembly: 'Circuit assembly',
    regionalConvention: 'Regional convention',
    fieldServiceCancelled: ({ when }) =>
      `${when}: the meeting for field service is canceled.`,
    fieldServiceMoved: ({ when, from }) =>
      `${when}: the meeting for field service (moved from ${from}).`,
    fieldServiceNotice: ({ when, notice }) =>
      `${when}, meeting for field service: ${notice}`,
    accountsMonth: ({ month, report }) =>
      `Congregation accounts report for ${month}: ${report}`,
    accountsAudit: ({ months }) =>
      `The audit of the congregation accounts for ${months} has been done.`,
    assemblyScreens: ({ programUrl }) =>
      'Show the circuit assembly program on the screens: the theme and the key talks.' +
      (programUrl ? `\nProgram: ${programUrl}` : ''),
  },
  de: {
    gapReport: '[Text des Berichts]',
    later: LATER_DE,
    generalCleaning: ({ when, later }) =>
      `${when}: Grundreinigung des Königreichssaals.${later ? ` ${LATER_DE(later)}` : ''} Alle sind eingeladen.`,
    coVisitAhead: ({ from, to, midweek }) =>
      `Vom ${from} bis ${to}: Besuch des Kreisaufsehers.` +
      (midweek
        ? ` Die Zusammenkunft unter der Woche in dieser Woche: ${midweek}.`
        : ''),
    coVisitNext: ({ from, to, midweek }) =>
      `Nächste Woche, vom ${from} bis ${to}: Besuch des Kreisaufsehers.` +
      (midweek ? ` Die Zusammenkunft unter der Woche: ${midweek}.` : ''),
    memorialAhead: ({ when, place, later }) =>
      `Das Gedächtnismahl: ${when}${place ? `, ${place}` : ''}.${later ? ` ${LATER_DE(later)}` : ''} Laden wir alle ein, die wir kennen.`,
    memorialNext: ({ when, place, later }) =>
      `Nächste Woche: das Gedächtnismahl, ${when}${place ? `, ${place}` : ''}.${later ? ` ${LATER_DE(later)}` : ''}`,
    conventionAhead: ({ name, dates }) =>
      `${name}: ${dates}. Bitte planen Sie diese Zeit schon jetzt ein.`,
    conventionNext: ({ name, dates }) =>
      `Nächste Woche: ${name} (${dates}). Bitte laden Sie das Programm vorher herunter, bringen Sie den Wachtturm mit und kommen Sie pünktlich.`,
    circuitAssembly: 'Kreiskongress',
    regionalConvention: 'Regionaler Kongress',
    fieldServiceCancelled: ({ when }) =>
      `${when}: Die Zusammenkunft für den Predigtdienst fällt aus.`,
    fieldServiceMoved: ({ when, from }) =>
      `${when}: Zusammenkunft für den Predigtdienst (verlegt vom ${from}).`,
    fieldServiceNotice: ({ when, notice }) =>
      `${when}, Zusammenkunft für den Predigtdienst: ${notice}`,
    accountsMonth: ({ month, report }) =>
      `Bericht über die Konten der Versammlung für ${month}: ${report}`,
    accountsAudit: ({ months }) =>
      `Die Prüfung der Konten der Versammlung für ${months} ist erfolgt.`,
    assemblyScreens: ({ programUrl }) =>
      'Zeigen Sie das Programm des Kreiskongresses auf den Bildschirmen: das Thema und die Hauptvorträge.' +
      (programUrl ? `\nProgramm: ${programUrl}` : ''),
  },
};
