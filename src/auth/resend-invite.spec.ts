import { AuthService } from './auth.service';

/**
 * Asking for a fresh invitation code.
 *
 * The tests are about the two promises that let this be public: it tells
 * nobody whether an address exists, and it will not mail an account that has
 * finished its invitation. Both are invisible from the outside by design,
 * which is exactly why they need holding down here.
 */
describe('AuthService.resendInvite', () => {
  const build = (user: unknown) => {
    const sendInvitation = jest.fn(async () => undefined);
    const usersService = {
      findByEmailWithPassword: jest.fn(async () => user),
      sendInvitation,
    };
    const service = Object.create(AuthService.prototype) as AuthService;
    Object.assign(service, {
      usersService,
      logger: { warn: jest.fn(), log: jest.fn() },
    });
    return { service, sendInvitation };
  };

  it('sends when the account is still waiting for a password', async () => {
    const { service, sendInvitation } = build({
      id: 'u1',
      email: 'a@b.c',
      isActive: true,
      passwordHash: null,
    });

    await service.resendInvite('A@B.C ');

    // The address is no longer passed in: sendInvitation reads the account and
    // decides for itself whether there is anywhere to send. Four callers each
    // deciding that separately is how one of them ends up deciding wrongly.
    expect(sendInvitation).toHaveBeenCalledWith('u1');
  });

  it('refuses to mail an account that already has a password', async () => {
    const { service, sendInvitation } = build({
      id: 'u1',
      email: 'a@b.c',
      isActive: true,
      passwordHash: 'hashed',
    });

    await service.resendInvite('a@b.c');

    // «Забыли пароль» is that door. This one must not become a way to mail
    // people who did not ask.
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it('says nothing different about an address that does not exist', async () => {
    const { service, sendInvitation } = build(null);

    // No throw, no distinguishable answer — the caller cannot learn whether
    // this congregation knows the address.
    await expect(service.resendInvite('nobody@b.c')).resolves.toBeUndefined();
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it('does not send to a switched-off account', async () => {
    const { service, sendInvitation } = build({
      id: 'u1',
      email: 'a@b.c',
      isActive: false,
      passwordHash: null,
    });

    await service.resendInvite('a@b.c');

    expect(sendInvitation).not.toHaveBeenCalled();
  });
});
