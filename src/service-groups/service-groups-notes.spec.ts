// The service reaches the push SDK through its imports; it ships as ESM only.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));
import { ServiceGroupsService } from './service-groups.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * A group's notes: for the elders and for the group itself.
 *
 * Until 6 October every signed-in member was sent the notes of every group.
 * The app drew them only on a group's own card — hidden on the screen, sent
 * all the same.
 */
describe('ServiceGroupsService — whose notes', () => {
  const TENANT = 'c1';
  const groups = [
    {
      id: 'g-mine',
      congregationId: TENANT,
      name: 'Первая',
      notes: 'ЗАМЕТКА-своей',
    },
    {
      id: 'g-other',
      congregationId: TENANT,
      name: 'Вторая',
      notes: 'ЗАМЕТКА-чужой',
    },
  ];
  const user = {
    id: 'u1',
    role: 'publisher',
    congregationId: TENANT,
  } as unknown as AuthenticatedUser;

  function make(privileged: boolean, ownGroupId: string | null) {
    const repo = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(async () => [
          groups.map((g) => ({ ...g })),
          2,
        ]),
      })),
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
        const g = groups.find((x) => x.id === where.id);
        return g ? { ...g } : null;
      }),
    };
    const publishers = {
      findOne: jest.fn(async () => null),
      resolvePrivateAccess: jest.fn(async () => privileged),
      findOwnServiceGroupId: jest.fn(async () => ownGroupId),
    };
    return new ServiceGroupsService(
      repo as never,
      publishers as never,
      {} as never,
    );
  }
  const notesOf = async (svc: ServiceGroupsService) => {
    const page = await svc.findAllFor(TENANT, {} as never, user);
    return Object.fromEntries(page.data.map((g) => [g.id, g.notes]));
  };

  it('sends a member the notes of her own group and of no other', async () => {
    expect(await notesOf(make(false, 'g-mine'))).toEqual({
      'g-mine': 'ЗАМЕТКА-своей',
      'g-other': null,
    });
  });

  it('sends somebody in no group no notes at all', async () => {
    expect(await notesOf(make(false, null))).toEqual({
      'g-mine': null,
      'g-other': null,
    });
  });

  it('sends the elders every group’s notes', async () => {
    expect(await notesOf(make(true, null))).toEqual({
      'g-mine': 'ЗАМЕТКА-своей',
      'g-other': 'ЗАМЕТКА-чужой',
    });
  });

  it('holds the same for one group asked for by its number', async () => {
    const member = make(false, 'g-mine');
    expect((await member.findOneFor(TENANT, 'g-mine', user)).notes).toBe(
      'ЗАМЕТКА-своей',
    );
    expect((await member.findOneFor(TENANT, 'g-other', user)).notes).toBeNull();
    expect(
      (await make(true, null).findOneFor(TENANT, 'g-other', user)).notes,
    ).toBe('ЗАМЕТКА-чужой');
  });

  it('still says which group is one’s own, and keeps the rest of the row', async () => {
    const page = await make(false, 'g-mine').findAllFor(
      TENANT,
      {} as never,
      user,
    );
    expect(page.data.map((g) => [g.name, g.mine])).toEqual([
      ['Первая', true],
      ['Вторая', false],
    ]);
  });
});
