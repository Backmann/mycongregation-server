/**
 * WHAT A STUDENT PART IS GIVEN TO WORK ON (23 November 2026): the lesson for
 * the counsel and the setting the conversation takes place in. Both stand in
 * the workbook's text of the part — the setting at its start, in capitals
 * («ПРОПОВЕДЬ ПО ДОМАМ.»), the lesson at its end, in brackets
 * («(lmd урок 2, пункт 3)», «(th урок 10)»).
 *
 * Until now only the title kept them, and the title is cut at 120 characters
 * by the import: on the live programme 30 of 175 student parts (May 2026 —
 * February 2027) had lost their lesson that way. Kept the same in the app
 * (lib/student-part.ts), where the workbook is read.
 */

/** The parts a student is given: the Bible reading and «Оттачиваем навыки». */
export function isStudentPart(partKey: string): boolean {
  return partKey === 'bible_reading' || /^apply_yourself_\d+$/.test(partKey);
}

export const SETTINGS = ['house', 'informal', 'public'] as const;
export type Setting = (typeof SETTINGS)[number];

/** The last bracketed reference to a lesson: «lmd урок 2, пункт 3». */
export function lessonOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const all = [...text.matchAll(/\(((?:lmd|th)\s[^()]{1,60}?)\)/gu)];
  const last = all.at(-1)?.[1]?.replace(/\s+/g, ' ').trim();
  return last || null;
}

/**
 * The setting, from the capitals the part's text begins with — in a stored
 * title after «Part name: ». Only the three the workbook uses are known; any
 * other stays in the title and is not guessed.
 */
export function settingOf(text: string | null | undefined): Setting | null {
  if (!text) return null;
  const body = text.includes(': ') ? text.slice(text.indexOf(': ') + 2) : text;
  const caps = /^\s*([A-ZА-ЯЁÄÖÜ][A-ZА-ЯЁÄÖÜ ,-]{2,60})\./u.exec(body)?.[1];
  if (!caps) return null;
  if (/ДОМАМ/u.test(caps)) return 'house';
  if (/НЕФОРМАЛЬН/u.test(caps)) return 'informal';
  if (/ОБЩЕСТВЕНН/u.test(caps)) return 'public';
  return null;
}
