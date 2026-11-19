import { Harness, startHarness } from './harness';
import { SchoolAbsencesService } from '../../src/special-events/school-absences.service';

/**
 * The Kingdom Ministry School marks its brothers away (19 November 2026,
 * Lionel): the school takes the whole day, so each invited brother has one
 * absence over its days, written and withdrawn by the event — never by hand.
 *
 * Dates in 2099, far ahead of any clock; one school in 2020 is history.
 */
describe('the Kingdom Ministry School marks its brothers away (real database)', () => {
  let h: Harness;
  let elder = '';
  let servant = '';
  let pioneer = '';

  const create = (body: Record<string, unknown>) =>
    h.as('admin').post('/special-events', body);
  const absencesOf = (publisherId: string) =>
    h.sql<{
      id: string;
      start_date: string;
      end_date: string | null;
      special_event_id: string | null;
      deleted_at: string | null;
    }>(
      `SELECT id, start_date::text, end_date::text, special_event_id, deleted_at
         FROM absences WHERE publisher_id = $1 AND deleted_at IS NULL
        ORDER BY start_date`,
      [publisherId],
    );
  const school = async (over: Record<string, unknown> = {}) => {
    const r = await create({
      title: 'Школа Священного Служения для старейшин',
      type: 'kingdom_ministry_school_elders',
      date: '2099-02-07',
      endDate: '2099-02-08',
      time: '09:30',
      timeEnd: '16:00',
      address: 'Musterstraße 5, Hamm',
      ...over,
    });
    expect(r.status).toBe(201);
    return (r.body as { id: string }).id;
  };

  beforeAll(async () => {
    h = await startHarness();
    const add = async (firstName: string, gender: string, sets: string) => {
      const id = await h.addPublisher({
        firstName,
        lastName: 'Тест',
        gender,
        baptismDate: '2001-01-01',
      });
      if (sets)
        await h.sql(`UPDATE publishers SET ${sets} WHERE id = $1`, [id]);
      return id;
    };
    elder = await add('Пётр', 'brother', `appointment = 'elder'`);
    servant = await add(
      'Павел',
      'brother',
      `appointment = 'ministerial_servant'`,
    );
    pioneer = await add(
      'Анна',
      'sister',
      `pioneer_type = 'regular', pioneer_since = '2020-09-01'`,
    );
    await h.addUser({ login: 'elder', role: 'elder', publisherId: elder });
    await h.addUser({
      login: 'servant',
      role: 'ministerial_servant',
      publisherId: servant,
    });
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    await h.sql(`DELETE FROM absences`);
    await h.sql(`DELETE FROM notification_outbox`);
    await h.sql(`DELETE FROM special_events`);
    await h.sql(`UPDATE publishers SET appointment = 'elder' WHERE id = $1`, [
      elder,
    ]);
    await h.sql(
      `UPDATE publishers SET appointment = 'ministerial_servant' WHERE id = $1`,
      [servant],
    );
  });

  it('the school for elders: each elder away over its days; nobody else', async () => {
    const id = await school();
    const rows = await absencesOf(elder);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      start_date: '2099-02-07',
      end_date: '2099-02-08',
      special_event_id: id,
    });
    expect(await absencesOf(servant)).toHaveLength(0);
    expect(await absencesOf(pioneer)).toHaveLength(0);
  });

  it('the school for servants: the servants, not the elders', async () => {
    const id = await school({
      title: 'Школа Священного Служения для служебных помощников',
      type: 'kingdom_ministry_school_servants',
      endDate: null,
    });
    const rows = await absencesOf(servant);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      start_date: '2099-02-07',
      end_date: null,
      special_event_id: id,
    });
    expect(await absencesOf(elder)).toHaveLength(0);
  });

  it('the meeting with the pioneers writes no absence', async () => {
    await school({
      title: 'Специальная встреча с пионерами района',
      type: 'pioneer_special_meeting',
      endDate: null,
    });
    expect(await absencesOf(pioneer)).toHaveLength(0);
    expect(await absencesOf(elder)).toHaveLength(0);
  });

  it('moved: the absence moves with it, still one', async () => {
    const id = await school();
    const r = await h
      .as('admin')
      .patch(`/special-events/${id}`, { date: '2099-03-14', endDate: null });
    expect(r.status).toBe(200);
    const rows = await absencesOf(elder);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      start_date: '2099-03-14',
      end_date: null,
      special_event_id: id,
    });
  });

  it('removed: the absence goes; restored: it comes back, once', async () => {
    const id = await school();
    expect([200, 204]).toContain(
      (await h.as('admin').delete(`/special-events/${id}`)).status,
    );
    expect(await absencesOf(elder)).toHaveLength(0);
    const back = await h.as('admin').post(`/special-events/${id}/restore`);
    expect([200, 201]).toContain(back.status);
    expect(await absencesOf(elder)).toHaveLength(1);
  });

  it('appointed after the school was saved: the night brings him in; released: out', async () => {
    const id = await school();
    await h.sql(`UPDATE publishers SET appointment = 'elder' WHERE id = $1`, [
      servant,
    ]);
    const svc = h.app.get(SchoolAbsencesService);
    await svc.resyncUpcoming();
    expect(await absencesOf(servant)).toHaveLength(1);
    await h.sql(
      `UPDATE publishers SET appointment = 'ministerial_servant' WHERE id = $1`,
      [servant],
    );
    await h.sql(
      `UPDATE publishers SET appointment = 'publisher' WHERE id = $1`,
      [elder],
    );
    await svc.resyncUpcoming();
    expect(await absencesOf(servant)).toHaveLength(0);
    expect(await absencesOf(elder)).toHaveLength(0);
    // Twice is the same as once.
    await h.sql(`UPDATE publishers SET appointment = 'elder' WHERE id = $1`, [
      elder,
    ]);
    await svc.resyncUpcoming();
    await svc.resyncUpcoming();
    const rows = await absencesOf(elder);
    expect(rows).toHaveLength(1);
    expect(rows[0].special_event_id).toBe(id);
  });

  it('a school that is over is history: its absences stay as they were', async () => {
    const id = await school({ date: '2020-02-07', endDate: '2020-02-08' });
    // Written as history by hand: the past is not rewritten.
    expect(await absencesOf(elder)).toHaveLength(0);
    await h.sql(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date, special_event_id)
       SELECT congregation_id, $1, '2020-02-07', '2020-02-08', id FROM special_events WHERE id = $2`,
      [elder, id],
    );
    await h.sql(
      `UPDATE publishers SET appointment = 'publisher' WHERE id = $1`,
      [elder],
    );
    await h.app.get(SchoolAbsencesService).resyncUpcoming();
    expect(await absencesOf(elder)).toHaveLength(1);
  });

  it('not changed, removed or restored by hand; named by its kind', async () => {
    await school();
    const [row] = await absencesOf(elder);
    const list = await h.as('elder').get('/absences');
    expect(list.status).toBe(200);
    const mine = (
      list.body as { id: string; specialEventType?: string }[]
    ).find((a) => a.id === row.id);
    expect(mine?.specialEventType).toBe('kingdom_ministry_school_elders');
    const one = await h.as('elder').get(`/absences/${row.id}`);
    expect((one.body as { specialEventType?: string }).specialEventType).toBe(
      'kingdom_ministry_school_elders',
    );
    for (const call of [
      () => h.as('admin').patch(`/absences/${row.id}`, { note: 'x' }),
      () => h.as('admin').delete(`/absences/${row.id}`),
    ]) {
      const r = await call();
      expect(r.status).toBe(400);
      expect((r.body as { code?: string }).code).toBe('ABSENCE_FROM_EVENT');
    }
    expect(await absencesOf(elder)).toHaveLength(1);
  });

  it('two passes at the same moment write one absence, not two', async () => {
    const id = await school();
    await h.sql(`DELETE FROM absences`);
    const svc = h.app.get(SchoolAbsencesService);
    await Promise.all([svc.sync(id), svc.sync(id), svc.sync(id)]);
    expect(await absencesOf(elder)).toHaveLength(1);
  });

  it('two rows for one brother (cards merged): the pass keeps one', async () => {
    const id = await school();
    await h.sql(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date, special_event_id)
       SELECT congregation_id, $1, '2099-02-07', '2099-02-08', id FROM special_events WHERE id = $2`,
      [elder, id],
    );
    expect(await absencesOf(elder)).toHaveLength(2);
    await h.app.get(SchoolAbsencesService).sync(id);
    expect(await absencesOf(elder)).toHaveLength(1);
  });

  it('the kind is fixed: a refused change keeps the absences', async () => {
    const id = await school();
    const r = await h
      .as('admin')
      .patch(`/special-events/${id}`, { type: 'other', title: 'Другое' });
    expect(r.status).toBe(400);
    expect(await absencesOf(elder)).toHaveLength(1);
  });

  it('a past school removed as entered by mistake takes its absences', async () => {
    const id = await school({ date: '2020-02-07', endDate: '2020-02-08' });
    await h.sql(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date, special_event_id)
       SELECT congregation_id, $1, '2020-02-07', '2020-02-08', id FROM special_events WHERE id = $2`,
      [elder, id],
    );
    const del = await h.as('admin').delete(`/special-events/${id}`);
    expect([200, 204]).toContain(del.status);
    expect(await absencesOf(elder)).toHaveLength(0);
  });

  it('not brought back by hand after a removal', async () => {
    await school();
    const [row] = await absencesOf(elder);
    await h.sql(`UPDATE absences SET deleted_at = now() WHERE id = $1`, [
      row.id,
    ]);
    const r = await h.as('admin').post(`/absences/${row.id}/restore`);
    expect(r.status).toBe(400);
    expect((r.body as { code?: string }).code).toBe('ABSENCE_FROM_EVENT');
  });

  it('the school itself is not shown «away» in his agenda', async () => {
    const id = await school();
    const r = await h
      .as('elder')
      .get('/me/agenda?from=2099-02-01&to=2099-02-28');
    expect(r.status).toBe(200);
    const items =
      (r.body as { items?: unknown[] }).items ?? (r.body as unknown[]);
    const it = (items as { id: string; state: string }[]).find(
      (x) => x.id === `event:${id}`,
    );
    expect(it?.state).toBe('ok');
  });
});
