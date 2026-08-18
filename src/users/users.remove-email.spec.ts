import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * Taking an address off an account.
 *
 * It used to be impossible by construction: the column was NOT NULL and the
 * form demanded a valid address. Both are gone, so «please take my e-mail out
 * of there» is now a thing somebody can ask for and an elder can do.
 */
describe('UsersService.changeEmailByAdmin — an address may be removed', () => {
  const build = (current: string | null) => {
    const user = {
      id: 'u1',
      email: current,
      isOwner: false,
      congregationId: 'c1',
    };
    const save = jest.fn(async (x: unknown) => x);
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      usersRepo: { save },
      findByIdInCongregation: jest.fn(async () => user),
    });
    return { service, save, user };
  };

  it('clears the address when the field is emptied', async () => {
    const { service, save, user } = build('vera@gmail.com');

    await service.changeEmailByAdmin('u1', '   ', 'c1');

    expect(save).toHaveBeenCalled();
    expect(user.email).toBeNull();
  });

  it('refuses something that is neither empty nor an address', async () => {
    // Accepting it would break delivery silently — nobody finds out until a
    // letter fails to arrive, months later.
    const { service, save } = build('vera@gmail.com');

    await expect(
      service.changeEmailByAdmin('u1', 'vera at gmail', 'c1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('still accepts an address another account already uses', async () => {
    const { service, user } = build(null);

    await service.changeEmailByAdmin('u1', 'Family@Gmail.com', 'c1');

    expect(user.email).toBe('family@gmail.com');
  });
});
