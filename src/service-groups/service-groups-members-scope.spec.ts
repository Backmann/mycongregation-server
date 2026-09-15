// expo-server-sdk тянется транзитивно через publishers.service — мокаем.
jest.mock('expo-server-sdk', () => {
  class MockExpo {
    static isExpoPushToken() {
      return true;
    }
    chunkPushNotifications(m: unknown[]) {
      return [m];
    }
    sendPushNotificationsAsync = jest.fn().mockResolvedValue([]);
  }
  return { Expo: MockExpo };
});

import { ServiceGroupsService } from './service-groups.service';

const TENANT = 'cong-1';
const member = { id: 'u-m', role: 'publisher' } as any;

function makeSvc(pubOver: Partial<Record<string, any>> = {}) {
  const groupsRepo = {
    findOne: jest.fn(async () => ({ id: 'g1', congregationId: TENANT })),
    // Список групп строится запросом; подделке довольно вернуть две строки,
    // чтобы стало видно, какая из них помечена своей.
    createQueryBuilder: jest.fn(() => {
      const qb: any = {
        where: () => qb,
        andWhere: () => qb,
        orderBy: () => qb,
        take: () => qb,
        skip: () => qb,
        withDeleted: () => qb,
        getManyAndCount: async () => [
          [
            { id: 'g1', name: '1-я', congregationId: TENANT },
            { id: 'g2', name: '2-я', congregationId: TENANT },
          ],
          2,
        ],
      };
      return qb;
    }),
  } as any;
  const publishersService = {
    resolvePrivateAccess: jest.fn(async () => pubOver.privileged ?? false),
    findOwnServiceGroupId: jest.fn(async () => pubOver.ownGroup ?? null),
    findOne: jest.fn(async () => null),
    findAll: jest.fn(async () => ({
      data: pubOver.rows ?? [
        {
          id: 'p1',
          displayName: 'A',
          appointment: 'publisher',
          mobilePhone: 'secret',
          contactsConfirmedAt: '2026-01-05',
          userId: 'u-1',
        },
      ],
      total: (pubOver.rows ?? [1]).length,
      limit: 50,
      offset: 0,
    })),
  } as any;
  const auditMock = {
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logEvent: jest.fn(),
  } as any;
  const svc = new ServiceGroupsService(
    groupsRepo,
    publishersService,
    auditMock,
  );
  return { svc, publishersService };
}

describe('ServiceGroupsService.findPublishers — scoping', () => {
  /**
   * Правило было таким, потом его сняли, и 15 сентября Лионель вернул его.
   *
   * Причина точнее прежней: список братьев для обычного возвещателя ограничен
   * его группой, а открытый состав чужих групп давал то же самое в два
   * нажатия. Половинчатое правило хуже любого из двух.
   */
  it('не пускает обычного возвещателя в чужую группу', async () => {
    const { svc } = makeSvc({ ownGroup: 'g-OTHER' });

    await expect(
      svc.findPublishers(TENANT, 'g1', {} as any, member),
    ).rejects.toMatchObject({ response: { code: 'OTHER_GROUP' } });
  });

  it('говорит клиенту, какая группа своя', async () => {
    /**
     * Без этого признака экран не мог отличить свою группу от чужой — и
     * обычный возвещатель тыкался в чужую, получая отказ без объяснения.
     */
    const { svc } = makeSvc({ ownGroup: 'g1' });

    const page = (await svc.findAllFor(TENANT, {} as any, member)) as {
      data: { id: string; mine: boolean }[];
    };

    expect(page.data.find((g) => g.id === 'g1')?.mine).toBe(true);
    expect(page.data.some((g) => g.id !== 'g1' && g.mine)).toBe(false);
  });

  it('свою группу показывает, но без личных данных', async () => {
    const { svc } = makeSvc({ ownGroup: 'g1' });

    const res = (await svc.findPublishers(
      TENANT,
      'g1',
      {} as any,
      member,
    )) as unknown as { data: Record<string, unknown>[] };

    expect(res.data[0].displayName).toBe('A');
    expect(res.data[0].mobilePhone).toBeUndefined();
  });

  // pioneerSince is private, and a start month still ahead means the person is
  // NOT yet a pioneer. Without the date the app guessed "already serving" and
  // showed an auxiliary pioneer as a regular one months early.
  it('answers the pioneer question instead of leaking the date', async () => {
    const rows = [
      {
        id: 'p1',
        displayName: 'A',
        appointment: 'publisher',
        pioneerType: 'regular',
        pioneerSince: '2099-08-01',
      },
    ];
    const { svc } = makeSvc({ ownGroup: 'g1', rows });
    const res = (await svc.findPublishers(
      TENANT,
      'g1',
      {} as any,
      member,
    )) as unknown as { data: Record<string, unknown>[] };
    expect(res.data[0].pioneerSince).toBeUndefined();
    expect(res.data[0].pioneerActive).toBe(false);
  });

  it('never sends contact-confirmation or account state to a publisher', async () => {
    const { svc } = makeSvc({ ownGroup: 'g1' });
    const res = (await svc.findPublishers(
      TENANT,
      'g1',
      {} as any,
      member,
    )) as unknown as { data: Record<string, unknown>[] };
    expect(res.data[0].contactsConfirmedAt).toBeUndefined();
    expect(res.data[0].userId).toBeUndefined();
  });

  it('hides students from a publisher and keeps the count honest', async () => {
    const rows = [
      { id: 'p1', displayName: 'A', appointment: 'publisher' },
      { id: 'p2', displayName: 'S', appointment: 'student' },
    ];
    const { svc } = makeSvc({ ownGroup: 'g1', rows });
    const res = (await svc.findPublishers(
      TENANT,
      'g1',
      {} as any,
      member,
    )) as unknown as { data: Record<string, unknown>[]; total: number };
    expect(res.data.map((p) => p.id)).toEqual(['p1']);
    expect(res.total).toBe(1);
  });

  it('keeps students visible to privileged callers', async () => {
    const rows = [
      { id: 'p1', displayName: 'A', appointment: 'publisher' },
      { id: 'p2', displayName: 'S', appointment: 'student' },
    ];
    const { svc } = makeSvc({ privileged: true, rows });
    const res = (await svc.findPublishers(
      TENANT,
      'g1',
      {} as any,
      member,
    )) as unknown as { data: Record<string, unknown>[] };
    expect(res.data).toHaveLength(2);
  });

  it('redacts private fields for a regular publisher reading their own group', async () => {
    const { svc } = makeSvc({ ownGroup: 'g1' });
    const res = (await svc.findPublishers(
      TENANT,
      'g1',
      {} as any,
      member,
    )) as unknown as {
      data: Record<string, unknown>[];
    };
    expect(res.data[0].mobilePhone).toBeUndefined();
    expect(res.data[0].displayName).toBe('A');
  });

  it('returns full rows to privileged callers', async () => {
    const { svc } = makeSvc({ privileged: true });
    const res = (await svc.findPublishers(
      TENANT,
      'g1',
      {} as any,
      member,
    )) as unknown as {
      data: Record<string, unknown>[];
    };
    expect(res.data[0].mobilePhone).toBe('secret');
  });
});
