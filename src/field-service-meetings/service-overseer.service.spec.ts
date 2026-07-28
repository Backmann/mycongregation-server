import {
  ServiceOverseerService,
  meetingDate,
  serviceYearBounds,
} from './service-overseer.service';
import { currentServiceYear } from './service-overseer.controller';

function make(
  groups: { id: string; name: string }[],
  visits: {
    serviceGroupId: string | null;
    weekStartDate: string;
    dayOfWeek: number;
    serviceOverseerPublisherId?: string | null;
  }[],
) {
  const svc = new ServiceOverseerService(
    { find: async () => visits } as never,
    { find: async () => groups } as never,
  );
  return svc;
}

describe('ServiceOverseerService — which groups still need a visit', () => {
  const GROUPS = [
    { id: 'g1', name: 'Группа 1' },
    { id: 'g2', name: 'Группа 2' },
    { id: 'g3', name: 'Группа 3' },
  ];

  it('counts visits inside the service year and remembers the last one', async () => {
    const svc = make(GROUPS, [
      // service year 2026 runs Sept 2025 – Aug 2026
      {
        serviceGroupId: 'g1',
        weekStartDate: '2025-10-06',
        dayOfWeek: 3,
        serviceOverseerPublisherId: 'p1',
      },
      {
        serviceGroupId: 'g1',
        weekStartDate: '2026-03-02',
        dayOfWeek: 3,
        serviceOverseerPublisherId: 'p1',
      },
      // the year before — must not be counted, but is still the last visit
      // for a group that has had none since
      {
        serviceGroupId: 'g2',
        weekStartDate: '2025-04-07',
        dayOfWeek: 5,
        serviceOverseerPublisherId: 'p1',
      },
    ]);

    const { groups } = await svc.groupVisits('c1', 2026, '2026-07-28');
    const g1 = groups.find((g) => g.serviceGroupId === 'g1')!;
    const g2 = groups.find((g) => g.serviceGroupId === 'g2')!;

    expect(g1.visitsThisYear).toBe(2);
    expect(g1.lastVisitDate).toBe('2026-03-04');
    expect(g1.lastVisitBy).toBe('p1');
    expect(g2.visitsThisYear).toBe(0);
    expect(g2.lastVisitDate).toBe('2025-04-11');
  });

  // The whole point of the screen: the ones most easily forgotten come first.
  it('puts a group never visited above one visited long ago', async () => {
    const svc = make(GROUPS, [
      { serviceGroupId: 'g2', weekStartDate: '2025-04-07', dayOfWeek: 5 },
    ]);
    const { groups } = await svc.groupVisits('c1', 2026, '2026-07-28');
    // g1 and g3 have never been visited at all; g2 at least has a date
    expect(groups.map((g) => g.serviceGroupId)).toEqual(['g1', 'g3', 'g2']);
  });

  it('sinks a group already visited this year to the bottom without hiding it', async () => {
    const svc = make(GROUPS, [
      { serviceGroupId: 'g1', weekStartDate: '2026-03-02', dayOfWeek: 3 },
    ]);
    const { groups } = await svc.groupVisits('c1', 2026, '2026-07-28');
    expect(groups[groups.length - 1].serviceGroupId).toBe('g1');
    expect(groups).toHaveLength(3);
  });

  // A planned visit is not a visit yet — counting it would let a group be
  // ticked off in September for something happening next July.
  it('keeps a visit still to come apart from one already made', async () => {
    const svc = make(GROUPS, [
      { serviceGroupId: 'g1', weekStartDate: '2026-08-03', dayOfWeek: 3 },
    ]);
    const { groups } = await svc.groupVisits('c1', 2026, '2026-07-28');
    const g1 = groups.find((g) => g.serviceGroupId === 'g1')!;
    expect(g1.lastVisitDate).toBeNull();
    expect(g1.nextVisitDate).toBe('2026-08-05');
    // it still counts toward the year, because it is planned inside it
    expect(g1.visitsThisYear).toBe(1);
  });

  it('ignores a visit whose group is gone', async () => {
    const svc = make(GROUPS, [
      { serviceGroupId: 'deleted', weekStartDate: '2026-03-02', dayOfWeek: 3 },
      { serviceGroupId: null, weekStartDate: '2026-03-02', dayOfWeek: 3 },
    ]);
    const { groups } = await svc.groupVisits('c1', 2026, '2026-07-28');
    expect(groups.every((g) => g.visitsThisYear === 0)).toBe(true);
  });
});

describe('service year and meeting dates', () => {
  it('runs September to August', () => {
    expect(serviceYearBounds(2026)).toEqual({
      first: '2025-09-01',
      last: '2026-08-31',
    });
  });

  it('names the year for the August it ends in', () => {
    expect(currentServiceYear('2025-09-01')).toBe(2026);
    expect(currentServiceYear('2026-08-31')).toBe(2026);
    expect(currentServiceYear('2026-09-01')).toBe(2027);
  });

  // A meeting has no date of its own — it is a week plus an ISO weekday.
  it('works the real date out of the week and the day', () => {
    expect(meetingDate('2026-03-02', 1)).toBe('2026-03-02'); // Monday
    expect(meetingDate('2026-03-02', 3)).toBe('2026-03-04'); // Wednesday
    expect(meetingDate('2026-03-02', 7)).toBe('2026-03-08'); // Sunday
  });
});
