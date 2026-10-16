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
});
