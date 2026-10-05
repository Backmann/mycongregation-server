/**
 * What a circuit visit HOLDS in its week, and what an import may not do to it.
 *
 * The visit rewrites the week once: it hides the Bible study, puts the
 * service talk in, adds an empty row for the closing song the overseer picks
 * himself and takes the workbook's song off the closing prayer. Everything it
 * did is written down on the event, so that taking the visit away puts the
 * week back.
 *
 * The import knew none of this. It matches rows by part key and rewrites any
 * row nobody is assigned to — and the visit's own song row has the SAME key
 * as the workbook's middle song (`mid_song`), and nobody assigned. So loading
 * the workbook a second time into a visit week (5 October, the January 2027
 * issue):
 *
 *   - turned the overseer's closing-song row into a second «Песня 64» in the
 *     middle of the meeting;
 *   - gave the closing prayer back the song the visit had removed;
 *   - and, at the weekend, would set the Watchtower study back to an hour.
 *
 * Nothing warned of it: the screen said «+2 ~13» and the week looked loaded.
 *
 * Two things follow, both here and both pure, so they can be tested without a
 * database: which rows and fields the visit holds (`heldFromOps`), and how to
 * put right a week an earlier import already spoiled (`mendPlan`).
 */

export type HeldField = 'partDurationMin' | 'speakerName' | 'partTitle';

export interface HeldByVisit {
  /** Rows the visit ADDED. They are its own; an import never matches them. */
  added: Set<string>;
  /** Fields the visit CHANGED on rows of the programme, by row id. */
  fields: Map<string, Set<HeldField>>;
  /**
   * Rows the visit HID — the Bible study and its reader, the Watchtower
   * reader. They are still the week's rows, only out of sight, and a workbook
   * part of that kind belongs on them, not on a new row beside them.
   */
  hidden: Set<string>;
}

export function nothingHeld(): HeldByVisit {
  return { added: new Set(), fields: new Map(), hidden: new Set() };
}

/** Reads the undo plan stored on a visit. Anything unrecognised is skipped. */
export function heldFromOps(ops: unknown, into: HeldByVisit = nothingHeld()) {
  if (!Array.isArray(ops)) return into;
  for (const raw of ops) {
    if (!raw || typeof raw !== 'object') continue;
    const op = raw as { op?: unknown; id?: unknown; field?: unknown };
    if (typeof op.id !== 'string') continue;
    if (op.op === 'added') into.added.add(op.id);
    if (op.op === 'deleted') into.hidden.add(op.id);
    if (
      op.op === 'field' &&
      (op.field === 'partDurationMin' ||
        op.field === 'speakerName' ||
        op.field === 'partTitle')
    ) {
      const set = into.fields.get(op.id) ?? new Set<HeldField>();
      set.add(op.field);
      into.fields.set(op.id, set);
    }
  }
  return into;
}

/** A part as the import is about to write it. */
export interface ImportedPart {
  partKey: string;
  partTitle: string | null;
  partOrder: number;
  durationMin: number | null;
}

/** As much of a programme row as the mending needs. */
export interface HeldRow {
  id: string;
  partKey: string;
  partTitle: string | null;
  partOrder: number;
  partDurationMin: number | null;
}

export interface Mend {
  id: string;
  partTitle?: null;
  partOrder?: number;
  partDurationMin?: number;
}

/** The song row the visit adds has the key of a song the publications print. */
const SONG_OF_PRAYER: Record<string, string> = {
  mid_song: 'midweek_closing_prayer',
  weekend_song: 'weekend_closing_prayer',
};
const WT_CONDUCTOR_KEY = 'watchtower_conductor';

/**
 * Puts right what an import did to a visit week BEFORE it learned to leave
 * the visit's rows alone.
 *
 * Deliberately narrow: a row is touched only when it carries, to the letter,
 * what the import would have written there — the same title AND the same
 * place for the song, the same title for the prayer, the same length for the
 * study. A song somebody chose, a title somebody typed, never match and are
 * never touched. Loading the same file once more is what triggers it, which
 * is also the only moment the import's own values are known.
 *
 * @param studyMinutes the length the visit gives the Watchtower study.
 */
export function mendPlan(
  rows: HeldRow[],
  held: HeldByVisit,
  parts: ImportedPart[],
  studyMinutes: number,
): Mend[] {
  const out: Mend[] = [];
  const imported = new Map(parts.map((p) => [p.partKey, p]));

  for (const row of rows) {
    const part = imported.get(row.partKey);
    if (!part) continue;

    // The overseer's song row, overwritten with the workbook's song.
    if (held.added.has(row.id) && SONG_OF_PRAYER[row.partKey]) {
      if (
        row.partTitle !== null &&
        row.partTitle === part.partTitle &&
        row.partOrder === part.partOrder
      ) {
        const prayer = rows.find(
          (r) =>
            r.partKey === SONG_OF_PRAYER[row.partKey] && !held.added.has(r.id),
        );
        out.push({
          id: row.id,
          partTitle: null,
          ...(prayer ? { partOrder: prayer.partOrder - 1 } : {}),
        });
      }
      continue;
    }

    const fields = held.fields.get(row.id);
    if (!fields) continue;
    const mend: Mend = { id: row.id };
    // The prayer given back the song the visit took off it.
    if (
      fields.has('partTitle') &&
      row.partTitle !== null &&
      row.partTitle === part.partTitle
    ) {
      mend.partTitle = null;
    }
    // The study set back to its ordinary length.
    if (
      fields.has('partDurationMin') &&
      row.partKey === WT_CONDUCTOR_KEY &&
      row.partDurationMin !== studyMinutes &&
      row.partDurationMin === part.durationMin
    ) {
      mend.partDurationMin = studyMinutes;
    }
    if (Object.keys(mend).length > 1) out.push(mend);
  }
  return out;
}
