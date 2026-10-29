import { randomUUID } from 'node:crypto';
import { Harness, startHarness } from './harness';
import { CongregationClock } from '../../src/common/congregation-clock.service';
import {
  ServiceLogService,
  reportHoursOf,
} from '../../src/service-log/service-log.service';

/**
 * A pioneer's own hours log (Lionel, 29 October 2026), on a real database:
 * his alone, written for open months only, summed into whole hours.
 */
describe('the personal hours log (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let today: string;
  let now: string;
  const users: Record<string, string> = {};
  const cards: Record<string, string> = {};

  const person = async (
    login: string,
    first: string,
    role: 'elder' | 'publisher',
    pioneer: string | null,
  ) => {
    cards[login] = await h.addPublisher({
      firstName: first,
      lastName: 'Часов',
      gender: 'brother',
      appointment: role === 'elder' ? 'elder' : 'publisher',
      baptismDate: '2005-01-01',
    });
    users[login] = await h.addUser({ login, role, publisherId: cards[login] });
    if (pioneer) {
      await h.sql(
        `INSERT INTO pioneer_spells (congregation_id, publisher_id, pioneer_type, start_month)
         VALUES ($1, $2, $3, '2020-09-01')`,
        [tenantId, cards[login], pioneer],
      );
    }
  };
  const put = (who: string, id: string, body: Record<string, unknown>) =>
    h.as(who).put(`/service-log/entries/${id}`, { kind: 'field', ...body });
  const month = (who: string, m = now) =>
    h.as(who).get(`/service-log/month?month=${m}`);

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    today = await h.app.get(CongregationClock).todayFor(tenantId);
    now = today.slice(0, 7);
    await person('pio', 'Пётр', 'publisher', 'regular');
    await person('pub', 'Павел', 'publisher', null);
    await person('eld', 'Илья', 'elder', null);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('whole hours: down, a started first hour counted', () => {
    expect([0, 40, 59, 60, 119, 125, 1910].map(reportHoursOf)).toEqual([
      0, 1, 1, 1, 1, 2, 31,
    ]);
  });

  const first = randomUUID();
  it('a regular pioneer writes, writes again, sees his month', async () => {
    const r = await put('pio', first, { day: today, minutes: 90 });
    expect(r.status).toBe(200);
    // Sent twice from a phone without a connection: still one entry.
    expect((await put('pio', first, { day: today, minutes: 120 })).status).toBe(
      200,
    );
    await put('pio', randomUUID(), {
      day: today,
      minutes: 360,
      kind: 'credit',
      note: 'стройка',
    });
    const m = await month('pio');
    expect(m.body).toMatchObject({
      month: now,
      role: 'regular',
      goal: 50,
      open: true,
      fieldMinutes: 120,
      creditMinutes: 360,
      reportHours: 2,
      report: null,
    });
    expect(m.body.entries).toHaveLength(2);
    expect(
      m.body.entries.find((e: { kind: string }) => e.kind === 'credit').note,
    ).toBe('стройка');
    // The note is kept encrypted.
    const [raw] = await h.sql<{ note: string }>(
      `SELECT note FROM service_log_entries WHERE kind = 'credit'`,
    );
    expect(raw.note).not.toContain('стройка');
    const ov = await h.as('pio').get('/service-log');
    expect(ov.body.months.map((x: { month: string }) => x.month)).toContain(
      now,
    );
  });

  it('refuses a day ahead and a day past twenty-four hours', async () => {
    const [y, m, d] = today.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    const tomorrow = t.toISOString().slice(0, 10);
    expect(
      (await put('pio', randomUUID(), { day: tomorrow, minutes: 60 })).body
        .code,
    ).toBe('SERVICE_LOG_FUTURE');
    await put('pio', randomUUID(), { day: today, minutes: 720 });
    expect(
      (await put('pio', randomUUID(), { day: today, minutes: 300 })).body.code,
    ).toBe('SERVICE_LOG_DAY_FULL');
    expect(
      (await put('pio', randomUUID(), { day: today, minutes: 721 })).status,
    ).toBe(400);
  });

  it('is his alone: nobody else reads, changes or removes it', async () => {
    const other = await month('eld');
    expect(other.body).toMatchObject({ role: null, entries: [] });
    expect((await put('eld', first, { day: today, minutes: 30 })).status).toBe(
      404,
    );
    expect(
      (await h.as('eld').delete(`/service-log/entries/${first}`)).status,
    ).toBe(204);
    const [row] = await h.sql<{ minutes: number }>(
      `SELECT minutes FROM service_log_entries WHERE id = $1`,
      [first],
    );
    expect(row.minutes).toBe(120);
    // An admin is no exception.
    expect(
      (await h.as('admin').get('/service-log/month')).body.entries,
    ).toEqual([]);
  });

  it('is not open to a publisher whose report has no hours', async () => {
    expect((await month('pub')).body.role).toBeNull();
    expect(
      (await put('pub', randomUUID(), { day: today, minutes: 60 })).body.code,
    ).toBe('SERVICE_LOG_NOT_YOURS');
  });

  it('an account moved to another card does not carry the entries', async () => {
    const spare = await h.addPublisher({
      firstName: 'Запасной',
      lastName: 'Часов',
      gender: 'brother',
      appointment: 'publisher',
    });
    const moved = await h.as('admin').patch(`/users/${users.pio}/publisher`, {
      publisherId: spare,
    });
    expect(moved.status).toBe(200);
    expect((await month('pio')).body.entries).toEqual([]);
    const back = await h.as('admin').patch(`/users/${users.pio}/publisher`, {
      publisherId: cards.pio,
    });
    expect(back.status).toBe(200);
    expect((await month('pio')).body.entries.length).toBeGreaterThan(0);
  });

  it('once his report is in, the report speaks for the month', async () => {
    await h.sql(
      `INSERT INTO service_reports (congregation_id, publisher_id, report_month, hours_reported, submitted_by_id)
       VALUES ($1, $2, $3, 30, $4)`,
      [tenantId, cards.pio, `${now}-01`, users.eld],
    );
    const m = await month('pio');
    expect(m.body).toMatchObject({
      open: false,
      report: { hours: 30, byOther: true },
    });
    expect(
      (await put('pio', first, { day: today, minutes: 30 })).body.code,
    ).toBe('SERVICE_LOG_REPORTED');
    expect(
      (await h.as('pio').delete(`/service-log/entries/${first}`)).body.code,
    ).toBe('SERVICE_LOG_REPORTED');
  });

  it('an application before the committee already opens the month', async () => {
    await h.sql(
      `INSERT INTO aux_pioneer_applications (congregation_id, publisher_id, months, reduced_months)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, cards.pub, [now], [now]],
    );
    expect((await month('pub')).body).toMatchObject({
      role: 'aux_pending',
      goal: 15,
      open: true,
    });
  });

  it('keeps two service years and lets the rest go', async () => {
    await h.sql(
      `INSERT INTO service_log_entries (id, congregation_id, publisher_id, user_id, day, minutes)
       VALUES ($1, $2, $3, $4, '2019-03-02', 60)`,
      [randomUUID(), tenantId, cards.pio, users.pio],
    );
    await h.app.get(ServiceLogService).prune();
    const left = await h.sql(
      `SELECT 1 FROM service_log_entries WHERE day < '2020-01-01'`,
    );
    expect(left).toEqual([]);
    expect(
      (await h.sql(`SELECT 1 FROM service_log_entries WHERE id = $1`, [first]))
        .length,
    ).toBe(1);
  });
});
