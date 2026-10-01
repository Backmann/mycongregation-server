import { lastMonthCollection } from './annual-figures';

/** A report for one month, shared or not. */
const rep = (publisherId: string, month: string, served = true) => ({
  publisherId,
  reportMonth: `${month}-01`,
  servedThisMonth: served,
  hoursReported: null,
});

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  firstName: 'Иван',
  lastName: id,
  appointment: 'publisher',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  removedAt: null,
  deletedAt: null,
  isActive: true,
  ...extra,
});

describe('lastMonthCollection — August, before the annual report goes out', () => {
  it('counts who has reported for August and who has not', () => {
    const out = lastMonthCollection({
      startYear: 2025,
      reports: [
        rep('a', '2026-08'),
        rep('b', '2026-05'),
        rep('c', '2026-08', false),
      ],
      publishers: [card('a'), card('b'), card('c')],
    });

    expect(out.month).toBe('2026-08');
    expect(out.expected).toBe(3);
    // A «нет» is a report handed in: the collection is about rows.
    expect(out.received).toBe(2);
    expect(out.missing.map((m) => m.id)).toEqual(['b']);
  });

  it('marks whose «active» rests on the missing August report alone', () => {
    // The 2025/26 case: his one report from March on was August's, filed the
    // afternoon the form went out — 85 sent, 86 counted afterwards.
    const out = lastMonthCollection({
      startYear: 2025,
      reports: [rep('steady', '2026-04'), rep('only-aug', '2026-01')],
      publishers: [card('steady'), card('only-aug')],
    });

    expect(out.missing).toEqual([
      expect.objectContaining({ id: 'only-aug', decidesActive: true }),
      expect.objectContaining({ id: 'steady', decidesActive: false }),
    ]);
  });

  it('a «нет» from March to July does not make him active either', () => {
    const out = lastMonthCollection({
      startYear: 2025,
      reports: [rep('no', '2026-06', false)],
      publishers: [card('no')],
    });

    expect(out.missing[0].decidesActive).toBe(true);
  });

  it('still expects somebody who left after the year, not somebody who left in it', () => {
    const out = lastMonthCollection({
      startYear: 2025,
      reports: [],
      publishers: [
        card('moved-sept', {
          isActive: false,
          removedAt: new Date('2026-09-01'),
          deletedAt: new Date('2026-09-27T10:00:00Z'),
        }),
        card('moved-july', {
          isActive: false,
          removedAt: new Date('2026-07-10'),
          deletedAt: new Date('2026-07-11T10:00:00Z'),
        }),
      ],
    });

    expect(out.missing.map((m) => m.id)).toEqual(['moved-sept']);
  });

  it('does not expect participants or cards typed in after the year', () => {
    const out = lastMonthCollection({
      startYear: 2025,
      reports: [],
      publishers: [
        card('student', { appointment: 'student' }),
        card('new', { createdAt: new Date('2026-09-15T10:00:00Z') }),
      ],
    });

    expect(out.expected).toBe(0);
  });
});
