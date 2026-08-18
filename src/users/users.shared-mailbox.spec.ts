import { UsersService } from './users.service';

/**
 * Telling somebody their way in has changed — before it does.
 *
 * When an address starts serving a second login, the person who has been
 * signing in with it for months can no longer use it. Two things follow: the
 * form must be able to say so while the elder can still choose otherwise, and
 * the person themselves must hear it from us rather than from a refusal.
 */
describe('a mailbox that starts serving two logins', () => {
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

  const build = (rows: unknown[]) => {
    const getMany = jest.fn().mockResolvedValue(rows);
    const sendSharedMailboxNotice = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      usersRepo: {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany,
        })),
      },
      publishersRepo: {
        findOne: jest
          .fn()
          .mockResolvedValue({ firstName: 'Александр', lastName: 'Сидоров' }),
      },
      mailService: { sendSharedMailboxNotice },
      logger: { warn: jest.fn(), log: jest.fn() },
      firstNameOf: jest.fn().mockResolvedValue('Александр'),
    });
    return { service, sendSharedMailboxNotice, getMany };
  };

  it('writes to the person who was already using the address', async () => {
    const { service, sendSharedMailboxNotice } = build([him, her]);

    await service.noticeMailboxNowShared('family@gmail.com', 'her');

    // Only him: she is the one who just arrived, and she knows.
    expect(sendSharedMailboxNotice).toHaveBeenCalledTimes(1);
    const [to, lang, extra] = sendSharedMailboxNotice.mock.calls[0] as [
      string,
      string,
      { loginName?: string | null },
    ];
    expect(to).toBe('family@gmail.com');
    expect(lang).toBe('ru');
    // The letter is useless without the one thing he now needs.
    expect(extra.loginName).toBe('sidorov.aleksandr');
  });

  it('says nothing when the address serves nobody else', async () => {
    const { service, sendSharedMailboxNotice } = build([her]);

    await service.noticeMailboxNowShared('vera@gmail.com', 'her');

    expect(sendSharedMailboxNotice).not.toHaveBeenCalled();
  });

  it('says nothing when there is no address at all', async () => {
    const { service, sendSharedMailboxNotice, getMany } = build([]);

    await service.noticeMailboxNowShared(null, 'her');

    expect(getMany).not.toHaveBeenCalled();
    expect(sendSharedMailboxNotice).not.toHaveBeenCalled();
  });

  it('a failed letter does not undo what succeeded', async () => {
    // The login was created. Losing it because a mail server hiccuped would
    // be a far worse outcome than a notice nobody received.
    const { service, sendSharedMailboxNotice } = build([him, her]);
    sendSharedMailboxNotice.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.noticeMailboxNowShared('family@gmail.com', 'her'),
    ).resolves.toBeUndefined();
  });

  it('tells the form who else holds an address, and who they are', async () => {
    const { service } = build([him]);

    const holders = await service.whoElseUses('Family@Gmail.com', 'cong-1');

    expect(holders).toEqual([
      { loginName: 'sidorov.aleksandr', displayName: 'Сидоров Александр' },
    ]);
  });

  it('answers nothing to an empty address without asking the database', async () => {
    const { service, getMany } = build([]);

    await expect(service.whoElseUses('  ', 'cong-1')).resolves.toEqual([]);
    expect(getMany).not.toHaveBeenCalled();
  });
});
