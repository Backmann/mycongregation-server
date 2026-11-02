import {
  aloneSpans,
  coverage,
  merge,
  minus,
  overfull,
  spanProblem,
} from './cart-time';
import { PersonStanding, suggest } from './cart-fairness';

const day = { startTime: '07:00', endTime: '16:00' };
const s = (a: string, b: string) => ({ startTime: a, endTime: b });

describe('time at the stand, on the half-hour', () => {
  it('a span is an hour or more, on the half-hour, inside the day', () => {
    expect(spanProblem(s('10:00', '11:30'), day)).toBeNull();
    expect(spanProblem(s('10:00', '10:30'), day)).toBe('TOO_SHORT');
    expect(spanProblem(s('10:15', '11:30'), day)).toBe('NOT_HALF_HOUR');
    expect(spanProblem(s('06:30', '08:00'), day)).toBe('OUTSIDE_DAY');
    expect(spanProblem(s('15:00', '16:30'), day)).toBe('OUTSIDE_DAY');
  });

  it('counts who stands at each half-hour, whatever lengths they chose', () => {
    const c = coverage(day, [s('10:00', '12:00'), s('11:00', '13:00')]);
    expect(c.get(600)).toBe(1); // 10:00
    expect(c.get(660)).toBe(2); // 11:00
    expect(c.get(750)).toBe(1); // 12:30
    expect(c.get(780)).toBe(0); // 13:00
  });

  it('a fifth at any half-hour is too many, even if the others overlap only partly', () => {
    const four = [
      s('09:00', '11:00'),
      s('10:00', '12:00'),
      s('10:30', '12:00'),
      s('08:00', '11:00'),
    ];
    expect(overfull(day, four, s('10:30', '11:30'))).toBe(630);
    expect(overfull(day, four, s('11:00', '12:00'))).toBeNull();
  });

  it('calling off part of a day leaves the rest of a span', () => {
    expect(minus(s('10:00', '14:00'), [s('11:00', '12:00')])).toEqual([
      s('10:00', '11:00'),
      s('12:00', '14:00'),
    ]);
    expect(minus(s('10:00', '12:00'), [s('09:00', '13:00')])).toEqual([]);
  });

  it('spans that touch are one time at the stand', () => {
    expect(
      merge([s('11:00', '12:00'), s('10:00', '11:00'), s('14:00', '15:00')]),
    ).toEqual([s('10:00', '12:00'), s('14:00', '15:00')]);
  });

  it('says where somebody stands alone', () => {
    expect(aloneSpans(day, [s('10:00', '12:00'), s('11:00', '13:00')])).toEqual(
      [s('10:00', '11:00'), s('12:00', '13:00')],
    );
  });
});

describe('who goes first when more want a time than it holds', () => {
  const D = {
    id: 'd',
    date: '2026-11-20',
    startTime: '10:00',
    endTime: '12:00',
    off: [],
  };
  const wish = (p: string, n: number, a = '10:00', b = '12:00') => ({
    id: `r-${p}`,
    publisherId: p,
    dayId: 'd',
    date: D.date,
    startTime: a,
    endTime: b,
    createdAt: n,
  });
  const st = (
    p: string,
    x: Partial<PersonStanding>,
  ): [string, PersonStanding] => [
    p,
    {
      publisherId: p,
      pioneer: false,
      missedWeeks: 0,
      recentDays: 0,
      lastDate: null,
      ...x,
    },
  ];

  it('pioneers first, then whoever was left out longest, then who stood least', () => {
    const wishes = ['a', 'b', 'c', 'd', 'e', 'f'].map((p, i) => wish(p, i));
    const standing = new Map([
      st('a', { recentDays: 1 }),
      st('b', { recentDays: 0 }),
      st('c', { pioneer: true, recentDays: 6 }),
      st('d', { missedWeeks: 2, recentDays: 5 }),
      st('e', { missedWeeks: 3, recentDays: 5 }),
      st('f', { recentDays: 9 }),
    ]);
    const chosen = suggest([D], wishes, [], standing).map((p) => p.publisherId);
    expect(chosen.sort()).toEqual(['b', 'c', 'd', 'e']);
  });

  it('nobody twice at one hour, and never more than four', () => {
    const wishes = [
      wish('a', 1),
      wish('a', 2),
      wish('b', 3),
      wish('c', 4),
      wish('d', 5),
      wish('e', 6),
    ];
    const out = suggest([D], wishes, [], new Map());
    expect(out.filter((p) => p.publisherId === 'a')).toHaveLength(1);
    expect(out).toHaveLength(4);
  });

  it('two shifts this week give way to someone with none', () => {
    const placed = [
      {
        dayId: 'x',
        publisherId: 'pi',
        date: '2026-11-18',
        startTime: '10:00',
        endTime: '11:00',
      },
      {
        dayId: 'y',
        publisherId: 'pi',
        date: '2026-11-19',
        startTime: '10:00',
        endTime: '11:00',
      },
    ];
    const four = ['b', 'c', 'd', 'e'].map((p, i) => wish(p, i + 2));
    const out = suggest(
      [D],
      [wish('pi', 1), ...four],
      placed,
      new Map([st('pi', { pioneer: true })]),
    );
    expect(out.map((p) => p.publisherId).sort()).toEqual(['b', 'c', 'd', 'e']);
  });

  it('fills the time where one would stand alone with part of a wish', () => {
    // a 10–12 fits; b wants 10–12 but c and d already take 11–12 twice over.
    const placed = [
      {
        dayId: 'd',
        publisherId: 'x1',
        date: D.date,
        startTime: '11:00',
        endTime: '12:00',
      },
      {
        dayId: 'd',
        publisherId: 'x2',
        date: D.date,
        startTime: '11:00',
        endTime: '12:00',
      },
      {
        dayId: 'd',
        publisherId: 'x3',
        date: D.date,
        startTime: '11:00',
        endTime: '12:00',
      },
    ];
    const out = suggest([D], [wish('a', 1), wish('b', 2)], placed, new Map());
    expect(out).toEqual([
      {
        dayId: 'd',
        publisherId: 'a',
        date: D.date,
        startTime: '10:00',
        endTime: '12:00',
      },
      {
        dayId: 'd',
        publisherId: 'b',
        date: D.date,
        startTime: '10:00',
        endTime: '11:00',
      },
    ]);
  });
});
