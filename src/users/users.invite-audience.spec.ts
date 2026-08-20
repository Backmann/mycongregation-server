import { UsersService } from './users.service';

/**
 * Whose mailbox is this, and can an invitation be taken back?
 *
 * The publisher's own card decides the first question — an address that is not
 * on it is borrowed, and a borrowed mailbox gets a code with no link.
 */
describe('UsersService.sendInvitation — own address or borrowed', () => {
  const build = (cardEmail: string | null) => {
    const sendInvite = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      usersRepo: {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        findOne: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'family@gmail.com',
          loginName: 'sidorova.vera',
          uiLanguage: 'ru',
        }),
      },
      publishersRepo: {
        findOne: jest
          .fn()
          .mockResolvedValue({ firstName: 'Вера', email: cardEmail }),
      },
      mailService: { sendInvite },
      config: { get: () => undefined },
      logger: { warn: jest.fn(), log: jest.fn() },
      setPasswordResetToken: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'family@gmail.com',
        loginName: 'sidorova.vera',
        uiLanguage: 'ru',
      }),
    });
    return { service, sendInvite };
  };

  const extrasOf = (sendInvite: jest.Mock) =>
    sendInvite.mock.calls[0][3] as { borrowedMailbox?: boolean };
  const linkOf = (sendInvite: jest.Mock) =>
    sendInvite.mock.calls[0][2] as string;

  it('treats an address that is not on the card as borrowed, and sends no link', async () => {
    const { service, sendInvite } = build('vera@gmail.com');

    await service.sendInvitation('u1');

    expect(extrasOf(sendInvite).borrowedMailbox).toBe(true);
    expect(linkOf(sendInvite)).toBe('');
  });

  it('treats the address on the card as the person\u2019s own', async () => {
    const { service, sendInvite } = build('Family@Gmail.com');

    await service.sendInvitation('u1');

    expect(extrasOf(sendInvite).borrowedMailbox).toBe(false);
    expect(linkOf(sendInvite)).toContain('reset-password?token=');
  });

  it('treats a card with no address as borrowed', async () => {
    // Safest reading: we have nothing saying this address is theirs.
    const { service, sendInvite } = build(null);

    await service.sendInvitation('u1');

    expect(extrasOf(sendInvite).borrowedMailbox).toBe(true);
  });
});

describe('UsersService.revokeInvitation', () => {
  it('closes both doors, the code and the link', async () => {
    // Issued together for one purpose. Killing the code and leaving the link
    // would keep a way in that nobody is watching.
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      usersRepo: { update },
      findByIdInCongregation: jest.fn(async () => ({ id: 'u1' })),
    });

    await service.revokeInvitation('u1', 'c1');

    expect(update).toHaveBeenCalledWith('u1', {
      inviteCodeHash: null,
      inviteCodeExpiresAt: null,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    });
  });

  it('refuses an account outside the caller\u2019s congregation', async () => {
    const update = jest.fn();
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      usersRepo: { update },
      findByIdInCongregation: jest.fn(async () => {
        throw new Error('User not found');
      }),
    });

    await expect(service.revokeInvitation('u1', 'other')).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
});
