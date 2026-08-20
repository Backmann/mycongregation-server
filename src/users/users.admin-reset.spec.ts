import { UsersService } from './users.service';

/**
 * What happens to the OLD way in when a password is set for somebody.
 *
 * The self-service reset ended every session from the day it was written. An
 * elder's reset did not — so a phone that was lost, and a password changed
 * precisely because it was lost, left the finder signed in for up to thirty
 * days. Same intent, two implementations, one of them half done.
 */
describe('UsersService.resetPasswordByAdmin', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const user = {
      id: 'u1',
      congregationId: 'c1',
      email: 'vera@gmail.com',
      loginName: 'sidorova.vera',
      uiLanguage: 'ru',
      isOwner: false,
      ...over,
    };
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const sessionsUpdate = jest.fn().mockResolvedValue({ affected: 2 });
    const sendPasswordSetByAdmin = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      usersRepo: { update },
      sessionsRepo: { update: sessionsUpdate },
      publishersRepo: { findOne: jest.fn().mockResolvedValue(null) },
      mailService: { sendPasswordSetByAdmin },
      auditLog: { logRawUpdate: jest.fn().mockResolvedValue(undefined) },
      config: { get: () => 4 },
      findByIdInCongregation: jest.fn(async () => user),
      firstNameOf: jest.fn(async () => 'Вера'),
    });
    return { service, update, sessionsUpdate, sendPasswordSetByAdmin };
  };

  it('ends every open session of that account', async () => {
    const { service, sessionsUpdate } = build();

    await service.resetPasswordByAdmin(
      'u1',
      'correct horse battery',
      'c1',
      'admin-1',
    );

    expect(sessionsUpdate).toHaveBeenCalledTimes(1);
    const [where] = sessionsUpdate.mock.calls[0] as [{ userId: string }];
    expect(where.userId).toBe('u1');
  });

  it('tells the owner their password was changed, and by what name to sign in', async () => {
    const { service, sendPasswordSetByAdmin } = build();

    await service.resetPasswordByAdmin(
      'u1',
      'correct horse battery',
      'c1',
      'admin-1',
    );

    const [to, lang, extra] = sendPasswordSetByAdmin.mock.calls[0] as [
      string,
      string,
      { loginName?: string | null },
    ];
    expect(to).toBe('vera@gmail.com');
    expect(lang).toBe('ru');
    expect(extra.loginName).toBe('sidorova.vera');
  });

  it('writes to nobody when the account has no address', async () => {
    // The ordinary case here: no address is exactly why an elder is setting
    // the password by hand instead of sending a link.
    const { service, sendPasswordSetByAdmin, sessionsUpdate } = build({
      email: null,
    });

    await service.resetPasswordByAdmin(
      'u1',
      'correct horse battery',
      'c1',
      'admin-1',
    );

    expect(sendPasswordSetByAdmin).not.toHaveBeenCalled();
    // The sessions still end — that part is not about letters.
    expect(sessionsUpdate).toHaveBeenCalled();
  });

  it('does not write to somebody changing their own password', async () => {
    const { service, sendPasswordSetByAdmin } = build();

    await service.resetPasswordByAdmin(
      'u1',
      'correct horse battery',
      'c1',
      'u1',
    );

    expect(sendPasswordSetByAdmin).not.toHaveBeenCalled();
  });

  it('refuses a weak password before touching anything', async () => {
    const { service, update, sessionsUpdate } = build();

    await expect(
      service.resetPasswordByAdmin('u1', 'short', 'c1', 'admin-1'),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(sessionsUpdate).not.toHaveBeenCalled();
  });
});
