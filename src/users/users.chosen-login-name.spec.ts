import { BadRequestException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * The name an elder types when granting access.
 *
 * The field has been on the screen since the form was rebuilt, and the server
 * did not accept it: the request was refused whole, by validation, with
 * «property loginName should not exist» — so nothing happened at all when the
 * button was pressed. And had it been accepted, it was ignored: the account
 * was named from the card regardless.
 *
 * That matters most for exactly the names it exists for. Transliteration reads
 * the card and produces `bakmann.lionel`; the man writes himself Backmann on
 * every document he owns, and the elder is the one who knows it.
 */
describe('createUserByAdmin — the name the elder chose', () => {
  const build = (taken = false) => {
    const saved: { loginName?: string }[] = [];
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, {
      usersRepo: {
        create: (x: { loginName?: string }) => x,
        save: jest.fn(async (x: { loginName?: string }) => {
          saved.push(x);
          return x;
        }),
        findOne: jest.fn().mockResolvedValue(null),
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(taken ? 1 : 0),
        })),
      },
      publishersRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'p1',
          firstName: 'Лионель',
          lastName: 'Бакманн',
        }),
        save: jest.fn(async (x: unknown) => x),
      },
      auditLog: { logCreate: jest.fn().mockResolvedValue(undefined) },
      config: { get: () => 4 },
      mailService: { sendInvite: jest.fn() },
      logger: { warn: jest.fn(), log: jest.fn() },
      hashPassword: jest.fn(async () => 'hashed'),
      sendInvitation: jest.fn(async () => ({
        code: 'K7QM-3XPD',
        expiresAt: new Date(),
        sentTo: null,
      })),
    });
    return { service, saved };
  };

  const dto = (over: Record<string, unknown> = {}) => ({
    password: 'correct horse battery',
    role: UserRole.PUBLISHER,
    publisherId: 'p1',
    ...over,
  });

  it('uses the spelling the elder typed', async () => {
    const { service, saved } = build();

    await service.createUserByAdmin(
      dto({ loginName: 'Backmann.Lionel' }) as never,
      'c1',
      'admin-1',
    );

    expect(saved[0].loginName).toBe('backmann.lionel');
  });

  it('falls back to the card when the elder typed nothing', async () => {
    const { service, saved } = build();

    await service.createUserByAdmin(dto() as never, 'c1', 'admin-1');

    expect(saved[0].loginName).toBe('bakmann.lionel');
  });

  it('refuses a name that cannot be dictated, rather than quietly replacing it', async () => {
    // Silently substituting a generated name would leave the elder telling
    // somebody a name that is not theirs.
    const { service } = build();

    await expect(
      service.createUserByAdmin(
        dto({ loginName: 'Бакманн Лионель' }) as never,
        'c1',
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a name somebody else already holds', async () => {
    const { service } = build(true);

    await expect(
      service.createUserByAdmin(
        dto({ loginName: 'sidorova.vera' }) as never,
        'c1',
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
