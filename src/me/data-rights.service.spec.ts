import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataRightsService } from './data-rights.service';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';

jest.mock('bcrypt', () => ({ compare: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require('bcrypt') as { compare: jest.Mock };

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeDataSource() {
  const repos = new Map<unknown, ReturnType<typeof makeRepo>>();
  const manager = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue(undefined),
  };
  const ds = {
    repos,
    manager,
    getRepository: jest.fn((entity: unknown) => {
      if (!repos.has(entity)) repos.set(entity, makeRepo());
      return repos.get(entity)!;
    }),
    transaction: jest.fn(async (cb: (m: typeof manager) => unknown) =>
      cb(manager),
    ),
  };
  return ds;
}

describe('DataRightsService.eraseMyAccount', () => {
  beforeEach(() => bcrypt.compare.mockReset());

  it('rejects a wrong password', async () => {
    const ds = makeDataSource();
    ds.repos.set(
      User,
      makeRepo({
        findOne: jest.fn().mockResolvedValue({
          id: 'u1',
          role: UserRole.PUBLISHER,
          passwordHash: 'h',
        }),
      }),
    );
    bcrypt.compare.mockResolvedValue(false);
    const svc = new DataRightsService(ds as never);
    await expect(svc.eraseMyAccount('c1', 'u1', 'bad')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ds.transaction).not.toHaveBeenCalled();
  });

  it('blocks the last active admin', async () => {
    const ds = makeDataSource();
    ds.repos.set(
      User,
      makeRepo({
        findOne: jest.fn().mockResolvedValue({
          id: 'u1',
          role: UserRole.ADMIN,
          passwordHash: 'h',
        }),
        count: jest.fn().mockResolvedValue(1),
      }),
    );
    bcrypt.compare.mockResolvedValue(true);
    const svc = new DataRightsService(ds as never);
    await expect(svc.eraseMyAccount('c1', 'u1', 'good')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(ds.transaction).not.toHaveBeenCalled();
  });

  it('throws when the account has no password set', async () => {
    const ds = makeDataSource();
    ds.repos.set(
      User,
      makeRepo({
        findOne: jest.fn().mockResolvedValue({
          id: 'u1',
          role: UserRole.PUBLISHER,
          passwordHash: null,
        }),
      }),
    );
    const svc = new DataRightsService(ds as never);
    await expect(svc.eraseMyAccount('c1', 'u1', 'x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('anonymises the publisher and deletes the user on success', async () => {
    const ds = makeDataSource();
    ds.repos.set(
      User,
      makeRepo({
        findOne: jest.fn().mockResolvedValue({
          id: 'u1',
          role: UserRole.PUBLISHER,
          passwordHash: 'h',
        }),
      }),
    );
    ds.manager.findOne.mockResolvedValue({
      id: 'p1',
      firstName: 'Иван',
      lastName: 'Иванов',
      mobilePhone: '+49',
      userId: 'u1',
    });
    bcrypt.compare.mockResolvedValue(true);

    const svc = new DataRightsService(ds as never);
    const res = await svc.eraseMyAccount('c1', 'u1', 'good');

    expect(res).toEqual({ erased: true });
    expect(ds.transaction).toHaveBeenCalledTimes(1);

    const savedPublisher = ds.manager.save.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(savedPublisher.displayName).toBe('Удалённый возвещатель');
    expect(savedPublisher.mobilePhone).toBeNull();
    expect(savedPublisher.userId).toBeNull();
    expect(savedPublisher.anonymizedAt).toBeInstanceOf(Date);

    expect(ds.manager.update).toHaveBeenCalled();
    expect(ds.manager.delete).toHaveBeenCalledWith(User, { id: 'u1' });
  });
});

describe('DataRightsService.exportMyData', () => {
  it('returns the account and publisher bundle', async () => {
    const ds = makeDataSource();
    ds.repos.set(
      User,
      makeRepo({
        findOne: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'a@b.c',
          role: UserRole.PUBLISHER,
          uiLanguage: 'ru',
          isActive: true,
          createdAt: new Date(),
          lastLoginAt: null,
        }),
      }),
    );
    ds.repos.set(
      Publisher,
      makeRepo({ findOne: jest.fn().mockResolvedValue({ id: 'p1' }) }),
    );

    const svc = new DataRightsService(ds as never);
    const res = (await svc.exportMyData('c1', 'u1')) as Record<string, unknown>;

    expect(res.account).toMatchObject({ email: 'a@b.c' });
    expect(res.publisher).toMatchObject({ id: 'p1' });
    expect(res).toHaveProperty('absences');
    expect(res).toHaveProperty('serviceReports');
    expect(res).toHaveProperty('devices');
  });
});
