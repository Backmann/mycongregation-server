import { AnnualReportService } from './annual-report.service';
import { clockStub } from '../common/testing/clock-stub';
import { setNow, restoreNow } from '../common/testing/set-now';

const TENANT = 'cong-1';

/** A publisher who reported ministry in exactly these months (YYYY-MM). */
function reportsFor(pubId: string, months: string[]) {
  return months.map((m) => ({
    publisherId: pubId,
    reportMonth: `${m}-01`,
    servedThisMonth: true,
    hoursReported: null,
    bibleStudies: 0,
  }));
}

/**
 * Report rows for a publisher who is NOT on the roster, one per month across
 * the whole window the report reads.
 *
 * They exist so the congregation has a record for every month. Without them
 * the fixtures describe a congregation whose books begin the month its first
 * subject reported — and the report, quite rightly, refuses to call the empty
 * months before that silence. Real congregations look like the filler: eighty
 * reports a month, every month.
 */
function coverage(): unknown[] {
  const out: unknown[] = [];
  for (let y = 2026, m = 2; !(y === 2027 && m === 9); ) {
    out.push({
      publisherId: 'not-on-the-roster',
      reportMonth: `${y}-${String(m).padStart(2, '0')}-01`,
      servedThisMonth: true,
      hoursReported: null,
      bibleStudies: 0,
    });
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Exactly the rows given — for testing what happens with no coverage. */
function buildRaw(reports: unknown[], publishers: unknown[]) {
  return make(reports, publishers);
}

function build(reportsGiven: unknown[], publishers: unknown[]) {
  return make([...coverage(), ...reportsGiven], publishers);
}

function make(reports: unknown[], publishers: unknown[]) {
  const reportsRepo = { find: jest.fn().mockResolvedValue(reports) } as never;
  const publishersRepo = {
    find: jest.fn().mockResolvedValue(publishers),
  } as never;
  const service = new AnnualReportService(
    reportsRepo,
    publishersRepo,
    clockStub(),
  );
  return Object.assign(service, {
    __reportsRepo: reportsRepo,
  }) as AnnualReportService & { __reportsRepo: { find: jest.Mock } };
}

const pub = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  firstName: 'Иван',
  lastName: `Т${id}`,
  removedAt: null,
  isDeaf: false,
  isBlind: false,
  isImprisoned: false,
  ...extra,
});

describe('AnnualReportService — service year 2026/27', () => {
  // The year 2026/27 ends in August 2027, whose reports close on 20 September.
  // Standing after that date, every month of the year is a settled fact — which
  // is the only footing on which the figures below can be asserted at all. A
  // month that has not closed is not judged, so without freezing the clock
  // these tests would answer differently depending on the day they ran.
  beforeEach(() => setNow(Date.UTC(2027, 8, 25)));
  afterEach(() => restoreNow());

  it('asks the database for real dates, not bare months', async () => {
    // The months are handled as YYYY-MM throughout, but reportMonth is a date
    // column and Postgres cannot parse "2026-02" — the endpoint answered with
    // an error and the screen, which blamed permissions for anything that went
    // wrong, said the report was not available. A mocked repository could not
    // have shown it, so the query itself is checked here.
    const svc = build([], []);

    await svc.figures(TENANT, 2026);

    const where = svc.__reportsRepo.find.mock.calls[0][0].where;
    const bounds = (where.reportMonth as { value: string[] }).value;
    for (const b of bounds) {
      // A full calendar date, not a bare month.
      expect(b).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('counts as active anyone who reported at least once March–August', async () => {
    const svc = build(reportsFor('p1', ['2027-05']), [pub('p1')]);

    const out = await svc.figures(TENANT, 2026);

    expect(out.active.map((x) => x.id)).toEqual(['p1']);
  });

  it('does NOT count someone whose only months were before March', async () => {
    // THE DIVERGENCE THAT MATTERS. Reported faithfully September–February and
    // fell silent from March. The app's rolling status may well still call him
    // active; the annual report asks only about March–August, and there he is
    // absent. If this code ever reached for the status field instead of the
    // reports, this test would fail — which is exactly its job.
    const svc = build(
      reportsFor('p1', [
        '2026-09',
        '2026-10',
        '2026-11',
        '2026-12',
        '2027-01',
        '2027-02',
      ]),
      [pub('p1')],
    );

    const out = await svc.figures(TENANT, 2026);

    expect(out.active).toHaveLength(0);
  });

  it('counts becoming inactive when the sixth silent month falls in the year', async () => {
    // Last report February 2027; six silent months March–August, so the run
    // completes in August, inside the year.
    const svc = build(reportsFor('p1', ['2027-02']), [pub('p1')]);

    const out = await svc.figures(TENANT, 2026);

    expect(out.becameInactive.map((x) => x.id)).toEqual(['p1']);
    expect(out.becameInactive[0].month).toBe('2027-08');
  });

  it('judges nothing in a year that has not been collected yet', async () => {
    // The screen opens on the CURRENT service year. Standing in September
    // 2026, the year 2026/27 has three days of history and no reports at all —
    // and the figures used to answer that everybody had become inactive, dated
    // January 2027, with «Активные» empty. Months are judged only once their
    // collection window has closed.
    restoreNow();
    setNow(Date.UTC(2026, 8, 3));
    const svc = build(
      reportsFor('p1', ['2026-02', '2026-03', '2026-04', '2026-05']),
      [pub('p1')],
    );

    const out = await svc.figures(TENANT, 2026);

    expect(out.becameInactive).toHaveLength(0);
    expect(out.reactivated).toHaveLength(0);
  });

  it('stops at the last closed month part-way through a year', async () => {
    // 3 October 2027: August 2027 closed on 20 September, so the year is fully
    // judgeable. Move a month earlier and August is still being collected.
    restoreNow();
    setNow(Date.UTC(2027, 8, 3));
    const svc = build(reportsFor('p1', ['2027-02']), [pub('p1')]);

    const out = await svc.figures(TENANT, 2026);

    // Six silent months would complete in August 2027, but on 3 September
    // August has not closed — the run cannot be asserted yet.
    expect(out.becameInactive).toHaveLength(0);
  });

  it('does NOT count someone who lapsed in an earlier year and never returned', async () => {
    // The form says so in as many words, and it is the difference between a
    // true figure and counting the same person every September for years.
    const svc = build([], [pub('p1')]);

    const out = await svc.figures(TENANT, 2026);

    expect(out.becameInactive).toHaveLength(0);
  });

  it('counts someone who was inactive and reported again in the year', async () => {
    // Reported in February, fell silent for the best part of a year, and came
    // back in January. The February report matters: without a record BEFORE
    // the silence there is no silence to speak of, only a gap in what we hold.
    const svc = build(reportsFor('p1', ['2026-02', '2027-01']), [pub('p1')]);

    const out = await svc.figures(TENANT, 2026);

    expect(out.reactivated.map((x) => x.id)).toEqual(['p1']);
    expect(out.reactivated[0].month).toBe('2027-01');
  });

  it('does not call a first report a return from inactivity', async () => {
    // The bug Lionel found in production: eighty-two brothers who had served
    // for years were listed as having come back, because the app's records
    // begin where they do and everything before read as silence.
    const svc = build(reportsFor('p1', ['2027-03', '2027-04']), [pub('p1')]);

    const out = await svc.figures(TENANT, 2026);

    expect(out.reactivated).toHaveLength(0);
    // He is active all the same — that much the reports do say.
    expect(out.active.map((x) => x.id)).toEqual(['p1']);
  });

  it('does not call a publisher who transferred in a returning one', async () => {
    // He never stopped; he served in another congregation and moved here in
    // May. Our records start in May, and that is a fact about us, not him.
    const svc = build(reportsFor('p1', ['2027-05', '2027-06', '2027-07']), [
      pub('p1'),
    ]);

    const out = await svc.figures(TENANT, 2026);

    expect(out.reactivated).toHaveLength(0);
    expect(out.becameInactive).toHaveLength(0);
  });

  it('does not call it a return when the gap was shorter than six months', async () => {
    // Missed three months and came back. That is irregular, not a return from
    // inactivity, and counting it would inflate the figure.
    //
    // The run-up months matter here and the first draft of this test forgot
    // them: with nothing before September the publisher was, by the data,
    // silent for six months already, and the code was right to call February a
    // return. Reporting steadily into the year is what makes the gap a gap.
    const svc = build(
      reportsFor('p1', [
        '2026-03',
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
        '2026-10',
        // silent November, December, January — three months, not six
        '2027-02',
        '2027-03',
      ]),
      [pub('p1')],
    );

    const out = await svc.figures(TENANT, 2026);

    expect(out.reactivated).toHaveLength(0);
  });

  it('names the people behind every figure, not just how many', async () => {
    // A number a secretary cannot look into is a number they must take on
    // trust, and they are the one signing it.
    const svc = build(reportsFor('p1', ['2027-05']), [pub('p1')]);

    const out = await svc.figures(TENANT, 2026);

    expect(out.active[0].name).toBe('Тp1 Иван');
  });

  it('leaves out publishers who are no longer in the congregation', async () => {
    const svc = build(reportsFor('p1', ['2027-05']), [
      pub('p1', { removedAt: new Date('2027-06-01') }),
    ]);

    const out = await svc.figures(TENANT, 2026);

    expect(out.active).toHaveLength(0);
  });

  it('carries the circumstances the form asks about', async () => {
    const svc = build(
      [],
      [
        pub('p1', { isDeaf: true }),
        pub('p2', { isBlind: true, isImprisoned: true }),
      ],
    );

    const out = await svc.figures(TENANT, 2026);

    expect(out.deaf.map((x) => x.id)).toEqual(['p1']);
    expect(out.blind.map((x) => x.id)).toEqual(['p2']);
    expect(out.imprisoned.map((x) => x.id)).toEqual(['p2']);
  });
  it('says nothing about months the congregation has no records for', () => {
    // THE ONE THAT BIT. This congregation's books begin in September 2026:
    // there is not a single report row before it. Every publisher's first
    // report therefore follows six empty months, and the report used to read
    // that as six months of inactivity and call the whole congregation
    // «возобновившие» — two of them at first, and the rest as soon as their
    // cards were given a baptism date.
    const months: string[] = [];
    for (let y = 2026, m = 9; !(y === 2027 && m === 9); ) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      m += 1;
      if (m === 13) {
        m = 1;
        y += 1;
      }
    }
    const svc = buildRaw(
      [...reportsFor('p1', months), ...reportsFor('p2', months)],
      [
        pub('p1', { baptismDate: '2005-06-01' }),
        pub('p2', { ministryStartDate: '2010-03-01' }),
      ],
    );

    return (async () => {
      const out = await svc.figures(TENANT, 2026);
      expect(out.reactivated).toHaveLength(0);
      expect(out.becameInactive).toHaveLength(0);
      expect(out.active).toHaveLength(2);
    })();
  });

  it('lists who is inactive as things stand, apart from the form figure', () => {
    // Two questions, two answers. The form asks whose sixth silent month fell
    // inside the year and says not to count anyone who lapsed earlier and is
    // still lapsed. The elders ask who is inactive now. Somebody with no
    // report at all is the second and not the first.
    const svc = build([], [pub('p1', { baptismDate: '2005-06-01' })]);

    return (async () => {
      const out = await svc.figures(TENANT, 2026);
      expect(out.becameInactive).toHaveLength(0);
      expect(out.inactiveNow.map((x) => x.id)).toEqual(['p1']);
    })();
  });

  it('gives the reports-per-month figures rather than guessing who failed to report', () => {
    // The app cannot tell "did not share" from "not collected yet", so it
    // states the counts and lets the secretary read them. Filing on 2
    // September, August standing far below the rest is the signal.
    return (async () => {
      const svc = build(
        [
          ...reportsFor('p1', ['2027-07', '2027-08']),
          ...reportsFor('p2', ['2027-07']),
        ],
        [pub('p1'), pub('p2')],
      );

      const out = await svc.figures(TENANT, 2026);
      const july = out.monthlyReporters.find((m) => m.month === '2027-07-01');
      const august = out.monthlyReporters.find((m) => m.month === '2027-08-01');

      // Plus the filler above, who reports every month: the figure counts
      // reports, not roster members, which is exactly what it is for.
      expect(july?.count).toBe(3);
      expect(august?.count).toBe(2);
      expect(out.monthlyReporters).toHaveLength(12);
    })();
  });
});
