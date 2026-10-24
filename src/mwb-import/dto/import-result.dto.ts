export interface WeekImportSummary {
  weekStartDate: string;
  weekEndDate: string;
  biblePassage: string;
  created: number;
  updated: number;
  skipped: number;
  /**
   * Set when the congregation holds no such meeting that week, so nothing of
   * the week was applied. `skipped` then counts every part that came in.
   */
  notHeld?: boolean;
  /**
   * Set when the week's programme is already the record — its meeting was
   * held more than a week ago — so nothing of it was applied (13 October
   * 2026). `skipped` then counts every part that came in.
   */
  frozen?: boolean;
}

/**
 * Something the person loading the file has to be told, as DATA.
 *
 * The same things used to travel only as finished English sentences in
 * `warnings`, and the screen printed them as they came — so a Russian or a
 * German congregation read «Week 2027-01-18: the congregation holds no
 * midweek meeting that week…» in the middle of its own language (5 October).
 * A sentence cannot be translated after the fact; its parts can. The screen
 * builds the sentence, in the reader's language, from these.
 *
 * `warnings` stays, word for word, for an app that has not updated yet.
 */
export type ImportNotice =
  | {
      /** The week holds no such meeting, so its parts were not applied. */
      code: 'meeting_not_held';
      weekStartDate: string;
      meeting: 'midweek' | 'weekend';
      /** How many parts came in for the week and were left out. */
      parts: number;
    }
  | {
      /**
       * The week's programme is already the record (its meeting was held
       * more than a week ago), so its parts were not applied.
       */
      code: 'week_frozen';
      weekStartDate: string;
      meeting: 'midweek' | 'weekend';
      parts: number;
      /** The last day it could still have been changed. */
      editableUntil: string;
    }
  | {
      /** A part with no recognised kind — left out. */
      code: 'unclassified_part';
      weekStartDate: string;
      title: string | null;
    }
  | {
      /**
       * Parts whose title a person had changed: their title was left as it
       * was (24 October 2026).
       */
      code: 'kept_by_hand';
      weekStartDate: string;
      parts: number;
    }
  | {
      /**
       * Empty numbered parts of a week made by hand that this workbook does
       * not have — removed, so they are not reported as missing.
       */
      code: 'empty_parts_removed';
      weekStartDate: string;
      parts: number;
    };

export interface ImportResultDto {
  epubFile: string;
  year: number;
  /** Weeks the file was APPLIED to; a week with no such meeting is not one. */
  weeksImported: number;
  partsCreated: number;
  partsUpdated: number;
  /** Parts left as they were: already filled, or of a meeting not held. */
  partsSkipped: number;
  unclassifiedParts: number;
  weeks: WeekImportSummary[];
  errors: string[];
  warnings: string[];
  notices: ImportNotice[];
}
