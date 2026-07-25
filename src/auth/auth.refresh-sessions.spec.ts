import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * The refresh token is only as good as the session behind it. These tests pin
 * the three behaviours that make it revocable: a refresh rotates the session,
 * a replayed token kills every session of that user, and signing out ends the
 * session it was given.
 */
describe('AuthService — refresh sessions', () => {
  const REFRESH_SECRET = 'refresh-secret-that-is-long-enough-for-tests';

  const user = {
    id: 'user-1',
    email: 'someone@example.org',
    role: UserRole.PUBLISHER,
    congregationId: 'cong-1',
    isActive: true,
    uiLanguage: 'ru',
  };

  let rows: Record<string, any>;
  let service: AuthService;
  let jwt: JwtService;

  const sessionsRepo = {
    create: (data: any) => ({ ...data }),
    save: jest.fn(async (row: any) => {
      row.id = row.id ?? `session-${Object.keys(rows).length + 1}`;
      rows[row.id] = { ...rows[row.id], ...row };
      return rows[row.id];
    }),
    findOne: jest.fn(async ({ where: { id } }: any) => rows[id] ?? null),
    update: jest.fn(async (where: any, patch: any) => {
      let affected = 0;
      for (const row of Object.values(rows)) {
        const matchesUser = where.userId ? row.userId === where.userId : true;
        const matchesId = where.id ? row.id === where.id : true;
        const matchesFamily = where.familyId
          ? row.familyId === where.familyId
          : true;
        const notRevoked = row.revokedAt == null;
        if (matchesUser && matchesId && matchesFamily && notRevoked) {
          Object.assign(row, patch);
          affected++;
        }
      }
      return { affected };
    }),
  };

  beforeEach(async () => {
    rows = {};
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getDataSourceToken(),
          useValue: { getRepository: () => sessionsRepo },
        },
        {
          provide: UsersService,
          useValue: { findById: jest.fn().mockResolvedValue(user) },
        },
        {
          provide: JwtService,
          useValue: new JwtService({ secret: 'access-secret-long-enough' }),
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'jwt.refreshSecret'
                ? REFRESH_SECRET
                : key === 'jwt.refreshExpiresIn'
                  ? '30d'
                  : undefined,
          },
        },
        { provide: MailService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  /** Reaches the private signer the way login does. */
  const issue = async () =>
    (await (service as any).issueTokens(user)) as {
      accessToken: string;
      refreshToken: string;
    };

  it('stores a digest of the token, never the token itself', async () => {
    const { refreshToken } = await issue();
    const stored = Object.values(rows)[0];
    expect(stored.tokenHash).toEqual(expect.any(String));
    expect(stored.tokenHash).not.toContain(refreshToken);
    expect(stored.revokedAt).toBeNull();
  });

  it('rotates: refreshing revokes the presented session and opens a new one', async () => {
    const first = await issue();
    const sidBefore = jwt.verify<{ sid: string }>(first.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;

    const second = await service.refresh(first.refreshToken);
    const sidAfter = jwt.verify<{ sid: string }>(second.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;

    expect(sidAfter).not.toEqual(sidBefore);
    expect(rows[sidBefore].revokedAt).toBeInstanceOf(Date);
    expect(rows[sidAfter].revokedAt).toBeNull();
  });

  // A phone killed between our reply and its write to secure storage, a timed
  // out request that is retried, two tabs refreshing at once — all present the
  // token they still hold. That must not sign the person out everywhere.
  it('serves a replay inside the grace window as an honest retry', async () => {
    const first = await issue();
    const other = await issue(); // a second device
    const otherSid = jwt.verify<{ sid: string }>(other.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;

    await service.refresh(first.refreshToken);
    const retry = await service.refresh(first.refreshToken);

    expect(retry.accessToken).toBeTruthy();
    expect(retry.refreshToken).toBeTruthy();
    // The other device is untouched — this was never theft.
    expect(rows[otherSid].revokedAt).toBeNull();
  });

  it('keeps the original rotation time so retries cannot hold the window open', async () => {
    const first = await issue();
    const sid = jwt.verify<{ sid: string }>(first.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;

    await service.refresh(first.refreshToken);
    const rotatedAt = rows[sid].revokedAt as Date;
    await service.refresh(first.refreshToken);

    expect((rows[sid].revokedAt as Date).getTime()).toBe(rotatedAt.getTime());
  });

  it('a rotated session stays in the same family as the one it replaced', async () => {
    const first = await issue();
    const sidBefore = jwt.verify<{ sid: string }>(first.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;
    const second = await service.refresh(first.refreshToken);
    const sidAfter = jwt.verify<{ sid: string }>(second.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;

    expect(rows[sidAfter].familyId).toBe(rows[sidBefore].familyId);
  });

  it('a fresh sign-in starts its own family', async () => {
    const a = await issue();
    const b = await issue();
    const sidA = jwt.verify<{ sid: string }>(a.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;
    const sidB = jwt.verify<{ sid: string }>(b.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;

    expect(rows[sidA].familyId).toBe(sidA);
    expect(rows[sidB].familyId).not.toBe(rows[sidA].familyId);
  });

  it('treats a replay after the grace window as theft and ends that chain only', async () => {
    const first = await issue();
    const other = await issue(); // a second device
    const firstSid = jwt.verify<{ sid: string }>(first.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;
    const otherSid = jwt.verify<{ sid: string }>(other.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;

    await service.refresh(first.refreshToken);
    // Backdate the rotation so the replay lands well outside the window.
    rows[firstSid].revokedAt = new Date(Date.now() - 10 * 60_000);

    await expect(service.refresh(first.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
    // Only the chain that was replayed ends — the other device is untouched.
    expect(rows[firstSid].revokedAt).toBeInstanceOf(Date);
    expect(rows[otherSid].revokedAt).toBeNull();
  });

  it('treats a mismatched token as theft and ends that chain only', async () => {
    const first = await issue();
    const other = await issue();
    const firstSid = jwt.verify<{ sid: string }>(first.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;
    const otherSid = jwt.verify<{ sid: string }>(other.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;

    // Same session, a different token: not a lost reply.
    rows[firstSid].tokenHash = 'a-different-digest';

    await expect(service.refresh(first.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(rows[firstSid].revokedAt).toBeInstanceOf(Date);
    expect(rows[otherSid].revokedAt).toBeNull();
  });

  it('refuses a token whose session is gone', async () => {
    const { refreshToken } = await issue();
    rows = {};
    await expect(service.refresh(refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a legacy token that names no session', async () => {
    const legacy = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        congregationId: user.congregationId,
        tokenType: 'refresh',
      },
      { secret: REFRESH_SECRET, expiresIn: '30d' },
    );
    await expect(service.refresh(legacy)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('signing out ends that session and leaves other devices alone', async () => {
    const phone = await issue();
    const laptop = await issue();
    const phoneSid = jwt.verify<{ sid: string }>(phone.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;
    const laptopSid = jwt.verify<{ sid: string }>(laptop.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;

    await expect(service.logout(phone.refreshToken)).resolves.toEqual({
      ok: true,
    });

    expect(rows[phoneSid].revokedAt).toBeInstanceOf(Date);
    expect(rows[laptopSid].revokedAt).toBeNull();
  });

  it('answers ok when signing out with a token that is not valid', async () => {
    await expect(service.logout('not-a-token')).resolves.toEqual({ ok: true });
  });
});
