import { Harness, startHarness } from './harness';

/**
 * The rules of an auxiliary-pioneer period (Lionel, 29 October 2026), on a
 * real database: one period a month, never beside a permanent pioneering,
 * closed months as they were sent, history stopped rather than deleted, and
 * a period that ends with the person's departure.
 */
describe('auxiliary-pioneer periods keep their history (real database)', () => {
  let h: Harness;
  let sister: string;
  let pioneer: string;

  /** «YYYY-MM-01», n months from the current one. */
  const month = (n: number): string => {
    const d = new Date();
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
    return m.toISOString().slice(0, 10);
  };
  const add = (who: string, body: Record<string, unknown>) =>
    h.as(who).post('/auxiliary-pioneers', body);

  beforeAll(async () => {
    h = await startHarness();
    sister = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Вебер',
      gender: 'sister',
      appointment: 'publisher',
      baptismDate: '2010-05-01',
    });
    pioneer = await h.addPublisher({
      firstName: 'Лена',
      lastName: 'Кляйн',
      gender: 'sister',
      appointment: 'publisher',
      baptismDate: '2010-05-01',
      pioneerType: 'regular',
      pioneerSince: month(-6),
    });
    // The service overseer manages the list but is not the secretary.
    const so = await h.addUser({ login: 'overseer', role: 'elder' });
    const r = await h
      .as('admin')
      .post('/responsibilities', { type: 'service_overseer', userId: so });
    expect([200, 201]).toContain(r.status);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('refuses a second period over the same month', async () => {
    const first = await add('overseer', {
      publisherId: sister,
      startMonth: month(1),
      endMonth: month(2),
    });
    expect(first.status).toBe(201);
    const again = await add('overseer', {
      publisherId: sister,
      startMonth: month(2),
      endMonth: month(2),
    });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('AUX_OVERLAP');
    expect(again.body.month).toBe(month(2).slice(0, 7));
  });

  it('refuses a permanent pioneer', async () => {
    const r = await add('overseer', {
      publisherId: pioneer,
      startMonth: month(1),
      endMonth: month(1),
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('AUX_PERMANENT_PIONEER');
  });

  it('a closed month is changed only by the secretary or an admin', async () => {
    const closed = month(-3);
    await h.sql(
      `INSERT INTO report_month_closures (congregation_id, report_month)
       SELECT congregation_id, $1 FROM publishers WHERE id = $2`,
      [closed, sister],
    );
    const byOverseer = await add('overseer', {
      publisherId: sister,
      startMonth: closed,
      endMonth: closed,
    });
    expect(byOverseer.status).toBe(403);
    expect(byOverseer.body.code).toBe('AUX_MONTH_CLOSED');
    const byAdmin = await add('admin', {
      publisherId: sister,
      startMonth: closed,
      endMonth: closed,
    });
    expect(byAdmin.status).toBe(201);
  });

  it('a period that has begun is stopped, not deleted — except by the secretary or an admin', async () => {
    const begun = await add('overseer', {
      publisherId: sister,
      startMonth: month(0),
      endMonth: month(0),
    });
    expect(begun.status).toBe(201);
    const del = await h
      .as('overseer')
      .delete(`/auxiliary-pioneers/${begun.body.id}`);
    expect(del.status).toBe(403);
    expect(del.body.code).toBe('AUX_REMOVE_STARTED');
    const byAdmin = await h
      .as('admin')
      .delete(`/auxiliary-pioneers/${begun.body.id}`);
    expect(byAdmin.status).toBe(200);
  });

  it('a period not yet begun may be deleted by whoever keeps the list', async () => {
    const later = await add('overseer', {
      publisherId: sister,
      startMonth: month(5),
      endMonth: month(5),
    });
    expect(later.status).toBe(201);
    const del = await h
      .as('overseer')
      .delete(`/auxiliary-pioneers/${later.body.id}`);
    expect(del.status).toBe(200);
  });

  it('a departure ends an open period with the month he left, in the journal', async () => {
    const brother = await h.addPublisher({
      firstName: 'Бен',
      lastName: 'Вольф',
      gender: 'brother',
      appointment: 'publisher',
      baptismDate: '2010-05-01',
    });
    const open = await add('admin', {
      publisherId: brother,
      startMonth: month(-1),
      untilCancelled: true,
    });
    expect(open.status).toBe(201);
    const gone = await h
      .as('admin')
      .post(`/publishers/${brother}/remove`, { reason: 'moved' });
    expect([200, 201]).toContain(gone.status);
    const [row] = await h.sql<{ end_month: string; until_cancelled: boolean }>(
      `SELECT end_month::text, until_cancelled FROM auxiliary_pioneers WHERE id = $1`,
      [open.body.id],
    );
    expect(row.until_cancelled).toBe(false);
    expect(row.end_month).toBe(month(0));
    const journal = await h.sql(
      `SELECT 1 FROM audit_logs WHERE entity_type = 'auxiliary_pioneer' AND entity_id = $1 AND action = 'UPDATE'`,
      [open.body.id],
    );
    expect(journal.length).toBe(1);
  });
});
