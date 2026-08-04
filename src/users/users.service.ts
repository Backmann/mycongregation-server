import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { MailService } from '../mail/mail.service';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { Publisher } from '../entities/publisher.entity';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PresenceService } from '../presence/presence.service';
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
  /** Last authenticated activity (drives presence). Null = never active. */
  lastSeenAt: Date | null;
  /** True when lastSeenAt is within the online window at response time. */
  online: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Appointment of the linked publisher (null when no publisher is linked). */
  appointment: PublisherAppointment | null;
  /**
   * The publisher card this account speaks for, or null.
   *
   * Null is not a harmless gap: the app recognises a person THROUGH the card —
   * their report, assignments and group all hang off it. An account without
   * one can sign in and then find every personal screen closed to it, saying
   * only «свяжитесь со старейшиной». Which is why this now travels with the
   * list: an elder can see who is in that state before they discover it
   * themselves.
   */
  publisherId: string | null;
  /**
   * Whether a password has ever been set on this account.
   *
   * An account can be created and invited, and the invitation link is what
   * sets the password. Until then the person signing in is told «Invalid
   * credentials» — the same words as a wrong password — and there is no way
   * for anybody to tell the two apart. So the administrator gets the fact
   * that the login page must not give away.
   */
  hasPassword: boolean;
}

function toPublicUser(
  u: User,
  appointment: PublisherAppointment | null = null,
  now: number = Date.now(),
  publisherId: string | null = null,
): PublicUser {
  return {
    publisherId,
    hasPassword: !!u.passwordHash,
    id: u.id,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    uiLanguage: u.uiLanguage,
    lastLoginAt: u.lastLoginAt,
    lastSeenAt: u.lastSeenAt,
    online: PresenceService.isOnline(u.lastSeenAt, now),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    appointment,
  };
}

/** Postgres unique-violation SQLSTATE code. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
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
  /**
   * The address as the person typed it — which is not how it is stored.
   *
   * Everything that WRITES an address lowercases and trims it; the login
   * lookup compared what arrived, character for character. A capital from a
   * phone keyboard or a space picked up by copy-paste therefore answered
   * «Invalid credentials» to somebody whose password was perfectly right, and
   * there was no way for him to see what was wrong. The login rate limiter
   * normalised the same address one line earlier, which is how long this had
   * been half-done.
   *
   * LOWER() on the column rather than trusting the stored value: the very
   * first administrator of a congregation was written straight from the
   * bootstrap form without normalising, so mixed-case rows exist.
   */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = :email', {
        email: email.trim().toLowerCase(),
      })
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

  async findAllInCongregation(
    congregationId: string,
    viewerUserId: string,
  ): Promise<PublicUser[]> {
    // addSelect for the hash so we can answer «is one set» — the value never
    // leaves this method.
    const rows = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.congregation_id = :congregationId', { congregationId })
      .orderBy('user.created_at', 'ASC')
      .getMany();
    // Select only non-encrypted columns so publisher names aren't decrypted.
    const pubs = await this.publishersRepo
      .createQueryBuilder('p')
      .select(['p.id', 'p.userId', 'p.appointment'])
      .where('p.congregation_id = :cid', { cid: congregationId })
      .andWhere('p.user_id IS NOT NULL')
      .getMany();
    const apptByUser = new Map<string, PublisherAppointment>();
    const cardByUser = new Map<string, string>();
    for (const p of pubs) {
      if (p.userId) {
        apptByUser.set(p.userId, p.appointment);
        cardByUser.set(p.userId, p.id);
      }
    }
    const now = Date.now();
    return rows.map((u) => {
      const pub = toPublicUser(
        u,
        apptByUser.get(u.id) ?? null,
        now,
        cardByUser.get(u.id) ?? null,
      );
      // Presence is recorded for everyone but masked for users who hide it —
      // except when they are viewing their own row.
      if (u.hidePresence && u.id !== viewerUserId) {
        pub.online = false;
        pub.lastSeenAt = null;
      }
      return pub;
    });
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

  /**
   * Point an existing account at a publisher card, or clear the link.
   *
   * Repairs what the two ways of creating an account left inconsistent:
   * granting access FROM a card links it, while creating a login on the users
   * screen did not — and the person could then sign in to find every personal
   * screen shut, told only to «свяжитесь со старейшиной». Nobody could see who
   * was in that state, so it surfaced one complaint at a time.
   */
  async linkPublisher(
    userId: string,
    publisherId: string | null,
    congregationId: string,
    actorUserId: string,
  ): Promise<PublicUser> {
    const user = await this.usersRepo.findOne({
      where: { id: userId, congregationId },
    });
    if (!user) throw new NotFoundException('User not found');

    const previous = await this.publishersRepo.findOne({
      where: { congregationId, userId },
    });

    let next: Publisher | null = null;
    if (publisherId) {
      next = await this.publishersRepo.findOne({
        where: { id: publisherId, congregationId },
      });
      if (!next) throw new NotFoundException('Publisher not found');
      // One card, one account. Two accounts answering for the same person
      // would make «мои задания» mean two different things at once.
      if (next.userId && next.userId !== userId) {
        throw new ConflictException(
          'That publisher card already belongs to another account',
        );
      }
    }

    if (previous && previous.id !== publisherId) {
      previous.userId = null;
      await this.publishersRepo.save(previous);
    }
    if (next) {
      next.userId = userId;
      await this.publishersRepo.save(next);
    }

    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'user',
      entityId: userId,
      actorUserId,
      before: { publisherId: previous?.id ?? null },
      after: { publisherId: publisherId ?? null },
      fields: ['publisherId'],
    });

    return toPublicUser(
      user,
      next ? next.appointment : null,
      Date.now(),
      next ? next.id : null,
    );
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

    const passwordHash = dto.password
      ? await this.hashPassword(dto.password)
      : null;

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
      // Link the card in the same breath as creating the account. Doing it
      // afterwards is what left orphans: two steps, and the second forgotten.
      if (dto.publisherId) {
        const card = await this.publishersRepo.findOne({
          where: { id: dto.publisherId, congregationId },
        });
        if (card && !card.userId) {
          card.userId = user.id;
          await this.publishersRepo.save(card);
        }
      }
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
      entityType: 'user',
      entityId: user.id,
      actorUserId,
      after: {
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        uiLanguage: user.uiLanguage,
      },
    });

    // An account with no password and no invitation can never be signed into,
    // and nothing anywhere says so — it simply answers «Invalid credentials»
    // for ever. That is exactly how one login sat unusable for weeks: created
    // here without a password, while the invitation belongs to the OTHER path
    // (granting access from a publisher's card).
    //
    // So the account cannot be born dead: no password means an invitation,
    // always. Best-effort, and after the account exists — a mail server having
    // a bad minute must not undo a login that was created correctly. The
    // administrator sees «Пароль не задан» on the row either way and can set
    // one by hand.
    if (!dto.password) {
      try {
        await this.sendInvitation(user.id, user.email);
      } catch (err: unknown) {
        this.logger.warn(
          `invitation for a new login ${user.email} could not be sent: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }

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
    if (user.isOwner) {
      throw new ForbiddenException('The owner account is protected');
    }
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
      entityType: 'user',
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

    if (!isActive && user.isOwner) {
      throw new ForbiddenException('The owner account cannot be deactivated');
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
      entityType: 'user',
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
      entityType: 'user',
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
    if (user.isOwner) {
      throw new ForbiddenException('The owner account is protected');
    }
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

  // ---- Password reset (forgot password) ----

  /** Same normalisation as the login lookup — see the note there. */
  findByEmail(email: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = :email', {
        email: email.trim().toLowerCase(),
      })
      .getOne();
  }

  async setPasswordResetToken(
    id: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.usersRepo.update(
      { id },
      { resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt },
    );
  }

  /** Active user with a matching, unexpired reset token — or null. */
  findByValidResetToken(tokenHash: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .where('user.resetTokenHash = :tokenHash', { tokenHash })
      .andWhere('user.resetTokenExpiresAt > :now', { now: new Date() })
      .andWhere('user.isActive = :active', { active: true })
      .getOne();
  }

  async completePasswordReset(id: string, passwordHash: string): Promise<void> {
    await this.usersRepo.update(
      { id },
      {
        passwordHash,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    );
  }

  async resetPasswordByAdmin(
    targetId: string,
    newPassword: string,
    congregationId: string,
    actorUserId: string,
  ): Promise<void> {
    // Verify target exists in the caller's congregation
    const user = await this.findByIdInCongregation(targetId, congregationId);
    if (user.isOwner && actorUserId !== targetId) {
      throw new ForbiddenException('The owner account is protected');
    }

    const passwordHash = await this.hashPassword(newPassword);
    await this.usersRepo.update(targetId, { passwordHash });

    // Mask the hash — never store the actual hash in the audit log.
    // logRawUpdate (no auto-diff) is required here because logUpdate would
    // treat the two equal '<redacted>' values as "unchanged" and write nothing.
    await this.auditLog.logRawUpdate({
      tenantId: congregationId,
      entityType: 'user',
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

    if (!user.passwordHash) {
      // Invited account that has not set a password yet — direct them
      // to set a password via the invitation link instead.
      throw new BadRequestException(
        'Set a password via the invitation link first',
      );
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await this.hashPassword(newPassword);
    await this.usersRepo.update(userId, { passwordHash });

    await this.auditLog.logRawUpdate({
      tenantId: user.congregationId,
      entityType: 'user',
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
      entityType: 'user',
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

  /**
   * Issue a 72h invitation token for an account and email the link, so
   * the invited person sets their own password via /reset-password.
   */
  async sendInvitation(userId: string, email: string): Promise<void> {
    const THREE_DAYS = 72 * 60 * 60 * 1000;
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + THREE_DAYS);
    await this.setPasswordResetToken(userId, tokenHash, expiresAt);
    const user = await this.findById(userId);
    const lang = user?.uiLanguage ?? 'ru';
    const base =
      this.config.get<string>('PUBLIC_APP_URL') ?? 'https://mycongregation.org';
    const link = `${base}/reset-password?token=${token}`;
    await this.mailService.sendInvite(email, lang, link);
  }

  private hashPassword(password: string): Promise<string> {
    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    return bcrypt.hash(password, rounds);
  }
}
