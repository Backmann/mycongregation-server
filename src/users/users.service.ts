import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateUserDto } from './dto/create-user.dto';

/**
 * Public projection of a User — excludes sensitive fields (passwordHash)
 * and soft-delete metadata. Safe to return from HTTP endpoints.
 */
export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  uiLanguage: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    uiLanguage: u.uiLanguage,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

/** Postgres unique-violation SQLSTATE code. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService,
  ) {}

  count(): Promise<number> {
    return this.usersRepo.count();
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { id } });
  }

  /**
   * For login flow — explicitly selects passwordHash which is excluded by default.
   */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  touchLastLogin(id: string): Promise<unknown> {
    return this.usersRepo.update(id, { lastLoginAt: new Date() });
  }

  async updateUiLanguage(id: string, uiLanguage: string): Promise<User | null> {
    await this.usersRepo.update(id, { uiLanguage });
    return this.findById(id);
  }

  // ---------------------------------------------------------------------------
  // Admin user management (Phase 1 — roles-and-permissions.md)
  //
  // All methods below assume the caller has been authorized as an admin in
  // `congregationId`. They enforce multi-tenancy by scoping all queries to
  // the caller's congregation, and protect critical invariants such as
  // "you cannot lock the last admin out of the congregation".
  // ---------------------------------------------------------------------------

  async findAllInCongregation(congregationId: string): Promise<PublicUser[]> {
    const rows = await this.usersRepo.find({
      where: { congregationId },
      order: { createdAt: 'ASC' },
    });
    return rows.map(toPublicUser);
  }

  /**
   * Loads a user that must belong to the caller's congregation.
   * Throws NotFoundException if no match — including when the user exists
   * in another congregation (multi-tenancy enforcement).
   */
  async findByIdInCongregation(
    id: string,
    congregationId: string,
  ): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { id, congregationId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async createUserByAdmin(
    dto: CreateUserDto,
    congregationId: string,
    actorUserId: string,
  ): Promise<PublicUser> {
    const email = dto.email.trim().toLowerCase();

    // Pre-check for the common case (clean 409 even though the DB UNIQUE
    // constraint is the actual source of truth).
    const existing = await this.usersRepo.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await this.hashPassword(dto.password);

    const user = this.usersRepo.create({
      congregationId,
      email,
      passwordHash,
      role: dto.role,
      isActive: true,
      uiLanguage: dto.uiLanguage ?? 'ru',
    });

    try {
      await this.usersRepo.save(user);
    } catch (err) {
      // Race-condition fallback: another request inserted the same email
      // between our pre-check and save. The UNIQUE constraint catches it.
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code?: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw err;
    }

    await this.auditLog.logCreate({
      tenantId: congregationId,
      entityType: 'User',
      entityId: user.id,
      actorUserId,
      after: {
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        uiLanguage: user.uiLanguage,
      },
    });

    return toPublicUser(user);
  }

  async updateRoleByAdmin(
    targetId: string,
    newRole: UserRole,
    congregationId: string,
    actorUserId: string,
  ): Promise<PublicUser> {
    if (targetId === actorUserId) {
      throw new ForbiddenException('You cannot change your own role');
    }

    const user = await this.findByIdInCongregation(targetId, congregationId);
    const oldRole = user.role;
    if (oldRole === newRole) {
      return toPublicUser(user);
    }

    if (
      oldRole === UserRole.ADMIN &&
      newRole !== UserRole.ADMIN &&
      user.isActive
    ) {
      const adminCount =
        await this.countActiveAdminsInCongregation(congregationId);
      if (adminCount <= 1) {
        throw new ForbiddenException(
          'Cannot demote the last active admin in this congregation',
        );
      }
    }

    await this.usersRepo.update(targetId, { role: newRole });

    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'User',
      entityId: targetId,
      actorUserId,
      before: { role: oldRole },
      after: { role: newRole },
      fields: ['role'],
    });

    return toPublicUser({ ...user, role: newRole });
  }

  async setActiveByAdmin(
    targetId: string,
    isActive: boolean,
    congregationId: string,
    actorUserId: string,
  ): Promise<PublicUser> {
    if (targetId === actorUserId && !isActive) {
      throw new ForbiddenException('You cannot deactivate yourself');
    }

    const user = await this.findByIdInCongregation(targetId, congregationId);
    if (user.isActive === isActive) {
      return toPublicUser(user);
    }

    if (!isActive && user.role === UserRole.ADMIN) {
      const adminCount =
        await this.countActiveAdminsInCongregation(congregationId);
      if (adminCount <= 1) {
        throw new ForbiddenException(
          'Cannot deactivate the last active admin in this congregation',
        );
      }
    }

    await this.usersRepo.update(targetId, { isActive });

    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'User',
      entityId: targetId,
      actorUserId,
      before: { isActive: !isActive },
      after: { isActive },
      fields: ['isActive'],
    });

    return toPublicUser({ ...user, isActive });
  }

  async setPrivateAccessByAdmin(
    targetId: string,
    canViewPrivateData: boolean,
    congregationId: string,
    actorUserId: string,
  ): Promise<PublicUser> {
    const user = await this.findByIdInCongregation(targetId, congregationId);
    if (user.canViewPrivateData === canViewPrivateData) {
      return toPublicUser(user);
    }
    await this.usersRepo.update(targetId, { canViewPrivateData });
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'User',
      entityId: targetId,
      actorUserId,
      before: { canViewPrivateData: !canViewPrivateData },
      after: { canViewPrivateData },
      fields: ['canViewPrivateData'],
    });
    return toPublicUser({ ...user, canViewPrivateData });
  }

  /**
   * Change a user's login email (admin action) — e.g. to fix a typo made
   * when access was granted. Normalized to lowercase; must not collide
   * with any other account.
   */
  async changeEmailByAdmin(
    id: string,
    rawEmail: string,
    congregationId: string,
  ): Promise<void> {
    const user = await this.findByIdInCongregation(id, congregationId);
    const email = rawEmail.trim().toLowerCase();
    if (user.email === email) {
      return;
    }
    const existing = await this.usersRepo.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }
    user.email = email;
    try {
      await this.usersRepo.save(user);
    } catch (err) {
      // Race-condition fallback, same as createUserByAdmin.
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code?: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw err;
    }
  }

  async resetPasswordByAdmin(
    targetId: string,
    newPassword: string,
    congregationId: string,
    actorUserId: string,
  ): Promise<void> {
    // Verify target exists in the caller's congregation
    await this.findByIdInCongregation(targetId, congregationId);

    const passwordHash = await this.hashPassword(newPassword);
    await this.usersRepo.update(targetId, { passwordHash });

    // Mask the hash — never store the actual hash in the audit log.
    // logRawUpdate (no auto-diff) is required here because logUpdate would
    // treat the two equal '<redacted>' values as "unchanged" and write nothing.
    await this.auditLog.logRawUpdate({
      tenantId: congregationId,
      entityType: 'User',
      entityId: targetId,
      actorUserId,
      changedFields: ['passwordHash'],
      before: { passwordHash: '<redacted>' },
      after: { passwordHash: '<redacted>' },
    });
  }

  // ---------------------------------------------------------------------------
  // Self-service operations (Phase 1 follow-up)
  // ---------------------------------------------------------------------------

  /**
   * Self-service password change — the caller proves possession of the
   * current password before being allowed to set a new one. Available to
   * any authenticated user (no role restriction).
   *
   * Distinguished from `resetPasswordByAdmin` in the audit log by
   * `actorUserId === entityId` — a forensic marker that this was a self
   * action, not an admin reset.
   *
   * Throws:
   *   - NotFoundException when the user no longer exists (e.g. stale token
   *     against a deleted account)
   *   - BadRequestException when `currentPassword` does not match. NOT
   *     UnauthorizedException, because 401 would trigger the client's
   *     token-refresh interceptor — the caller IS still authenticated,
   *     they just typed the wrong current password.
   */
  async changePasswordSelfService(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    // passwordHash is excluded from the entity by default — re-add it.
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await this.hashPassword(newPassword);
    await this.usersRepo.update(userId, { passwordHash });

    await this.auditLog.logRawUpdate({
      tenantId: user.congregationId,
      entityType: 'User',
      entityId: userId,
      actorUserId: userId, // self-action: actor === target
      changedFields: ['passwordHash'],
      before: { passwordHash: '<redacted>' },
      after: { passwordHash: '<redacted>' },
    });
  }

  /**
   * Keep a linked publisher's login role in sync with their appointment.
   * Never touches admins (admin is an explicit, sticky elevation) and is a
   * no-op when the role already matches. No self-guard: this is a derived
   * change, not an interactive role edit.
   */
  async syncRoleFromAppointment(
    targetId: string,
    newRole: UserRole,
    congregationId: string,
    actorUserId?: string,
  ): Promise<void> {
    const user = await this.findByIdInCongregation(targetId, congregationId);
    if (user.role === UserRole.ADMIN || user.role === newRole) {
      return;
    }
    await this.usersRepo.update(targetId, { role: newRole });
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'User',
      entityId: targetId,
      actorUserId: actorUserId ?? targetId,
      before: { role: user.role },
      after: { role: newRole },
      fields: ['role'],
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private countActiveAdminsInCongregation(
    congregationId: string,
  ): Promise<number> {
    return this.usersRepo.count({
      where: { congregationId, role: UserRole.ADMIN, isActive: true },
    });
  }

  private hashPassword(password: string): Promise<string> {
    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    return bcrypt.hash(password, rounds);
  }
}
