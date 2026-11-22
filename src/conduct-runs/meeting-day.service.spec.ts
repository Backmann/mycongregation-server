import { MeetingDayService } from './meeting-day.service';

/** Whether a week's midweek meeting is over — its day passed (16 October 2026). */
function build(meetings: { date: string; kind: string }[], today: string) {
  const weekRules = {
    contextOf: jest.fn(async () => ({})),
    rulesFrom: jest.fn(() => ({ meetings })),
  };
  const clock = { todayFor: jest.fn(async () => today) };
  return new MeetingDayService(weekRules as never, clock as never);
}

describe('MeetingDayService', () => {
  const week = '2026-10-12';
  const held = [
    { date: '2026-10-14', kind: 'midweek' },
    { date: '2026-10-18', kind: 'weekend' },
  ];

  it('the day itself is not over — the meeting is that evening', async () => {
    expect(await build(held, '2026-10-14').isOver('c1', week)).toBe(false);
  });

  it('the day after, it is', async () => {
    expect(await build(held, '2026-10-15').isOver('c1', week)).toBe(true);
  });

  it('before the day, it is not', async () => {
    expect(await build(held, '2026-10-12').isOver('c1', week)).toBe(false);
  });

  it('a week with no midweek meeting has nothing to be over', async () => {
    const svc = build([{ date: '2026-10-18', kind: 'weekend' }], '2026-10-30');
    expect(await svc.isOver('c1', week)).toBe(false);
    expect(await svc.midweekDate('c1', week)).toBeNull();
  });

  it('the weekend meeting has a day of its own (18 October 2026)', async () => {
    // Monday after Wednesday's meeting: the midweek one is over, Sunday's not.
    const svc = build(held, '2026-10-15');
    expect(await svc.isOver('c1', week, 'weekend' as never)).toBe(false);
    expect(await svc.isOver('c1', week)).toBe(true);
    expect(
      await build(held, '2026-10-19').isOver('c1', week, 'weekend' as never),
    ).toBe(true);
    expect(await svc.meetingDate('c1', week, 'weekend' as never)).toBe(
      '2026-10-18',
    );
  });
});

describe('before the day and on it (R-73, 22 November 2026)', () => {
  const week = '2026-10-12';
  const held = [
    { date: '2026-10-14', kind: 'midweek' },
    { date: '2026-10-18', kind: 'weekend' },
  ];

  it('the days before are «before», the day itself is not', async () => {
    expect(await build(held, '2026-10-13').isBefore('c1', week)).toBe(true);
    expect(await build(held, '2026-10-14').isBefore('c1', week)).toBe(false);
    expect(await build(held, '2026-10-14').isToday('c1', week)).toBe(true);
    expect(await build(held, '2026-10-15').isToday('c1', week)).toBe(false);
  });

  it("the day is the CONGREGATION's: the clock asked is its own", async () => {
    // Late on 13 October in Berlin it is already the 14th there, while UTC
    // may still say the 13th: the service asks the congregation's clock.
    const svc = build(held, '2026-10-14');
    expect(await svc.isBefore('c1', week)).toBe(false);
  });

  it('a meeting moved to another day is measured by that day', async () => {
    const moved = [{ date: '2026-10-13', kind: 'midweek' }];
    expect(await build(moved, '2026-10-13').isToday('c1', week)).toBe(true);
    expect(await build(moved, '2026-10-13').isBefore('c1', week)).toBe(false);
  });

  it('a week with no such meeting is neither (the rule leaves it as it was)', async () => {
    const svc = build([{ date: '2026-10-18', kind: 'weekend' }], '2026-10-12');
    expect(await svc.isBefore('c1', week)).toBe(false);
    expect(await svc.isToday('c1', week)).toBe(false);
  });

  it('the weekend meeting by its own day', async () => {
    const svc = build(held, '2026-10-15');
    expect(await svc.isBefore('c1', week, 'weekend' as never)).toBe(true);
    expect(await svc.isBefore('c1', week)).toBe(false);
  });
});
