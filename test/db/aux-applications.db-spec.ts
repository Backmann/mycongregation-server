import { Harness, startHarness } from './harness';
import { AuxApplicationsService } from '../../src/auxiliary-pioneers/aux-applications.service';

/**
 * The S-205b application online and the service committee's three places
 * (Lionel, 29 October 2026), walked end to end on a real database.
 */
describe('applications to serve as an auxiliary pioneer (real database)', () => {
  let h: Harness;
  let tenantId: string;
  const users: Record<string, string> = {};
  const cards: Record<string, string> = {};

  const elder = async (login: string, first: string) => {
    cards[login] = await h.addPublisher({
      firstName: first,
      lastName: 'Тест',
      gender: 'brother',
      appointment: 'elder',
      baptismDate: '2000-01-01',
    });
    users[login] = await h.addUser({
      login,
      role: 'elder',
      publisherId: cards[login],
    });
  };
  const give = (type: string, login: string) =>
    h.as('admin').post('/responsibilities', { type, userId: users[login] });
  const apply = (who: string, months: string[], extra = {}) =>
    h.as(who).post('/aux-applications', { months, confirmed: true, ...extra });
  const periodsOf = (card: string) =>
    h.sql<{ start_month: string; end_month: string | null }>(
      `SELECT start_month::text, end_month::text FROM auxiliary_pioneers WHERE publisher_id = $1 ORDER BY start_month`,
      [card],
    );

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    await elder('coord', 'Давид');
    await elder('secr', 'Петер');
    await elder('over', 'Андреас');
    await elder('extra', 'Йонас');
    cards.sister = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Вебер',
      gender: 'sister',
      appointment: 'publisher',
      baptismDate: '2010-01-01',
    });
    users.sister = await h.addUser({
      login: 'sister',
      role: 'publisher',
      publisherId: cards.sister,
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('is not taken while the committee is not whole', async () => {
    await give('body_coordinator', 'coord');
    const r = await apply('sister', ['2031-05']);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('AUX_APP_COMMITTEE_INCOMPLETE');
    const adm = await h.as('admin').get('/aux-applications/committee');
    expect(adm.body).toEqual({
      complete: false,
      missing: ['secretary', 'service_overseer'],
    });
    await give('secretary', 'secr');
    await give('service_overseer', 'over');
  });

  let first: string;
  it('three places answer; another elder answers in a place passed on', async () => {
    const r = await apply('sister', ['2031-05', '2031-06']);
    expect(r.status).toBe(201);
    first = r.body.id;
    expect((await apply('sister', ['2031-09'])).body.code).toBe(
      'AUX_APP_PENDING_EXISTS',
    );
    // An elder outside the committee sees nothing yet.
    expect((await h.as('extra').get('/aux-applications')).body).toEqual([]);
    expect(
      (await h.as('extra').post(`/aux-applications/${first}/approve`, {})).body
        .code,
    ).toBe('AUX_APP_NO_SEAT');

    expect(
      (await h.as('coord').post(`/aux-applications/${first}/approve`, {}))
        .status,
    ).toBe(201);
    // Answered: the applicant may no longer change it.
    const ch = await h.as('sister').patch(`/aux-applications/${first}`, {
      months: ['2031-07'],
      confirmed: true,
    });
    expect(ch.body.code).toBe('AUX_APP_ANSWERED');
    expect(
      (await h.as('coord').post(`/aux-applications/${first}/approve`, {})).body
        .code,
    ).toBe('AUX_APP_ALREADY_ANSWERED');

    // The secretary passes his place on; the other elder may take it.
    const passed = await h.as('secr').post(`/aux-applications/${first}/pass`);
    expect(passed.status).toBe(201);
    const seen = await h.as('extra').get('/aux-applications');
    expect(seen.body.map((a: { id: string }) => a.id)).toEqual([first]);
    expect(seen.body[0].can.approveOpenSeats).toEqual(['secretary']);
    const pending = await h.as('extra').get('/me/pending');
    expect(
      pending.body.items.some(
        (i: { kind: string; id: string }) =>
          i.kind === 'aux_application' && i.id === first,
      ),
    ).toBe(true);
    expect(
      (await h.as('extra').post(`/aux-applications/${first}/approve`, {}))
        .status,
    ).toBe(201);
    expect(await periodsOf(cards.sister)).toEqual([]);

    const last = await h
      .as('over')
      .post(`/aux-applications/${first}/approve`, {});
    expect(last.status).toBe(201);
    expect(last.body.status).toBe('approved');
    expect(await periodsOf(cards.sister)).toEqual([
      { start_month: '2031-05-01', end_month: '2031-06-01' },
    ]);
    const mine = await h.as('sister').get('/aux-applications/mine');
    expect(mine.body.applications[0]).toMatchObject({
      id: first,
      status: 'approved',
    });
    // The applicant is never shown who answered.
    expect(JSON.stringify(mine.body)).not.toContain('Давид');
  });

  it('a brother of the committee applying: another elder takes his place', async () => {
    const r = await apply('coord', ['2031-08']);
    expect(r.status).toBe(201);
    const v = await h.as('secr').get(`/aux-applications/${r.body.id}`);
    expect(v.body.seats[0]).toMatchObject({
      seat: 'body_coordinator',
      open: true,
      openReason: 'applicant',
    });
    expect(
      (await h.as('coord').post(`/aux-applications/${r.body.id}/approve`, {}))
        .body.code,
    ).toBe('AUX_APP_OWN');
    await h.as('secr').post(`/aux-applications/${r.body.id}/approve`, {});
    await h.as('over').post(`/aux-applications/${r.body.id}/approve`, {});
    const done = await h
      .as('extra')
      .post(`/aux-applications/${r.body.id}/approve`, {});
    expect(done.body.status).toBe('approved');
  });

  it('a committee brother takes it back quietly: it is gone, the journal keeps a line', async () => {
    const r = await apply('sister', ['2031-10']);
    expect(r.status).toBe(201);
    const w = await h
      .as('secr')
      .post(`/aux-applications/${r.body.id}/withdraw`);
    expect(w.status).toBe(204);
    expect(
      await h.sql(`SELECT 1 FROM aux_pioneer_applications WHERE id = $1`, [
        r.body.id,
      ]),
    ).toEqual([]);
    const line = await h.sql<{ after_json: string }>(
      `SELECT after_json FROM audit_logs WHERE entity_type = 'aux_application' AND entity_id = $1 AND action = 'DELETE'`,
      [r.body.id],
    );
    // The journal is sealed at rest; that the line is there is what counts.
    expect(line).toHaveLength(1);
  });

  it('a paper signed by two is entered by the secretary, not by another brother', async () => {
    const brother = await h.addPublisher({
      firstName: 'Бен',
      lastName: 'Вольф',
      gender: 'brother',
      appointment: 'publisher',
      baptismDate: '2010-01-01',
    });
    const body = {
      publisherId: brother,
      months: ['2031-03', '2031-04'],
      reducedMonths: ['2031-03'],
      paperDate: '2031-02-20',
      signers: [
        { seat: 'body_coordinator', userId: users.coord },
        { seat: 'service_overseer', name: 'Андреас Тест' },
      ],
    };
    expect(
      (await h.as('over').post('/aux-applications/paper', body)).body.code,
    ).toBe('AUX_APP_PAPER_SECRETARY');
    const r = await h.as('secr').post('/aux-applications/paper', body);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('approved');
    const [p] = await h.sql<{ reduced_months: string[] }>(
      `SELECT reduced_months FROM auxiliary_pioneers WHERE publisher_id = $1`,
      [brother],
    );
    expect(p.reduced_months).toEqual(['2031-03']);
    const card = await h
      .as('extra')
      .get(`/aux-applications/publisher/${brother}`);
    expect(card.body[0]).toMatchObject({
      source: 'paper',
      signers: ['Тест Давид', 'Андреас Тест'],
    });
  });

  it('at night: a holder away three days is replaced, the other reminded; months over leave', async () => {
    const r = await apply('sister', ['2031-11']);
    expect(r.status).toBe(201);
    await h.sql(
      `UPDATE aux_pioneer_applications SET created_at = now() - interval '4 days' WHERE id = $1`,
      [r.body.id],
    );
    await h.sql(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date)
       VALUES ($1, $2, current_date - 1, current_date + 5)`,
      [tenantId, cards.over],
    );
    // An old one, its only month long over.
    const [old] = await h.sql<{ id: string }>(
      `INSERT INTO aux_pioneer_applications (congregation_id, publisher_id, months)
       VALUES ($1, $2, '{2020-01}') RETURNING id`,
      [tenantId, cards.extra],
    );
    await h.app.get(AuxApplicationsService).runFor(tenantId);
    const seats = await h.sql<{
      seat: string;
      open_reason: string | null;
      reminded_at: string | null;
    }>(
      `SELECT seat, open_reason, reminded_at FROM aux_pioneer_application_seats WHERE application_id = $1 ORDER BY seat`,
      [r.body.id],
    );
    expect(seats.find((s) => s.seat === 'service_overseer')?.open_reason).toBe(
      'absent',
    );
    expect(
      seats.find((s) => s.seat === 'secretary')?.reminded_at,
    ).not.toBeNull();
    expect(
      await h.sql(`SELECT 1 FROM aux_pioneer_applications WHERE id = $1`, [
        old.id,
      ]),
    ).toEqual([]);
  });

  it('with no elder left for an open place, two answers are enough', async () => {
    // The only other elder can no longer sign in.
    await h.sql(`UPDATE publishers SET user_id = NULL WHERE id = $1`, [
      cards.extra,
    ]);
    const r = await apply('over', ['2031-12']);
    expect(r.status).toBe(201);
    await h.as('coord').post(`/aux-applications/${r.body.id}/approve`, {});
    const done = await h
      .as('secr')
      .post(`/aux-applications/${r.body.id}/approve`, {});
    expect(done.body.status).toBe('approved');
    expect(done.body.seats[2]).toMatchObject({
      seat: 'service_overseer',
      unfillable: true,
    });
  });
});
