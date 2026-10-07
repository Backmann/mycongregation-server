import { UsersService } from './users.service';

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
