import { ServiceOverseerService } from './service-overseer.service';

/**
 * Which groups are still waiting for the service overseer.
 *
 * Built on the page's own answer rather than beside it: two counts of «has
 * this group been visited» would agree all year and part company at the edge
 * of it — and we would meet the disagreement as a complaint about a brother
 * being nagged, not as a failing test.
 */
describe('ServiceOverseerService.groupsAtRisk', () => {
  const build = (
    groups: {
      serviceGroupId: string;
      visitsThisYear: number;
      nextVisitDate: string | null;
    }[],
    ages: Record<string, Date>,
  ) => {
    const service = Object.create(
      ServiceOverseerService.prototype,
    ) as ServiceOverseerService;
    Object.assign(service, {
      groups: {
        find: jest.fn(async () =>
          groups.map((g) => ({
            id: g.serviceGroupId,
            createdAt: ages[g.serviceGroupId] ?? new Date('2020-01-01'),
          })),
        ),
      },
      groupVisits: jest.fn(async () => ({
        serviceYear: 2026,
        groups: groups.map((g) => ({ ...g, name: g.serviceGroupId })),
      })),
    });
    return service;
  };

  const waitingIds = async (service: ServiceOverseerService) =>
    (await service.groupsAtRisk('c1', 2026, '2026-05-04')).waiting.map(
      (g) => g.serviceGroupId,
    );

  it('names a group with no visit and none planned', async () => {
    const service = build(
      [{ serviceGroupId: 'g1', visitsThisYear: 0, nextVisitDate: null }],
      {},
    );

    await expect(waitingIds(service)).resolves.toEqual(['g1']);
  });

  it('leaves alone a group already visited this year', async () => {
    const service = build(
      [{ serviceGroupId: 'g1', visitsThisYear: 1, nextVisitDate: null }],
      {},
    );

    await expect(waitingIds(service)).resolves.toEqual([]);
  });

  it('counts a planned visit as covering the group', async () => {
    // He has arranged it; nagging him about it would be nagging about work
    // already done.
    const service = build(
      [
        {
          serviceGroupId: 'g1',
          visitsThisYear: 0,
          nextVisitDate: '2026-07-12',
        },
      ],
      {},
    );

    await expect(waitingIds(service)).resolves.toEqual([]);
  });

  it('does NOT let a visit planned for the next year cover this one', async () => {
    // The page's «next visit» is the next of ANY year — right for a page that
    // says when he is coming. Here it would tick off the August that is ending
    // on the strength of a September that belongs to the year after.
    const service = build(
      [
        {
          serviceGroupId: 'g1',
          visitsThisYear: 0,
          nextVisitDate: '2026-09-06',
        },
      ],
      {},
    );

    await expect(waitingIds(service)).resolves.toEqual(['g1']);
  });

  it('says nothing about a group formed three months ago', async () => {
    // It has not had a year to be visited in. Naming it would be an
    // accusation about nothing — Lionel's own rule.
    const service = build(
      [{ serviceGroupId: 'young', visitsThisYear: 0, nextVisitDate: null }],
      { young: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
    );

    const out = await service.groupsAtRisk('c1', 2026, '2026-05-04');

    expect(out.waiting).toEqual([]);
    expect(out.tooNew).toBe(1);
  });

  it('does count a group formed a year ago', async () => {
    const service = build(
      [{ serviceGroupId: 'g1', visitsThisYear: 0, nextVisitDate: null }],
      { g1: new Date('2025-04-01') },
    );

    await expect(waitingIds(service)).resolves.toEqual(['g1']);
  });
});
