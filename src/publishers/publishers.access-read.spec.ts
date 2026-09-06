// The push module reaches expo-server-sdk, which ships ESM that Jest will not
// parse. Nothing here touches push; stubbing it keeps the import graph quiet.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { PublishersService } from './publishers.service';

/**
 * Opening somebody's access card sends nothing at all.
 *
 * Written after a report from the congregation: «I open this screen and a
 * letter goes out before I press anything.» Reading the code found no such
 * path — every send is behind a POST — but a claim that rests on somebody
 * having looked carefully is worth less than one that fails a build.
 *
 * What is held here: the read that this screen performs touches the mail
 * service zero times, and touches nothing that could stand in for it — no
 * invitation is issued, no code is written, no session is ended.
 */
describe('PublishersService.getAccess — reading is not doing', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const sendInvitation = jest.fn();
    const mailService = {
      sendInvite: jest.fn(),
      sendPasswordReset: jest.fn(),
      sendPasswordSetByAdmin: jest.fn(),
      sendSharedMailboxNotice: jest.fn(),
    };
    const save = jest.fn();
    const update = jest.fn();
    const service = Object.create(
      PublishersService.prototype,
    ) as PublishersService;
    Object.assign(service, {
      publishersRepo: { save, update },
      findOne: jest.fn(async () => ({
        id: 'p1',
        congregationId: 'c1',
        userId: 'u1',
        firstName: 'Вера',
        lastName: 'Сидорова',
        ...over,
      })),
      usersService: {
        findByIdInCongregation: jest.fn(async () => ({
          id: 'u1',
          email: 'vera@web.de',
          loginName: 'sidorova.vera',
          role: 'publisher',
          isActive: true,
          lastLoginAt: null,
          canViewPrivateData: false,
          passwordHash: null,
          // A live invitation: the very state in which somebody might suspect
          // that opening the screen re-issues one.
          inviteCodeExpiresAt: new Date(Date.now() + 86400000),
        })),
        suggestLoginName: () => 'sidorova.vera',
        sendInvitation,
        mailService,
      },
      mailService,
    });
    return { service, sendInvitation, mailService, save, update };
  };

  const read = (service: PublishersService) =>
    (
      service as unknown as {
        getAccess: (t: string, id: string) => Promise<Record<string, unknown>>;
      }
    ).getAccess('c1', 'p1');

  it('puts no letter in the post', async () => {
    const { service, mailService, sendInvitation } = build();

    await read(service);

    expect(sendInvitation).not.toHaveBeenCalled();
    for (const send of Object.values(mailService)) {
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('writes nothing at all', async () => {
    // A read that saves is how an invitation code would get replaced behind
    // somebody's back — the old one dying without anybody asking for that.
    const { service, save, update } = build();

    await read(service);

    expect(save).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('reports the invitation without touching it', async () => {
    const { service } = build();

    const summary = await read(service);

    expect(summary.hasAccess).toBe(true);
    expect(summary.invitePendingUntil).toBeInstanceOf(Date);
    expect(summary.hasPassword).toBe(false);
  });

  it('says nothing is pending once the code has expired', async () => {
    const { service } = build();
    (
      service as unknown as {
        usersService: { findByIdInCongregation: jest.Mock };
      }
    ).usersService.findByIdInCongregation = jest.fn(async () => ({
      id: 'u1',
      email: null,
      loginName: 'sidorova.vera',
      role: 'publisher',
      isActive: true,
      lastLoginAt: null,
      canViewPrivateData: false,
      passwordHash: null,
      inviteCodeExpiresAt: new Date(Date.now() - 1000),
    }));

    const summary = await read(service);

    expect(summary.invitePendingUntil).toBeNull();
  });
});
