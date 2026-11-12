import { RETENTION_RULES, cutoffDate } from './retention-rules';

describe('retention rules', () => {
  it('counts months back on the calendar, clamping short months', () => {
    expect(cutoffDate('2026-10-31', { months: 12 })).toBe('2025-10-31');
    expect(cutoffDate('2026-03-31', { months: 1 })).toBe('2026-02-28');
    expect(cutoffDate('2028-03-31', { months: 1 })).toBe('2028-02-29');
    expect(cutoffDate('2026-01-15', { months: 36 })).toBe('2023-01-15');
  });

  it('counts days back across a month and a year', () => {
    expect(cutoffDate('2026-10-31', { days: 30 })).toBe('2026-10-01');
    expect(cutoffDate('2026-01-05', { days: 7 })).toBe('2025-12-29');
  });

  it('holds the periods decided on 31 October 2026', () => {
    const keep = (key: string) => {
      const r = RETENTION_RULES.find((x) => x.key === key);
      return r && r.kind !== 'counted' ? r.keep : undefined;
    };
    expect(keep('assignments')).toEqual({ months: 12 });
    expect(keep('attendance')).toEqual({ months: 36 });
    expect(keep('absences')).toEqual({ months: 1 });
    expect(keep('deleted:service-reports')).toEqual({ days: 30 });
  });

  it('has one rule per key and a basis for every rule', () => {
    const keys = RETENTION_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of RETENTION_RULES) expect(r.basis.length).toBeGreaterThan(10);
  });

  it('the S-13: names for this and last service year, lines for five (12 November 2026)', () => {
    const rule = (key: string) => {
      const r = RETENTION_RULES.find((x) => x.key === key);
      if (r?.kind !== 'counted') throw new Error(key);
      return r;
    };
    // Service year 2027 runs 1 September 2026 – 31 August 2027.
    expect(rule('territory-names').keptFrom('2026-11-12')).toBe('2025-09-01');
    expect(rule('territory-names').keptFrom('2026-08-31')).toBe('2024-09-01');
    expect(rule('territory-names').keptFrom('2026-09-01')).toBe('2025-09-01');
    expect(rule('territory-lines').keptFrom('2026-11-12')).toBe('2021-09-01');
    expect(rule('territory-names').does).toBe('anonymise');
    expect(rule('territory-lines').does).toBe('delete');
  });

  it('never touches the congregation itself', () => {
    expect(
      RETENTION_RULES.some(
        (r) => (r.entity as { name?: string }).name === 'Congregation',
      ),
    ).toBe(false);
  });
});
