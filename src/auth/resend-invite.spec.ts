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
  const build = (...users: unknown[]) => {
    const sendInvitation = jest.fn(async () => undefined);
    const findAllWaitingForInvite = jest.fn(async () =>
      users.filter((u) => u !== null),
    );
    const usersService = { findAllWaitingForInvite, sendInvitation };
    const service = Object.create(AuthService.prototype) as AuthService;
    Object.assign(service, {
      usersService,
      logger: { warn: jest.fn(), log: jest.fn() },
      resetRequests: new Map<string, number[]>(),
    });
    return { service, sendInvitation, findAllWaitingForInvite };
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
    const { service, sendInvitation } = build();

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

  it('accepts the login name, which is what the letter told them to keep', async () => {
    // The address may have been typed by an elder and never said out loud.
    // The login name is printed in a box in the letter with «write this
    // down» next to it — so it is what a person actually has when the code
    // has died.
    const { service, sendInvitation, findAllWaitingForInvite } = build({
      id: 'u1',
      email: 'vera@gmail.com',
      isActive: true,
      passwordHash: null,
    });

    await service.resendInvite('Sidorova.Vera');

    expect(findAllWaitingForInvite).toHaveBeenCalledWith('sidorova.vera');
    expect(sendInvitation).toHaveBeenCalledWith('u1');
  });

  it('sends nothing when there is nowhere to send', async () => {
    // Most of this congregation has no address at all. Their code is handed
    // over in person, and no amount of asking over the internet can produce
    // one — the screen says so rather than pretending a letter is coming.
    const { service, sendInvitation } = build({
      id: 'u1',
      email: null,
      isActive: true,
      passwordHash: null,
    });

    await service.resendInvite('sidorova.vera');

    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it('writes to both accounts on a shared mailbox', async () => {
    // A husband and wife with one address. Picking one of them would be right
    // half the time; each letter names its own reader.
    const { service, sendInvitation } = build(
      {
        id: 'u1',
        email: 'family@gmail.com',
        isActive: true,
        passwordHash: null,
      },
      {
        id: 'u2',
        email: 'family@gmail.com',
        isActive: true,
        passwordHash: null,
      },
    );

    await service.resendInvite('family@gmail.com');

    expect(sendInvitation).toHaveBeenCalledTimes(2);
  });

  it('stops somebody asking over and over for the same person', async () => {
    const { service, sendInvitation } = build({
      id: 'u1',
      email: 'vera@gmail.com',
      isActive: true,
      passwordHash: null,
    });

    for (let i = 0; i < 5; i++) await service.resendInvite('sidorova.vera');

    // Three letters an hour to one account — enough for a person who tried
    // twice and lost the letter, not enough to bury a mailbox.
    expect(sendInvitation).toHaveBeenCalledTimes(3);
  });
});
