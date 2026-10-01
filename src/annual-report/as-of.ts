import type { AnnualPublisher, AnnualReportRow } from './annual-figures';

/**
 * THE REPORTS AS THEY STOOD AT A MOMENT THAT HAS PASSED.
 *
 * The annual report for 2025/26 went to the branch on 3 September 2026. By
 * the end of the month the app gave a different figure, and nobody could say
 * any longer what it had given on the day — the rule had changed in between,
 * and so had the data. This answers the data half: given every report row as
 * it is now, and the journal of what was done to them, it rebuilds the rows
 * as they were at a chosen moment, so the same arithmetic can be asked of
 * them.
 *
 * What is recoverable, and from where:
 *   - that a report existed — its createdAt;
 *   - that it was taken back or put back — DELETE / RESTORE in the journal;
 *   - what it said — its present values, with every later edit undone from
 *     the `before` the journal holds for it.
 * What is NOT, and is therefore reported as `unsure` rather than guessed:
 *   - a report filed again over one that had been taken back: the submission
 *     writes the new figures over the old row without a journal entry, so
 *     what the row said before is gone;
 *   - an edit whose journal entry was redacted (a person's right to erasure).
 */

/** A report row as stored, departed and deleted ones included. */
export interface StoredReport extends AnnualReportRow {
  id: string;
  createdAt: Date;
  submittedAt: Date;
  deletedAt: Date | null;
}

/** What the journal says was done to one report. */
export interface ReportJournalEntry {
  entityId: string;
  action: string;
  at: Date;
  /** The fields an UPDATE changed, as they were before it; null if redacted. */
  before: Record<string, unknown> | null;
}

/** Something entered AFTER the moment asked about that bears on the year. */
export interface LateFact {
  publisherId: string;
  kind:
    | 'report_filed'
    | 'report_changed'
    | 'report_withdrawn'
    | 'report_restored'
    | 'departure_entered'
    | 'card_created';
  /** When it was entered. */
  at: string;
  /** The report month it concerns, YYYY-MM-DD. */
  reportMonth?: string;
  /** For a departure: the day the person left, YYYY-MM-DD. */
  day?: string;
}

export interface UnsureReport {
  reportId: string;
  publisherId: string;
  reportMonth: string;
  why: 'refiled_over_withdrawn' | 'edit_redacted';
}

/**
 * A submission that restored a withdrawn row rewrites submittedAt and leaves
 * createdAt. A minute's grace keeps the two timestamps of one ordinary insert
 * — written a few milliseconds apart — from looking like that.
 */
const REFILE_GRACE_MS = 60_000;

const VALUE_FIELDS = ['servedThisMonth', 'hoursReported'] as const;

export function reportsAsOf(
  rows: StoredReport[],
  journal: ReportJournalEntry[],
  at: Date,
): {
  reports: AnnualReportRow[];
  unsure: UnsureReport[];
  late: LateFact[];
} {
  const t = at.getTime();
  const byReport = new Map<string, ReportJournalEntry[]>();
  for (const e of journal) {
    const list = byReport.get(e.entityId) ?? [];
    list.push(e);
    byReport.set(e.entityId, list);
  }

  const reports: AnnualReportRow[] = [];
  const unsure: UnsureReport[] = [];
  const late: LateFact[] = [];

  for (const row of rows) {
    const created = row.createdAt.getTime();
    const entries = (byReport.get(row.id) ?? [])
      .slice()
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const fact = (kind: LateFact['kind'], when: Date) =>
      late.push({
        publisherId: row.publisherId,
        kind,
        at: when.toISOString(),
        reportMonth: row.reportMonth,
      });

    if (created > t) {
      // Not there yet. Filed afterwards — and if it has since been withdrawn,
      // it never counted either way.
      if (!row.deletedAt) fact('report_filed', row.createdAt);
      continue;
    }

    // Withdrawn and put back, in order. A refiling over a withdrawn row puts
    // it back too, though the journal does not say so.
    const switches: { at: number; present: boolean }[] = entries
      .filter((e) => e.action === 'DELETE' || e.action === 'RESTORE')
      .map((e) => ({ at: e.at.getTime(), present: e.action === 'RESTORE' }));
    const refiledAt =
      row.submittedAt.getTime() - created > REFILE_GRACE_MS
        ? row.submittedAt.getTime()
        : null;
    if (refiledAt !== null) switches.push({ at: refiledAt, present: true });
    if (row.deletedAt && !entries.some((e) => e.action === 'DELETE')) {
      switches.push({ at: row.deletedAt.getTime(), present: false });
    }
    switches.sort((a, b) => a.at - b.at);

    let present = true;
    for (const s of switches) {
      if (s.at <= t) present = s.present;
    }
    for (const s of switches) {
      if (s.at > t) {
        fact(
          s.present ? 'report_restored' : 'report_withdrawn',
          new Date(s.at),
        );
      }
    }
    if (!present) continue;

    // What it said then: its present figures, with every later edit undone.
    // Undo from the earliest later edit, field by field — that edit's
    // `before` is the value that stood at the moment asked about.
    const value: AnnualReportRow = {
      publisherId: row.publisherId,
      reportMonth: row.reportMonth,
      servedThisMonth: row.servedThisMonth,
      hoursReported: row.hoursReported,
    };
    const undone = new Set<string>();
    let redacted = false;
    for (const e of entries) {
      if (e.action !== 'UPDATE' || e.at.getTime() <= t) continue;
      if (e.before === null) {
        redacted = true;
        continue;
      }
      let touched = false;
      for (const f of VALUE_FIELDS) {
        if (!(f in e.before) || undone.has(f)) continue;
        (value as unknown as Record<string, unknown>)[f] = e.before[f];
        undone.add(f);
        touched = true;
      }
      if (touched) fact('report_changed', e.at);
    }
    reports.push(value);

    if (refiledAt !== null && refiledAt > t) {
      unsure.push({
        reportId: row.id,
        publisherId: row.publisherId,
        reportMonth: row.reportMonth,
        why: 'refiled_over_withdrawn',
      });
    } else if (redacted) {
      unsure.push({
        reportId: row.id,
        publisherId: row.publisherId,
        reportMonth: row.reportMonth,
        why: 'edit_redacted',
      });
    }
  }

  return { reports, unsure, late };
}

/**
 * The cards as the app knew them at that moment: a card typed in later did
 * not exist yet, and a departure entered later had not been entered — the
 * person was still on the roll.
 */
export function publishersAsOf<P extends AnnualPublisher>(
  publishers: P[],
  at: Date,
): { publishers: P[]; late: LateFact[] } {
  const t = at.getTime();
  const out: P[] = [];
  const late: LateFact[] = [];
  for (const p of publishers) {
    const created = p.createdAt ? new Date(p.createdAt) : null;
    if (created && created.getTime() > t) {
      late.push({
        publisherId: p.id,
        kind: 'card_created',
        at: created.toISOString(),
      });
      continue;
    }
    const entered = p.deletedAt ? new Date(p.deletedAt) : null;
    if (entered && entered.getTime() > t) {
      late.push({
        publisherId: p.id,
        kind: 'departure_entered',
        at: entered.toISOString(),
        day: p.removedAt
          ? (p.removedAt instanceof Date
              ? p.removedAt.toISOString()
              : String(p.removedAt)
            ).slice(0, 10)
          : undefined,
      });
      out.push({ ...p, removedAt: null, deletedAt: null });
      continue;
    }
    out.push(p);
  }
  return { publishers: out, late };
}

/**
 * The last instant of a calendar day in the congregation's timezone — "as of
 * 3 September" means everything entered on the 3rd, wherever the server is.
 */
export function endOfLocalDay(day: string, timezone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d + 1);
  // How far ahead of UTC the congregation's clock is at that moment.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(midnightUtc));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
  );
  const offset = wall - midnightUtc;
  return new Date(midnightUtc - offset - 1);
}
