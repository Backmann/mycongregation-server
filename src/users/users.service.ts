import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, QueryFailedError, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  makeInviteCode,
  formatInviteCode,
  hashInviteCode,
  INVITE_CODE_LIFETIME_MS,
  RESET_CODE_LIFETIME_MS,
} from '../auth/invite-code';
import { MailService } from '../mail/mail.service';
import { User } from '../entities/user.entity';
import { Publisher } from '../entities/publisher.entity';
import { Gender } from '../common/enums/gender.enum';
import { RefreshSession } from '../entities/refresh-session.entity';
import { Congregation } from '../entities/congregation.entity';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PresenceService } from '../presence/presence.service';
import { CreateUserDto } from './dto/create-user.dto';
import { passwordProblem } from '../auth/password-policy';
import {
  hashPassword as hashClean,
  passwordMatches,
} from '../auth/password-edges';
import {
  loginNameFrom,
  loginNameFromEmail,
  loginNameProblem,
  looksLikeEmail,
  settleLoginName,
} from './login-name';

/**
 * Public projection of a User — excludes sensitive fields (passwordHash)
 * and soft-delete metadata. Safe to return from HTTP endpoints.
 */
export interface PublicUser {
  id: string;
  /** Where letters go, or null: most of this congregation has no address. */
  email: string | null;
  /**
   * What this person types to sign in. Shown to administrators so that
   * «я забыл имя входа» is one question to an elder rather than a dead end.
   */
  loginName: string | null;
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
   * Of the linked publisher, or null when there is no card.
   *
   * Here for one screen: congregational responsibilities are held by brothers,
   * and the picker offered every account in the congregation — sisters with a
   * login among them. Not a private field in the sense the card's contacts
   * are: the roster shows it to everybody who can see a name.
   */
  gender: Gender | null;
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
  /** The name on that card — whose account this is. Null without a card. */
  publisherName: string | null;
  /**
   * The last time this account was turned away, when that was AFTER the last
   * time it got in — and which of the reasons. Null otherwise.
   */
  lastFailedLoginAt: Date | null;
  lastFailedLoginReason: string | null;
  /**
   * When this account's invitation code stops working, or null when there is
   * no invitation outstanding.
   *
   * Admin-only, like the rest of this list, and it exists for one question an
   * elder had no way to answer: is this person waiting on a code that still
   * works, or on one that died three weeks ago? Five people here were in the
   * second state, and nothing on any screen said so — it took a query against
   * the database to find them.
   */
  inviteExpiresAt: Date | null;
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
  /**
   * What this person last used — a platform and a kind, and when.
   *
   * The question behind it is «кто ещё не поставил приложение»: a brother on a
   * browser gets no push notifications and has no build to update. Null until
   * he signs in again, because older sessions never recorded it.
   */
  lastClient: {
    platform: string;
    kind: string;
    /** OS version as the client stated it; null when it did not say. */
    os: string | null;
    /** Which build of ours he is on; null in a browser. */
    appVersion: string | null;
    /**
     * Whether that build is behind the one being handed out — the whole point
     * of showing a version. Null when there is nothing to compare against.
     */
    outdated: boolean | null;
    at: Date | null;
  } | null;
}

/**
 * Is this build older than the one being handed out.
 *
 * Numeric, part by part: «1.2.10» is newer than «1.2.9», which a string
 * comparison gets backwards — the one place this could quietly mislead.
 */
function behindCurrent(
  mine: string | null,
  current: string | null,
): boolean | null {
  if (!mine || !current) return null;
  const a = mine.split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

function toPublicUser(
  u: User,
  appointment: PublisherAppointment | null = null,
  now: number = Date.now(),
  publisherId: string | null = null,
  lastClient: PublicUser['lastClient'] = null,
  gender: Gender | null = null,
  publisherName: string | null = null,
): PublicUser {
  // The same rule as the card: a refusal older than the last time the person
  // got in is history, not a reason to help.
  const failedAt =
    u.lastFailedLoginAt &&
    (!u.lastLoginAt || u.lastFailedLoginAt.getTime() > u.lastLoginAt.getTime())
      ? u.lastFailedLoginAt
      : null;
  return {
    gender,
    publisherName,
    lastFailedLoginAt: failedAt,
    lastFailedLoginReason: failedAt ? (u.lastFailedLoginReason ?? null) : null,
    publisherId,
    hasPassword: !!u.passwordHash,
    inviteExpiresAt: u.inviteCodeExpiresAt ?? null,
    lastClient,
    id: u.id,
    email: u.email,
    loginName: u.loginName ?? null,
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

/**
 * What an invitation produced: the code to hand over, when it dies, and the
 * address it was mailed to — null when there was nowhere to mail it.
 */
export interface InvitationIssued {
  code: string;
  expiresAt: Date;
  sentTo: string | null;
}

/**
 * A new account, plus the invitation it was born with.
 *
 * The code travels back with the account or not at all: only its hash is
 * stored, so nothing can look it up afterwards. That is deliberate — a code
 * that could be read out of the database twice would be a password lying in
 * a table — but it means whoever needs to show it must be handed it here.
 */
export interface CreatedUser extends PublicUser {
  invitation?: InvitationIssued;
}

/** Postgres unique-violation SQLSTATE code. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * A new password ends every OTHER way in that was handed out before it.
 *
 * Found on 7 October 2026, on the stand: an elder set a sister's password,
 * and the invitation code from her letter — still good for weeks — set a
 * different one a minute later. His password stopped working, the card said
 * «пароль задан», and nothing anywhere said a code was alive. The two paths
 * that end an invitation cleared the code and the link; the two where a
 * password is simply set (by an elder, by the person in the profile) did
 * not. One object now, used by all four, so a fifth cannot forget.
 */
export function freshPassword(passwordHash: string) {
  return {
    passwordHash,
    inviteCodeHash: null,
    inviteCodeExpiresAt: null,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
  };
}

/** Why an account was last turned away at the door — see noteFailedLogin. */
/**
 * One place a person is signed in right now — a platform and a kind, the same
 * two words the session row keeps, and nothing that names a device.
 */
export interface SignedInPlace {
  /** android · ios · windows · mac · other — or null on a session older than the record. */
  platform: string | null;
  /** app · browser · homescreen. */
  kind: string | null;
  os: string | null;
  appVersion: string | null;
  /** When they signed in there. */
  since: Date;
  /** When that sign-in last renewed itself — about when it was last opened. */
  lastActiveAt: Date;
  /** The one this very request came from. */
  current: boolean;
}

/**
 * See UsersService.forgetDeadSessions. A day of slack past the expiry, so a
 * clock that disagrees by an hour deletes nothing that could still be asked
 * for. Exported so the stand can run these very words against a real table.
 */
export const FORGET_DEAD_SESSIONS_SQL = `
  DELETE FROM refresh_sessions s
  WHERE s.expires_at < now() - interval '1 day'
    AND NOT (
      s.id = s.family_id
      AND EXISTS (
        SELECT 1 FROM refresh_sessions alive
        WHERE alive.family_id = s.family_id
          AND alive.revoked_at IS NULL
          AND alive.expires_at > now()
      )
    )
`;

export type FailedLoginReason =
  | 'wrong_password'
  | 'no_password'
  | 'disabled'
  | 'code_expired';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(RefreshSession)
    private readonly sessionsRepo: Repository<RefreshSession>,
    /**
     * Read for one line of one letter: whose congregation this invitation is
     * from. A letter arriving from an unknown domain and asking somebody to
     * set a password is, to a careful reader, indistinguishable from a trick —
     * and the careful readers are exactly the ones who will not click.
     */
    @InjectRepository(Congregation)
    private readonly congregationsRepo: Repository<Congregation>,
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

  /**
   * Who is trying to sign in — by login name, or by address as before.
   *
   * The two are told apart by the @ and nothing else, so the answer never
   * depends on what happens to be in the database.
   *
   * `shared` is the case the address alone can no longer answer: now that an
   * address may belong to several logins (a couple with one mailbox), it stops
   * being enough to say who you are. We do NOT try each password in turn —
   * that would work, but it makes one person's wrong password count against
   * the other's rate limit, and turns a forgotten password into two letters.
   * The person is asked for their name instead, which they have.
   */
  async findForLogin(
    identifier: string,
  ): Promise<{ user: User | null; shared: boolean }> {
    const value = identifier.trim().toLowerCase();
    if (value === '') return { user: null, shared: false };

    if (!looksLikeEmail(value)) {
      const user = await this.usersRepo
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('LOWER(user.login_name) = :name', { name: value })
        .getOne();
      return { user, shared: false };
    }

    const matches = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = :email', { email: value })
      .getMany();
    if (matches.length > 1) return { user: null, shared: true };
    return { user: matches[0] ?? null, shared: false };
  }

  /**
   * Every account a forgotten-password request could mean.
   *
   * A login name means exactly one. An address may mean several now, and all
   * of them get a letter — each naming its own reader, so one shared mailbox
   * does not become a puzzle.
   */
  /**
   * Every account a request for a fresh invitation could mean, WITH the
   * password hash — because the one thing this must not do is mail somebody
   * who has already finished their invitation.
   *
   * Separate from findAllForReset for that reason alone: that one does not
   * select the hash, and a hash that is merely absent from the query reads as
   * «no password set» and would turn this door into a way of mailing anybody.
   */
  async findAllWaitingForInvite(identifier: string): Promise<User[]> {
    const value = identifier.trim().toLowerCase();
    if (value === '') return [];
    const column = looksLikeEmail(value) ? 'user.email' : 'user.login_name';
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where(`LOWER(${column}) = :value`, { value })
      .getMany();
  }

  async findAllForReset(identifier: string): Promise<User[]> {
    const value = identifier.trim().toLowerCase();
    if (value === '') return [];
    const column = looksLikeEmail(value) ? 'user.email' : 'user.login_name';
    return this.usersRepo
      .createQueryBuilder('user')
      .where(`LOWER(${column}) = :value`, { value })
      .getMany();
  }

  /**
   * The name for a new account: the one an elder typed, or one built from the
   * card.
   *
   * A typed name is judged and refused if it cannot be used — silently
   * replacing it with a generated one would leave the elder telling somebody a
   * name that is not theirs.
   */
  private async chooseLoginName(
    requested: string | undefined,
    card: Publisher | null,
    email: string | null,
  ): Promise<string> {
    const wanted = requested?.trim().toLowerCase();
    if (wanted) {
      const problem = loginNameProblem(wanted);
      if (problem) {
        throw new BadRequestException({ code: 'BAD_LOGIN_NAME', problem });
      }
      if (await this.loginNameTaken(wanted)) {
        throw new ConflictException({ code: 'LOGIN_NAME_TAKEN' });
      }
      return wanted;
    }
    return this.settleLoginNameFor({
      firstName: card?.firstName,
      lastName: card?.lastName,
      email,
    });
  }

  /** Is this login name free? Deleted accounts do not hold one — see the index. */
  private async loginNameTaken(candidate: string): Promise<boolean> {
    const count = await this.usersRepo
      .createQueryBuilder('user')
      .where('LOWER(user.login_name) = :name', { name: candidate })
      .getCount();
    return count > 0;
  }

  /**
   * A name for a new account, from the card if there is one and from the
   * address if there is not.
   *
   * Every path that creates a login comes through here. Two paths deciding
   * this separately is the shape of every account bug we have had: one of them
   * always ends up doing half the job.
   */
  async settleLoginNameFor(input: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  }): Promise<string> {
    const fromCard = loginNameFrom(input.lastName, input.firstName);
    const preferred =
      fromCard !== '' ? fromCard : loginNameFromEmail(input.email);
    return settleLoginName(preferred, (candidate) =>
      this.loginNameTaken(candidate),
    );
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
      // …and for the last refusal, so the list can say who is stuck at the
      // door without anybody opening sixty cards one by one.
      .addSelect(['user.lastFailedLoginAt', 'user.lastFailedLoginReason'])
      .where('user.congregation_id = :congregationId', { congregationId })
      .orderBy('user.created_at', 'ASC')
      .getMany();

    // What each person is using is read from HIS OWN ROW: it is written on
    // every request, so the picture is right within a minute of him opening
    // the app. It used to be read from his newest session, which is written
    // only at sign-in or on a token refresh — and that is why a brother who
    // had just installed the new build went on reading «Неизвестно».
    const currentBuild =
      this.config.get<string | null>('appVersion.current') ?? null;

    // Select only non-encrypted columns so publisher names aren't decrypted.
    const pubs = await this.publishersRepo
      .createQueryBuilder('p')
      .select([
        'p.id',
        'p.userId',
        'p.appointment',
        'p.gender',
        // Whose account this is. The list named accounts by what is typed to
        // sign in — and «кому помочь» is a question about a person.
        'p.displayName',
      ])
      .where('p.congregation_id = :cid', { cid: congregationId })
      .andWhere('p.user_id IS NOT NULL')
      .getMany();
    const apptByUser = new Map<string, PublisherAppointment>();
    const cardByUser = new Map<string, string>();
    const genderByUser = new Map<string, Gender>();
    const nameByUser = new Map<string, string>();
    for (const p of pubs) {
      if (p.userId) {
        apptByUser.set(p.userId, p.appointment);
        cardByUser.set(p.userId, p.id);
        genderByUser.set(p.userId, p.gender);
        nameByUser.set(p.userId, p.displayName);
      }
    }
    const now = Date.now();
    return rows.map((u) => {
      const pub = toPublicUser(
        u,
        apptByUser.get(u.id) ?? null,
        now,
        cardByUser.get(u.id) ?? null,
        u.clientPlatform
          ? {
              platform: u.clientPlatform,
              kind: u.clientKind ?? 'app',
              os: u.clientOs,
              appVersion: u.clientAppVersion,
              outdated: behindCurrent(u.clientAppVersion, currentBuild),
              at: u.clientSeenAt,
            }
          : null,
        genderByUser.get(u.id) ?? null,
        nameByUser.get(u.id) ?? null,
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
  /**
   * `passwordHash` is `select: false`, so it is absent unless asked for — and
   * a reader that merely checks `!!user.passwordHash` would quietly conclude
   * «no password» for everybody. Asked for here because the access card needs
   * to say whether this person ever got in; the hash itself never leaves.
   */
  async findByIdInCongregation(
    id: string,
    congregationId: string,
  ): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { id, congregationId },
      select: {
        id: true,
        congregationId: true,
        email: true,
        loginName: true,
        role: true,
        isActive: true,
        isOwner: true,
        uiLanguage: true,
        lastLoginAt: true,
        canViewPrivateData: true,
        passwordHash: true,
        inviteCodeExpiresAt: true,
      },
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
  ): Promise<CreatedUser> {
    const email = dto.email?.trim().toLowerCase() || null;

    // The address may now repeat: a couple with one mailbox, a parent reading
    // a child's letters. Identity moved to the login name, and THAT is what is
    // checked for collisions below.
    //
    // The card is read before the account is saved, because its surname and
    // given name are what the login name is built from.
    const card = dto.publisherId
      ? await this.publishersRepo.findOne({
          where: { id: dto.publisherId, congregationId },
        })
      : null;

    const passwordHash = dto.password
      ? await this.hashPassword(dto.password)
      : null;

    const user = this.usersRepo.create({
      congregationId,
      email,
      // The elder's correction wins when he made one — he is looking at the
      // person's own spelling of their name, which transliteration cannot
      // know. Otherwise the name is built from the card as usual.
      loginName: await this.chooseLoginName(dto.loginName, card, email),
      passwordHash,
      role: dto.role,
      isActive: true,
      uiLanguage: dto.uiLanguage ?? 'ru',
    });

    try {
      await this.usersRepo.save(user);
      // Link the card in the same breath as creating the account. Doing it
      // afterwards is what left orphans: two steps, and the second forgotten.
      if (card && !card.userId) {
        card.userId = user.id;
        await this.publishersRepo.save(card);
      }
    } catch (err) {
      // Race-condition fallback: two requests settled on the same login name
      // between the check and the save. The partial unique index catches it,
      // and one retry is enough — the loser now sees the winner's name taken.
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code?: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        user.loginName = await this.chooseLoginName(dto.loginName, card, email);
        await this.usersRepo.save(user);
        if (card && !card.userId) {
          card.userId = user.id;
          await this.publishersRepo.save(card);
        }
      } else {
        throw err;
      }
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
    let invitation: InvitationIssued | undefined;
    if (!dto.password) {
      try {
        invitation = await this.sendInvitation(user.id);
      } catch (err: unknown) {
        this.logger.warn(
          `invitation for a new login ${user.loginName ?? user.id} could not ` +
            'be issued: ' +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }

    return { ...toPublicUser(user), invitation };
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
   * Change where a user's letters go (admin action) — e.g. to fix a typo made
   * when access was granted, or to point an account at a family mailbox.
   *
   * An EMPTY value removes the address, which is now a real thing to want: it
   * is optional, somebody may ask for theirs to be taken off, and the account
   * keeps working — its owner signs in by name and an elder resets a forgotten
   * password. What is refused is a value that is neither empty nor an address,
   * because that silently breaks delivery and nobody would find out until a
   * letter failed to arrive.
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
    const trimmed = rawEmail.trim().toLowerCase();
    const email: string | null = trimmed === '' ? null : trimmed;
    if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException({ code: 'BAD_EMAIL' });
    }
    if (user.email === email) {
      return;
    }
    // No collision check any more: an address is where letters go, and two
    // people may share a mailbox. Whoever signs in with a shared address is
    // asked for their login name instead — see findForLogin.
    user.email = email;
    await this.usersRepo.save(user);
    // Same event as granting access on a shared address, so the same notice.
    await this.noticeMailboxNowShared(email, user.id);
  }

  /**
   * Correct what somebody types to sign in (admin action).
   *
   * Transliteration cannot know that a man born Бакманн writes himself
   * Backmann on every document he owns, so the generated name is a starting
   * point and this is the correction. The old name stops working at once —
   * there is no second name, and pretending otherwise would mean two ways in
   * to one account, one of which nobody maintains.
   *
   * Which is why the interface must say it plainly: correct the name BEFORE
   * telling anybody what it is.
   */
  async changeLoginNameByAdmin(
    id: string,
    rawName: string,
    congregationId: string,
    actorUserId: string,
  ): Promise<PublicUser> {
    const user = await this.findByIdInCongregation(id, congregationId);
    if (user.isOwner) {
      throw new ForbiddenException('The owner account is protected');
    }
    const loginName = rawName.trim().toLowerCase();
    const problem = loginNameProblem(loginName);
    if (problem) {
      throw new BadRequestException({ code: 'BAD_LOGIN_NAME', problem });
    }
    const before = user.loginName ?? null;
    if (before === loginName) return toPublicUser(user);

    if (await this.loginNameTaken(loginName)) {
      throw new ConflictException({ code: 'LOGIN_NAME_TAKEN' });
    }

    user.loginName = loginName;
    try {
      await this.usersRepo.save(user);
    } catch (err) {
      // Two administrators settling on the same name at once. The partial
      // unique index is the one that actually decides.
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code?: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException({ code: 'LOGIN_NAME_TAKEN' });
      }
      throw err;
    }

    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'user',
      entityId: user.id,
      actorUserId,
      before: { loginName: before },
      after: { loginName },
      fields: ['loginName'],
    });

    return toPublicUser(user);
  }

  /**
   * What this account's login name WOULD be if generated now — the starting
   * point an administrator corrects, so the field is never empty.
   */
  suggestLoginName(input: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  }): string {
    const fromCard = loginNameFrom(input.lastName, input.firstName);
    return fromCard !== '' ? fromCard : loginNameFromEmail(input.email);
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
    await this.usersRepo.update({ id }, freshPassword(passwordHash));
  }

  /**
   * End every open session of one account.
   *
   * Lives here, in ONE place, because two of them is how the paths drift: the
   * self-service reset revoked sessions from the day it was written, while an
   * elder's reset quietly did not — so a lost phone kept its way in for up to
   * thirty days after the password was changed to lock it out.
   */
  async signedInPlaces(
    userId: string,
    currentFamilyId?: string,
  ): Promise<SignedInPlace[]> {
    // One sign-in is a chain of rows — a new one at every renewal, the old
    // one revoked. So a living chain is exactly an unrevoked, unexpired row:
    // its newest. (A reply lost on the way can leave two for a moment; the
    // newer one speaks for the chain.)
    const alive = await this.sessionsRepo.find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });
    const chains = new Map<string, { newest: RefreshSession; since: Date }>();
    for (const row of alive) {
      if (!chains.has(row.familyId)) {
        chains.set(row.familyId, { newest: row, since: row.createdAt });
      }
    }
    if (chains.size === 0) return [];
    // When the person signed in there is the chain's FIRST row, long revoked.
    const firsts = await this.sessionsRepo
      .createQueryBuilder('s')
      .select('s.family_id', 'familyId')
      .addSelect('MIN(s.created_at)', 'since')
      .where('s.family_id IN (:...ids)', { ids: [...chains.keys()] })
      .groupBy('s.family_id')
      .getRawMany<{ familyId: string; since: Date | string }>();
    for (const f of firsts) {
      const chain = chains.get(f.familyId);
      if (chain) chain.since = new Date(f.since);
    }
    const now = Date.now();
    const places: SignedInPlace[] = [];
    for (const [familyId, { newest, since }] of chains) {
      if (newest.revokedAt || newest.expiresAt.getTime() <= now) continue;
      places.push({
        platform: newest.clientPlatform,
        kind: newest.clientKind,
        os: newest.clientOs,
        appVersion: newest.clientAppVersion,
        since,
        lastActiveAt: newest.createdAt,
        current: !!currentFamilyId && familyId === currentFamilyId,
      });
    }
    // «Это устройство» first, then the most recently used.
    places.sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
    return places.slice(0, 12);
  }

  /**
   * Forget the sessions nobody can come back to.
   *
   * The table was never pruned. Every renewal adds a row and revokes the one
   * before — about four an hour for as long as the app is open — and the old
   * rows were kept for ever, by an account that is read row by row for «Где
   * вы вошли».
   *
   * What may go is exactly what can no longer be reached: a row is found only
   * through the token that names it, and that token dies at the row's own
   * `expiresAt`. Until then a revoked row is NOT dead weight — presenting its
   * token again is how a stolen one is recognised (AuthService.refresh), so
   * nothing younger than its expiry is touched.
   *
   * One row is kept past that: the first of a chain that is still alive. It
   * is where «когда вошёл здесь» is read from.
   */
  async forgetDeadSessions(): Promise<number> {
    const result: unknown = await this.sessionsRepo.query(
      FORGET_DEAD_SESSIONS_SQL,
    );
    // node-postgres answers a DELETE with [rows, count].
    const count = Array.isArray(result) ? result[1] : 0;
    return typeof count === 'number' ? count : 0;
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.sessionsRepo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
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
    // The same bar as a person setting his own: an administrator handing out
    // «12345678» by telephone is exactly the case worth stopping.
    const problem = passwordProblem(newPassword, user.email ?? undefined);
    if (problem) {
      throw new BadRequestException({ code: 'WEAK_PASSWORD', problem });
    }

    const passwordHash = await this.hashPassword(newPassword);
    await this.usersRepo.update(targetId, freshPassword(passwordHash));

    // A password an elder sets is often set BECAUSE the old way in is no
    // longer trusted — a lost phone, a shared password. Leaving the old
    // sessions alive would defeat the very reason for doing it.
    await this.revokeAllSessions(targetId);

    // And the owner of the account learns about it from us. Somebody else
    // changing your password is worth a letter, even when it was agreed
    // beforehand; when it was not, this is the only way they find out.
    if (user.email && actorUserId !== targetId) {
      await this.mailService.sendPasswordSetByAdmin(
        user.email,
        user.uiLanguage,
        {
          recipientName: await this.firstNameOf(user.id),
          loginName: user.loginName,
        },
      );
    }

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

    const ok = await passwordMatches(currentPassword, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('Current password is incorrect');
    }
    const problem = passwordProblem(newPassword, user.email ?? undefined);
    if (problem) {
      throw new BadRequestException({ code: 'WEAK_PASSWORD', problem });
    }

    const passwordHash = await this.hashPassword(newPassword);
    await this.usersRepo.update(userId, freshPassword(passwordHash));

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
   * Issue an invitation: a code that works inside the app, and a link for
   * whoever is at a computer. The code lives thirty days, the link three.
   *
   * It decides ON ITS OWN whether a letter goes out, and that is the whole
   * point of the change: the address used to arrive as an argument, so each of
   * the four callers decided separately whether to send — and one of them
   * would eventually decide wrongly for an account that has no address. Now
   * there is one answer, in one place.
   *
   * The code comes back either way, so an elder can read it out to somebody
   * standing in front of him. For an account with no address that is the ONLY
   * way in, which is why this returns it rather than logging it: a live
   * credential in a log file is a credential lying about in the open.
   */
  async sendInvitation(
    userId: string,
    opts: { post?: boolean } = {},
  ): Promise<InvitationIssued> {
    // Whether a letter goes out at all. It always did, and that surprised the
    // person issuing the code: he pressed «выдать код», the letter was already
    // gone by the time the code appeared on his screen, and the dialog then
    // offered to write one — as if nothing had been sent. Now the choice is
    // made before the code exists, by the person making it.
    //
    // Default true: the letter is the better path when there is an address,
    // and every caller that does not care should keep getting it.
    const post = opts.post ?? true;
    const user = await this.findById(userId);
    // Somebody who already has a password is not being invited: the elder is
    // giving him a way back in (a lost phone, a password nobody remembers).
    // Same code, same month to use it — a different letter.
    const withPassword = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: userId })
      .getOne();
    const kind: 'invite' | 'reset' = withPassword?.passwordHash
      ? 'reset'
      : 'invite';
    const issued = await this.issueCode(userId, INVITE_CODE_LIFETIME_MS);
    const address = post ? (user?.email ?? null) : null;
    if (!address) {
      // Nowhere to send — or nobody asked us to. The first is the ordinary
      // case for most of this congregation; the second is an elder who will
      // read the code out himself. Either way the code is the answer, and
      // `sentTo: null` says plainly that no letter went anywhere.
      return issued;
    }
    await this.postCode(userId, address, kind, issued, { issuedByElder: true });
    return { ...issued, sentTo: address };
  }

  /**
   * A fresh code for one account — the ONE way in that a letter or an elder
   * hands over.
   *
   * It replaces whatever was issued before, and it ends the old sign-in link
   * too: those links signed their clicker in wherever the letter happened to
   * be opened, which is the wrong place as often as not (see the code letter
   * in MailService). None is issued any more; one that is still out there
   * from an earlier letter stops working here.
   */
  private async issueCode(
    userId: string,
    lifetimeMs: number,
  ): Promise<InvitationIssued> {
    const code = makeInviteCode();
    const expiresAt = new Date(Date.now() + lifetimeMs);
    await this.usersRepo.update(userId, {
      inviteCodeHash: hashInviteCode(code),
      inviteCodeExpiresAt: expiresAt,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    });
    return { code: formatInviteCode(code), expiresAt, sentTo: null };
  }

  /** The code letter: who it is for, which congregation, where the app is. */
  private async postCode(
    userId: string,
    address: string,
    kind: 'invite' | 'reset',
    issued: InvitationIssued,
    opts: { issuedByElder?: boolean } = {},
  ): Promise<void> {
    const user = await this.findById(userId);
    const lang = user?.uiLanguage ?? 'ru';
    const base =
      this.config.get<string>('PUBLIC_APP_URL') ?? 'https://mycongregation.org';
    // Opens the code screen with the code typed in — and signs nobody in.
    // The path is /reset-password because that is the one the installed
    // Android app is registered to open; the screen there sees `code` and
    // hands over to the code screen.
    // …in the language of the letter. A phone set to German would otherwise
    // open a Russian letter's button onto a German screen.
    const fillLink = `${base}/reset-password?code=${issued.code}&lang=${lang}`;
    const congregation = user?.congregationId
      ? await this.congregationsRepo.findOne({
          where: { id: user.congregationId },
          select: { id: true, name: true },
        })
      : null;
    const extra = {
      code: issued.code,
      expiresAt: issued.expiresAt,
      // The same setting the version endpoint hands out, so the letter
      // cannot point somewhere the app is no longer given away from.
      installUrl: this.config.get<string>('appVersion.downloadUrl'),
      // Who this letter is for, and what they will type to sign in. One
      // mailbox may serve a husband and a wife: the name at the top is what
      // tells two otherwise identical letters apart.
      recipientName: await this.firstNameOf(userId),
      loginName: user?.loginName ?? null,
      congregationName: congregation?.name ?? null,
      issuedByElder: opts.issuedByElder === true,
    };
    if (kind === 'invite') {
      await this.mailService.sendInvite(address, lang, fillLink, extra);
    } else {
      await this.mailService.sendPasswordReset(address, lang, fillLink, extra);
    }
  }

  /**
   * «Забыли пароль» — a code by post, for one account.
   *
   * A day to use it, not the invitation's month: this letter is asked for by
   * somebody standing at the sign-in screen right now, and a code that opens
   * an account should not sit in a mailbox longer than that needs.
   *
   * Somebody who never finished their invitation and presses «Забыли пароль»
   * is sent the invitation again instead — with its month, and its words.
   */
  async sendResetCode(userId: string): Promise<void> {
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user?.email || !user.isActive) return;
    if (!user.passwordHash) {
      await this.sendInvitation(userId);
      return;
    }
    const issued = await this.issueCode(userId, RESET_CODE_LIFETIME_MS);
    await this.postCode(userId, user.email, 'reset', issued);
  }

  /**
   * Remember why this account was last turned away — for the elder helping.
   *
   * The sign-in form answers every refusal with one sentence, on purpose.
   * The reason went to the server's log, and the log starts again at every
   * deploy: on 7 October a sister could not get in, the log was empty, and
   * nobody could say whether her password was wrong or never set. The card
   * now can. Only refusals that reached THIS account are recorded — a
   * mistyped name belongs to no account, and its absence here says so.
   */
  /**
   * The last refusal, if it came AFTER the last time the person got in — an
   * older one says nothing about today.
   */
  async lastFailedLogin(
    userId: string,
  ): Promise<{ at: Date; reason: string | null } | null> {
    const row = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect(['user.lastFailedLoginAt', 'user.lastFailedLoginReason'])
      .where('user.id = :id', { id: userId })
      .getOne()
      .catch(() => null);
    if (!row?.lastFailedLoginAt) return null;
    if (
      row.lastLoginAt &&
      row.lastFailedLoginAt.getTime() <= row.lastLoginAt.getTime()
    ) {
      return null;
    }
    return { at: row.lastFailedLoginAt, reason: row.lastFailedLoginReason };
  }

  async noteFailedLogin(userId: string, reason: FailedLoginReason) {
    await this.usersRepo
      .update(userId, {
        lastFailedLoginAt: new Date(),
        lastFailedLoginReason: reason,
      })
      .catch(() => undefined);
  }

  /**
   * The person's own first name, for a letter to say hello with.
   *
   * Null when no card stands behind the account — an administrator who is not
   * a publisher here — and then the letter greets without a name, as before.
   */
  async firstNameOf(userId: string): Promise<string | null> {
    const card = await this.publishersRepo.findOne({
      where: { userId },
      select: { id: true, firstName: true },
    });
    return card?.firstName ?? null;
  }

  /**
   * «Who else already uses this address?» — for the form, before it acts.
   *
   * Returns the login names and the people behind them, so the elder can be
   * told what granting access on this address WILL DO to somebody else, while
   * he can still choose otherwise. Admin-only, and scoped to his congregation:
   * an address from another congregation is none of his business, and the
   * answer would be a way of probing for one.
   */
  async whoElseUses(
    email: string,
    congregationId: string,
  ): Promise<{ loginName: string | null; displayName: string | null }[]> {
    const value = email.trim().toLowerCase();
    if (value === '') return [];
    const rows = await this.usersRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = :value', { value })
      .andWhere('user.congregation_id = :cid', { cid: congregationId })
      .getMany();
    const out: { loginName: string | null; displayName: string | null }[] = [];
    for (const u of rows) {
      const card = await this.publishersRepo.findOne({
        where: { userId: u.id },
        select: { id: true, firstName: true, lastName: true },
      });
      out.push({
        loginName: u.loginName ?? null,
        displayName: card
          ? [card.lastName, card.firstName].filter(Boolean).join(' ').trim()
          : null,
      });
    }
    return out;
  }

  /**
   * Every other live account this address already serves.
   *
   * Asked before a login is created, so the interface can warn, and again
   * after, so the people already using it can be told.
   */
  async othersUsingEmail(
    email: string,
    exceptUserId?: string,
  ): Promise<User[]> {
    const value = email.trim().toLowerCase();
    if (value === '') return [];
    const rows = await this.usersRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = :value', { value })
      .getMany();
    return rows.filter((u) => u.id !== exceptUserId);
  }

  /**
   * Tell whoever was already using this mailbox that it now serves two logins.
   *
   * Called at the moment sharing begins — creating a login on somebody else's
   * address, or moving an account onto one. Nobody has to remember: the person
   * whose habit just broke hears it from us, not from a refusal at the sign-in
   * screen. Failure to send must not undo the thing that succeeded, so this
   * swallows its own errors and leaves a line in the log.
   */
  async noticeMailboxNowShared(
    email: string | null,
    newUserId: string,
  ): Promise<void> {
    if (!email) return;
    const others = await this.othersUsingEmail(email, newUserId);
    for (const other of others) {
      if (!other.isActive || !other.email) continue;
      try {
        await this.mailService.sendSharedMailboxNotice(
          other.email,
          other.uiLanguage ?? 'ru',
          {
            recipientName: await this.firstNameOf(other.id),
            loginName: other.loginName,
          },
        );
      } catch (err: unknown) {
        this.logger.warn(
          `could not tell ${other.loginName ?? other.id} the mailbox is now ` +
            'shared: ' +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }

  /**
   * Cancel a waiting invitation: both doors, the code and the link.
   *
   * Issued together for one purpose, so they are called back together —
   * leaving the link alive after killing the code would keep a way in that
   * nobody is watching, which is the same reasoning as completeInvite.
   */
  async revokeInvitation(
    userId: string,
    congregationId: string,
  ): Promise<void> {
    await this.findByIdInCongregation(userId, congregationId);
    await this.usersRepo.update(userId, {
      inviteCodeHash: null,
      inviteCodeExpiresAt: null,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    });
  }

  /**
   * Whose invitation this code is.
   *
   * The code identifies the account on its own — nobody has to say who they
   * are first. That is what lets somebody with no address finish an
   * invitation: there is nothing else about them to type.
   *
   * A wrong code matches no row, so it does not even reveal WHO was being
   * guessed at. What guards this is the size of the space (eight characters
   * from an alphabet of thirty-one) and the limit on attempts per address the
   * guessing comes from.
   */
  findByInviteCode(code: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { inviteCodeHash: hashInviteCode(code) },
    });
  }

  /**
   * The password is set and BOTH doors are closed — the code and the link.
   * They were issued together for one purpose; leaving the link alive after
   * the code was used would keep a way in that nobody is watching.
   */
  async completeInvite(userId: string, passwordHash: string): Promise<void> {
    await this.usersRepo.update(userId, freshPassword(passwordHash));
  }

  private hashPassword(password: string): Promise<string> {
    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    return hashClean(password, rounds);
  }
}
