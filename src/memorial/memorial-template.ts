/**
 * The Memorial programme, in the order it happens.
 *
 * Nine lines, and the order is not decoration: the two prayers fall INSIDE the
 * talk — one before the bread, one before the wine — and the announcements
 * come after it. A sheet that lists them in any other order describes a
 * different evening.
 *
 * The defaults below are used ONCE, for a congregation's first Memorial. Every
 * one after that is filled from the previous year instead — theme, songs,
 * labels and all — so when the theme changes, it is typed once and carries
 * forward on its own. Neither the theme nor the song numbers should ever need
 * a release to change, which is why they live here only as a starting point
 * and never as a rule.
 */

export const MEMORIAL_SECTION = {
  PROGRAMME: 'programme',
  EMBLEMS: 'emblems',
  DUTY: 'duty',
} as const;

export type MemorialSection =
  (typeof MEMORIAL_SECTION)[keyof typeof MEMORIAL_SECTION];

/** The fixed parts, by the key the app uses to know what a line is. */
export const MEMORIAL_PART = {
  CHAIRMAN: 'chairman',
  SONG_OPENING: 'song_opening',
  PRAYER_OPENING: 'prayer_opening',
  TALK: 'talk',
  PRAYER_BREAD: 'prayer_bread',
  PRAYER_WINE: 'prayer_wine',
  ANNOUNCEMENTS: 'announcements',
  SONG_CLOSING: 'song_closing',
  PRAYER_CLOSING: 'prayer_closing',
} as const;

export type MemorialPart = (typeof MEMORIAL_PART)[keyof typeof MEMORIAL_PART];

export interface MemorialTemplateLine {
  partKey: MemorialPart;
  /** Fallback label, in case the caller supplies no translation. */
  label: string;
  songNumber?: number;
}

/**
 * The starting sheet: order, parts and the songs a congregation begins from.
 *
 * Songs 20 and 18 are what this congregation has used; they are a suggestion
 * the first time and are then carried from last year like everything else.
 */
export const MEMORIAL_TEMPLATE: MemorialTemplateLine[] = [
  { partKey: MEMORIAL_PART.CHAIRMAN, label: 'Председатель' },
  { partKey: MEMORIAL_PART.SONG_OPENING, label: 'Песня', songNumber: 20 },
  { partKey: MEMORIAL_PART.PRAYER_OPENING, label: 'Вступительная молитва' },
  { partKey: MEMORIAL_PART.TALK, label: 'Речь' },
  { partKey: MEMORIAL_PART.PRAYER_BREAD, label: 'Молитва за хлеб' },
  { partKey: MEMORIAL_PART.PRAYER_WINE, label: 'Молитва за вино' },
  { partKey: MEMORIAL_PART.ANNOUNCEMENTS, label: 'Объявления' },
  { partKey: MEMORIAL_PART.SONG_CLOSING, label: 'Песня', songNumber: 18 },
  { partKey: MEMORIAL_PART.PRAYER_CLOSING, label: 'Заключительная молитва' },
];

/** Which parts carry a song rather than a person. */
export const MEMORIAL_SONG_PARTS: MemorialPart[] = [
  MEMORIAL_PART.SONG_OPENING,
  MEMORIAL_PART.SONG_CLOSING,
];

/**
 * The talk's theme, as the yearly letter gives it.
 *
 * A starting value, nothing more: it changes when the letter changes, and it
 * is carried from last year's Memorial rather than read from here.
 */
export const MEMORIAL_DEFAULT_THEME =
  'Цените всё, что Бог и Христос сделали для вас!';
