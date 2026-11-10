import { prepOptions, PrepFacts, MeetingFact } from './pair-prep-options';

/**
 * The moments two people of a part are offered to prepare it at
 * (10 November 2026). The part: Wednesday 25 November, 19:00; today Tuesday
 * 17 November, 10:00.
 */
const mw = (date: string, weekStart: string): MeetingFact => ({
  date,
  kind: 'midweek',
  time: '19:00',
  weekStart,
});
const we = (date: string, weekStart: string): MeetingFact => ({
  date,
  kind: 'weekend',
  time: '10:00',
  weekStart,
});

const facts = (over: Partial<PrepFacts> = {}): PrepFacts => ({
  today: '2026-11-17',
  nowMinutes: 10 * 60,
  part: mw('2026-11-25', '2026-11-23'),
  meetings: [
    mw('2026-11-18', '2026-11-16'),
    we('2026-11-22', '2026-11-16'),
    mw('2026-11-25', '2026-11-23'),
    we('2026-11-29', '2026-11-23'),
  ],
  services: [
    {
      id: '00000000-0000-0000-0000-000000000001',
      date: '2026-11-21',
      time: '09:30',
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      date: '2026-11-21',
      time: '11:00',
    },
  ],
  myDuties: new Set(),
  partnerDuties: new Set(),
  cleaningWeeks: new Set(),
  away: () => false,
  ...over,
});

const keys = (f: PrepFacts) => prepOptions(f).options.map((o) => o.key);

describe('prepOptions', () => {
  it('offers the meetings before the part in date order, the part’s own last but «self», and nothing after it', () => {
    expect(keys(facts())).toEqual([
      'after:2026-11-18:midweek',
      'service:00000000-0000-0000-0000-000000000001',
      'after:2026-11-22:weekend',
      'before:2026-11-25:midweek',
      'self',
    ]);
  });

  it('leaves out a meeting at which either of the two has a duty, and says why', () => {
    const r = prepOptions(
      facts({ partnerDuties: new Set(['2026-11-16|midweek']) }),
    );
    expect(r.options.map((o) => o.key)).not.toContain(
      'after:2026-11-18:midweek',
    );
    expect(r.hidden).toEqual([
      {
        date: '2026-11-18',
        kind: 'after',
        meeting: 'midweek',
        reason: 'partner_duty',
      },
    ]);
    expect(
      prepOptions(facts({ myDuties: new Set(['2026-11-23|midweek']) })).hidden,
    ).toEqual([
      {
        date: '2026-11-25',
        kind: 'before',
        meeting: 'midweek',
        reason: 'my_duty',
      },
    ]);
  });

  it('leaves out «after» the meetings of a week their group cleans after, but not «before»', () => {
    const r = prepOptions(facts({ cleaningWeeks: new Set(['2026-11-16']) }));
    expect(r.options.map((o) => o.key)).toEqual([
      'service:00000000-0000-0000-0000-000000000001',
      'before:2026-11-25:midweek',
      'self',
    ]);
    expect(r.hidden.map((x) => x.reason)).toEqual(['cleaning', 'cleaning']);
    // The week of the part itself: cleaning comes after it, «before» stays.
    const own = prepOptions(facts({ cleaningWeeks: new Set(['2026-11-23']) }));
    expect(own.options.map((o) => o.key)).toContain(
      'before:2026-11-25:midweek',
    );
  });

  it('leaves out a day either one is away, field service included', () => {
    const r = prepOptions(
      facts({ away: (d) => d >= '2026-11-20' && d <= '2026-11-22' }),
    );
    expect(r.options.map((o) => o.key)).toEqual([
      'after:2026-11-18:midweek',
      'before:2026-11-25:midweek',
      'self',
    ]);
    expect(r.hidden.map((x) => x.reason)).toEqual(['away', 'away', 'away']);
  });

  it('a meeting of today counts only until it begins', () => {
    const today = facts({
      today: '2026-11-18',
      nowMinutes: 18 * 60,
    });
    expect(keys(today)[0]).toBe('after:2026-11-18:midweek');
    expect(keys({ ...today, nowMinutes: 19 * 60 + 5 })[0]).not.toBe(
      'after:2026-11-18:midweek',
    );
  });

  it('one field service meeting a day, two days at most, the nearest to the part', () => {
    const services = [
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
    ].flatMap((date, i) => [
      { id: `00000000-0000-0000-0000-00000000010${i}`, date, time: '09:30' },
      { id: `00000000-0000-0000-0000-00000000020${i}`, date, time: '18:00' },
    ]);
    const s = prepOptions(facts({ services })).options.filter(
      (o) => o.kind === 'service',
    );
    expect(s.map((o) => o.date)).toEqual(['2026-11-20', '2026-11-21']);
    expect(s.map((o) => o.time)).toEqual(['09:30', '09:30']);
  });

  it('no further back than three weeks before the part', () => {
    const r = prepOptions(
      facts({
        today: '2026-10-20',
        meetings: [
          mw('2026-10-21', '2026-10-19'),
          mw('2026-11-04', '2026-11-02'),
          mw('2026-11-25', '2026-11-23'),
        ],
        services: [],
      }),
    );
    expect(r.options.map((o) => o.key)).toEqual([
      'after:2026-11-04:midweek',
      'before:2026-11-25:midweek',
      'self',
    ]);
  });

  it('«self» is always there, even when no moment is left', () => {
    expect(
      keys(facts({ today: '2026-11-25', nowMinutes: 20 * 60, services: [] })),
    ).toEqual(['self']);
  });
});
