import { Harness, startHarness } from './harness';
import {
  MEMORIAL_DETAILS_DUE_DAYS,
  MemorialDetailsService,
} from '../../src/tasks/memorial-details.service';
import { AttendanceReminderService } from '../../src/meeting-attendance/attendance-reminder.service';

/**
 * The Memorial's hour and place may come later (27 November 2026): entered
 * without them, a task asks the body coordinator for them six weeks ahead
 * and closes itself once given; the push says «время уточняется»; the
 * attendance of a Memorial with no hour is asked for the morning after.
 */
describe('the Memorial: the hour and the place later', () => {
  let h: Harness;
  let tenant: string;
  let coordCard: string;
  let memorialId: string;
  const today = new Date().toISOString().slice(0, 10);
  const add = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  // A Monday five weeks ahead: inside the six weeks, a weekday evening.
  const monday = (d: string) =>
    add(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
  const DATE = add(monday(today), 35);
  const sync = () => h.app.get(MemorialDetailsService).sync(tenant);
  const tasks = () =>
    h.sql<{
      id: string;
      status: string;
      due_date: string;
      kind_period: string;
    }>(
      `SELECT id, status, to_char(due_date, 'YYYY-MM-DD') AS due_date, kind_period
         FROM elder_tasks WHERE congregation_id = $1 AND kind = 'memorial_details'
         ORDER BY created_at`,
      [tenant],
    );

  beforeAll(async () => {
    h = await startHarness();
    tenant = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    const settings = await h.as('admin').post('/meeting-settings', {
      effectiveFrom: '2026-01-05',
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '10:00',
      address: 'Musterstraße 1, 59065 Hamm',
      confirmPast: true,
    });
    expect([200, 201]).toContain(settings.status);
    coordCard = await h.addPublisher({
      firstName: 'Координатор',
      lastName: 'Совета',
      appointment: 'elder',
      baptismDate: '2000-01-01',
    });
    const coord = await h.addUser({
      login: 'coord',
      role: 'elder',
      publisherId: coordCard,
    });
    const r = await h
      .as('admin')
      .post('/responsibilities', { type: 'body_coordinator', userId: coord });
    expect([200, 201]).toContain(r.status);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('is entered without its hour, said to be elsewhere', async () => {
    const ev = await h.as('admin').post('/special-events', {
      type: 'memorial',
      title: 'Вечеря',
      date: DATE,
      elsewhere: true,
    });
    expect([ev.status, ev.body.time, ev.body.elsewhere]).toEqual([
      201,
      null,
      true,
    ]);
    memorialId = ev.body.id;
    const got = await h.as('admin').get(`/special-events/${memorialId}`);
    expect(got.body.elsewhere).toBe(true);
    // A yes or a no: null is refused, not a server error.
    const nul = await h
      .as('admin')
      .patch(`/special-events/${memorialId}`, { elsewhere: null });
    expect(nul.status).toBe(400);
    // Only the Memorial is elsewhere.
    const other = await h.as('admin').post('/special-events', {
      type: 'other',
      title: 'Другое',
      date: add(DATE, 60),
      elsewhere: true,
    });
    expect([other.status, other.body.elsewhere]).toEqual([201, false]);
  });

  it('the body coordinator gets a task, due four weeks before', async () => {
    expect(await sync()).toBe(1);
    const [t] = await tasks();
    expect([t.status, t.kind_period, t.due_date]).toEqual([
      'open',
      DATE,
      add(DATE, -MEMORIAL_DETAILS_DUE_DAYS) < today
        ? today
        : add(DATE, -MEMORIAL_DETAILS_DUE_DAYS),
    ]);
    const [{ n }] = await h.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM elder_task_assignees a JOIN elder_tasks t ON t.id = a.task_id
        WHERE t.kind = 'memorial_details' AND a.publisher_id = $1`,
      [coordCard],
    );
    expect(n).toBe(1);
    // Once raised, never twice.
    expect(await sync()).toBe(0);
  });

  it('the hour alone is not enough while the place is still unknown', async () => {
    await h
      .as('admin')
      .patch(`/special-events/${memorialId}`, { time: '19:30' });
    await sync();
    expect((await tasks()).map((t) => t.status)).toEqual(['open']);
  });

  it('the push says what is still to be told', async () => {
    const [{ body }] = await h.sql<{ body: string }>(
      `SELECT body FROM notification_outbox WHERE kind = 'special_event' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(body).toContain('место уточняется');
  });

  it('closes itself once the address is given', async () => {
    await h.as('admin').patch(`/special-events/${memorialId}`, {
      address: 'Lindenstraße 5, Hamm',
    });
    await sync();
    expect((await tasks()).map((t) => t.status)).toEqual(['done']);
  });

  it('moved, with the hour gone again: the new day raises its own', async () => {
    const moved = add(DATE, 7);
    const r = await h
      .as('admin')
      .patch(`/special-events/${memorialId}`, { date: moved, time: null });
    expect(r.status).toBe(200);
    await sync();
    const all = await tasks();
    expect(all.map((t) => [t.kind_period, t.status])).toEqual([
      [DATE, 'done'],
      [moved, 'open'],
    ]);
    // Moved back before anyone acts: the open one goes with its day, and
    // the old day's, closed by the app, opens again — the hour is missing.
    await h.as('admin').patch(`/special-events/${memorialId}`, { date: DATE });
    await sync();
    expect((await tasks()).map((t) => [t.kind_period, t.status])).toEqual([
      [DATE, 'open'],
    ]);
  });

  it('closed by the app, it opens again when the hour is taken away', async () => {
    await h
      .as('admin')
      .patch(`/special-events/${memorialId}`, { time: '19:30' });
    await sync();
    expect((await tasks()).map((t) => t.status)).toEqual(['done']);
    await h.as('admin').patch(`/special-events/${memorialId}`, { time: null });
    await sync();
    expect((await tasks()).map((t) => t.status)).toEqual(['open']);
  });

  it('closed by hand, it stays closed', async () => {
    const [{ id: coordUser }] = await h.sql<{ id: string }>(
      `SELECT user_id AS id FROM publishers WHERE id = $1`,
      [coordCard],
    );
    await h.sql(
      `UPDATE elder_tasks SET status = 'done', done_at = now(), done_by_id = $2 WHERE congregation_id = $1 AND kind = 'memorial_details'`,
      [tenant, coordUser],
    );
    await sync();
    expect((await tasks()).every((t) => t.status === 'done')).toBe(true);
  });

  it('its attendance: not at 20:00 that evening, the morning after instead', async () => {
    const recorderCard = await h.addPublisher({
      firstName: 'Счётчик',
      lastName: 'Посещаемости',
      appointment: 'ministerial_servant',
      baptismDate: '2000-01-01',
    });
    const recorder = await h.addUser({
      login: 'recorder',
      role: 'ministerial_servant',
      publisherId: recorderCard,
    });
    const r = await h.as('admin').post('/responsibilities', {
      type: 'attendance_recorder',
      userId: recorder,
    });
    expect([200, 201]).toContain(r.status);
    const reminder = h.app.get(AttendanceReminderService);
    expect(await reminder.remindFor(tenant, DATE)).toBe(0);
    expect(await reminder.remindMorningAfter(tenant, DATE)).toBe(1);
    const [{ body }] = await h.sql<{ body: string }>(
      `SELECT body FROM notification_outbox WHERE kind = 'attendance_due' AND user_id = $1`,
      [recorder],
    );
    expect(body).toBe('Вчерашняя Вечеря воспоминания ещё не внесена.');
    // Begun early enough to be over by 20:00: the evening's, as every meeting.
    await h
      .as('admin')
      .patch(`/special-events/${memorialId}`, { time: '18:30' });
    expect(await reminder.remindMorningAfter(tenant, DATE)).toBe(0);
    expect(await reminder.remindFor(tenant, DATE)).toBe(1);
    // At 19:30 it may still be going on at 20:00: the morning after again.
    await h
      .as('admin')
      .patch(`/special-events/${memorialId}`, { time: '19:30' });
    expect(await reminder.remindFor(tenant, DATE)).toBe(0);
    expect(await reminder.remindMorningAfter(tenant, DATE)).toBe(1);
  });
});
