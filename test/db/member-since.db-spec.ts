import { Harness, startHarness } from './harness';

/**
 * In our congregation since (1 November 2026), against a real database:
 * the three answers of the new card, the month it is kept as, and how the
 * standing reads it.
 */
describe('«в нашем собрании с» (real database)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const make = (extra: Record<string, unknown>) =>
    h.as('admin').post('/publishers', {
      firstName: 'Пришедший',
      lastName: 'Тест',
      gender: 'brother',
      appointment: 'publisher',
      baptismDate: '1999-03-03',
      ...extra,
    });
  const row = async (id: string) =>
    (
      await h.sql<{ member_since: string | null; status: string | null }>(
        `SELECT to_char(member_since, 'YYYY-MM-DD') AS member_since, status FROM publishers WHERE id = $1`,
        [id],
      )
    )[0];
  const thisMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;

  it('an app that does not ask: this month, and he is not inactive', async () => {
    const r = await make({});
    expect(r.status).toBe(201);
    const got = await row(r.body.id);
    expect(got.member_since).toBe(thisMonth());
    expect(got.status).not.toBe('inactive');
  });

  it('a month given is kept as its first day; counting starts there', async () => {
    const r = await make({ memberSince: '2026-09-17' });
    expect(r.status).toBe(201);
    const got = await row(r.body.id);
    expect(got.member_since).toBe('2026-09-01');
    expect(got.status).not.toBe('inactive');
  });

  it('«давно в собрании»: no date — judged on his silence like everyone', async () => {
    const r = await make({ memberSince: null });
    expect(r.status).toBe(201);
    const got = await row(r.body.id);
    expect(got.member_since).toBeNull();
    expect(got.status).toBe('inactive');
  });

  it('a date moved far back on the card re-reads the standing at once', async () => {
    const r = await make({});
    const moved = await h
      .as('admin')
      .patch(`/publishers/${r.body.id}`, { memberSince: '2020-01-01' });
    expect(moved.status).toBe(200);
    expect((await row(r.body.id)).status).toBe('inactive');
  });

  it('as private as the baptism date: not in a publisher’s roster', async () => {
    const id = await h.addPublisher({
      firstName: 'Читающий',
      lastName: 'Тест',
      appointment: 'publisher',
      baptismDate: '2000-01-01',
    });
    await h.sql(
      `UPDATE publishers SET status = 'active', status_manually_overridden = true WHERE id = $1`,
      [id],
    );
    await h.addUser({ login: 'reader', role: 'publisher', publisherId: id });
    const res = await h.as('reader').get('/publishers?limit=200');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/memberSince/);
  });
});
