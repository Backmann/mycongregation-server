import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataRightsService } from './data-rights.service';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { IsNull } from 'typeorm';
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
    // Erasure now also empties the journal entries about this person, so the
    // transaction manager has to answer find().
    find: jest.fn().mockResolvedValue([]),
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
    const svc = new DataRightsService(
      ds as never,
      {
        todayFor: jest.fn().mockResolvedValue('2026-09-05'),
      } as never,
    );
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
    const svc = new DataRightsService(
      ds as never,
      {
        todayFor: jest.fn().mockResolvedValue('2026-09-05'),
      } as never,
    );
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
    const svc = new DataRightsService(
      ds as never,
      {
        todayFor: jest.fn().mockResolvedValue('2026-09-05'),
      } as never,
    );
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

    const svc = new DataRightsService(
      ds as never,
      {
        todayFor: jest.fn().mockResolvedValue('2026-09-05'),
      } as never,
    );
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

  /**
   * Spells of pioneer service follow the rule the reports already follow: the
   * record of service belongs to the congregation and stays, only what was the
   * person's own is wiped. A spell holds no name and no contact — just «this id
   * served from month to month» — so the free-text note is its only personal
   * part.
   *
   * The open spell is CLOSED rather than left running: he no longer serves,
   * and an open spell would go on claiming he does for every month to come.
   */
  it('closes the open spell and wipes its note, without deleting the record', async () => {
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
    ds.manager.findOne.mockResolvedValue({ id: 'p1', userId: 'u1' });
    bcrypt.compare.mockResolvedValue(true);

    const svc = new DataRightsService(
      ds as never,
      {
        todayFor: jest.fn().mockResolvedValue('2026-09-05'),
      } as never,
    );
    await svc.eraseMyAccount('c1', 'u1', 'good');

    const spellCalls = ds.manager.update.mock.calls.filter(
      (c: unknown[]) => c[0] === PioneerSpell,
    );
    expect(spellCalls.length).toBe(2);

    const closing = spellCalls[0] as unknown[];
    expect(closing[1]).toEqual({ publisherId: 'p1', endMonth: IsNull() });
    expect((closing[2] as { endMonth: string }).endMonth).toMatch(
      /^\d{4}-\d{2}-01$/,
    );
    expect((closing[2] as { note: null }).note).toBeNull();

    // And nothing deletes a spell.
    const deleted = ds.manager.delete.mock.calls.map((c: unknown[]) => c[0]);
    expect(deleted).not.toContain(PioneerSpell);
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

    const svc = new DataRightsService(
      ds as never,
      {
        todayFor: jest.fn().mockResolvedValue('2026-09-05'),
      } as never,
    );
    const res = (await svc.exportMyData('c1', 'u1')) as Record<string, unknown>;

    expect(res.account).toMatchObject({ email: 'a@b.c' });
    expect(res.publisher).toMatchObject({ id: 'p1' });
    expect(res).toHaveProperty('absences');
    expect(res).toHaveProperty('serviceReports');
    expect(res).toHaveProperty('devices');
  });
});
