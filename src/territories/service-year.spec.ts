import { addMonths, keptFrom, serviceYearOf } from './service-year';

describe('service year arithmetic', () => {
  it('a month on keeps the day, or falls to the last day of a short month', () => {
    expect(addMonths('2026-11-11', 1)).toBe('2026-12-11');
    expect(addMonths('2026-12-20', 1)).toBe('2027-01-20');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('a service year starts on 1 September and is named by its end', () => {
    expect(serviceYearOf('2026-08-31')).toBe(2026);
    expect(serviceYearOf('2026-09-01')).toBe(2027);
    expect(keptFrom('2026-11-11')).toBe('2025-09-01');
  });
});
