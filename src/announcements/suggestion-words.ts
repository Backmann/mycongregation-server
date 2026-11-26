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
 * A missing fact is never guessed: it is left as a visible gap — «[время]» —
 * and the suggestion says so, so the writer fills it in or fixes the event.
 */
export interface SuggestionWords {
  gapTime: string;
  gapReport: string;
  /** {when} — «Суббота, 13 марта, 9:00». */
  generalCleaning: (p: { when: string }) => string;
  /** {from}, {to} — the visit's days; {midweek} — the moved midweek meeting. */
  coVisitAhead: (p: { from: string; to: string; midweek: string }) => string;
  coVisitNext: (p: { from: string; to: string; midweek: string }) => string;
  memorialAhead: (p: { when: string }) => string;
  memorialNext: (p: { when: string }) => string;
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
}

export const SUGGESTION_WORDS: Record<SupportedLanguage, SuggestionWords> = {
  ru: {
    gapTime: '[время]',
    gapReport: '[текст отчёта]',
    generalCleaning: ({ when }) =>
      `${when} — генеральная уборка Зала царства. Приглашаются все.`,
    coVisitAhead: ({ from, to, midweek }) =>
      `С ${from} по ${to} — посещение районного старейшины. Встреча в будни на той неделе — ${midweek}.`,
    coVisitNext: ({ from, to, midweek }) =>
      `На следующей неделе, с ${from} по ${to}, — посещение районного старейшины. Встреча в будни — ${midweek}.`,
    memorialAhead: ({ when }) =>
      `Вечеря воспоминания — ${when}. Пригласим на неё всех, кого знаем.`,
    memorialNext: ({ when }) =>
      `На следующей неделе — Вечеря воспоминания: ${when}.`,
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
  },
  en: {
    gapTime: '[time]',
    gapReport: '[report text]',
    generalCleaning: ({ when }) =>
      `${when}: general cleaning of the Kingdom Hall. Everyone is invited.`,
    coVisitAhead: ({ from, to, midweek }) =>
      `From ${from} to ${to}: the circuit overseer's visit. The midweek meeting that week: ${midweek}.`,
    coVisitNext: ({ from, to, midweek }) =>
      `Next week, from ${from} to ${to}: the circuit overseer's visit. The midweek meeting: ${midweek}.`,
    memorialAhead: ({ when }) =>
      `The Memorial: ${when}. Let us invite everyone we know.`,
    memorialNext: ({ when }) => `Next week: the Memorial, ${when}.`,
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
  },
  de: {
    gapTime: '[Uhrzeit]',
    gapReport: '[Text des Berichts]',
    generalCleaning: ({ when }) =>
      `${when}: Grundreinigung des Königreichssaals. Alle sind eingeladen.`,
    coVisitAhead: ({ from, to, midweek }) =>
      `Vom ${from} bis ${to}: Besuch des Kreisaufsehers. Die Zusammenkunft unter der Woche in dieser Woche: ${midweek}.`,
    coVisitNext: ({ from, to, midweek }) =>
      `Nächste Woche, vom ${from} bis ${to}: Besuch des Kreisaufsehers. Die Zusammenkunft unter der Woche: ${midweek}.`,
    memorialAhead: ({ when }) =>
      `Das Gedächtnismahl: ${when}. Laden wir alle ein, die wir kennen.`,
    memorialNext: ({ when }) => `Nächste Woche: das Gedächtnismahl, ${when}.`,
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
  },
};
