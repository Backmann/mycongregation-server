import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';
import { Publisher } from '../entities/publisher.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MailService } from '../mail/mail.service';

type MockRepo<T extends object = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const makeQueryBuilder = () => ({
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
});

const makeUsersRepo = (): MockRepo<User> => ({
  count: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn().mockImplementation((x) => x),
  save: jest.fn().mockImplementation(async (x) => x),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  createQueryBuilder: jest.fn(),
});

const makePublishersRepo = (): MockRepo<Publisher> => ({
  createQueryBuilder: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })) as unknown as jest.Mock,
});

const makeAuditLog = (): jest.Mocked<Partial<AuditLogService>> => ({
  logUpdate: jest.fn().mockResolvedValue(undefined),
  logCreate: jest.fn().mockResolvedValue(undefined),
  logRawUpdate: jest.fn().mockResolvedValue(undefined),
});

const CONG = 'cong-1';
const ADMIN_ID = 'admin-1';

function userFixture(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    congregationId: CONG,
    email: 'a@b.com',
    passwordHash: 'hash',
    role: UserRole.PUBLISHER,
    isActive: true,
    uiLanguage: 'ru',
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as User;
}

describe('UsersService — admin management (Phase 1 RBAC)', () => {
  let service: UsersService;
  let repo: MockRepo<User>;
  let audit: jest.Mocked<Partial<AuditLogService>>;

  beforeEach(async () => {
    repo = makeUsersRepo();
    audit = makeAuditLog();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        {
          provide: getRepositoryToken(Publisher),
          useValue: makePublishersRepo(),
        },
        {
          provide: MailService,
          useValue: {
            sendInvite: jest.fn().mockResolvedValue(undefined),
            sendPasswordReset: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AuditLogService, useValue: audit },
        {
          provide: ConfigService,
          useValue: {
            // Low bcrypt rounds keep the test suite fast — never use 4 in prod.
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'bcrypt.rounds') return 4;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // ---------------------------------------------------------------------------
  // findAllInCongregation
  // ---------------------------------------------------------------------------

  describe('findAllInCongregation', () => {
    /** The list is read through a query builder — see the first test. */
    const listReturns = (rows: unknown[]) => {
      const qb = {
        addSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
      };
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      // The list also asks for each person's latest session — «с чего он
      // заходит» — through the entity manager.
      (repo as unknown as { manager: unknown }).manager = {
        getRepository: () => ({
          createQueryBuilder: () => ({
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            addOrderBy: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue([]),
          }),
        }),
      };
      return qb;
    };

    it('returns users in the caller congregation sorted by createdAt ASC', async () => {
      // The list is read through a query builder now, so it can also answer
      // «has this account a password at all» without ever returning the hash.
      const qb = listReturns([
        userFixture({ id: 'u-1' }),
        userFixture({ id: 'u-2' }),
      ]);

      const result = await service.findAllInCongregation(CONG, 'viewer-1');

      expect(qb.where).toHaveBeenCalledWith(
        'user.congregation_id = :congregationId',
        { congregationId: CONG },
      );
      expect(result).toHaveLength(2);
      // passwordHash must never leak through the PublicUser projection
      expect((result[0] as any).passwordHash).toBeUndefined();
    });

    it('reads what a person uses from his own row, not from a session', async () => {
      // It used to come from the newest session, which is written only at
      // sign-in or on a token refresh — so a brother who had just installed a
      // new build went on reading «Неизвестно» for as long as a day. The row
      // is written on every request instead.
      listReturns([
        userFixture({
          id: 'u-1',
          clientPlatform: 'android',
          clientKind: 'app',
          clientOs: '36',
          clientAppVersion: '1.1.0',
          clientSeenAt: new Date('2026-08-12T10:00:00Z'),
        }),
      ]);

      const result = await service.findAllInCongregation(CONG, 'viewer-1');

      expect(result[0].lastClient).toMatchObject({
        platform: 'android',
        kind: 'app',
        os: '36',
        appVersion: '1.1.0',
      });
    });

    it('masks presence of hidden users for other viewers', async () => {
      listReturns([
        userFixture({ id: 'u-1', hidePresence: true, lastSeenAt: new Date() }),
        userFixture({ id: 'u-2', lastSeenAt: new Date() }),
      ]);
      const result = await service.findAllInCongregation(CONG, 'other');
      const hidden = result.find((r) => r.id === 'u-1')!;
      const visible = result.find((r) => r.id === 'u-2')!;
      expect(hidden.online).toBe(false);
      expect(hidden.lastSeenAt).toBeNull();
      expect(visible.online).toBe(true);
    });

    it('shows hidden users their own presence', async () => {
      listReturns([
        userFixture({ id: 'u-1', hidePresence: true, lastSeenAt: new Date() }),
      ]);
      const result = await service.findAllInCongregation(CONG, 'u-1');
      expect(result[0].online).toBe(true);
    });
  });

  describe('owner protection', () => {
    it('forbids changing the owner role', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', isOwner: true, role: UserRole.ADMIN }),
      );
      await expect(
        service.updateRoleByAdmin('u-1', UserRole.ELDER, CONG, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('forbids deactivating the owner', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', isOwner: true, isActive: true }),
      );
      await expect(
        service.setActiveByAdmin('u-1', false, CONG, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('forbids another admin resetting the owner password', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', isOwner: true }),
      );
      await expect(
        service.resetPasswordByAdmin('u-1', 'newpass123', CONG, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets the owner reset their own password', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', isOwner: true }),
      );
      await service.resetPasswordByAdmin('u-1', 'newpass123', CONG, 'u-1');
      expect(repo.update).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // findByIdInCongregation
  // ---------------------------------------------------------------------------

  describe('findByIdInCongregation', () => {
    it('returns user when found in the caller congregation', async () => {
      const u = userFixture();
      (repo.findOne as jest.Mock).mockResolvedValue(u);
      const result = await service.findByIdInCongregation('u-1', CONG);
      expect(result).toBe(u);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'u-1', congregationId: CONG },
      });
    });

    it('throws NotFoundException when user is in another congregation', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.findByIdInCongregation('u-1', CONG),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // createUserByAdmin
  // ---------------------------------------------------------------------------

  describe('createUserByAdmin', () => {
    it('invites a login created without a password', async () => {
      // An account with neither a password nor an invitation can never be
      // signed into, and nothing says so: it answers «Invalid credentials»
      // for ever. One login sat unusable for weeks exactly this way.
      (repo.findOne as jest.Mock).mockResolvedValue(null);
      const sendInvitation = jest
        .spyOn(service, 'sendInvitation')
        .mockResolvedValue(undefined);

      await service.createUserByAdmin(
        { email: 'new@example.org', role: UserRole.PUBLISHER } as never,
        CONG,
        'actor-1',
      );

      expect(sendInvitation).toHaveBeenCalled();
    });

    it('sends nothing when the administrator set a password', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(null);
      const sendInvitation = jest
        .spyOn(service, 'sendInvitation')
        .mockResolvedValue(undefined);

      await service.createUserByAdmin(
        {
          email: 'new2@example.org',
          role: UserRole.PUBLISHER,
          password: 'longenough1',
        } as never,
        CONG,
        'actor-1',
      );

      expect(sendInvitation).not.toHaveBeenCalled();
    });

    it('keeps the account when the invitation cannot be sent', async () => {
      // A mail server having a bad minute must not undo a login that was
      // created correctly; the row shows «Пароль не задан» either way.
      (repo.findOne as jest.Mock).mockResolvedValue(null);
      jest
        .spyOn(service, 'sendInvitation')
        .mockRejectedValue(new Error('smtp down'));

      await expect(
        service.createUserByAdmin(
          { email: 'new3@example.org', role: UserRole.PUBLISHER } as never,
          CONG,
          'actor-1',
        ),
      ).resolves.toBeDefined();
    });

    it('normalises email, hashes password, audits creation, omits sensitive fields', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(null);
      (repo.save as jest.Mock).mockImplementation(async (u: User) => {
        u.id = 'new-1';
        return u;
      });

      const result = await service.createUserByAdmin(
        {
          email: '  Foo@BAR.com  ',
          password: 'verysecret',
          role: UserRole.ELDER,
        },
        CONG,
        ADMIN_ID,
      );

      const created = (repo.create as jest.Mock).mock.calls[0][0];
      expect(created.email).toBe('foo@bar.com');
      expect(created.role).toBe(UserRole.ELDER);
      expect(created.isActive).toBe(true);
      expect(created.uiLanguage).toBe('ru'); // default
      // Password is actually hashed
      expect(created.passwordHash).not.toBe('verysecret');
      const ok = await bcrypt.compare('verysecret', created.passwordHash);
      expect(ok).toBe(true);

      // Audit log payload must NOT include passwordHash
      expect(audit.logCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: CONG,
          entityType: 'user',
          actorUserId: ADMIN_ID,
          after: expect.objectContaining({
            email: 'foo@bar.com',
            role: UserRole.ELDER,
            isActive: true,
            uiLanguage: 'ru',
          }),
        }),
      );
      const auditCall = (audit.logCreate as jest.Mock).mock.calls[0][0];
      expect(auditCall.after.passwordHash).toBeUndefined();

      // PublicUser projection returned to caller never includes passwordHash
      expect(result.email).toBe('foo@bar.com');
      expect((result as any).passwordHash).toBeUndefined();
    });

    it('throws ConflictException when email already exists (pre-check)', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(userFixture());
      await expect(
        service.createUserByAdmin(
          {
            email: 'a@b.com',
            password: 'verysecret',
            role: UserRole.PUBLISHER,
          },
          CONG,
          ADMIN_ID,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
      expect(audit.logCreate).not.toHaveBeenCalled();
    });

    it('respects explicit uiLanguage when provided', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(null);
      await service.createUserByAdmin(
        {
          email: 'a@b.com',
          password: 'verysecret',
          role: UserRole.PUBLISHER,
          uiLanguage: 'de',
        },
        CONG,
        ADMIN_ID,
      );
      const created = (repo.create as jest.Mock).mock.calls[0][0];
      expect(created.uiLanguage).toBe('de');
    });
  });

  // ---------------------------------------------------------------------------
  // updateRoleByAdmin
  // ---------------------------------------------------------------------------

  describe('updateRoleByAdmin', () => {
    it('forbids changing own role', async () => {
      await expect(
        service.updateRoleByAdmin(ADMIN_ID, UserRole.ELDER, CONG, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('is a no-op when newRole equals current role', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', role: UserRole.ELDER }),
      );
      const result = await service.updateRoleByAdmin(
        'u-1',
        UserRole.ELDER,
        CONG,
        ADMIN_ID,
      );
      expect(repo.update).not.toHaveBeenCalled();
      expect(audit.logUpdate).not.toHaveBeenCalled();
      expect(result.role).toBe(UserRole.ELDER);
    });

    it('forbids demoting the last active admin', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', role: UserRole.ADMIN, isActive: true }),
      );
      (repo.count as jest.Mock).mockResolvedValue(1);
      await expect(
        service.updateRoleByAdmin('u-1', UserRole.ELDER, CONG, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
      expect(audit.logUpdate).not.toHaveBeenCalled();
    });

    it('allows demoting admin when another active admin exists', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', role: UserRole.ADMIN, isActive: true }),
      );
      (repo.count as jest.Mock).mockResolvedValue(2);
      const result = await service.updateRoleByAdmin(
        'u-1',
        UserRole.ELDER,
        CONG,
        ADMIN_ID,
      );
      expect(repo.update).toHaveBeenCalledWith('u-1', { role: UserRole.ELDER });
      expect(audit.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          before: { role: UserRole.ADMIN },
          after: { role: UserRole.ELDER },
          fields: ['role'],
        }),
      );
      expect(result.role).toBe(UserRole.ELDER);
    });

    it('promotes a non-admin without admin-count check', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', role: UserRole.PUBLISHER }),
      );
      const result = await service.updateRoleByAdmin(
        'u-1',
        UserRole.ADMIN,
        CONG,
        ADMIN_ID,
      );
      expect(repo.count).not.toHaveBeenCalled();
      expect(result.role).toBe(UserRole.ADMIN);
    });

    it('throws NotFoundException when user is in another congregation', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.updateRoleByAdmin('u-1', UserRole.ELDER, CONG, ADMIN_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // setActiveByAdmin
  // ---------------------------------------------------------------------------

  describe('setActiveByAdmin', () => {
    it('forbids deactivating self', async () => {
      await expect(
        service.setActiveByAdmin(ADMIN_ID, false, CONG, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('allows activating self (no-op when already active)', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: ADMIN_ID, isActive: true }),
      );
      const result = await service.setActiveByAdmin(
        ADMIN_ID,
        true,
        CONG,
        ADMIN_ID,
      );
      expect(repo.update).not.toHaveBeenCalled();
      expect(audit.logUpdate).not.toHaveBeenCalled();
      expect(result.isActive).toBe(true);
    });

    it('is a no-op when current isActive already matches desired', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', isActive: false }),
      );
      await service.setActiveByAdmin('u-1', false, CONG, ADMIN_ID);
      expect(repo.update).not.toHaveBeenCalled();
      expect(audit.logUpdate).not.toHaveBeenCalled();
    });

    it('forbids deactivating the last active admin', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', role: UserRole.ADMIN, isActive: true }),
      );
      (repo.count as jest.Mock).mockResolvedValue(1);
      await expect(
        service.setActiveByAdmin('u-1', false, CONG, ADMIN_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('allows deactivating admin when another active admin exists', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', role: UserRole.ADMIN, isActive: true }),
      );
      (repo.count as jest.Mock).mockResolvedValue(2);
      const result = await service.setActiveByAdmin(
        'u-1',
        false,
        CONG,
        ADMIN_ID,
      );
      expect(repo.update).toHaveBeenCalledWith('u-1', { isActive: false });
      expect(audit.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          before: { isActive: true },
          after: { isActive: false },
          fields: ['isActive'],
        }),
      );
      expect(result.isActive).toBe(false);
    });

    it('reactivates a non-admin without admin-count check', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', role: UserRole.PUBLISHER, isActive: false }),
      );
      const result = await service.setActiveByAdmin(
        'u-1',
        true,
        CONG,
        ADMIN_ID,
      );
      expect(repo.count).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith('u-1', { isActive: true });
      expect(result.isActive).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // resetPasswordByAdmin
  // ---------------------------------------------------------------------------

  describe('setPrivateAccessByAdmin', () => {
    it('grants private-data access and audits the change', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({
          id: 'u-1',
          role: UserRole.MINISTERIAL_SERVANT,
          canViewPrivateData: false,
        }),
      );
      const result = await service.setPrivateAccessByAdmin(
        'u-1',
        true,
        CONG,
        ADMIN_ID,
      );
      expect(repo.update).toHaveBeenCalledWith('u-1', {
        canViewPrivateData: true,
      });
      expect(audit.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          before: { canViewPrivateData: false },
          after: { canViewPrivateData: true },
          fields: ['canViewPrivateData'],
        }),
      );
      expect(result.id).toBe('u-1');
    });

    it('is a no-op when the flag is unchanged', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        userFixture({ id: 'u-1', canViewPrivateData: true }),
      );
      await service.setPrivateAccessByAdmin('u-1', true, CONG, ADMIN_ID);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('resetPasswordByAdmin', () => {
    it('hashes the new password, updates, audits with redacted fields', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(userFixture({ id: 'u-1' }));

      await service.resetPasswordByAdmin('u-1', 'newpass123', CONG, ADMIN_ID);

      const updateCall = (repo.update as jest.Mock).mock.calls[0];
      expect(updateCall[0]).toBe('u-1');
      const hash = updateCall[1].passwordHash;
      const ok = await bcrypt.compare('newpass123', hash);
      expect(ok).toBe(true);

      expect(audit.logRawUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: CONG,
          entityType: 'user',
          entityId: 'u-1',
          actorUserId: ADMIN_ID,
          changedFields: ['passwordHash'],
          before: { passwordHash: '<redacted>' },
          after: { passwordHash: '<redacted>' },
        }),
      );
    });

    it('throws NotFoundException when user is in another congregation', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.resetPasswordByAdmin('u-1', 'newpass123', CONG, ADMIN_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
      expect(audit.logRawUpdate).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // changePasswordSelfService (Phase 1 follow-up)
  // ---------------------------------------------------------------------------

  describe('changePasswordSelfService', () => {
    /**
     * The method loads the user via createQueryBuilder (to re-include the
     * normally-excluded passwordHash). Tests prime that builder so the
     * mocked `getOne` returns the fixture we want for each scenario.
     */
    async function primeQbWithUser(user: User | null): Promise<void> {
      const qb = makeQueryBuilder();
      qb.getOne.mockResolvedValue(user);
      (repo.createQueryBuilder as jest.Mock).mockReturnValue(qb);
    }

    it('hashes and updates the new password, audits as a self-action', async () => {
      // Set up a real hash for the "current password" check
      const realHash = await bcrypt.hash('oldsecret', 4);
      await primeQbWithUser(userFixture({ id: 'u-1', passwordHash: realHash }));

      await service.changePasswordSelfService('u-1', 'oldsecret', 'newpass123');

      const updateCall = (repo.update as jest.Mock).mock.calls[0];
      expect(updateCall[0]).toBe('u-1');
      const newHash = updateCall[1].passwordHash;
      expect(await bcrypt.compare('newpass123', newHash)).toBe(true);

      // Audit shows self-action (actorUserId === entityId) and redacted hashes.
      expect(audit.logRawUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: CONG,
          entityType: 'user',
          entityId: 'u-1',
          actorUserId: 'u-1',
          changedFields: ['passwordHash'],
          before: { passwordHash: '<redacted>' },
          after: { passwordHash: '<redacted>' },
        }),
      );
    });

    it('throws BadRequestException when current password is wrong (NOT 401)', async () => {
      const realHash = await bcrypt.hash('actualcurrent', 4);
      await primeQbWithUser(userFixture({ id: 'u-1', passwordHash: realHash }));

      await expect(
        service.changePasswordSelfService('u-1', 'wrongguess', 'newpass123'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
      expect(audit.logRawUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when user no longer exists', async () => {
      await primeQbWithUser(null);

      await expect(
        service.changePasswordSelfService('u-1', 'anything', 'newpass123'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
      expect(audit.logRawUpdate).not.toHaveBeenCalled();
    });
  });
});

/**
 * Linking an account to a publisher card.
 *
 * The two ways of creating a login behaved differently — granting access from
 * a card linked it, creating a login on the users screen did not — and an
 * unlinked account can sign in only to find every personal screen closed. This
 * is the repair, so it is worth pinning down.
 */
describe('UsersService.linkPublisher', () => {
  const CONG2 = 'cong-1';
  let service: UsersService;
  let users: MockRepo<User>;
  let publishers: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    users = makeUsersRepo();
    users.findOne!.mockResolvedValue(userFixture({ id: 'u-1' }));
    publishers = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Publisher), useValue: publishers },
        {
          provide: MailService,
          useValue: {
            sendInvite: jest.fn(),
            sendPasswordReset: jest.fn(),
          },
        },
        { provide: AuditLogService, useValue: makeAuditLog() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(4) },
        },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  it('points the account at the card', async () => {
    publishers.findOne.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.id === 'p-1' ? ({ id: 'p-1', userId: null } as Publisher) : null,
      ),
    );
    const out = await service.linkPublisher('u-1', 'p-1', CONG2, 'admin-1');
    expect(publishers.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-1', userId: 'u-1' }),
    );
    expect(out.publisherId).toBe('p-1');
  });

  // One card, one account: two logins answering for the same person would make
  // «мои задания» mean two different things at once.
  it('refuses a card that already belongs to somebody else', async () => {
    publishers.findOne.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.id === 'p-1'
          ? ({ id: 'p-1', userId: 'someone-else' } as Publisher)
          : null,
      ),
    );
    await expect(
      service.linkPublisher('u-1', 'p-1', CONG2, 'admin-1'),
    ).rejects.toThrow();
    expect(publishers.save).not.toHaveBeenCalled();
  });

  it('releases the previous card when the account is moved', async () => {
    const prev = { id: 'p-old', userId: 'u-1' } as Publisher;
    publishers.findOne.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.userId
          ? prev
          : where.id === 'p-new'
            ? ({ id: 'p-new', userId: null } as Publisher)
            : null,
      ),
    );
    await service.linkPublisher('u-1', 'p-new', CONG2, 'admin-1');
    expect(publishers.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-old', userId: null }),
    );
  });

  // An administrator who is not a publisher here has no card to point at, and
  // refusing that would lock out the one person able to fix everything else.
  it('allows an account with no card at all', async () => {
    publishers.findOne.mockResolvedValue(null);
    const out = await service.linkPublisher('u-1', null, CONG2, 'admin-1');
    expect(out.publisherId).toBeNull();
  });
});
