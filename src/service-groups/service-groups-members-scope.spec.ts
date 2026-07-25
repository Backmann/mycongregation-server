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
  } as any;
  const publishersService = {
    resolvePrivateAccess: jest.fn(async () => pubOver.privileged ?? false),
    findOwnServiceGroupId: jest.fn(async () => pubOver.ownGroup ?? null),
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
  // Who serves with whom is what a group's composition is for, and the names
  // are on the posted schedules anyway. The personal data stays shut.
  it('lets a regular publisher read another group, still redacted', async () => {
    const { svc } = makeSvc({ ownGroup: 'g-OTHER' });
    const res = (await svc.findPublishers(
      TENANT,
      'g1',
      {} as any,
      member,
    )) as unknown as { data: Record<string, unknown>[] };
    expect(res.data[0].displayName).toBe('A');
    expect(res.data[0].mobilePhone).toBeUndefined();
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
