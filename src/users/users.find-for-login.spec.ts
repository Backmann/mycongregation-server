import { UsersService } from './users.service';

/**
 * Who is signing in, when the address no longer answers that on its own.
 *
 * The address used to be UNIQUE, so finding a person by it was the same thing
 * as identifying them. Now a couple may share a mailbox, and the question
 * splits in two: a login name identifies, an address merely delivers.
 */
describe('UsersService.findForLogin', () => {
  let where: jest.Mock;
  let getOne: jest.Mock;
  let getMany: jest.Mock;
  let service: UsersService;

  beforeEach(() => {
    where = jest.fn().mockReturnThis();
    getOne = jest.fn().mockResolvedValue(null);
    getMany = jest.fn().mockResolvedValue([]);
    const repo: any = {
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        where,
        getOne,
        getMany,
      })),
    };
    service = new (UsersService as unknown as new (r: unknown) => UsersService)(
      repo,
    );
  });

  const asked = () => ({
    sql: where.mock.calls[0][0] as string,
    value: Object.values(where.mock.calls[0][1] as Record<string, string>)[0],
  });

  it('looks a login name up by name, not by address', async () => {
    await service.findForLogin('Sidorova.Vera');

    const { sql, value } = asked();
    expect(sql).toContain('LOWER(user.login_name)');
    expect(value).toBe('sidorova.vera');
    // The address branch must not have been touched.
    expect(getMany).not.toHaveBeenCalled();
  });

  it('still lets the forty-eight people already here sign in by address', async () => {
    getMany.mockResolvedValue([{ id: 'u1' }]);

    const { user, shared } = await service.findForLogin(
      ' Backmannleo@Gmail.com ',
    );

    expect(asked().sql).toContain('LOWER(user.email)');
    expect(user).toEqual({ id: 'u1' });
    expect(shared).toBe(false);
  });

  it('asks for a name when one mailbox serves two logins', async () => {
    getMany.mockResolvedValue([{ id: 'him' }, { id: 'her' }]);

    const { user, shared } = await service.findForLogin('family@gmail.com');

    // Deliberately NOT trying each password in turn: one person's wrong
    // attempt would count against the other's limit, and a forgotten password
    // would send two letters to the same mailbox.
    expect(user).toBeNull();
    expect(shared).toBe(true);
  });

  it('answers nothing to an empty field without asking the database', async () => {
    const { user, shared } = await service.findForLogin('   ');

    expect(user).toBeNull();
    expect(shared).toBe(false);
    expect(where).not.toHaveBeenCalled();
  });
});
