import { plansDueBy } from './calendar-tasks.service';

const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

/**
 * These are fixed to the CALENDAR, not to when the last one was finished —
 * which is exactly why the «repeat in N months» question could not cover them.
 */
describe('plansDueBy', () => {
  it('puts nothing on the list in January', () => {
    expect(plansDueBy(on('2026-01-20'))).toEqual([]);
  });

  it('offers the pioneers review from mid-February, due 1 March', () => {
    expect(plansDueBy(on('2026-02-14'))).toEqual([]);

    const plan = plansDueBy(on('2026-02-15')).find(
      (p) => p.kind === 'pioneer_service_review',
    );
    expect(plan).toMatchObject({
      period: '2026',
      due: { month: 3, day: 1 },
      assigneeKind: 'people',
    });
  });

  it('offers the service-year review on 20 August, due the 31st', () => {
    // Lionel was precise: not September, and it goes to the committee.
    expect(
      plansDueBy(on('2026-08-19')).some(
        (p) => p.kind === 'service_year_review',
      ),
    ).toBe(false);

    const plan = plansDueBy(on('2026-08-20')).find(
      (p) => p.kind === 'service_year_review',
    );
    expect(plan).toMatchObject({
      due: { month: 8, day: 31 },
      assigneeKind: 'service_committee',
    });
  });

  it('offers the accounts check the month AFTER each quarter', () => {
    // Quarters run Sep–Nov, Dec–Feb, Mar–May, Jun–Aug, so the checks fall in
    // December, March, June and September.
    const months = [3, 6, 9, 12];
    for (const m of months) {
      const iso = `2026-${String(m).padStart(2, '0')}-01`;
      expect(plansDueBy(on(iso)).some((p) => p.kind === 'accounts_audit')).toBe(
        true,
      );
    }
  });

  it('gives the accounts check to the end of its month', () => {
    // Papers arrive around the fifth and the work runs one to three weeks; a
    // deadline on the fifth would make ordinary work permanently late.
    const plan = plansDueBy(on('2026-03-01')).find(
      (p) => p.kind === 'accounts_audit' && p.period === '2026-Q2',
    );
    expect(plan?.due).toEqual({ month: 3, day: 31 });
  });

  it('knows a short month', () => {
    const plan = plansDueBy(on('2026-06-10')).find(
      (p) => p.kind === 'accounts_audit' && p.period === '2026-Q3',
    );
    expect(plan?.due).toEqual({ month: 6, day: 30 });
  });

  it('names each quarter once, so two are never the same period', () => {
    const audits = plansDueBy(on('2026-12-15')).filter(
      (p) => p.kind === 'accounts_audit',
    );
    const periods = audits.map((p) => p.period);
    expect(new Set(periods).size).toBe(periods.length);
  });
});
