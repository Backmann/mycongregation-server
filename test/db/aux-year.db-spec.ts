import { Harness, startHarness } from './harness';
import { CongregationClock } from '../../src/common/congregation-clock.service';

/**
 * The committee's history by service years, one man's years for his card,
 * stopping one's own «until cancelled», and the report that came in without
 * hours for a month that became auxiliary (Lionel, 29 October 2026).
 *
 * Months are counted from the congregation's own today, so the cases hold
 * whenever they run.
 */
describe('auxiliary service by years (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let now: string; // YYYY-MM
  const users: Record<string, string> = {};
  const cards: Record<string, string> = {};

  const add = (key: string, n: number) => {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const syOf = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return m >= 9 ? y : y - 1;
  };
  const person = async (
    login: string,
    first: string,
    gender: string,
    appointment: string,
    role: 'elder' | 'publisher',
  ) => {
    cards[login] = await h.addPublisher({
      firstName: first,
      lastName: 'Годов',
      gender,
      appointment,
      baptismDate: '2005-01-01',
    });
    users[login] = await h.addUser({ login, role, publisherId: cards[login] });
  };
  const period = (
    card: string,
    start: string,
    end: string | null,
    reduced: string[] = [],
  ) =>
    h.sql(
      `INSERT INTO auxiliary_pioneers (congregation_id, publisher_id, start_month, end_month, until_cancelled, reduced_months)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        card,
        `${start}-01`,
        end ? `${end}-01` : null,
        end === null,
        reduced,
      ],
    );
  // Filed by the person himself, as from his own phone.
  const report = (login: string, month: string, hours: number | null) =>
    h.sql(
      `INSERT INTO service_reports (congregation_id, publisher_id, report_month, served_this_month, hours_reported, submitted_by_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        cards[login],
        `${month}-01`,
        hours === null ? true : null,
        hours,
        users[login],
      ],
    );

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    now = (await h.app.get(CongregationClock).todayFor(tenantId)).slice(0, 7);
    await person('coord', 'Давид', 'brother', 'elder', 'elder');
    await person('secr', 'Петер', 'brother', 'elder', 'elder');
    await person('over', 'Андреас', 'brother', 'elder', 'elder');
    await person('anna', 'Анна', 'sister', 'publisher', 'publisher');
    await person('lena', 'Лена', 'sister', 'publisher', 'publisher');
    for (const [type, login] of [
      ['body_coordinator', 'coord'],
      ['secretary', 'secr'],
      ['service_overseer', 'over'],
    ]) {
      await h
        .as('admin')
        .post('/responsibilities', { type, userId: users[login] });
    }
  });
  afterAll(async () => {
    await h?.close();
  });

  it('reads a service year: goals, hours in, awaited, ahead, pending', async () => {
    const sy = syOf(now);
    const last = add(now, -1);
    // Anna served last month (15 taken) and reported; this month awaited.
    await period(cards.anna, last, now, [last]);
    await report('anna', last, 17);
    // Lena: an open period from this month.
    await period(cards.lena, now, null);

    const r = await h.as('secr').get(`/auxiliary-pioneers/year`);
    expect(r.status).toBe(200);
    expect(r.body.year).toBe(sy);
    expect(r.body.months).toHaveLength(12);
    expect(r.body.current).toBe(now);
    const anna = r.body.rows.find(
      (x: { publisherId: string }) => x.publisherId === cards.anna,
    );
    // When the previous month lies in the year before, only this month shows.
    const inYear = (m: string) => syOf(m) === sy;
    expect(anna.cells).toEqual(
      [
        inYear(last)
          ? {
              month: last,
              goal: 15,
              hours: 17,
              state: 'reported',
              untilCancelled: false,
            }
          : null,
        {
          month: now,
          goal: 30,
          hours: null,
          state: 'awaiting',
          untilCancelled: false,
        },
      ].filter(Boolean),
    );
    const lena = r.body.rows.find(
      (x: { publisherId: string }) => x.publisherId === cards.lena,
    );
    expect(lena.untilCancelled).toBe(true);
    // Every month from this one to August: this awaited, the rest ahead.
    expect(lena.cells[0]).toMatchObject({ month: now, state: 'awaiting' });
    expect(
      lena.cells.slice(1).every((c: { state: string }) => c.state === 'ahead'),
    ).toBe(true);

    // Not for an ordinary elder outside the committee, nor a publisher.
    expect((await h.as('anna').get('/auxiliary-pioneers/year')).status).toBe(
      403,
    );
  });

  it('a publisher card: his years, his pending application; elders only', async () => {
    const r = await h
      .as('over')
      .get(`/auxiliary-pioneers/publisher/${cards.anna}`);
    expect(r.status).toBe(200);
    expect(r.body.totalMonths).toBe(2);
    expect(r.body.pending).toBeNull();
    const hours = r.body.years.reduce(
      (s: number, y: { hours: number }) => s + y.hours,
      0,
    );
    expect(hours).toBe(17);
    expect(
      (await h.as('lena').get(`/auxiliary-pioneers/publisher/${cards.anna}`))
        .status,
    ).toBe(403);
  });

  it('she ends her own «until cancelled»; the month must make sense', async () => {
    const tooEarly = await h
      .as('lena')
      .post('/aux-applications/stop-mine', { endMonth: add(now, -1) });
    // Before her period began.
    expect(tooEarly.body.code).toBe('AUX_STOP_MONTH');
    const ok = await h
      .as('lena')
      .post('/aux-applications/stop-mine', { endMonth: add(now, 1) });
    expect(ok.status).toBe(201);
    const [row] = await h.sql<{ end_month: string; until_cancelled: boolean }>(
      `SELECT end_month::text, until_cancelled FROM auxiliary_pioneers WHERE publisher_id = $1`,
      [cards.lena],
    );
    expect(row).toEqual({
      end_month: `${add(now, 1)}-01`,
      until_cancelled: false,
    });
    // Nothing left to stop.
    const again = await h
      .as('lena')
      .post('/aux-applications/stop-mine', { endMonth: now });
    expect(again.body.code).toBe('AUX_STOP_NONE');
  });

  it('approved after a report without hours: she is asked to add them', async () => {
    // Anna filed this month's report as a publisher; a month ahead she
    // applies for this month and the next.
    await h.sql(`DELETE FROM auxiliary_pioneers WHERE publisher_id = $1`, [
      cards.anna,
    ]);
    await report('anna', now, null);
    const app = await h.as('anna').post('/aux-applications', {
      months: [now, add(now, 1)],
      confirmed: true,
    });
    expect(app.status).toBe(201);
    for (const who of ['coord', 'secr', 'over']) {
      await h.as(who).post(`/aux-applications/${app.body.id}/approve`, {});
    }
    const mine = await h.as('anna').get('/aux-applications/mine');
    expect(mine.body.applications[0].status).toBe('approved');
    expect(mine.body.reportsWithoutHours).toEqual([
      { reportId: expect.any(String), month: now },
    ]);
    const asked = await h.sql<{ body: string }>(
      `SELECT body FROM notification_outbox WHERE dedupe_key = $1`,
      [`aux-hours:${mine.body.reportsWithoutHours[0].reportId}`],
    );
    expect(asked).toHaveLength(1);
    // The committee heard of her stopping too, without her name.
    const stopped = await h.sql<{ body: string }>(
      `SELECT body FROM notification_outbox WHERE dedupe_key LIKE 'aux-app:%stop:%'`,
    );
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped.every((x) => !x.body.includes('Лена'))).toBe(true);
    // She adds them: the hours take the place of «participated».
    const fixed = await h
      .as('anna')
      .patch(`/service-reports/${mine.body.reportsWithoutHours[0].reportId}`, {
        hoursReported: 12,
      });
    expect(fixed.status).toBe(200);
    const [row] = await h.sql<{ served: boolean | null; hours: number | null }>(
      `SELECT served_this_month AS served, hours_reported AS hours FROM service_reports WHERE id = $1`,
      [mine.body.reportsWithoutHours[0].reportId],
    );
    expect(row).toEqual({ served: null, hours: 12 });
    expect(
      (await h.as('anna').get('/aux-applications/mine')).body
        .reportsWithoutHours,
    ).toEqual([]);
    // The card shows the application pending no more, and the month awaited.
    const card = await h
      .as('coord')
      .get(`/auxiliary-pioneers/publisher/${cards.anna}`);
    expect(card.body.pending).toBeNull();
  });
});
