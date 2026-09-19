import { WeekRulesService, WeekRulesContext } from './week-rules.service';

/**
 * What this service must guarantee, and what a caller could previously get
 * wrong on its own.
 */

/** Counts calls so «one set of queries for the whole range» can be asserted. */
function fakeRepos(opts: {
  versions?: {
    effectiveFrom: string;
    midweekDow: number;
    weekendDow: number;
  }[];
  events?: Record<string, unknown[]>;
}) {
  const calls = { settings: 0, events: 0 };
  const settingsRepo = {
    find: () => {
      calls.settings += 1;
      // Deliberately UNSORTED: the service must not depend on the query.
      return Promise.resolve(opts.versions ?? []);
    },
  };
  const eventsRepo = {
    find: (q: { where: unknown }) => {
      calls.events += 1;
      const where = Array.isArray(q.where) ? q.where[0] : q.where;
      const w = where as { type?: string; replacesMeeting?: boolean };
      const key = w.replacesMeeting ? 'flagged' : (w.type ?? 'other');
      return Promise.resolve(opts.events?.[key] ?? []);
    },
  };
  return { settingsRepo, eventsRepo, calls };
}

function makeService(opts: Parameters<typeof fakeRepos>[0]) {
  const { settingsRepo, eventsRepo, calls } = fakeRepos(opts);
  const service = new WeekRulesService(
    settingsRepo as never,
    eventsRepo as never,
  );
  return { service, calls };
}

describe('WeekRulesService', () => {
  it('sorts settings versions itself, whatever order the query returned', async () => {
    // Newest first — the order `versionForWeek` would read backwards.
    const { service } = makeService({
      versions: [
        { effectiveFrom: '2026-06-01', midweekDow: 4, weekendDow: 7 },
        { effectiveFrom: '2026-01-01', midweekDow: 3, weekendDow: 7 },
      ],
    });

    const rules = await service.forWeek('c1', '2026-09-14');

    // The version in force in September is the June one (Thursday), not the
    // January one that happened to be returned second.
    expect(rules.version?.effectiveFrom).toBe('2026-06-01');
    expect(rules.dowOf('midweek')).toBe(4);
  });

  it('answers a whole range on ONE set of queries', async () => {
    const { service, calls } = makeService({
      versions: [{ effectiveFrom: '2026-01-01', midweekDow: 3, weekendDow: 7 }],
    });

    const weeks = [
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
    ];
    const map = await service.forWeeks('c1', weeks);

    expect([...map.keys()]).toEqual(weeks);
    // Five weeks, still one settings query and four event queries.
    expect(calls.settings).toBe(1);
    expect(calls.events).toBe(4);
  });

  it('keys the range by the week starts it was given', async () => {
    const { service } = makeService({
      versions: [{ effectiveFrom: '2026-01-01', midweekDow: 3, weekendDow: 7 }],
    });
    const map = await service.forWeeks('c1', ['2026-09-14']);
    expect(map.get('2026-09-14')?.weekStart).toBe('2026-09-14');
  });

  it('returns a context with no versions rather than refusing — the caller decides', async () => {
    const { service } = makeService({ versions: [] });
    const ctx: WeekRulesContext = await service.contextOf('c1');
    expect(ctx.versions).toEqual([]);
    // Attendance refuses on this; duties carries on. Both read the same shape.
    const rules = service.rulesFrom(ctx, '2026-09-14');
    expect(rules.version).toBeNull();
    expect(rules.meetings).toEqual([]);
  });

  it('a convention week holds no meetings', async () => {
    const { service } = makeService({
      versions: [{ effectiveFrom: '2026-01-01', midweekDow: 3, weekendDow: 7 }],
      events: {
        regional_convention: [
          {
            date: '2026-09-18',
            endDate: '2026-09-20',
            type: 'regional_convention',
          },
        ],
      },
    });
    const rules = await service.forWeek('c1', '2026-09-14');
    expect(rules.meetingsHeld).toBe(false);
    expect(rules.meetings).toEqual([]);
  });

  it('a circuit visit moves the midweek meeting instead of cancelling it', async () => {
    const { service } = makeService({
      versions: [{ effectiveFrom: '2026-01-01', midweekDow: 3, weekendDow: 7 }],
      events: {
        circuit_overseer_visit: [
          {
            date: '2026-09-16',
            type: 'circuit_overseer_visit',
            coMidweekDow: 2,
          },
        ],
      },
    });
    const rules = await service.forWeek('c1', '2026-09-14');
    expect(rules.meetingsHeld).toBe(true);
    expect(rules.dowOf('midweek')).toBe(2);
    expect(rules.dateOf('midweek')).toBe('2026-09-15');
  });
});
