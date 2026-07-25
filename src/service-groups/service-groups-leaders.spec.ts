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
const leader = {
  id: 'p-lead',
  displayName: 'Служитель',
  appointment: 'elder',
  mobilePhone: '+49 111',
  address: 'Musterstr. 2',
  pioneerType: 'none',
};

function makeSvc() {
  const groupsRepo = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(async () => [
        [{ id: 'g1', congregationId: TENANT, overseerPublisherId: 'p-lead' }],
        1,
      ]),
    })),
    findOne: jest.fn(async () => ({
      id: 'g1',
      congregationId: TENANT,
      overseerPublisherId: 'p-lead',
    })),
  } as any;
  const publishersService = {
    findOne: jest.fn(async () => leader),
    resolvePrivateAccess: jest.fn(async () => false),
  } as any;
  const audit = { logCreate: jest.fn(), logUpdate: jest.fn() } as any;
  return new ServiceGroupsService(groupsRepo, publishersService, audit);
}

describe('ServiceGroupsService — the two leaders', () => {
  // The group endpoints are open to every signed-in member, so attaching a
  // full publisher row handed out a card along with the group.
  it('redacts the overseer for an unprivileged caller', async () => {
    const svc = makeSvc();
    const g = (await svc.findOne(TENANT, 'g1', false)) as any;
    expect(g.overseer.displayName).toBe('Служитель');
    expect(g.overseer.mobilePhone).toBeUndefined();
    expect(g.overseer.address).toBeUndefined();
  });

  it('keeps the full row for a privileged caller', async () => {
    const svc = makeSvc();
    const g = (await svc.findOne(TENANT, 'g1', true)) as any;
    expect(g.overseer.mobilePhone).toBe('+49 111');
  });

  // Having to open every group to learn who serves it is what people hit.
  it('carries the leaders in the list too', async () => {
    const svc = makeSvc();
    const res = (await svc.findAll(TENANT, {} as any, false)) as any;
    expect(res.data[0].overseer.displayName).toBe('Служитель');
    expect(res.data[0].overseer.mobilePhone).toBeUndefined();
  });
});
