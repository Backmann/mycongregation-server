import { SupportedLanguage } from '../common/i18n/supported-languages';

/**
 * The names an agenda gives what is not a programme part or a duty (those
 * come from the reminders' own names, so a notification and the calendar say
 * the same). Kept beside the agenda: the calendar shows them as event titles,
 * and nothing else needs them.
 */
export interface AgendaWords {
  cleaningAfter: string;
  cleaningThorough: string;
  cleaningGeneral: string;
  cart: (place: string) => string;
  fieldService: string;
  fieldServiceVisit: string;
  outgoingTalk: (congregation: string | null) => string;
  guestLunch: string;
  coLunch: string;
  coLunchBox: string;
  coFieldService: string;
  coPastoral: string;
  coPioneers: string;
  coElders: string;
  coOther: string;
  coAccommodation: string;
  pioneerMeetingConduct: string;
  pioneerMeetingInvited: string;
  pioneerSchool: (duty: string) => string;
  eldersMeeting: string;
  memorial: string;
  events: Record<string, string>;
}

export const AGENDA_WORDS: Record<SupportedLanguage, AgendaWords> = {
  ru: {
    cleaningAfter: 'Уборка после встречи',
    cleaningThorough: 'Генеральная уборка',
    cleaningGeneral: 'Общая уборка',
    cart: (p) => (p ? `Стенд — ${p}` : 'Стенд'),
    fieldService: 'Встреча для проповеди — ведёте вы',
    fieldServiceVisit:
      'Встреча для проповеди — посещение служебного надзирателя',
    outgoingTalk: (c) =>
      c ? `Речь на выезде — собрание ${c}` : 'Речь на выезде',
    guestLunch: 'Обед для докладчика',
    coLunch: 'Обед для районного старейшины',
    coLunchBox: 'Ланч-бокс для районного старейшины',
    coFieldService: 'Проповедь с районным старейшиной',
    coPastoral: 'Пастырское посещение с районным старейшиной',
    coPioneers: 'Встреча районного старейшины с пионерами',
    coElders:
      'Встреча районного старейшины со старейшинами и помощниками собрания',
    coOther: 'Посещение районного старейшины',
    coAccommodation: 'Районный старейшина живёт у вас',
    pioneerMeetingConduct: 'Встреча пионеров — ведёте вы',
    pioneerMeetingInvited: 'Встреча пионеров',
    pioneerSchool: (d) => `Школа пионерского служения — ${d}`,
    eldersMeeting: 'Встреча старейшин',
    memorial: 'Вечеря воспоминания',
    events: {
      regional_convention: 'Региональный конгресс',
      circuit_assembly: 'Районный конгресс',
      circuit_overseer_visit: 'Посещение районного старейшины',
      branch_representative_visit: 'Посещение представителя филиала',
      memorial: 'Вечеря воспоминания',
    },
  },
  en: {
    cleaningAfter: 'Cleaning after the meeting',
    cleaningThorough: 'Thorough cleaning',
    cleaningGeneral: 'General cleaning',
    cart: (p) => (p ? `Cart — ${p}` : 'Cart'),
    fieldService: 'Meeting for field service — you conduct',
    fieldServiceVisit: 'Meeting for field service — service overseer visit',
    outgoingTalk: (c) =>
      c ? `Public talk away — ${c} congregation` : 'Public talk away',
    guestLunch: 'Lunch for the visiting speaker',
    coLunch: 'Lunch for the circuit overseer',
    coLunchBox: 'Lunch bag for the circuit overseer',
    coFieldService: 'Field service with the circuit overseer',
    coPastoral: 'Shepherding call with the circuit overseer',
    coPioneers: 'Pioneers meeting with the circuit overseer',
    coElders:
      'Meeting of elders and ministerial servants with the circuit overseer',
    coOther: 'Circuit overseer visit',
    coAccommodation: 'The circuit overseer stays with you',
    pioneerMeetingConduct: 'Pioneers meeting — you conduct',
    pioneerMeetingInvited: 'Pioneers meeting',
    pioneerSchool: (d) => `Pioneer Service School — ${d}`,
    eldersMeeting: 'Elders meeting',
    memorial: 'Memorial',
    events: {
      regional_convention: 'Regional convention',
      circuit_assembly: 'Circuit assembly',
      circuit_overseer_visit: 'Circuit overseer visit',
      branch_representative_visit: 'Branch representative visit',
      memorial: 'Memorial',
    },
  },
  de: {
    cleaningAfter: 'Reinigung nach der Zusammenkunft',
    cleaningThorough: 'Grundreinigung',
    cleaningGeneral: 'Gemeinsame Reinigung',
    cart: (p) => (p ? `Trolley — ${p}` : 'Trolley'),
    fieldService: 'Predigtdienstzusammenkunft — Sie leiten',
    fieldServiceVisit:
      'Predigtdienstzusammenkunft — Besuch des Dienstaufsehers',
    outgoingTalk: (c) =>
      c ? `Vortrag auswärts — Versammlung ${c}` : 'Vortrag auswärts',
    guestLunch: 'Mittagessen für den Gastredner',
    coLunch: 'Mittagessen für den Kreisaufseher',
    coLunchBox: 'Lunchpaket für den Kreisaufseher',
    coFieldService: 'Predigtdienst mit dem Kreisaufseher',
    coPastoral: 'Hirtenbesuch mit dem Kreisaufseher',
    coPioneers: 'Pionierzusammenkunft mit dem Kreisaufseher',
    coElders:
      'Zusammenkunft der Ältesten und Dienstamtgehilfen mit dem Kreisaufseher',
    coOther: 'Besuch des Kreisaufsehers',
    coAccommodation: 'Der Kreisaufseher wohnt bei Ihnen',
    pioneerMeetingConduct: 'Pionierzusammenkunft — Sie leiten',
    pioneerMeetingInvited: 'Pionierzusammenkunft',
    pioneerSchool: (d) => `Pionierdienstschule — ${d}`,
    eldersMeeting: 'Ältestenzusammenkunft',
    memorial: 'Gedächtnismahl',
    events: {
      regional_convention: 'Regionaler Kongress',
      circuit_assembly: 'Kreiskongress',
      circuit_overseer_visit: 'Besuch des Kreisaufsehers',
      branch_representative_visit: 'Besuch des Zweigvertreters',
      memorial: 'Gedächtnismahl',
    },
  },
};

/** The big events a calendar shows — campaigns and «other» are left out on purpose (7 November 2026). */
export const BIG_EVENT_TYPES = [
  'regional_convention',
  'circuit_assembly',
  'circuit_overseer_visit',
  'branch_representative_visit',
  'memorial',
] as const;
