import {
  computeServiceStatus,
  effectiveStartMonth,
  resolveReportingStartMonth,
} from './service-status-rule';
import { PublisherStatus } from './enums/publisher-status.enum';

/**
 * The rule the congregation stated on 3 September, tested where it lives.
 *
 * It used to live in copies — in the status, in the «missed N months» flag and
 * in the annual report — and they disagreed about the one thing that matters
 * most: from when a person is counted at all.
 */
describe('resolveReportingStartMonth', () => {
  it('takes the EARLIEST of what is known, not the latest', () => {
    // The case that started all of this: a man reports as an unbaptized
    // publisher from October, is baptized on 1 August, and counting must not
    // begin in August.
    expect(
      resolveReportingStartMonth({
        ministryStartDate: '2025-10-15',
        baptismDate: '2026-08-01',
        firstReportMonth: '2025-10',
      }),
    ).toBe('2025-10');
  });

  it('falls back to the first report when the card lost its dates', () => {
    // The app cleared the ministry-start field whenever someone was marked
    // baptized, so for most cards the first report is the only evidence left
    // that the person was reporting before.
    expect(
      resolveReportingStartMonth({
        ministryStartDate: null,
        baptismDate: '2026-08-01',
        firstReportMonth: '2025-10',
      }),
    ).toBe('2025-10');
  });

  it('knows nothing about a card with no dates and no reports', () => {
    expect(
      resolveReportingStartMonth({
        ministryStartDate: null,
        baptismDate: null,
        firstReportMonth: null,
      }),
    ).toBeNull();
  });
});

describe('computeServiceStatus', () => {
  const july = '2026-07'; // last closed month on 3 September
  const august = '2026-08'; // the month being collected

  const status = (months: string[], startMonth: string | null) =>
    computeServiceStatus({
      participated: new Set(months),
      startMonth,
      lastClosedMonth: july,
      collectedMonth: august,
    });

  it('a year of reports and a baptism last month: active', () => {
    const months = [
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ];
    expect(status(months, '2025-10')).toBe(PublisherStatus.ACTIVE);
  });

  it('one missed month out of six: irregular', () => {
    const months = [
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-07',
      '2026-08',
    ];
    expect(status(months, '2020-01')).toBe(PublisherStatus.IRREGULAR);
  });

  it('six closed months of silence: inactive', () => {
    expect(status([], '2020-01')).toBe(PublisherStatus.INACTIVE);
  });

  it('silence in the month still being collected counts for nothing', () => {
    // August has no report and no deadline yet: he is not late, so the six
    // closed months before it are what he is judged on.
    const months = [
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ];
    expect(status(months, '2020-01')).toBe(PublisherStatus.ACTIVE);
  });

  it('a report for the month being collected counts at once', () => {
    // Six months of silence, then he hands in August. The report is a fact,
    // and counting begins again from it — «активность возобновилась».
    expect(status(['2026-08'], '2020-01')).toBe(PublisherStatus.ACTIVE);
  });

  it('and the restart is a clean slate, not a permanent pass', () => {
    // Back in February after a long silence, then missed March: two closed
    // months since the return, one of them served.
    expect(status(['2026-02', '2026-04'], '2020-01')).toBe(
      PublisherStatus.IRREGULAR,
    );
  });

  it('somebody who began this month is active, not inactive', () => {
    // Started preaching in August; August closes on 20 September. Nothing has
    // been asked of him yet, so he is behind on nothing.
    expect(status([], '2026-08')).toBe(PublisherStatus.ACTIVE);
  });

  it('moves the start to the month of the return', () => {
    expect(
      effectiveStartMonth({
        participated: new Set(['2026-08']),
        startMonth: '2020-01',
        lastClosedMonth: july,
        collectedMonth: august,
      }),
    ).toBe('2026-08');
  });
});
