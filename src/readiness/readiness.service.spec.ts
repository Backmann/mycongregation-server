import { ReadinessService } from './readiness.service';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';

/**
 * The arithmetic, pinned. Which meetings a week holds is the week rules'
 * business and is tested there; here the rules are stubbed so that what is
 * being asserted is only what this module decides — what counts, what does
 * not, and what is merely reported.
 */

function build(opts: {
  meetings?: Record<string, { date: string; kind: 'midweek' | 'weekend' }[]>;
  assignments?: Record<string, unknown>[];
  duties?: Record<string, unknown>[];
}) {
  const assignmentsRepo = {
    find: () => Promise.resolve(opts.assignments ?? []),
  };
  const dutiesRepo = { find: () => Promise.resolve(opts.duties ?? []) };
  const weekRules = {
    forWeeks: (_c: string, weeks: string[]) => {
      const m = new Map();
      for (const w of weeks) m.set(w, { meetings: opts.meetings?.[w] ?? [] });
      return Promise.resolve(m);
    },
  };
  return new ReadinessService(
    assignmentsRepo as never,
    dutiesRepo as never,
    weekRules as never,
  );
}

const part = (p: Record<string, unknown>) => ({
  weekStartDate: '2026-09-14',
  eventType: EventType.MIDWEEK,
  status: AssignmentStatus.PUBLISHED,
  publisherId: 'p1',
  ...p,
});

const duty = (p: Record<string, unknown>) => ({
  weekStartDate: '2026-09-14',
  eventType: EventType.MIDWEEK,
  publisherId: 'p1',
  ...p,
});

const WEEK = '2026-09-14';
const MIDWEEK = { [WEEK]: [{ date: '2026-09-16', kind: 'midweek' as const }] };

describe('ReadinessService', () => {
  it('counts a part without a person as missing, and names it', async () => {
    const s = build({
      meetings: MIDWEEK,
      assignments: [
        part({ partKey: 'treasures_talk' }),
        part({ partKey: 'bible_reading', publisherId: null }),
      ],
    });
    const [week] = await s.forRange('c1', WEEK, '2026-09-21');
    expect(week.meetings[0].programme).toEqual({
      loaded: true,
      assigned: 1,
      total: 2,
      missing: ['bible_reading'],
    });
  });

  it('leaves songs out — nobody is assigned to them', async () => {
    const s = build({
      meetings: MIDWEEK,
      assignments: [
        part({ partKey: 'treasures_talk' }),
        part({ partKey: 'mid_song', publisherId: null }),
      ],
    });
    const [week] = await s.forRange('c1', WEEK, '2026-09-21');
    expect(week.meetings[0].programme.total).toBe(1);
    expect(week.meetings[0].programme.missing).toEqual([]);
  });

  it("leaves out the circuit overseer's service talk — he gives it himself", async () => {
    // Otherwise a visit week could never be complete.
    const s = build({
      meetings: MIDWEEK,
      assignments: [
        part({ partKey: 'treasures_talk' }),
        part({ partKey: 'co_service_talk', publisherId: null }),
      ],
    });
    const [week] = await s.forRange('c1', WEEK, '2026-09-21');
    expect(week.meetings[0].programme).toEqual({
      loaded: true,
      assigned: 1,
      total: 1,
      missing: [],
    });
  });

  it('ignores a cancelled row entirely', async () => {
    const s = build({
      meetings: MIDWEEK,
      assignments: [
        part({ partKey: 'treasures_talk' }),
        part({
          partKey: 'spiritual_gems',
          publisherId: null,
          status: AssignmentStatus.CANCELLED,
        }),
      ],
    });
    const [week] = await s.forRange('c1', WEEK, '2026-09-21');
    expect(week.meetings[0].programme.total).toBe(1);
  });

  it('counts a draft as assigned', async () => {
    const s = build({
      meetings: MIDWEEK,
      assignments: [
        part({ partKey: 'treasures_talk', status: AssignmentStatus.DRAFT }),
      ],
    });
    const [week] = await s.forRange('c1', WEEK, '2026-09-21');
    expect(week.meetings[0].programme.assigned).toBe(1);
  });

  it('says the programme is not loaded rather than calling an empty week ready', async () => {
    const s = build({ meetings: MIDWEEK, assignments: [] });
    const [week] = await s.forRange('c1', WEEK, '2026-09-21');
    expect(week.meetings[0].programme).toEqual({
      loaded: false,
      assigned: 0,
      total: 0,
      missing: [],
    });
  });

  it('reports the duties without judging them', async () => {
    // «То назначают, то нет» — an empty duty is not necessarily undone, so
    // there is no missing list and nothing is called short.
    const s = build({
      meetings: MIDWEEK,
      assignments: [part({ partKey: 'treasures_talk' })],
      duties: [
        duty({ dutyType: 'security' }),
        duty({ dutyType: 'ventilation', publisherId: null }),
      ],
    });
    const [week] = await s.forRange('c1', WEEK, '2026-09-21');
    expect(week.meetings[0].duties).toEqual({
      created: true,
      assigned: 1,
      total: 2,
    });
  });

  it('says duties were never generated rather than reporting 0 of 0', async () => {
    const s = build({
      meetings: MIDWEEK,
      assignments: [part({ partKey: 'x' })],
    });
    const [week] = await s.forRange('c1', WEEK, '2026-09-21');
    expect(week.meetings[0].duties.created).toBe(false);
  });

  it('a convention week has no meetings to be ready about', async () => {
    const s = build({ meetings: { [WEEK]: [] }, assignments: [] });
    const [week] = await s.forRange('c1', WEEK, '2026-09-21');
    expect(week.meetings).toEqual([]);
  });

  it('walks every week of the range, and keeps them in order', async () => {
    const s = build({ meetings: {}, assignments: [] });
    const weeks = await s.forRange('c1', '2026-09-07', '2026-09-28');
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
    ]);
  });

  it('refuses a range wider than a year rather than reading one', async () => {
    const s = build({ meetings: {}, assignments: [] });
    await expect(s.forRange('c1', '2020-01-06', '2026-01-06')).rejects.toThrow(
      /Range too wide/,
    );
  });

  it('keeps midweek and weekend apart', async () => {
    const s = build({
      meetings: {
        [WEEK]: [
          { date: '2026-09-16', kind: 'midweek' },
          { date: '2026-09-20', kind: 'weekend' },
        ],
      },
      assignments: [
        part({ partKey: 'treasures_talk' }),
        part({
          partKey: 'public_talk_speaker',
          eventType: EventType.WEEKEND,
          publisherId: null,
        }),
      ],
    });
    const [week] = await s.forRange('c1', WEEK, '2026-09-21');
    expect(week.meetings[0].programme.assigned).toBe(1);
    expect(week.meetings[1].programme.missing).toEqual(['public_talk_speaker']);
  });
});
