import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';
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
});
