import { FORGET_DEAD_SESSIONS_SQL, UsersService } from './users.service';

/**
 * The nightly sweep of the sessions table.
 *
 * What the words of the query mean is proved against a real table on the
 * stand (seven kinds of row, which go and which stay); here it is held that
 * the service runs exactly those words and reads the count back.
 */
describe('UsersService.forgetDeadSessions', () => {
  const build = (answer: unknown) => {
    const query = jest.fn(async () => answer);
    const service = Object.create(UsersService.prototype) as UsersService;
    Object.assign(service, { sessionsRepo: { query } });
    return { service, query };
  };

  it('runs the one query and says how many rows went', async () => {
    const { service, query } = build([[], 412]);

    expect(await service.forgetDeadSessions()).toBe(412);
    expect(query).toHaveBeenCalledWith(FORGET_DEAD_SESSIONS_SQL);
  });

  it('an answer in a shape it does not know is «nothing», not a crash', async () => {
    expect(await build(undefined).service.forgetDeadSessions()).toBe(0);
    expect(await build([[]]).service.forgetDeadSessions()).toBe(0);
  });

  it('never deletes by revocation alone — a revoked row is how a stolen token is recognised', () => {
    // Deleting «everything revoked» is the obvious sweep and the wrong one:
    // a replayed token must still find its row for the rest of its life.
    const sql = FORGET_DEAD_SESSIONS_SQL.replace(/\s+/g, ' ');
    expect(sql).toContain("s.expires_at < now() - interval '1 day'");
    expect(sql).not.toMatch(/WHERE s\.revoked_at/);
    // …and the first row of a chain that is still alive stays.
    expect(sql).toContain('s.id = s.family_id');
    expect(sql).toContain('alive.revoked_at IS NULL');
  });
});
