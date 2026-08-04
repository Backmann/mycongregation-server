import { UsersService } from './users.service';

/**
 * Signing in with the address you can read on your own screen.
 *
 * Every write path lowercases and trims an address; the login lookup compared
 * it character for character. A capital from a phone keyboard or a space from
 * a paste answered «Invalid credentials» to a person whose password was right,
 * and told him nothing he could act on.
 */
describe('UsersService — finding a person by e-mail', () => {
  let where: jest.Mock;
  let service: UsersService;

  const qb = () => {
    where = jest.fn().mockReturnThis();
    return {
      addSelect: jest.fn().mockReturnThis(),
      where,
      getOne: jest.fn().mockResolvedValue(null),
    };
  };

  beforeEach(() => {
    const repo: any = { createQueryBuilder: jest.fn(() => qb()) };
    // Only the repository matters here; the rest of the constructor is not
    // reached by these two lookups.
    service = new (UsersService as unknown as new (r: unknown) => UsersService)(
      repo,
    );
  });

  const asked = () => ({
    sql: where.mock.calls[0][0] as string,
    email: (where.mock.calls[0][1] as { email: string }).email,
  });

  it('ignores the case of what was typed', async () => {
    await service.findByEmailWithPassword('Maximka3830@Gmail.com');

    const { sql, email } = asked();
    // The column is lowered too: the first administrator of a congregation
    // used to be stored exactly as typed, so mixed-case rows exist.
    expect(sql).toContain('LOWER(user.email)');
    expect(email).toBe('maximka3830@gmail.com');
  });

  it('ignores a space picked up by copy-paste', async () => {
    await service.findByEmailWithPassword('  maximka3830@gmail.com ');

    expect(asked().email).toBe('maximka3830@gmail.com');
  });

  it('does the same when looking someone up to reset a password', async () => {
    await service.findByEmail(' Maximka3830@GMAIL.com ');

    const { sql, email } = asked();
    expect(sql).toContain('LOWER(user.email)');
    expect(email).toBe('maximka3830@gmail.com');
  });
});
