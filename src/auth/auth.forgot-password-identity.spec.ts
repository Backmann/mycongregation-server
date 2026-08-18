import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';

/**
 * A forgotten password, now that an address may belong to two people.
 *
 * The address used to identify the account, so one request meant one letter.
 * It no longer does, and the question this answers is what happens when a
 * husband and wife share a mailbox and one of them cannot get in.
 */
describe('AuthService.forgotPassword — name or address', () => {
  let service: AuthService;
  let users: {
    findAllForReset: jest.Mock;
    firstNameOf: jest.Mock;
    setPasswordResetToken: jest.Mock;
  };
  let mail: { sendPasswordReset: jest.Mock };

  const him = {
    id: 'him',
    email: 'family@gmail.com',
    loginName: 'sidorov.aleksandr',
    uiLanguage: 'ru',
    isActive: true,
  };
  const her = {
    id: 'her',
    email: 'family@gmail.com',
    loginName: 'sidorova.vera',
    uiLanguage: 'ru',
    isActive: true,
  };

  beforeEach(async () => {
    users = {
      findAllForReset: jest.fn().mockResolvedValue([]),
      firstNameOf: jest.fn().mockResolvedValue('Вера'),
      setPasswordResetToken: jest.fn().mockResolvedValue(undefined),
    };
    mail = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getDataSourceToken(),
          useValue: { getRepository: () => ({ update: jest.fn() }) },
        },
        { provide: UsersService, useValue: users },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), signAsync: jest.fn() },
        },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('writes to both people when one mailbox serves two accounts', async () => {
    // Sending one letter would leave the other stuck; sending none, both.
    users.findAllForReset.mockResolvedValue([him, her]);

    await service.forgotPassword('family@gmail.com', '1.2.3.4');

    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(2);
    const names = mail.sendPasswordReset.mock.calls.map(
      (c) => (c[3] as { loginName?: string }).loginName,
    );
    // Each letter carries the login name it belongs to — that is what makes
    // two letters in one mailbox readable rather than baffling.
    expect(names).toEqual(['sidorov.aleksandr', 'sidorova.vera']);
  });

  it('finds a person by login name, not only by address', async () => {
    users.findAllForReset.mockResolvedValue([her]);

    await service.forgotPassword('Sidorova.Vera', '1.2.3.4');

    expect(users.findAllForReset).toHaveBeenCalledWith('sidorova.vera');
    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(1);
  });

  it('names the reader in the letter', async () => {
    users.findAllForReset.mockResolvedValue([her]);

    await service.forgotPassword('sidorova.vera', '1.2.3.4');

    const extras = mail.sendPasswordReset.mock.calls[0][3] as {
      recipientName?: string | null;
    };
    expect(extras.recipientName).toBe('Вера');
  });

  it('stays silent for an account with no address, and issues no token', async () => {
    // Nothing can be sent, so nothing is promised. A token minted here would
    // be a live reset link that reaches nobody.
    users.findAllForReset.mockResolvedValue([{ ...her, email: null }]);

    await expect(
      service.forgotPassword('sidorova.vera', '1.2.3.4'),
    ).resolves.toEqual({ ok: true });
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(users.setPasswordResetToken).not.toHaveBeenCalled();
  });

  it('answers the same to a name nobody holds', async () => {
    await expect(
      service.forgotPassword('nobody.here', '1.2.3.4'),
    ).resolves.toEqual({ ok: true });
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });
});
