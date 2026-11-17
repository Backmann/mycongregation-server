import type { FolderMarkState } from '../entities/co-visit-folder-mark.entity';

/**
 * THE FOLDER FOR THE CIRCUIT OVERSEER — form S-61 (12/25), as decided with
 * Lionel on 17 November 2026 (mockup «Папка для районного (S-61)», checked
 * against the form by a separate reviewer).
 *
 * Numbers are the form's own. Page 1 has three blocks: the coordinator of
 * the body of elders (1.x), the secretary (2.x) and the service overseer
 * (3.x). 3.5 and 3.6 are not on the form — the service committee asked for
 * them. What the app cannot make (S-62 names, accounts, the literature
 * record) is marked «separate file», «on paper» or «does not apply»; the
 * app keeps the mark, never the content.
 */
export type FolderRole = 'coordinator' | 'secretary' | 'service_overseer';

export interface FolderItemDef {
  key: string;
  section: 1 | 2 | 3;
  role: FolderRole;
  /** pdf — the app makes the file; manual — kept outside the app. */
  source: 'pdf' | 'manual';
  /** Marks a person may set. */
  states: readonly FolderMarkState[];
  /** Beyond the form, asked for by the service committee. */
  extra?: boolean;
}

const MANUAL: readonly FolderMarkState[] = ['separate', 'paper', 'na'];
const PDF: readonly FolderMarkState[] = ['saved', 'na'];

export const FOLDER_ITEMS: readonly FolderItemDef[] = [
  // 1.1 Names of brothers recommended for appointment or deletion — handed
  // over on the Tuesday; the S-62 itself is the milestone before the folder.
  {
    key: '1.1',
    section: 1,
    role: 'coordinator',
    source: 'manual',
    states: MANUAL,
  },
  // 1.2 Questions for the meeting with the elders, with the quarterly
  // meetings of the body — a separate file from the service committee.
  {
    key: '1.2',
    section: 1,
    role: 'coordinator',
    source: 'manual',
    states: MANUAL,
  },
  { key: '1.3', section: 1, role: 'coordinator', source: 'pdf', states: PDF },
  // 1.4 Accommodation — only when the overseer asked for it.
  { key: '1.4', section: 1, role: 'coordinator', source: 'pdf', states: PDF },
  { key: '1.5', section: 1, role: 'coordinator', source: 'pdf', states: PDF },
  // 2.1 S-21, one file per service group, two service years.
  { key: '2.1', section: 2, role: 'secretary', source: 'pdf', states: PDF },
  { key: '2.2', section: 2, role: 'secretary', source: 'pdf', states: PDF },
  {
    key: '2.3',
    section: 2,
    role: 'secretary',
    source: 'manual',
    states: MANUAL,
  },
  // 2.4 Hall operating committee accounts — when two or more congregations
  // use the hall AND this one is the contact congregation.
  {
    key: '2.4',
    section: 2,
    role: 'secretary',
    source: 'manual',
    states: MANUAL,
  },
  // 2.5 Contact details of every publisher — only in the file, never on a
  // screen.
  { key: '2.5', section: 2, role: 'secretary', source: 'pdf', states: PDF },
  {
    key: '3.1',
    section: 3,
    role: 'service_overseer',
    source: 'pdf',
    states: PDF,
  },
  // 3.2 S-28 — only for a congregation that coordinates literature orders.
  {
    key: '3.2',
    section: 3,
    role: 'service_overseer',
    source: 'manual',
    states: MANUAL,
  },
  {
    key: '3.3',
    section: 3,
    role: 'service_overseer',
    source: 'pdf',
    states: PDF,
  },
  {
    key: '3.4',
    section: 3,
    role: 'service_overseer',
    source: 'pdf',
    states: PDF,
  },
  {
    key: '3.5',
    section: 3,
    role: 'service_overseer',
    source: 'pdf',
    states: PDF,
    extra: true,
  },
  {
    key: '3.6',
    section: 3,
    role: 'service_overseer',
    source: 'pdf',
    states: PDF,
    extra: true,
  },
];

/** The fifteen questions of page 2; these four have only ДА / НЕТ. */
export const QUESTION_COUNT = 15;
export const YES_NO_ONLY = [1, 2, 10, 12] as const;

export function answerAllowed(q: number, answer: string): boolean {
  if (!Number.isInteger(q) || q < 1 || q > QUESTION_COUNT) return false;
  if (answer === 'yes' || answer === 'no') return true;
  return answer === 'na' && !(YES_NO_ONLY as readonly number[]).includes(q);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * «Не позднее вторника недели посещения» — the Tuesday of the week (Monday
 * to Sunday) the visit begins in.
 */
export function dueOn(visitStart: string): string {
  const dow = new Date(`${visitStart}T12:00:00Z`).getUTCDay(); // 0 Sun
  const fromMonday = (dow + 6) % 7;
  return addDays(visitStart, 1 - fromMonday);
}

/** The same day a calendar month earlier, clamped to the month's end. */
export function monthBefore(day: string, months = 1): string {
  const [y, m, d] = day.split('-').map(Number);
  const idx = y * 12 + (m - 1) - months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** The S-62 goes at least a month before the visit. */
export function s62DueOn(visitStart: string): string {
  return monthBefore(dueOn(visitStart), 1);
}

/** Reminders: the S-62 a month before its own date; the gaps a week ahead. */
export function s62RemindOn(visitStart: string): string {
  return monthBefore(s62DueOn(visitStart), 1);
}
export function gapsRemindOn(visitStart: string): string {
  return addDays(dueOn(visitStart), -7);
}

/** Page 2 is erased the day after the visit's last day. */
export function eraseOn(visitStart: string, visitEnd: string | null): string {
  return addDays(visitEnd ?? visitStart, 1);
}

/** An item is ready when marked, and a saved file still matches its data. */
export function isReady(
  state: FolderMarkState | null | undefined,
  changed: boolean,
): boolean {
  if (!state) return false;
  if (state === 'saved') return !changed;
  return true;
}

/** Whole days from `today` to `day` (negative once passed). */
export function daysUntil(today: string, day: string): number {
  return Math.round(
    (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) /
      86_400_000,
  );
}

export { addDays };
