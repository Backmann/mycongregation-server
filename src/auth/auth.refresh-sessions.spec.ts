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
        const notRevoked = row.revokedAt == null;
        if (matchesUser && matchesId && notRevoked) {
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

  it('treats a replayed token as theft and revokes every session', async () => {
    const first = await issue();
    const other = await issue(); // a second device
    const otherSid = jwt.verify<{ sid: string }>(other.refreshToken, {
      secret: REFRESH_SECRET,
    }).sid;

    await service.refresh(first.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(rows[otherSid].revokedAt).toBeInstanceOf(Date);
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
