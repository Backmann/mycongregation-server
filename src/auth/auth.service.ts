import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { MailService } from '../mail/mail.service';
import { User } from '../entities/user.entity';
import { RefreshSession } from '../entities/refresh-session.entity';
import { Congregation } from '../entities/congregation.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { UsersService } from '../users/users.service';
import { BootstrapDto } from './dto/bootstrap.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import type { AuthenticatedUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { passwordProblem } from './password-policy';
import { normalizeInviteCode } from './invite-code';
import type { ClientInfo } from './read-client';

interface RefreshTokenPayload {
  sub: string;
  email: string | null;
  role: UserRole;
  congregationId: string;
  tokenType: 'refresh';
  /** Session id — the row in refresh_sessions this token belongs to. */
  sid: string;
}

/** Refresh tokens are high-entropy machine strings; a digest is enough. */
function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** '30d' / '12h' / '45m' / '3600s' -> milliseconds. Defaults to 30 days. */
export function durationToMs(value: string | undefined): number {
  const DAY = 24 * 60 * 60 * 1000;
  if (!value) return 30 * DAY;
  const m = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!m) return 30 * DAY;
  const n = parseInt(m[1], 10);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: DAY }[m[2]] ?? DAY;
  return n * unit;
}

/**
 * How long a just-rotated refresh token is still honoured as an honest retry
 * rather than read as theft. Long enough to cover a lost reply, a timed-out
 * request or two tabs refreshing together; far too short to be useful to
 * someone replaying a stolen token days later.
 */
const REFRESH_REPLAY_GRACE_MS = 60_000;

/** Placeholder written for the split second before the row has its own id. */
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  /**
   * One-time setup: creates the first Congregation + first admin User.
   * Refuses if any user already exists in the database.
   */
  async bootstrap(dto: BootstrapDto) {
    const existing = await this.usersService.count();
    if (existing > 0) {
      throw new ConflictException(
        'Bootstrap already performed. Use invitation flow instead.',
      );
    }

    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const result = await this.dataSource.transaction(async (manager) => {
      const congregation = manager.create(Congregation, {
        name: dto.congregationName,
        country: dto.country,
        language: dto.language,
        timezone: dto.timezone ?? null,
      });
      await manager.save(congregation);

      const user = manager.create(User, {
        congregationId: congregation.id,
        // Normalised like every other address in the system. This one was
        // stored exactly as typed, so the founding administrator of a
        // congregation could end up unable to sign in with the address he
        // reads on his own screen.
        email: dto.email.trim().toLowerCase(),
        // The first account of a congregation needs a name like every other:
        // it has no publisher card to build one from, so the address supplies
        // it. Missing this would leave the one person who can fix everything
        // else unable to sign in by name.
        loginName: await this.usersService.settleLoginNameFor({
          email: dto.email,
        }),
        passwordHash,
        role: UserRole.ADMIN,
        isActive: true,
        uiLanguage: dto.language,
      });
      await manager.save(user);

      return { congregation, user };
    });

    return this.issueTokens(result.user);
  }

  /** Sliding-window in-memory limiter for login; key -> recent times. */
  private readonly loginAttempts = new Map<string, number[]>();
  private allowLogin(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.loginAttempts.get(key) ?? []).filter(
      (t) => now - t < windowMs,
    );
    if (recent.length >= limit) {
      this.loginAttempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.loginAttempts.set(key, recent);
    return true;
  }

  async login(dto: LoginDto, ip = 'unknown', client?: ClientInfo) {
    const FIFTEEN_MIN = 15 * 60 * 1000;
    // A login name or an address — whichever the person has. `email` is the
    // older name of the same field, still sent by app builds in people's
    // pockets today.
    const identifier = (dto.login ?? dto.email ?? '').toLowerCase().trim();
    if (identifier === '') {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Two nets of very different sizes, and the difference is the point.
    //
    // The ACCOUNT is what an attacker aims at, so the tight limit belongs
    // there: six tries at one name, and guessing a password stops being
    // worth anybody's time.
    //
    // The ADDRESS is a building. A congregation shares the hall's wifi, and
    // whole households share one line; keeping six there meant that six
    // people signing in — successfully, since every attempt is counted —
    // locked out the seventh. It is a net against somebody working through a
    // stolen list of accounts, not against a family, so it is set where only
    // that shows: sixty in a quarter of an hour.
    if (!this.allowLogin(`login:id:${identifier}`, 6, FIFTEEN_MIN)) {
      this.logger.warn(`login refused for ${identifier}: too many tries`);
      throw new HttpException(
        { code: 'RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!this.allowLogin(`login:ip:${ip}`, 60, FIFTEEN_MIN)) {
      // The address is written out because this is the one refusal that used
      // to be impossible to understand from outside: it names somebody who
      // did nothing wrong. Seeing a real address here — rather than the same
      // 172.x on every line — is also how we know the proxy is being read.
      this.logger.warn(`login refused for ${identifier}: too many from ${ip}`);
      throw new HttpException(
        { code: 'RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const { user, shared } = await this.usersService.findForLogin(identifier);
    if (shared) {
      // The one refusal that says something, because it is the one the person
      // can act on: their address is a family mailbox and cannot say which of
      // them is signing in. It admits that the address is used more than once
      // here — to somebody who already knows the address — and that is worth
      // less than leaving a couple stuck at their own front door.
      this.logger.warn(`login refused for ${identifier}: address is shared`);
      throw new UnauthorizedException({ code: 'LOGIN_SHARED_EMAIL' });
    }
    // The PAGE must keep saying one thing — telling a stranger «no such
    // address» turns the login form into a way of testing addresses. But the
    // four reasons are worlds apart for whoever is asked to help, and nobody
    // could tell them apart, so a person could be stuck for days on an
    // account that simply never had a password set.
    //
    // So: one answer on screen, the reason in the log.
    const refuse = (reason: string): never => {
      this.logger.warn(`login refused for ${identifier}: ${reason}`);
      throw new UnauthorizedException('Invalid credentials');
    };
    if (!user) return refuse('no account with this name or address');
    if (!user.isActive) return refuse('account is switched off');
    if (!user.passwordHash) {
      return refuse('no password has been set (invited but never completed?)');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) return refuse('wrong password');
    // Successful login clears this identifier's counter — the SAME key the
    // limiter above writes. It used to clear `login:email:…` while the limiter
    // counted something else, which would have left a successful sign-in
    // counting against the next one.
    this.loginAttempts.delete(`login:id:${identifier}`);
    await this.usersService.touchLastLogin(user.id);
    return this.issueTokens(user, undefined, client);
  }

  // ---- Password reset (forgot password) ----

  /** Sliding-window in-memory limiter; key -> recent request times. */
  private readonly resetRequests = new Map<string, number[]>();

  private allowReset(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.resetRequests.get(key) ?? []).filter(
      (t) => now - t < windowMs,
    );
    if (recent.length >= limit) {
      this.resetRequests.set(key, recent);
      return false;
    }
    recent.push(now);
    this.resetRequests.set(key, recent);
    return true;
  }

  /**
   * A letter to whoever has forgotten a password.
   *
   * Takes a login name OR an address, because after this month those are two
   * different things and a person may remember either one.
   *
   * A SHARED address gets a letter for EACH account it serves. That reads odd
   * written down, but consider the mailbox: a husband and wife who both forgot
   * are the likely case, and each letter now says whose it is and what name to
   * sign in with. Sending only one, or none, would leave one of them stuck
   * with nothing to act on.
   *
   * An account with no address at all resolves silently: nothing can be sent,
   * and their password is reset by an elder. The screen says so.
   *
   * Always resolves to the same generic OK — never reveals whether an account
   * exists. Over-limit and unknown requests are dropped silently for the same
   * reason.
   */
  async forgotPassword(
    rawIdentifier: string,
    ip: string,
  ): Promise<{ ok: true }> {
    const identifier = rawIdentifier.trim().toLowerCase();
    const HOUR = 60 * 60 * 1000;
    // Three letters an hour to one account is the limit that matters — it is
    // what stops a mailbox being buried. The per-address net is only against
    // somebody walking a list, and it counts a whole building, so ten was low
    // enough to silence a congregation on the evening invitations went out.
    if (
      !this.allowReset(`fp:ip:${ip}`, 30, HOUR) ||
      !this.allowReset(`fp:id:${identifier}`, 3, HOUR)
    ) {
      this.logger.warn(`password reset not sent for ${identifier}: too many`);
      return { ok: true };
    }

    const recipients = await this.usersService.findAllForReset(identifier);
    const base =
      this.config.get<string>('PUBLIC_APP_URL') ?? 'https://mycongregation.org';

    for (const user of recipients) {
      if (!user.isActive || !user.email) continue;
      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + HOUR);
      await this.usersService.setPasswordResetToken(
        user.id,
        tokenHash,
        expiresAt,
      );
      await this.mailService.sendPasswordReset(
        user.email,
        user.uiLanguage,
        `${base}/reset-password?token=${token}`,
        {
          recipientName: await this.usersService.firstNameOf(user.id),
          loginName: user.loginName,
        },
      );
    }
    return { ok: true };
  }

  /**
   * Set a password from a link, and let the person straight in.
   *
   * Until now this answered «done» and left him at the sign-in screen, asked
   * for the address and the password he had typed ten seconds earlier. For an
   * invitation that is the whole first impression of the app, and it is a
   * pointless one: the server knows exactly who this is — the link came from
   * his own mailbox and the password is in its hands.
   *
   * Every other device is still signed out first. A reset is the one moment
   * where killing every session is the point, and the new one issued here
   * belongs to whoever holds the mailbox, which is precisely the person the
   * link was for.
   */
  async resetPassword(token: string, password: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const user = await this.usersService.findByValidResetToken(tokenHash);
    if (!user) {
      throw new BadRequestException('Invalid or expired reset link');
    }
    const problem = passwordProblem(password, user.email ?? undefined);
    if (problem) {
      throw new BadRequestException({ code: 'WEAK_PASSWORD', problem });
    }
    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    const passwordHash = await bcrypt.hash(password, rounds);
    await this.usersService.completePasswordReset(user.id, passwordHash);
    await this.revokeAllSessions(user.id);
    // This IS an entry — the link hands out a session, the person lands on the
    // home screen. Leaving the stamp to the sign-in form alone made
    // «никогда не входил» and «вошёл по ссылке» look identical in the one list
    // an elder has for finding people who are stuck.
    await this.usersService.touchLastLogin(user.id);
    return this.issueTokens(user);
  }

  /**
   * Finish an invitation from inside the app.
   *
   * Answers the same way the link path does — with a session — because the
   * same thing has been proven: whoever holds the mailbox holds the code.
   *
   * What is DELIBERATELY not told apart on the reader's screen: no such
   * address, wrong code, expired code, code already used. All four say the
   * same thing, or the form becomes a way to ask us which addresses exist. The
   * log says which it was; the reader is told what to do about it. That is the
   * rule this project arrived at after three password incidents in a row.
   *
   * The remaining count IS returned, and that is not a leak: it only ever
   * appears once a real code for a real address has been offered and refused,
   * and being told «four left» is the difference between a form that is strict
   * and a form that seems broken.
   */
  /** Sliding-window limiter for code guessing; key -> recent attempt times. */
  private readonly inviteAttempts = new Map<string, number[]>();

  /**
   * Finish an invitation from inside the app, with the code and nothing else.
   *
   * The address used to be required here, purely to find the account before
   * checking the code against it. That made this door useless to the people it
   * matters most for — the ones who have no address to type. The code finds
   * the account by itself.
   *
   * What that costs, said plainly: the five-attempts-per-account counter can
   * no longer work, because a wrong code belongs to no account. The limit is
   * per source instead. It is not the weaker arrangement it sounds like — a
   * wrong guess now identifies nobody, so an attacker cannot even aim.
   *
   * App builds already installed still SEND an address with the code. The
   * request shape keeps accepting it and this method never sees it — refusing
   * those requests would strand whoever is mid-invitation on the day this
   * ships.
   */
  async redeemInvite(code: string, password: string, ip = 'unknown') {
    const FIFTEEN_MIN = 15 * 60 * 1000;
    // No account can be named by a wrong code, so the address is the only
    // thing to count here — which makes the size of this net the difference
    // between guessing being useless and an elder being unable to help the
    // third person he sits down with. Thirty tries against a code drawn from
    // 32^8 possibilities is not a way in.
    if (!this.allowLogin(`invite:ip:${ip}`, 30, FIFTEEN_MIN)) {
      this.logger.warn(`invite refused: too many attempts from ${ip}`);
      throw new HttpException(
        { code: 'RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const clean = normalizeInviteCode(code);
    const refuse = (why: string) => {
      this.logger.warn(`invite refused: ${why}`);
      return new BadRequestException({ code: 'INVITE_INVALID' });
    };

    const user = await this.usersService.findByInviteCode(clean);
    if (!user) throw refuse('no account holds this code');
    if (!user.isActive) throw refuse('account disabled');
    if (
      !user.inviteCodeExpiresAt ||
      user.inviteCodeExpiresAt.getTime() <= Date.now()
    ) {
      throw refuse('code expired');
    }

    // The password is judged before the code is spent: a refusal here should
    // cost the reader another try at typing, not another invitation.
    const problem = passwordProblem(password, user.email ?? undefined);
    if (problem) {
      throw new BadRequestException({ code: 'WEAK_PASSWORD', problem });
    }

    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    const passwordHash = await bcrypt.hash(password, rounds);
    await this.usersService.completeInvite(user.id, passwordHash);
    // A code sets a password, so it ends the old sessions like any other
    // password change — this is the way back in for a lost phone, and the
    // phone must not keep its own way in.
    await this.revokeAllSessions(user.id);
    // Same reason as the link path: the code ends inside the app, so the
    // account has been entered and the list must say so.
    await this.usersService.touchLastLogin(user.id);
    this.logger.log(`invite redeemed by ${user.loginName ?? user.id}`);
    return this.issueTokens(user);
  }

  /**
   * Send a fresh invitation code to an address that is still waiting for one.
   *
   * Returns nothing, always, and throws nothing the caller can tell apart —
   * the answer is identical for an unknown address, a disabled account, one
   * that already has a password, and a successful send. The log is where the
   * difference is recorded.
   *
   * A fresh code also resets the attempt counter, which matters more than the
   * code itself: whoever needs this most is the person who has just used the
   * last of five tries.
   */
  async resendInvite(email: string): Promise<void> {
    const address = email.toLowerCase().trim();
    const note = (why: string) =>
      this.logger.warn(`invite resend for ${address}: ${why}`);

    const user = await this.usersService.findByEmailWithPassword(address);
    if (!user) return note('no such account');
    if (!user.isActive) return note('account disabled');
    if (user.passwordHash) {
      // Not an invitation any more. «Забыли пароль» is that door, and this one
      // must not become a way to mail people who did not ask.
      return note('password already set — not resending');
    }

    await this.usersService.sendInvitation(user.id);
    this.logger.log(`invite resent to ${address}`);
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<AuthenticatedUser> {
    if (dto.uiLanguage !== undefined) {
      await this.usersService.updateUiLanguage(userId, dto.uiLanguage);
    }
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      congregationId: user.congregationId,
      uiLanguage: user.uiLanguage,
    };
  }

  /**
   * Exchanges a refresh token for a fresh pair. The signature alone is no
   * longer enough: the token must match a live session row, and using it
   * rotates that session away.
   *
   * Rotation is what makes theft visible. If a token that was already spent
   * comes back long after it was spent, either the thief or the rightful owner
   * is replaying it — we cannot tell which, so every session of that user is
   * revoked and both are sent back to the login screen.
   *
   * The exception is the moment right after rotation. An honest client loses
   * the reply all the time: the phone is killed between our answer and the
   * write to secure storage, a request times out and is retried, two browser
   * tabs refresh at once. It then presents the token it still has — the spent
   * one — through no fault of anyone. Without a grace window that ordinary
   * mishap signs the person out of every device, which is what people were
   * hitting. So a token replayed within REFRESH_REPLAY_GRACE_MS of its own
   * rotation is served as a retry instead of being read as theft. A replay
   * later than that, or one whose digest does not match the session at all,
   * is still treated as theft.
   */
  async refresh(refreshToken: string, client?: ClientInfo) {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Token is not a refresh token');
    }
    // Tokens issued before sessions existed carry no sid. They are not
    // revocable, so they are not honoured: everyone signs in once more.
    if (!payload.sid) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const sessions = this.dataSource.getRepository(RefreshSession);
    const session = await sessions.findOne({ where: { id: payload.sid } });
    if (!session) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // A token that does not match this session is not a lost reply — it is a
    // different token claiming the session. That is theft, whatever the timing.
    if (session.tokenHash !== digest(refreshToken)) {
      await this.revokeFamily(session.familyId);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (session.revokedAt) {
      const sinceRotationMs = Date.now() - session.revokedAt.getTime();
      if (sinceRotationMs > REFRESH_REPLAY_GRACE_MS) {
        await this.revokeFamily(session.familyId);
        throw new UnauthorizedException('Refresh token was already used');
      }
      // Inside the window: the client never received the previous reply. Hand
      // it a fresh pair rather than signing the account out everywhere.
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // The account may have been disabled since the token was handed out.
    const user = await this.usersService.findById(session.userId);
    if (!user || !user.isActive) {
      await this.revokeAllSessions(session.userId);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Keep the original rotation time: the grace window is measured from when
    // the token was first spent, not from the latest retry, so repeated
    // retries cannot hold the window open indefinitely.
    session.revokedAt = session.revokedAt ?? new Date();
    session.lastUsedAt = new Date();
    await sessions.save(session);

    // The chain continues, but the client can change: the same account moving
    // from a browser to the installed app is exactly what we want to see.
    return this.issueTokens(user, session.familyId, client);
  }

  /**
   * Signing out kills this device's session and nothing else. Always answers
   * ok: a caller holding a dead token should still end up signed out, and the
   * answer must not reveal whether the token was real.
   */
  async logout(refreshToken: string): Promise<{ ok: true }> {
    try {
      const payload = this.jwtService.verify<RefreshTokenPayload>(
        refreshToken,
        { secret: this.config.get<string>('jwt.refreshSecret') },
      );
      if (payload?.sid) {
        await this.dataSource
          .getRepository(RefreshSession)
          .update(
            { id: payload.sid, revokedAt: IsNull() },
            { revokedAt: new Date() },
          );
      }
    } catch {
      // Invalid or expired token — nothing to revoke.
    }
    return { ok: true };
  }

  /**
   * Ends one chain: the device whose token was replayed or did not match, and
   * nothing else. A suspicion attached to one device is not a reason to sign
   * somebody out of the others.
   */
  private async revokeFamily(familyId: string): Promise<void> {
    await this.dataSource
      .getRepository(RefreshSession)
      .update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  /**
   * Used on password reset and when the account itself is no longer valid.
   *
   * Delegates rather than repeats: an elder's reset needs exactly the same
   * thing, and a second copy is how the two drifted apart in the first place —
   * this path revoked sessions from the day it was written, that one never did.
   */
  private async revokeAllSessions(userId: string): Promise<void> {
    await this.usersService.revokeAllSessions(userId);
  }

  private signAccessToken(user: User): string {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      congregationId: user.congregationId,
    };
    return this.jwtService.sign(payload);
  }

  /**
   * Creates the session row first, then signs a token that names it. The row
   * stores only a digest, so a database dump does not hand out live tokens.
   */
  private async signRefreshToken(
    user: User,
    /** Continue an existing chain; a fresh sign-in starts its own. */
    familyId?: string,
    client?: ClientInfo,
  ): Promise<string> {
    const sessions = this.dataSource.getRepository(RefreshSession);
    const ttlMs = durationToMs(this.config.get<string>('jwt.refreshExpiresIn'));
    const session = await sessions.save(
      sessions.create({
        userId: user.id,
        familyId: familyId ?? EMPTY_UUID,
        tokenHash: '',
        expiresAt: new Date(Date.now() + ttlMs),
        lastUsedAt: null,
        revokedAt: null,
        clientPlatform: client?.platform ?? null,
        clientKind: client?.kind ?? null,
        clientOs: client?.os ?? null,
        clientAppVersion: client?.appVersion ?? null,
      }),
    );
    // A sign-in is the root of its own family, and the id only exists once the
    // row is saved.
    if (!familyId) session.familyId = session.id;

    const payload: RefreshTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      congregationId: user.congregationId,
      tokenType: 'refresh',
      sid: session.id,
    };
    const token = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: (this.config.get<string>('jwt.refreshExpiresIn') ??
        '30d') as never,
    });

    session.tokenHash = digest(token);
    await sessions.save(session);
    return token;
  }

  private async issueTokens(
    user: User,
    familyId?: string,
    client?: ClientInfo,
  ) {
    return {
      accessToken: this.signAccessToken(user),
      refreshToken: await this.signRefreshToken(user, familyId, client),
      user: {
        id: user.id,
        email: user.email,
        // The one thing a person needs to sign in again on another day, and
        // until now the app had no way of telling them: it is not in the
        // session, so no screen could show it.
        loginName: user.loginName,
        role: user.role,
        congregationId: user.congregationId,
        canViewPrivateData: user.canViewPrivateData,
      },
    };
  }
}
