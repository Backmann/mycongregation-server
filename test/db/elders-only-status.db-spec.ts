import { Harness, startHarness } from './harness';

/**
 * Decisions of 31 October 2026, against a real database:
 * - the service status (regular / irregular) is for elders and admins — not
 *   in the roster, not in a publisher's own history, not for a trusted
 *   member;
 * - the secretary, the coordinator of the body of elders and the service
 *   overseer must be elders.
 */
describe('status and the S-21 duties stay with elders (real database)', () => {
  let h: Harness;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await startHarness();
    ids.pub = await h.addPublisher({
      firstName: 'plain',
      lastName: 'Тест',
      baptismDate: '2005-05-05',
    });
    ids.pubUser = await h.addUser({
      login: 'plain',
      role: 'publisher',
      publisherId: ids.pub,
    });
    ids.servant = await h.addPublisher({
      firstName: 'servant',
      lastName: 'Тест',
      baptismDate: '2001-01-01',
      appointment: 'ministerial_servant',
    });
    ids.servantUser = await h.addUser({
      login: 'servant',
      role: 'ministerial_servant',
      publisherId: ids.servant,
    });
    ids.elder = await h.addPublisher({
      firstName: 'elder',
      lastName: 'Тест',
      baptismDate: '1990-01-01',
      appointment: 'elder',
    });
    ids.elderUser = await h.addUser({
      login: 'elder1',
      role: 'elder',
      publisherId: ids.elder,
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  const status = /"status(ManuallyOverridden)?"\s*:/;

  it('a publisher sees no status in the roster or in his own history', async () => {
    const roster = await h.as('plain').get('/publishers?limit=200');
    expect(roster.status).toBe(200);
    expect(status.test(JSON.stringify(roster.body))).toBe(false);

    const own = await h
      .as('plain')
      .get(`/service-reports/by-publisher/${ids.pub}`);
    expect(own.status).toBe(200);
    expect(status.test(JSON.stringify(own.body.publisher))).toBe(false);
  });

  it('an elder still sees it', async () => {
    const res = await h
      .as('elder1')
      .get(`/service-reports/by-publisher/${ids.pub}`);
    expect(res.status).toBe(200);
    expect('status' in res.body.publisher).toBe(true);
  });

  it('the S-21 duties are refused to a ministerial servant, given to an elder', async () => {
    for (const type of ['secretary', 'body_coordinator', 'service_overseer']) {
      const no = await h
        .as('admin')
        .post('/responsibilities', { type, userId: ids.servantUser });
      expect([type, no.status, no.body.code]).toEqual([
        type,
        403,
        'RESPONSIBILITY_ELDERS_ONLY',
      ]);
      const yes = await h
        .as('admin')
        .post('/responsibilities', { type, userId: ids.elderUser });
      expect([type, yes.status]).toEqual([type, 201]);
    }
  });

  it("«Мои данные» leave out the elders' notes and the status", async () => {
    await h.sql(`UPDATE publishers SET is_deaf = true WHERE id = $1`, [
      ids.pub,
    ]);
    const noted = await h.as('admin').patch(`/publishers/${ids.pub}`, {
      notes: 'заметка старейшин',
    });
    expect(noted.status).toBe(200);
    const res = await h.as('plain').get('/me/export');
    expect(res.status).toBe(200);
    const card = res.body.publisher as Record<string, unknown>;
    expect(card.firstName).toBe('plain');
    for (const f of ['notes', 'removedNote', 'status', 'isDeaf'])
      expect([f, f in card]).toEqual([f, false]);
    expect(JSON.stringify(res.body)).not.toMatch(/заметка старейшин/);
  });
});
