import { weekRules, isoDowOf } from './week-rules';

// Monday 2026-04-06. Midweek meeting Thursday (dow 4), weekend Sunday (dow 7).
const WEEK = '2026-04-06';
const VERSIONS = [
  { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
];

const rules = (events: Parameters<typeof weekRules>[0]['events']) =>
  weekRules({ weekStart: WEEK, versions: VERSIONS, events });

describe('an ordinary week', () => {
  it('holds both meetings on the days the settings name', () => {
    const r = rules([]);
    expect(r.meetings).toEqual([
      { date: '2026-04-09', kind: 'midweek' }, // Thursday
      { date: '2026-04-12', kind: 'weekend' }, // Sunday
    ]);
    expect(r.meetingsHeld).toBe(true);
  });
});

describe('a convention or assembly week', () => {
  // This is the case the old server rule got wrong. It asked whether the event
  // covered the MEETING'S date, so a Friday-to-Sunday convention left the
  // Thursday midweek meeting standing and the secretary was asked to record
  // attendance at a meeting nobody held.
  it('holds no meetings at all when a three-day convention covers only the weekend', () => {
    const r = rules([
      {
        type: 'regional_convention',
        date: '2026-04-10',
        endDate: '2026-04-12',
      },
    ]);
    expect(r.meetings).toEqual([]);
    expect(r.meetingsHeld).toBe(false);
  });

  it('holds no meetings at all when a one-day assembly falls on the Saturday', () => {
    // Neither the Thursday nor the Sunday meeting is covered by the Saturday,
    // so the old rule kept BOTH of them.
    const r = rules([{ type: 'circuit_assembly', date: '2026-04-11' }]);
    expect(r.meetings).toEqual([]);
    expect(r.meetingsHeld).toBe(false);
  });

  it('names the days the congress itself covers, for whoever needs them', () => {
    const r = rules([
      {
        type: 'regional_convention',
        date: '2026-04-10',
        endDate: '2026-04-12',
      },
    ]);
    expect(r.congressDays).toEqual(['2026-04-10', '2026-04-11', '2026-04-12']);
  });

  it('cancels the week even when the convention only reaches into it', () => {
    // Convention running from the previous week into Monday and Tuesday.
    const r = rules([
      {
        type: 'regional_convention',
        date: '2026-04-03',
        endDate: '2026-04-07',
      },
    ]);
    expect(r.meetingsHeld).toBe(false);
  });
});

describe('the Memorial', () => {
  it('takes the midweek meeting when it falls on a weekday, whatever day that meeting is', () => {
    // Wednesday, while the midweek meeting is a Thursday.
    const r = rules([{ type: 'memorial', date: '2026-04-08' }]);
    expect(r.memorialTakes).toBe('midweek');
    expect(r.meetings).toEqual([{ date: '2026-04-12', kind: 'weekend' }]);
  });

  it('takes the weekend meeting when it falls at the weekend', () => {
    // Saturday, while the weekend meeting is a Sunday.
    const r = rules([{ type: 'memorial', date: '2026-04-11' }]);
    expect(r.memorialTakes).toBe('weekend');
    expect(r.meetings).toEqual([{ date: '2026-04-09', kind: 'midweek' }]);
  });

  it('takes nothing in a convention week — there is nothing left to take', () => {
    const r = rules([
      { type: 'memorial', date: '2026-04-08' },
      {
        type: 'regional_convention',
        date: '2026-04-10',
        endDate: '2026-04-12',
      },
    ]);
    expect(r.meetings).toEqual([]);
  });

  it('is ignored when it falls outside the week', () => {
    const r = rules([{ type: 'memorial', date: '2026-04-15' }]);
    expect(r.memorialTakes).toBeNull();
    expect(r.meetings).toHaveLength(2);
  });
});

describe('a circuit-overseer visit', () => {
  it('moves the midweek meeting to Tuesday by default and leaves the weekend alone', () => {
    const r = rules([{ type: 'circuit_overseer_visit', date: '2026-04-06' }]);
    expect(r.meetings).toEqual([
      { date: '2026-04-07', kind: 'midweek' }, // Tuesday
      { date: '2026-04-12', kind: 'weekend' },
    ]);
  });

  it('follows the day recorded on the visit rather than the default', () => {
    const r = rules([
      { type: 'circuit_overseer_visit', date: '2026-04-06', coMidweekDow: 3 },
    ]);
    expect(r.dateOf('midweek')).toBe('2026-04-08'); // Wednesday
  });

  it('still gives the midweek meeting to a weekday Memorial, and keeps the moved day for nothing', () => {
    // Both in one week: the visit moves the midweek meeting, the Memorial then
    // takes it. The weekend meeting is held as usual.
    const r = rules([
      { type: 'circuit_overseer_visit', date: '2026-04-06' },
      { type: 'memorial', date: '2026-04-08' },
    ]);
    expect(r.dateOf('midweek')).toBe('2026-04-07');
    expect(r.meetings).toEqual([{ date: '2026-04-12', kind: 'weekend' }]);
  });
});

describe('missing settings', () => {
  it('holds nothing when no version is recorded', () => {
    expect(
      weekRules({ weekStart: WEEK, versions: [], events: [] }).meetings,
    ).toEqual([]);
  });

  it('skips a meeting whose weekday is not set', () => {
    const r = weekRules({
      weekStart: WEEK,
      versions: [
        { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: null },
      ],
      events: [],
    });
    expect(r.meetings).toEqual([{ date: '2026-04-09', kind: 'midweek' }]);
  });
});

describe('isoDowOf', () => {
  it('counts Monday as 1 and Sunday as 7', () => {
    expect(isoDowOf('2026-04-06')).toBe(1);
    expect(isoDowOf('2026-04-12')).toBe(7);
  });
});

describe('an event flagged «в этот день обычной встречи нет»', () => {
  it('takes the meeting whose day it covers', () => {
    // Special talk on the Thursday — the midweek meeting's own day.
    const r = rules([
      { type: 'special_talk', date: '2026-04-09', replacesMeeting: true },
    ]);
    expect(r.meetings).toEqual([{ date: '2026-04-12', kind: 'weekend' }]);
  });

  it('takes nothing when it falls on a day no meeting uses', () => {
    // Saturday, while the weekend meeting is the Sunday. Unlike the Memorial,
    // an ordinary event does not stand in for "the weekend" as a whole.
    const r = rules([
      { type: 'special_talk', date: '2026-04-11', replacesMeeting: true },
    ]);
    expect(r.meetings).toHaveLength(2);
    expect(r.replacedBy('weekend')).toBeNull();
  });

  it('covers a meeting inside a multi-day event', () => {
    const r = rules([
      {
        type: 'other',
        date: '2026-04-08',
        endDate: '2026-04-10',
        replacesMeeting: true,
      },
    ]);
    expect(r.replacedBy('midweek')).not.toBeNull();
    expect(r.meetings).toEqual([{ date: '2026-04-12', kind: 'weekend' }]);
  });

  it('is ignored when the flag is not set', () => {
    const r = rules([{ type: 'special_talk', date: '2026-04-09' }]);
    expect(r.meetings).toHaveLength(2);
  });

  it('does not judge a second time an event that has a rule of its own', () => {
    // A Memorial carrying the flag as well: it goes by the KIND OF DAY, so the
    // Saturday Memorial takes the Sunday weekend meeting and leaves the
    // midweek one — the flag must not additionally remove anything.
    const r = rules([
      { type: 'memorial', date: '2026-04-11', replacesMeeting: true },
    ]);
    expect(r.meetings).toEqual([{ date: '2026-04-09', kind: 'midweek' }]);
  });

  it('does not cancel the midweek meeting a circuit visit merely moved', () => {
    const r = rules([
      {
        type: 'circuit_overseer_visit',
        date: '2026-04-07',
        replacesMeeting: true,
      },
    ]);
    expect(r.meetings).toEqual([
      { date: '2026-04-07', kind: 'midweek' },
      { date: '2026-04-12', kind: 'weekend' },
    ]);
  });

  it('has nothing to take in a convention week', () => {
    const r = rules([
      { type: 'special_talk', date: '2026-04-09', replacesMeeting: true },
      {
        type: 'regional_convention',
        date: '2026-04-10',
        endDate: '2026-04-12',
      },
    ]);
    expect(r.meetings).toEqual([]);
  });
});
