import { AnnualReportService } from './annual-report.service';
import { endOfLocalDay, publishersAsOf, reportsAsOf } from './as-of';
import { clockStub } from '../common/testing/clock-stub';
import { setNow, restoreNow } from '../common/testing/set-now';

const TENANT = 'cong-1';

/** A stored report, filed at `filed` and unchanged since unless told. */
function row(
  id: string,
  publisherId: string,
  month: string,
  filed: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    publisherId,
    reportMonth: `${month}-01`,
    servedThisMonth: true,
    hoursReported: null,
    bibleStudies: 0,
    createdAt: new Date(filed),
    submittedAt: new Date(filed),
    deletedAt: null,
    ...extra,
  };
}

describe('reportsAsOf — the reports as they stood on a past day', () => {
  const at = new Date('2026-09-03T21:59:59.999Z');

  it('leaves out a report filed afterwards, and says so', () => {
    const out = reportsAsOf(
      [row('r1', 'p1', '2026-08', '2026-09-12T08:00:00Z')],
      [],
      at,
    );

    expect(out.reports).toHaveLength(0);
    expect(out.late).toEqual([
      expect.objectContaining({
        publisherId: 'p1',
        kind: 'report_filed',
        reportMonth: '2026-08-01',
      }),
    ]);
  });

  it('undoes a later edit from the journal', () => {
    const out = reportsAsOf(
      [row('r1', 'p1', '2026-05', '2026-06-02T08:00:00Z')],
      [
        {
          entityId: 'r1',
          action: 'UPDATE',
          at: new Date('2026-09-10T08:00:00Z'),
          before: { servedThisMonth: false },
        },
      ],
      at,
    );

    expect(out.reports[0].servedThisMonth).toBe(false);
    expect(out.late.map((f) => f.kind)).toEqual(['report_changed']);
  });

  it('takes the earliest later edit when a field changed twice', () => {
    const out = reportsAsOf(
      [
        row('r1', 'p1', '2026-05', '2026-06-02T08:00:00Z', {
          hoursReported: 9,
        }),
      ],
      [
        {
          entityId: 'r1',
          action: 'UPDATE',
          at: new Date('2026-09-20T08:00:00Z'),
          before: { hoursReported: 5 },
        },
        {
          entityId: 'r1',
          action: 'UPDATE',
          at: new Date('2026-09-10T08:00:00Z'),
          before: { hoursReported: 2 },
        },
      ],
      at,
    );

    expect(out.reports[0].hoursReported).toBe(2);
  });

  it('keeps an edit made before the day', () => {
    const out = reportsAsOf(
      [row('r1', 'p1', '2026-05', '2026-06-02T08:00:00Z')],
      [
        {
          entityId: 'r1',
          action: 'UPDATE',
          at: new Date('2026-08-10T08:00:00Z'),
          before: { servedThisMonth: false },
        },
      ],
      at,
    );

    expect(out.reports[0].servedThisMonth).toBe(true);
  });

  it('counts a report withdrawn later — it was there on the day', () => {
    const out = reportsAsOf(
      [
        row('r1', 'p1', '2026-05', '2026-06-02T08:00:00Z', {
          deletedAt: new Date('2026-09-15T08:00:00Z'),
        }),
      ],
      [
        {
          entityId: 'r1',
          action: 'DELETE',
          at: new Date('2026-09-15T08:00:00Z'),
          before: null,
        },
      ],
      at,
    );

    expect(out.reports).toHaveLength(1);
    expect(out.late.map((f) => f.kind)).toEqual(['report_withdrawn']);
  });

  it('does not count a report withdrawn before the day and put back after', () => {
    const out = reportsAsOf(
      [row('r1', 'p1', '2026-05', '2026-06-02T08:00:00Z')],
      [
        {
          entityId: 'r1',
          action: 'DELETE',
          at: new Date('2026-08-15T08:00:00Z'),
          before: null,
        },
        {
          entityId: 'r1',
          action: 'RESTORE',
          at: new Date('2026-09-15T08:00:00Z'),
          before: null,
        },
      ],
      at,
    );

    expect(out.reports).toHaveLength(0);
    expect(out.late.map((f) => f.kind)).toEqual(['report_restored']);
  });

  it('counts a deleted row with no journal entry as gone from its deletion', () => {
    const out = reportsAsOf(
      [
        row('r1', 'p1', '2026-05', '2026-06-02T08:00:00Z', {
          deletedAt: new Date('2026-07-01T08:00:00Z'),
        }),
      ],
      [],
      at,
    );

    expect(out.reports).toHaveLength(0);
  });

  it('names a report refiled over a withdrawn one rather than guessing its figures', () => {
    // A new submission writes over the withdrawn row without a journal entry;
    // what the row said before is gone, so it is named, not invented.
    const out = reportsAsOf(
      [
        row('r1', 'p1', '2026-05', '2026-06-02T08:00:00Z', {
          submittedAt: new Date('2026-09-20T08:00:00Z'),
        }),
      ],
      [],
      at,
    );

    expect(out.reports).toHaveLength(1);
    expect(out.unsure).toEqual([
      expect.objectContaining({
        reportId: 'r1',
        why: 'refiled_over_withdrawn',
      }),
    ]);
  });

  it('names a report whose later edit was redacted', () => {
    const out = reportsAsOf(
      [row('r1', 'p1', '2026-05', '2026-06-02T08:00:00Z')],
      [
        {
          entityId: 'r1',
          action: 'UPDATE',
          at: new Date('2026-09-10T08:00:00Z'),
          before: null,
        },
      ],
      at,
    );

    expect(out.unsure.map((u) => u.why)).toEqual(['edit_redacted']);
  });
});

describe('publishersAsOf — the roll as it stood on a past day', () => {
  const at = new Date('2026-09-03T21:59:59.999Z');
  const card = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    appointment: 'publisher',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    removedAt: null,
    deletedAt: null,
    ...extra,
  });

  it('puts back on the roll somebody whose departure was entered later', () => {
    const out = publishersAsOf(
      [
        card('p1', {
          removedAt: new Date('2026-08-12'),
          deletedAt: new Date('2026-09-27T10:00:00Z'),
        }),
      ],
      at,
    );

    expect(out.publishers[0].removedAt).toBeNull();
    expect(out.late).toEqual([
      expect.objectContaining({
        publisherId: 'p1',
        kind: 'departure_entered',
        day: '2026-08-12',
      }),
    ]);
  });

  it('keeps a departure entered before the day', () => {
    const out = publishersAsOf(
      [
        card('p1', {
          removedAt: new Date('2026-08-12'),
          deletedAt: new Date('2026-08-13T10:00:00Z'),
        }),
      ],
      at,
    );

    expect(out.publishers[0].removedAt).toEqual(new Date('2026-08-12'));
    expect(out.late).toHaveLength(0);
  });

  it('leaves out a card typed in afterwards', () => {
    const out = publishersAsOf(
      [card('p1', { createdAt: new Date('2026-09-10T10:00:00Z') })],
      at,
    );

    expect(out.publishers).toHaveLength(0);
    expect(out.late.map((f) => f.kind)).toEqual(['card_created']);
  });
});

describe('endOfLocalDay', () => {
  it('ends a Berlin summer day at 22:00 UTC', () => {
    expect(endOfLocalDay('2026-09-03', 'Europe/Berlin').toISOString()).toBe(
      '2026-09-03T21:59:59.999Z',
    );
  });

  it('ends a Berlin winter day at 23:00 UTC', () => {
    expect(endOfLocalDay('2026-12-03', 'Europe/Berlin').toISOString()).toBe(
      '2026-12-03T22:59:59.999Z',
    );
  });
});

describe('AnnualReportService.figuresAsOf — the year as the data stood', () => {
  beforeEach(() => setNow(Date.UTC(2026, 9, 1, 12)));
  afterEach(() => restoreNow());

  /** A report for every month, so the year is covered as a real one is. */
  function coverage() {
    const out: ReturnType<typeof row>[] = [];
    for (let y = 2025, m = 2; !(y === 2026 && m === 9); ) {
      const month = `${y}-${String(m).padStart(2, '0')}`;
      out.push(row(`c-${month}`, 'filler', month, `${month}-25T08:00:00Z`));
      m += 1;
      if (m === 13) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  function service(reports: unknown[], cards: unknown[], journal: unknown[]) {
    return new AnnualReportService(
      { find: jest.fn().mockResolvedValue(reports) } as never,
      { find: jest.fn().mockResolvedValue(cards) } as never,
      { find: jest.fn().mockResolvedValue(journal) } as never,
      clockStub(),
    );
  }

  const card = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    firstName: 'Иван',
    lastName: id,
    appointment: 'publisher',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    removedAt: null,
    deletedAt: null,
    isDeaf: false,
    isBlind: false,
    isImprisoned: false,
    ...extra,
  });

  it('answers what the data said on the day the report went out', async () => {
    const svc = service(
      [
        ...coverage(),
        // Reported only for August, and late — after the report went out.
        row('late', 'p-late', '2026-08', '2026-09-12T08:00:00Z'),
        // Left on 1 September, entered on the 27th: in the year either way.
        row('mover', 'p-mover', '2026-06', '2026-07-03T08:00:00Z'),
        // His one report was corrected from «did not share» afterwards.
        row('fixed', 'p-fixed', '2026-05', '2026-06-03T08:00:00Z'),
      ],
      [
        card('filler'),
        card('p-late'),
        card('p-mover', {
          removedAt: new Date('2026-09-01'),
          deletedAt: new Date('2026-09-27T10:00:00Z'),
        }),
        card('p-fixed'),
      ],
      [
        {
          entityId: 'fixed',
          action: 'UPDATE',
          createdAt: new Date('2026-09-10T08:00:00Z'),
          beforeJson: JSON.stringify({ servedThisMonth: false }),
        },
      ],
    );

    const then = await svc.figuresAsOf(TENANT, 2025, '2026-09-03');
    const now = await svc.figures(TENANT, 2025);

    expect(then.active.map((x) => x.id).sort()).toEqual(['filler', 'p-mover']);
    expect(now.active.map((x) => x.id).sort()).toEqual([
      'filler',
      'p-fixed',
      'p-late',
      'p-mover',
    ]);
    expect(then.late.map((f) => [f.publisherId, f.kind])).toEqual([
      ['p-fixed', 'report_changed'],
      ['p-late', 'report_filed'],
      ['p-mover', 'departure_entered'],
    ]);
  });

  it('judges only the months that had closed on that day', async () => {
    // His last report was for February. Six silent months run out in August —
    // but on 3 September August was still being collected, so nobody could
    // have said so yet. By October they can.
    const svc = service(
      [
        ...coverage(),
        row('feb', 'p-quiet', '2026-02', '2026-03-05T08:00:00Z'),
        row('jan', 'p-quiet', '2026-01', '2026-02-05T08:00:00Z'),
      ],
      [card('filler'), card('p-quiet', { baptismDate: '2010-01-01' })],
      [],
    );

    const then = await svc.figuresAsOf(TENANT, 2025, '2026-09-03');
    const now = await svc.figures(TENANT, 2025);

    expect(then.asOf).toBe('2026-09-03');
    expect(then.becameInactive).toHaveLength(0);
    expect(now.becameInactive).toEqual([
      expect.objectContaining({ id: 'p-quiet', month: '2026-08' }),
    ]);
  });
});
