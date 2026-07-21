// The controller pulls in publishers.service.ts which transitively imports
// the Expo SDK (ESM) — mock it before the import chain resolves.
jest.mock('expo-server-sdk', () => {
  class MockExpo {
    static isExpoPushToken() {
      return true;
    }
    chunkPushNotifications(messages: unknown[]) {
      return [messages];
    }
    sendPushNotificationsAsync = jest.fn().mockResolvedValue([]);
  }
  return { Expo: MockExpo };
});

import { PublishersController } from './publishers.controller';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

const TENANT = 'cong-1';
const USER = { id: 'user-1', role: 'publisher' } as AuthenticatedUser;

function makeController(
  service: Partial<Record<string, unknown>>,
  aux: Partial<Record<string, unknown>> = {
    isActiveAuxiliaryPioneer: jest.fn().mockResolvedValue(false),
  },
) {
  return new PublishersController(service as never, aux as never);
}

describe('PublishersController.findAll — directory scoping', () => {
  it('gives a responsibility holder the full congregation, redacted', async () => {
    const findAll = jest.fn(async () => ({
      data: [{ id: 'p1', displayName: 'A', mobilePhone: 'secret' }],
      total: 1,
      limit: 50,
      offset: 0,
    }));
    const controller = makeController({
      resolvePrivateAccess: jest.fn(async () => false),
      holdsAnyResponsibility: jest.fn(async () => true),
      findOwnServiceGroupId: jest.fn(),
      findAll,
    });
    const query: Record<string, unknown> = {};
    const res = (await controller.findAll(
      TENANT,
      USER,
      query as never,
    )) as unknown as {
      data: Record<string, unknown>[];
    };
    // группа НЕ навязана — пикеру нужны все кандидаты
    expect(query.serviceGroupId).toBeUndefined();
    // приватные поля вырезаны
    expect(res.data[0].mobilePhone).toBeUndefined();
    expect(res.data[0].displayName).toBe('A');
  });

  it('forces a regular publisher to their own service group', async () => {
    const findAll = jest.fn(async () => ({
      data: [{ id: 'p1', displayName: 'A', mobilePhone: 'secret' }],
      total: 1,
      limit: 50,
      offset: 0,
    }));
    const controller = makeController({
      resolvePrivateAccess: jest.fn(async () => false),
      holdsAnyResponsibility: jest.fn(async () => false),
      findOwnServiceGroupId: jest.fn(async () => 'group-7'),
      findAll,
    });
    const query: Record<string, unknown> = { includeRemoved: true };
    const res = (await controller.findAll(
      TENANT,
      USER,
      query as never,
    )) as unknown as {
      data: Record<string, unknown>[];
    };
    // own group forced, removed excluded
    expect(findAll).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({
        serviceGroupId: 'group-7',
        includeRemoved: false,
      }),
    );
    // private fields redacted
    expect(res.data[0].mobilePhone).toBeUndefined();
    expect(res.data[0].displayName).toBe('A');
  });

  it('returns an empty page for a publisher without a linked group', async () => {
    const findAll = jest.fn();
    const controller = makeController({
      resolvePrivateAccess: jest.fn(async () => false),
      holdsAnyResponsibility: jest.fn(async () => false),
      findOwnServiceGroupId: jest.fn(async () => null),
      findAll,
    });
    const res = await controller.findAll(TENANT, USER, {} as never);
    expect(res).toEqual({ data: [], total: 0, limit: 50, offset: 0 });
    expect(findAll).not.toHaveBeenCalled();
  });

  it('leaves privileged callers unrestricted', async () => {
    const findAll = jest.fn(async () => ({
      data: [{ id: 'p1', mobilePhone: 'kept' }],
      total: 1,
      limit: 50,
      offset: 0,
    }));
    const controller = makeController({
      resolvePrivateAccess: jest.fn(async () => true),
      findAll,
    });
    const query: Record<string, unknown> = {};
    const res = (await controller.findAll(
      TENANT,
      USER,
      query as never,
    )) as unknown as {
      data: Record<string, unknown>[];
    };
    expect(query.serviceGroupId).toBeUndefined();
    expect(res.data[0].mobilePhone).toBe('kept');
  });
});

describe('PublishersController.roster', () => {
  it('delegates to the names-only roster', async () => {
    const roster = jest.fn(async () => ({
      data: [{ id: 'p1', displayName: 'A' }],
    }));
    const controller = makeController({ roster });
    const res = await controller.roster(TENANT);
    expect(roster).toHaveBeenCalledWith(TENANT);
    expect(res.data[0]).toEqual({ id: 'p1', displayName: 'A' });
  });
});

describe('PublishersController.findOne — computed status visibility', () => {
  function setup(role: string) {
    const controller = makeController({
      resolvePrivateAccess: jest.fn(async () => true),
      findOne: jest.fn(async () => ({
        id: 'pub-1',
        displayName: 'A',
        status: 'inactive',
        lastEditedById: null,
      })),
      resolveEditorName: jest.fn(async () => null),
    });
    const user = { id: 'u', role } as AuthenticatedUser;
    return { controller, user };
  }

  it('includes status for an elder', async () => {
    const { controller, user } = setup('elder');
    const res = (await controller.findOne(TENANT, user, 'pub-1')) as {
      status?: string;
    };
    expect(res.status).toBe('inactive');
  });

  it('includes status for an admin', async () => {
    const { controller, user } = setup('admin');
    const res = (await controller.findOne(TENANT, user, 'pub-1')) as {
      status?: string;
    };
    expect(res.status).toBe('inactive');
  });

  it('strips status for a trusted non-elder (canViewPrivateData)', async () => {
    const { controller, user } = setup('publisher');
    const res = (await controller.findOne(TENANT, user, 'pub-1')) as {
      status?: string;
    };
    expect(res.status).toBeUndefined();
  });

  it('exposes isAuxiliaryPioneerNow from the aux service', async () => {
    const controller = makeController(
      {
        resolvePrivateAccess: jest.fn(async () => true),
        findOne: jest.fn(async () => ({
          id: 'pub-1',
          displayName: 'A',
          status: 'active',
          lastEditedById: null,
        })),
        resolveEditorName: jest.fn(async () => null),
      },
      { isActiveAuxiliaryPioneer: jest.fn().mockResolvedValue(true) },
    );
    const user = { id: 'u', role: 'elder' } as AuthenticatedUser;
    const res = (await controller.findOne(TENANT, user, 'pub-1')) as {
      isAuxiliaryPioneerNow?: boolean;
    };
    expect(res.isAuxiliaryPioneerNow).toBe(true);
  });
});
