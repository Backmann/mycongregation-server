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
  let repo: {
    update: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  const buildWith = async (user: unknown) => {
    sendInvite = jest.fn().mockResolvedValue(undefined);
    repo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue(user),
      // «Has he a password already?» is asked with the hash selected.
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(user),
      })),
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

  it('gives the code a month — and issues no sign-in link at all', async () => {
    // The link signed its clicker in wherever the letter was opened: the mail
    // client's browser on an iPhone, a browser on an Android phone whose app
    // then asked for the password again. One door now, and it is the code.
    await buildWith({ id: 'u1', email: 'vera@gmail.com', uiLanguage: 'ru' });
    const before = Date.now();

    const issued = await service.sendInvitation('u1');

    const days = (d: Date) => Math.round((d.getTime() - before) / 86400000);
    expect(days(issued.expiresAt)).toBe(30);
    const written = repo.update.mock.calls.find(
      (c) => (c[1] as { inviteCodeHash?: string }).inviteCodeHash,
    )?.[1] as Record<string, unknown>;
    // …and a link still out there from an earlier letter stops working.
    expect(written.resetTokenHash).toBeNull();
    expect(written.resetTokenExpiresAt).toBeNull();
  });

  it('the button in the letter only fills the code in — it carries no token', async () => {
    await buildWith({ id: 'u1', email: 'vera@gmail.com', uiLanguage: 'ru' });

    const issued = await service.sendInvitation('u1');

    const link = sendInvite.mock.calls[0][2] as string;
    // …and it opens the screen in the language the letter is written in.
    expect(link).toBe(
      `https://mycongregation.org/reset-password?code=${issued.code}&lang=ru`,
    );
    expect(link).not.toMatch(/token=/);
  });

  it('the same letter whether or not the address is on the card — nobody’s own mailbox is called «общий»', async () => {
    // It used to depend on the card: an address kept only on the account got
    // a letter saying «это письмо пришло на общий почтовый ящик — передайте
    // его», sent to the reader's own mailbox.
    await buildWith({
      id: 'u1',
      email: 'vera@gmail.com',
      uiLanguage: 'ru',
      congregationId: 'c1',
    });

    await service.sendInvitation('u1');

    const extra = sendInvite.mock.calls[0][3] as Record<string, unknown>;
    expect(extra).not.toHaveProperty('borrowedMailbox');
    expect(extra.recipientName).toBe('Вера');
    expect(extra.congregationName).toBe('Хамм');
  });

  it('somebody who already has a password gets «вам выдали код», not an invitation', async () => {
    await buildWith({
      id: 'u1',
      email: 'vera@gmail.com',
      uiLanguage: 'ru',
      passwordHash: 'x',
    });
    const reset = (
      service as unknown as { mailService: { sendPasswordReset: jest.Mock } }
    ).mailService.sendPasswordReset;

    await service.sendInvitation('u1');

    expect(sendInvite).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(
      (reset.mock.calls[0][3] as { issuedByElder?: boolean }).issuedByElder,
    ).toBe(true);
  });

  describe('sendResetCode — «Забыли пароль»', () => {
    const reset = () =>
      (service as unknown as { mailService: { sendPasswordReset: jest.Mock } })
        .mailService.sendPasswordReset;

    it('a code that lives a day, by post, saying «вы попросили»', async () => {
      await buildWith({
        id: 'u1',
        email: 'vera@gmail.com',
        uiLanguage: 'ru',
        isActive: true,
        passwordHash: 'x',
      });
      const before = Date.now();

      await service.sendResetCode('u1');

      const written = repo.update.mock.calls.find(
        (c) => (c[1] as { inviteCodeHash?: string }).inviteCodeHash,
      )?.[1] as { inviteCodeExpiresAt: Date };
      const hours = (written.inviteCodeExpiresAt.getTime() - before) / 3600000;
      expect(Math.round(hours)).toBe(24);
      const [to, , link, extra] = reset().mock.calls[0] as [
        string,
        string,
        string,
        { issuedByElder?: boolean; code?: string },
      ];
      expect(to).toBe('vera@gmail.com');
      expect(link).toContain(`reset-password?code=${extra.code}`);
      expect(extra.issuedByElder).toBe(false);
    });

    it('somebody who never finished the invitation is sent the invitation again', async () => {
      await buildWith({
        id: 'u1',
        email: 'vera@gmail.com',
        uiLanguage: 'ru',
        isActive: true,
        passwordHash: null,
      });

      await service.sendResetCode('u1');

      expect(sendInvite).toHaveBeenCalledTimes(1);
      expect(reset()).not.toHaveBeenCalled();
    });

    it.each([
      ['no address', { email: null, isActive: true }],
      ['switched off', { email: 'vera@gmail.com', isActive: false }],
    ])('%s: nothing is issued and nothing is sent', async (_n, over) => {
      await buildWith({
        id: 'u1',
        uiLanguage: 'ru',
        passwordHash: 'x',
        ...over,
      });

      await service.sendResetCode('u1');

      expect(repo.update).not.toHaveBeenCalled();
      expect(reset()).not.toHaveBeenCalled();
      expect(sendInvite).not.toHaveBeenCalled();
    });
  });

  it.each([
    [
      'an elder sets it',
      (s: UsersService) =>
        s.resetPasswordByAdmin('u1', 'Birke Nebel Tasse', 'c1', 'admin'),
    ],
  ])(
    'a new password ends the code and the link handed out before it — when %s',
    async (_n, act) => {
      // Found on the stand, 7 October: the elder's password was overwritten a
      // minute later by the invitation code from an old letter.
      await buildWith({
        id: 'u1',
        email: null,
        uiLanguage: 'ru',
        isOwner: false,
      });
      Object.assign(service, {
        findByIdInCongregation: jest.fn(async () => ({
          id: 'u1',
          email: null,
          isOwner: false,
        })),
      });

      await act(service);

      const written = repo.update.mock.calls.find(
        (c) => (c[1] as { passwordHash?: string }).passwordHash,
      )?.[1] as Record<string, unknown>;
      expect(written).toMatchObject({
        inviteCodeHash: null,
        inviteCodeExpiresAt: null,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      });
    },
  );

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
