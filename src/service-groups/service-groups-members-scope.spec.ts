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

import { ForbiddenException } from '@nestjs/common';
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
      data: [{ id: 'p1', displayName: 'A', mobilePhone: 'secret' }],
      total: 1,
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
  it('forbids a regular publisher from reading a foreign group', async () => {
    const { svc } = makeSvc({ ownGroup: 'g-OTHER' });
    await expect(
      svc.findPublishers(TENANT, 'g1', {} as any, member),
    ).rejects.toThrow(ForbiddenException);
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
