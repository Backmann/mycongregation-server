import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';

const sessionsRepo = {
  update: jest.fn().mockResolvedValue({ affected: 0 }),
  findOne: jest.fn(),
  // Issuing tokens saves a session row and reads its id back.
  save: jest.fn(async (row: Record<string, unknown>) => ({
    id: 'session-1',
    ...row,
  })),
  create: jest.fn((row: Record<string, unknown>) => ({
    id: 'session-1',
    ...row,
  })),
};

describe('AuthService — password reset', () => {
  let service: AuthService;
  let users: {
    findByEmail: jest.Mock;
    findAllForReset: jest.Mock;
    firstNameOf: jest.Mock;
    setPasswordResetToken: jest.Mock;
    revokeAllSessions: jest.Mock;
    findByValidResetToken: jest.Mock;
    completePasswordReset: jest.Mock;
    touchLastLogin: jest.Mock;
  };
  let mail: { sendPasswordReset: jest.Mock };

  const activeUser = {
    id: 'u1',
    email: 'lionel@mycongregation.org',
    uiLanguage: 'ru',
    isActive: true,
  };

  beforeEach(async () => {
    users = {
      findByEmail: jest.fn(),
      // A forgotten password is now looked up by login name OR address, and an
      // address may serve several accounts — so the lookup answers with a list.
      findAllForReset: jest.fn().mockResolvedValue([]),
      firstNameOf: jest.fn().mockResolvedValue(null),
      setPasswordResetToken: jest.fn().mockResolvedValue(undefined),
      // Ending every session lives in UsersService now, so that an elder's
      // reset and this one do the same thing rather than nearly the same.
      revokeAllSessions: jest.fn().mockResolvedValue(undefined),
      findByValidResetToken: jest.fn(),
      completePasswordReset: jest.fn().mockResolvedValue(undefined),
      // Setting a password by link ends with a session — that is an entry.
      touchLastLogin: jest.fn().mockResolvedValue(undefined),
    };
    mail = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getDataSourceToken(),
          // A password reset now also revokes every refresh session, so the
          // stub has to answer getRepository.
          useValue: { getRepository: () => sessionsRepo },
        },
        { provide: UsersService, useValue: users },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(() => 'access.token'),
            signAsync: jest.fn(async () => 'refresh.token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'bcrypt.rounds' ? 4 : undefined,
            ),
          },
        },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('answers a generic OK for an unknown email and sends nothing', async () => {
    users.findAllForReset.mockResolvedValue([]);
    const res = await service.forgotPassword('ghost@nowhere.org', '1.2.3.4');
    expect(res).toEqual({ ok: true });
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(users.setPasswordResetToken).not.toHaveBeenCalled();
  });

  it('sends nothing for a deactivated account', async () => {
    users.findAllForReset.mockResolvedValue([
      { ...activeUser, isActive: false },
    ]);
    await service.forgotPassword(activeUser.email, '1.2.3.4');
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('stores only the sha256 of the token and mails a 1-hour link', async () => {
    users.findAllForReset.mockResolvedValue([{ ...activeUser }]);
    const before = Date.now();
    await service.forgotPassword('  LIONEL@mycongregation.org ', '1.2.3.4');

    expect(users.setPasswordResetToken).toHaveBeenCalledTimes(1);
    const [userId, storedHash, expiresAt] =
      users.setPasswordResetToken.mock.calls[0];
    expect(userId).toBe('u1');

    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(1);
    const [to, lang, link] = mail.sendPasswordReset.mock.calls[0];
    expect(to).toBe(activeUser.email);
    expect(lang).toBe('ru');
    const token = String(link).split('token=')[1];
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(token).digest('hex')).toBe(storedHash);

    const ttlMs = (expiresAt as Date).getTime() - before;
    expect(ttlMs).toBeGreaterThan(55 * 60 * 1000);
    expect(ttlMs).toBeLessThan(65 * 60 * 1000);
  });

  it('rate-limits to 3 mails per email per hour', async () => {
    users.findAllForReset.mockResolvedValue([{ ...activeUser }]);
    for (let i = 0; i < 4; i++) {
      await service.forgotPassword(activeUser.email, '1.2.3.4');
    }
    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(3);
  });

  it('rejects an invalid or expired token', async () => {
    users.findByValidResetToken.mockResolvedValue(null);
    await expect(
      service.resetPassword('a'.repeat(64), 'newpassword1'),
    ).rejects.toThrow(BadRequestException);
    expect(users.completePasswordReset).not.toHaveBeenCalled();
  });

  it('hashes the new password and clears the token on success', async () => {
    // Setting a password now also signs the person in, so the service reaches
    // for the token issuer — the whole point of the change: an invitation
    // should not end at a sign-in form asking for what was just typed.
    users.findByValidResetToken.mockResolvedValue({
      id: 'u1',
      email: 'brother@example.org',
      role: 'publisher',
      congregationId: 'c1',
    });
    await service.resetPassword('b'.repeat(64), 'newpassword1');
    expect(users.completePasswordReset).toHaveBeenCalledTimes(1);
    const [userId, passwordHash] = users.completePasswordReset.mock.calls[0];
    expect(userId).toBe('u1');
    await expect(bcrypt.compare('newpassword1', passwordHash)).resolves.toBe(
      true,
    );
  });
});
