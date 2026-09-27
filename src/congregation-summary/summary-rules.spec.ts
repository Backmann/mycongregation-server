import {
  absencesSummary,
  cleaningSummary,
  nextMeetingDuties,
  programmeSummary,
} from './summary-rules';
import type { WeekReadiness } from '../readiness/readiness.service';

const meeting = (
  date: string,
  kind: 'midweek' | 'weekend',
  programme: { loaded: boolean; assigned: number; total: number },
  duties = { created: true, assigned: 6, total: 8 },
) => ({ date, kind, programme: { ...programme, missing: [] }, duties });

const WEEKS: WeekReadiness[] = [
  {
    weekStart: '2026-09-21',
    meetings: [
      meeting('2026-09-23', 'midweek', { loaded: true, assigned: 5, total: 9 }),
      meeting(
        '2026-09-27',
        'weekend',
        { loaded: true, assigned: 7, total: 7 },
        { created: true, assigned: 4, total: 8 },
      ),
    ],
  },
  {
    weekStart: '2026-09-28',
    meetings: [
      meeting('2026-09-30', 'midweek', { loaded: true, assigned: 8, total: 9 }),
      meeting('2026-10-04', 'weekend', { loaded: true, assigned: 7, total: 7 }),
    ],
  },
  // A convention week holds no meetings.
  { weekStart: '2026-10-05', meetings: [] },
  {
    weekStart: '2026-10-12',
    meetings: [
      meeting('2026-10-14', 'midweek', {
        loaded: false,
        assigned: 0,
        total: 0,
      }),
      meeting('2026-10-18', 'weekend', { loaded: true, assigned: 6, total: 7 }),
    ],
  },
];

describe('programmeSummary', () => {
  it('counts the loaded meetings still short of a person, from today on', () => {
    // 23 September has passed: its missing parts no longer count.
    expect(programmeSummary(WEEKS, '2026-09-27')).toEqual({
      windowWeeks: 8,
      notReady: 2,
      loadedUntil: '2026-10-18',
    });
  });

  it('does not call a meeting unready whose programme is not imported', () => {
    const only = [
      { weekStart: '2026-10-12', meetings: [WEEKS[3].meetings[0]] },
    ];
    expect(programmeSummary(only, '2026-09-27')).toEqual({
      windowWeeks: 8,
      notReady: 0,
      loadedUntil: null,
    });
  });
});

describe('nextMeetingDuties', () => {
  it('is the next meeting from today, today included', () => {
    expect(nextMeetingDuties(WEEKS, '2026-09-27')).toEqual({
      date: '2026-09-27',
      kind: 'weekend',
      assigned: 4,
      total: 8,
    });
  });

  it('skips a week without meetings', () => {
    expect(nextMeetingDuties(WEEKS, '2026-10-05')?.date).toBe('2026-10-14');
  });

  it('is null when nothing lies ahead', () => {
    expect(nextMeetingDuties(WEEKS, '2026-11-01')).toBeNull();
  });
});

describe('absencesSummary', () => {
  const rows = [
    { publisherId: 'a', startDate: '2026-09-20', endDate: '2026-09-30' },
    // Two records of one person over one evening (pioneer school duties).
    { publisherId: 'b', startDate: '2026-09-27', endDate: null },
    { publisherId: 'b', startDate: '2026-09-27', endDate: null },
    { publisherId: 'me', startDate: '2026-10-10', endDate: '2026-10-12' },
    { publisherId: 'me', startDate: '2026-11-01', endDate: null },
  ];

  it('counts people away today once each, for those who read all', () => {
    expect(absencesSummary(rows, '2026-09-27', true, 'me')).toEqual({
      readAll: true,
      awayNow: 2,
      mine: { startDate: '2026-10-10', endDate: '2026-10-12' },
    });
  });

  it('says nothing of others to those who read only their own', () => {
    const own = rows.filter((r) => r.publisherId === 'me');
    expect(absencesSummary(own, '2026-09-27', false, 'me')).toEqual({
      readAll: false,
      awayNow: null,
      mine: { startDate: '2026-10-10', endDate: '2026-10-12' },
    });
  });

  it('has no own period for a login without a card', () => {
    expect(absencesSummary(rows, '2026-09-27', true, null).mine).toBeNull();
  });
});

describe('cleaningSummary', () => {
  const names: Record<string, string> = { g1: 'Ahlen', g2: 'Hamm' };
  const rows = [
    {
      weekStartDate: '2026-09-28',
      slotType: 'after_meeting',
      serviceGroupId: 'g2',
      thoroughPlannedAt: null,
    },
    {
      weekStartDate: '2026-09-28',
      slotType: 'thorough',
      serviceGroupId: 'g1',
      thoroughPlannedAt: new Date('2026-10-01T16:00:00Z'),
    },
    {
      weekStartDate: '2026-10-12',
      slotType: 'after_meeting',
      serviceGroupId: 'g1',
      thoroughPlannedAt: null,
    },
  ];

  it('names this week’s groups and the person’s own next cleaning', () => {
    expect(
      cleaningSummary(
        rows,
        (id) => names[id] ?? null,
        '2026-09-28',
        'g1',
        true,
      ),
    ).toEqual({
      thisWeek: { afterMeeting: 'Hamm', thorough: 'Ahlen', meetingsHeld: true },
      mine: {
        weekStart: '2026-09-28',
        slot: 'thorough',
        plannedAt: '2026-10-01T16:00:00.000Z',
      },
    });
  });

  it('has no own cleaning without a group', () => {
    expect(
      cleaningSummary(rows, (id) => names[id] ?? null, '2026-09-28', null, true)
        .mine,
    ).toBeNull();
  });

  it('within one week the cleaning after the meetings comes first', () => {
    const both = [
      {
        weekStartDate: '2026-10-05',
        slotType: 'thorough',
        serviceGroupId: 'g1',
        thoroughPlannedAt: null,
      },
      {
        weekStartDate: '2026-10-05',
        slotType: 'after_meeting',
        serviceGroupId: 'g1',
        thoroughPlannedAt: null,
      },
    ];
    expect(
      cleaningSummary(both, (id) => names[id] ?? null, '2026-09-28', 'g1', true)
        .mine?.slot,
    ).toBe('after_meeting');
  });
});
