import { AnnualReportService } from './annual-report.service';

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

function build(reports: unknown[], publishers: unknown[]) {
  const reportsRepo = { find: jest.fn().mockResolvedValue(reports) } as never;
  const publishersRepo = {
    find: jest.fn().mockResolvedValue(publishers),
  } as never;
  const service = new AnnualReportService(reportsRepo, publishersRepo);
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

      expect(july?.count).toBe(2);
      expect(august?.count).toBe(1);
      expect(out.monthlyReporters).toHaveLength(12);
    })();
  });
});
