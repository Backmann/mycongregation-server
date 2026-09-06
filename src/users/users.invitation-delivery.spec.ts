import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';
import { RefreshSession } from '../entities/refresh-session.entity';
import { Congregation } from '../entities/congregation.entity';
import { Publisher } from '../entities/publisher.entity';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * Who decides whether a letter goes out.
 *
 * It used to be the caller's business: the address arrived as an argument, and
 * each of the four callers made up its own mind. One of them would eventually
 * make it up wrongly for an account that has no address — so the decision now
 * lives in one place, and these hold it there.
 */
describe('UsersService.sendInvitation', () => {
  let service: UsersService;
  let sendInvite: jest.Mock;
  let repo: { update: jest.Mock; findOne: jest.Mock };

  const buildWith = async (user: unknown) => {
    sendInvite = jest.fn().mockResolvedValue(undefined);
    repo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue(user),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        {
          provide: getRepositoryToken(Publisher),
          // The letter greets the reader by name, so the card is read too.
          useValue: {
            createQueryBuilder: jest.fn(),
            findOne: jest.fn().mockResolvedValue({ firstName: 'Вера' }),
          },
        },
        {
          provide: getRepositoryToken(RefreshSession),
          // Setting a password now ends the account's open sessions — one
          // implementation for both the self-service and the elder's path.
          useValue: { update: jest.fn().mockResolvedValue({ affected: 0 }) },
        },
        {
          // Read for one line of the invitation letter: whose congregation it
          // comes from.
          provide: getRepositoryToken(Congregation),
          useValue: { findOne: jest.fn().mockResolvedValue({ name: 'Хамм' }) },
        },
        {
          provide: MailService,
          useValue: { sendInvite, sendPasswordReset: jest.fn() },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: AuditLogService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logRawUpdate: jest.fn(),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  };

  it('mails the code when there is somewhere to mail it', async () => {
    await buildWith({ id: 'u1', email: 'vera@gmail.com', uiLanguage: 'ru' });

    const issued = await service.sendInvitation('u1');

    expect(sendInvite).toHaveBeenCalled();
    expect(issued.sentTo).toBe('vera@gmail.com');
  });

  it('issues the code anyway when there is nowhere to send it', async () => {
    // The ordinary case here, not the exception: this is how most of the
    // congregation will be invited — the elder reads the code out.
    await buildWith({ id: 'u1', email: null, uiLanguage: 'ru' });

    const issued = await service.sendInvitation('u1');

    expect(sendInvite).not.toHaveBeenCalled();
    expect(issued.sentTo).toBeNull();
    expect(issued.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('stores a hash of the code, never the code', async () => {
    await buildWith({ id: 'u1', email: null, uiLanguage: 'ru' });

    const issued = await service.sendInvitation('u1');

    const written = repo.update.mock.calls.find(
      (c) => (c[1] as { inviteCodeHash?: string }).inviteCodeHash,
    );
    const stored = (written?.[1] as { inviteCodeHash: string }).inviteCodeHash;
    expect(stored).toHaveLength(64);
    expect(stored).not.toContain(issued.code.replace('-', ''));
  });

  it('sends nothing when the elder chose to hand the code over himself', async () => {
    // The surprise this exists to remove: pressing «выдать код» posted a
    // letter before the code was even on screen, and then offered to write
    // one. The choice is made first now, and «sentTo: null» is how the dialog
    // knows not to pretend otherwise.
    await buildWith({ id: 'u1', email: 'vera@gmail.com', uiLanguage: 'ru' });

    const issued = await service.sendInvitation('u1', { post: false });

    expect(sendInvite).not.toHaveBeenCalled();
    expect(issued.sentTo).toBeNull();
    expect(issued.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('still posts when nobody said otherwise', async () => {
    // Every caller that does not care keeps the better path.
    await buildWith({ id: 'u1', email: 'vera@gmail.com', uiLanguage: 'ru' });

    const issued = await service.sendInvitation('u1');

    expect(sendInvite).toHaveBeenCalled();
    expect(issued.sentTo).toBe('vera@gmail.com');
  });

  it('gives the code a month and the link three days', async () => {
    // They were one number because they were issued together, and that is
    // what left five people with a dead code: the letter was opened on the
    // fourth day. The link keeps the short life — it signs its clicker
    // straight in.
    await buildWith({ id: 'u1', email: 'vera@gmail.com', uiLanguage: 'ru' });
    const before = Date.now();

    const issued = await service.sendInvitation('u1');

    const days = (d: Date) => Math.round((d.getTime() - before) / 86400000);
    expect(days(issued.expiresAt)).toBe(30);

    const linkWrite = repo.update.mock.calls.find(
      (c) => (c[1] as { resetTokenExpiresAt?: Date }).resetTokenExpiresAt,
    );
    const linkExpiry = (linkWrite?.[1] as { resetTokenExpiresAt: Date })
      .resetTokenExpiresAt;
    expect(days(linkExpiry)).toBe(3);
  });

  it('closes the code as well when the password is set by link', async () => {
    // An invitation opens two doors for ONE purpose. Whichever is walked
    // through, both must shut: a letter with a live code can sit for three
    // days in a mailbox somebody else can open.
    await buildWith({ id: 'u1', email: 'vera@gmail.com', uiLanguage: 'ru' });

    await service.completePasswordReset('u1', 'new-hash');

    const written = repo.update.mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >;
    expect(written).toMatchObject({
      passwordHash: 'new-hash',
      resetTokenHash: null,
      inviteCodeHash: null,
      inviteCodeExpiresAt: null,
    });
  });
});
