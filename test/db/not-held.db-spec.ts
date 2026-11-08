import { NotHeldService } from '../../src/not-held/not-held.service';
import { Harness, startHarness } from './harness';

/**
 * Assignments on meetings that are not held (8 November 2026): found by the
 * week rules, taken off quietly, given back, and their editor told once.
 *
 * Weeks of 2027, ahead of today and inside the year the service looks at.
 * Settings: midweek on Wednesday, weekend on Sunday.
 */
describe('assignments on meetings that are not held (real database)', () => {
  let h: Harness;
  let tenant = '';
  let anna = '';
  let peter = '';
  let annaUser = '';
  let markusUser = '';
  let adminUser = '';

  const CONGRESS = '2027-03-22'; // convention Fri 26th — Sun 28th
  const VISIT = '2027-03-15'; // circuit overseer: midweek moves to Tuesday
  const MEMORIAL = '2027-04-05'; // Memorial on Thursday 8th: takes the midweek
  const REPLACED = '2027-04-26'; // an event on Sunday 2nd May replaces the weekend
  const PAST = '2026-10-26'; // convention Fri 30th Oct — Sun 1st Nov: past

  type Meeting = {
    weekStartDate: string;
    eventType: string;
    reason: string;
    date: string | null;
    event: { type: string } | null;
    parts: {
      id: string;
      partKey: string;
      people: string[];
      guest: string | null;
    }[];
    duties: { id: string; dutyType: string; person: string | null }[];
    canParts: boolean;
    canDuties: boolean;
  };
  type View = {
    meetings: Meeting[];
    restorable: {
      clearanceId: string;
      weekStartDate: string;
      eventType: string;
      parts: number;
      duties: number;
      heldAgain: boolean;
    }[];
  };
  const view = async (who: string): Promise<View> => {
    const r = await h.as(who).get('/not-held');
    expect(r.status).toBe(200);
    return r.body as View;
  };
  const part = async (
    week: string,
    kind: 'midweek' | 'weekend',
    key: string,
    who: string | null,
    extra: { order?: number; status?: string; speaker?: string } = {},
  ): Promise<string> =>
    (
      await h.sql<{ id: string }>(
        `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, part_order, publisher_id, status, speaker_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          tenant,
          week,
          kind,
          key,
          extra.order ?? 0,
          who,
          extra.status ?? 'published',
          extra.speaker ?? null,
        ],
      )
    )[0].id;
  const duty = async (
    week: string,
    kind: 'midweek' | 'weekend',
    type: string,
    who: string,
    slot = 0,
  ): Promise<string> =>
    (
      await h.sql<{ id: string }>(
        `INSERT INTO duties (congregation_id, week_start_date, event_type, duty_type, slot_index, publisher_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenant, week, kind, type, slot, who],
      )
    )[0].id;
  const event = async (
    type: string,
    date: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const cols = [
      'congregation_id',
      'title',
      'type',
      'date',
      ...Object.keys(extra),
    ];
    const vals = [
      tenant,
      `Событие ${type}`,
      type,
      date,
      ...Object.values(extra),
    ];
    return (
      await h.sql<{ id: string }>(
        `INSERT INTO special_events (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        vals,
      )
    )[0].id;
  };
  const congress = () =>
    event('regional_convention', '2027-03-26', { end_date: '2027-03-28' });
  const status = async (id: string) =>
    (
      await h.sql<{ status: string; changed: boolean }>(
        `SELECT status, changed_since_publish AS changed FROM assignments WHERE id = $1`,
        [id],
      )
    )[0];
  const notice = (userId: string, itemType: 'part' | 'duty', itemId: string) =>
    h.sql(
      `INSERT INTO assignment_notices (congregation_id, user_id, item_type, item_id, meeting_date, meeting_kind, label_key)
       VALUES ($1, $2, $3, $4, '2027-03-28', 'weekend', 'x')`,
      [tenant, userId, itemType, itemId],
    );
  const notices = async () =>
    (
      await h.sql<{ n: string }>(
        `SELECT count(*) AS n FROM assignment_notices WHERE congregation_id = $1`,
        [tenant],
      )
    )[0].n;
  const clear = (
    who: string,
    week: string,
    eventType: 'midweek' | 'weekend',
    what: { parts?: boolean; duties?: boolean } = {},
  ) =>
    h.as(who).post('/not-held/clear', {
      weekStartDate: week,
      eventType,
      parts: what.parts ?? true,
      duties: what.duties ?? true,
    });
  const outbox = async (userId: string) =>
    h.sql<{ key: string; data: { type: string } }>(
      `SELECT dedupe_key AS key, data FROM notification_outbox
        WHERE user_id = $1 AND data->>'type' = 'meeting_not_held'
        ORDER BY created_at`,
      [userId],
    );

  beforeAll(async () => {
    h = await startHarness();
    [{ id: tenant }] = await h.sql<{ id: string }>(
      `SELECT id FROM congregations LIMIT 1`,
    );
    const settings = await h.as('admin').post('/meeting-settings', {
      effectiveFrom: '2026-01-05',
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '10:00',
      address: 'Lindenstraße 12, Nordwald',
      confirmPast: true,
    });
    expect([200, 201]).toContain(settings.status);
    anna = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Берг',
      gender: 'sister',
      baptismDate: '2015-01-01',
    });
    peter = await h.addPublisher({
      firstName: 'Петер',
      lastName: 'Шульц',
      gender: 'brother',
      baptismDate: '2001-01-01',
    });
    annaUser = await h.addUser({
      login: 'nhanna',
      role: 'publisher',
      publisherId: anna,
    });
    markusUser = await h.addUser({ login: 'nhmarkus', role: 'elder' });
    await h.sql(
      `INSERT INTO responsibilities (congregation_id, type, user_id)
       VALUES ($1, 'life_ministry_overseer', $2)`,
      [tenant, markusUser],
    );
    [{ id: adminUser }] = await h.sql<{ id: string }>(
      `SELECT id FROM users WHERE congregation_id = $1 AND role = 'admin' LIMIT 1`,
      [tenant],
    );
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    for (const t of [
      'assignment_notices',
      'assignments',
      'duties',
      'talk_exchange',
      'not_held_clearances',
      'not_held_alerts',
      'special_events',
    ]) {
      await h.sql(`DELETE FROM ${t} WHERE congregation_id = $1`, [tenant]);
    }
    await h.sql(
      `DELETE FROM notification_outbox WHERE data->>'type' = 'meeting_not_held'`,
    );
  });

  it('a convention week: both meetings, their parts and duties, with names', async () => {
    await congress();
    await part(CONGRESS, 'midweek', 'bible_reading', anna);
    await part(CONGRESS, 'weekend', 'watchtower_reader', peter);
    await duty(CONGRESS, 'weekend', 'attendant', anna);
    // A song names nobody: not an assignment, not counted, left as it is.
    const song = await part(CONGRESS, 'weekend', 'song_opening', null);
    // A part already cancelled is not counted.
    await part(CONGRESS, 'weekend', 'chairman', peter, { status: 'cancelled' });
    const v = await view('admin');
    expect(
      v.meetings.map((m) => [m.weekStartDate, m.eventType, m.reason]),
    ).toEqual([
      [CONGRESS, 'midweek', 'congress'],
      [CONGRESS, 'weekend', 'congress'],
    ]);
    const weekend = v.meetings[1];
    expect(weekend.event?.type).toBe('regional_convention');
    expect(weekend.parts.map((p) => [p.partKey, p.people])).toEqual([
      ['watchtower_reader', ['Шульц Петер']],
    ]);
    expect(weekend.duties.map((d) => [d.dutyType, d.person])).toEqual([
      ['attendant', 'Берг Анна'],
    ]);
    expect((await clear('admin', CONGRESS, 'weekend')).body).toMatchObject({
      parts: 1,
      duties: 1,
    });
    expect((await status(song)).status).toBe('published');
  });

  it('the circuit overseer’s week is held (on Tuesday): nothing to show', async () => {
    await event('circuit_overseer_visit', '2027-03-16', {
      end_date: '2027-03-21',
    });
    await part(VISIT, 'midweek', 'bible_reading', anna);
    expect((await view('admin')).meetings).toEqual([]);
  });

  it('the Memorial takes the midweek only; an event «instead of the meeting» takes its day', async () => {
    await event('memorial', '2027-04-08', { time: '19:30' });
    await part(MEMORIAL, 'midweek', 'bible_reading', anna);
    await part(MEMORIAL, 'weekend', 'watchtower_reader', peter);
    await event('other', '2027-05-02', { replaces_meeting: true });
    await part(REPLACED, 'weekend', 'watchtower_reader', peter);
    await part(REPLACED, 'midweek', 'bible_reading', anna);
    const v = await view('admin');
    expect(
      v.meetings.map((m) => [m.weekStartDate, m.eventType, m.reason]),
    ).toEqual([
      [MEMORIAL, 'midweek', 'memorial'],
      [REPLACED, 'weekend', 'replaced'],
    ]);
  });

  it('each sees only the meeting they keep; a publisher sees nothing and may do nothing', async () => {
    await congress();
    await part(CONGRESS, 'midweek', 'bible_reading', anna);
    await part(CONGRESS, 'weekend', 'watchtower_reader', peter);
    await duty(CONGRESS, 'weekend', 'attendant', anna);
    const m = await view('nhmarkus');
    expect(m.meetings.map((x) => x.eventType)).toEqual(['midweek']);
    expect(
      (await clear('nhmarkus', CONGRESS, 'weekend', { duties: false })).status,
    ).toBe(403);
    expect(
      (await clear('nhmarkus', CONGRESS, 'midweek', { duties: true })).status,
    ).toBe(403);
    expect(await view('nhanna')).toEqual({ meetings: [], restorable: [] });
    expect(
      (await clear('nhanna', CONGRESS, 'midweek', { duties: false })).status,
    ).toBe(403);
    // Nothing changed by the refusals.
    expect((await view('admin')).meetings).toHaveLength(2);
    // His own meeting he may clear.
    expect(
      (await clear('nhmarkus', CONGRESS, 'midweek', { duties: false })).status,
    ).toBe(200);
  });

  it('takes off quietly: cancelled, no «changed» mark, the marks of what people were told dropped', async () => {
    await congress();
    const p = await part(CONGRESS, 'weekend', 'watchtower_reader', peter);
    const d = await duty(CONGRESS, 'weekend', 'attendant', anna);
    await notice(annaUser, 'duty', d);
    await notice(annaUser, 'part', p);
    const r = await clear('admin', CONGRESS, 'weekend');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ parts: 1, duties: 1 });
    expect(await status(p)).toEqual({ status: 'cancelled', changed: false });
    expect(await h.sql(`SELECT id FROM duties WHERE id = $1`, [d])).toEqual([]);
    expect(await notices()).toBe('0');
    expect((await view('admin')).meetings).toEqual([]);
    const [audit] = await h.sql<{ action: string }>(
      `SELECT action FROM audit_logs WHERE entity_type = 'not_held_clearance' AND entity_id = $1`,
      [r.body.clearanceId],
    );
    expect(audit?.action).toBe('DELETE');
  });

  it('a held meeting is refused; so is a past one', async () => {
    await part(VISIT, 'midweek', 'bible_reading', anna);
    const held = await clear('admin', VISIT, 'midweek');
    expect([held.status, held.body.code]).toEqual([
      409,
      'NOT_HELD_MEETING_HELD',
    ]);
    await event('regional_convention', '2026-10-30', {
      end_date: '2026-11-01',
    });
    const p = await part(PAST, 'weekend', 'watchtower_reader', peter);
    const past = await clear('admin', PAST, 'weekend');
    expect([past.status, past.body.code]).toEqual([409, 'NOT_HELD_PAST']);
    expect((await status(p)).status).toBe('published');
  });

  it('a guest speaker: his entry is marked «meeting cancelled» — and unmarked when given back', async () => {
    await congress();
    const slot = await part(CONGRESS, 'weekend', 'public_talk_speaker', null, {
      speaker: 'Гюнтер Майер',
    });
    const booked = await h.as('admin').post('/talk-exchange', {
      direction: 'incoming',
      date: '2027-03-28',
      speakerName: 'Гюнтер Майер',
    });
    expect(booked.status).toBe(201);
    const cancelled = async () =>
      (
        await h.sql<{ c: boolean }>(
          `SELECT meeting_cancelled AS c FROM talk_exchange WHERE id = $1`,
          [booked.body.id],
        )
      )[0].c;
    expect(await cancelled()).toBe(false);
    const v = await view('admin');
    expect(v.meetings[0].parts[0].guest).toBe('Гюнтер Майер');
    const r = await clear('admin', CONGRESS, 'weekend');
    expect(r.status).toBe(200);
    expect((await status(slot)).status).toBe('cancelled');
    expect(await cancelled()).toBe(true);
    const back = await h
      .as('admin')
      .post(`/not-held/restore/${r.body.clearanceId}`);
    expect(back.status).toBe(200);
    expect(await cancelled()).toBe(false);
  });

  it('undo while still not held: back as quietly as it went', async () => {
    await congress();
    const p = await part(CONGRESS, 'weekend', 'watchtower_reader', peter);
    await duty(CONGRESS, 'weekend', 'attendant', anna);
    const r = await clear('admin', CONGRESS, 'weekend');
    const v = await view('admin');
    expect(v.restorable).toEqual([
      expect.objectContaining({
        clearanceId: r.body.clearanceId,
        parts: 1,
        duties: 1,
        heldAgain: false,
      }),
    ]);
    const back = await h
      .as('admin')
      .post(`/not-held/restore/${r.body.clearanceId}`);
    expect(back.status).toBe(200);
    expect(back.body).toEqual({ parts: 1, duties: 1, skipped: [] });
    expect(await status(p)).toEqual({ status: 'published', changed: false });
    const duties = await h.sql<{ publisher_id: string }>(
      `SELECT publisher_id FROM duties WHERE congregation_id = $1 AND week_start_date = $2`,
      [tenant, CONGRESS],
    );
    expect(duties).toEqual([{ publisher_id: anna }]);
    expect((await view('admin')).restorable).toEqual([]);
    // Twice is refused.
    expect(
      (await h.as('admin').post(`/not-held/restore/${r.body.clearanceId}`))
        .status,
    ).toBe(409);
  });

  it('the event moved away: given back through the programme’s own path; a filled place is left alone', async () => {
    const ev = await congress();
    const p = await part(CONGRESS, 'weekend', 'watchtower_reader', peter);
    const reading = await part(CONGRESS, 'midweek', 'bible_reading', anna);
    await duty(CONGRESS, 'midweek', 'microphone', anna, 0);
    const w = await clear('admin', CONGRESS, 'weekend');
    const m = await clear('admin', CONGRESS, 'midweek');
    expect([w.status, m.status]).toEqual([200, 200]);
    await h.sql(`DELETE FROM special_events WHERE id = $1`, [ev]);
    // Since then somebody else got the reading and the microphone.
    await part(CONGRESS, 'midweek', 'bible_reading', peter);
    await duty(CONGRESS, 'midweek', 'microphone', peter, 0);
    const v = await view('admin');
    expect(v.restorable.every((x) => x.heldAgain)).toBe(true);
    const wb = await h
      .as('admin')
      .post(`/not-held/restore/${w.body.clearanceId}`);
    expect(wb.status).toBe(200);
    expect(wb.body).toMatchObject({ parts: 1, skipped: [] });
    // News for its brother, like any part given back: «changed» for the evening note.
    expect(await status(p)).toEqual({ status: 'published', changed: true });
    const mb = await h
      .as('admin')
      .post(`/not-held/restore/${m.body.clearanceId}`);
    expect(mb.status).toBe(200);
    expect(mb.body.parts).toBe(0);
    expect(mb.body.duties).toBe(0);
    expect(mb.body.skipped).toHaveLength(2);
    expect((await status(reading)).status).toBe('cancelled');
  });

  it('tells the one who keeps the meeting once; again only after it filled up anew', async () => {
    await congress();
    await part(CONGRESS, 'midweek', 'bible_reading', anna);
    const run = () => h.app.get(NotHeldService).alert(tenant);
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
    const told = await outbox(markusUser);
    expect(told).toHaveLength(1);
    expect(told[0].data).toMatchObject({
      type: 'meeting_not_held',
      weekStartDate: CONGRESS,
      eventType: 'midweek',
    });
    // The admin keeps nothing here by duty — the overseer is told instead.
    expect(await outbox(adminUser)).toEqual([]);
    expect((await clear('admin', CONGRESS, 'midweek')).status).toBe(200);
    expect(await run()).toBe(0);
    await part(CONGRESS, 'midweek', 'apply_yourself_1', anna, { order: 3 });
    expect(await run()).toBe(1);
    expect(await outbox(markusUser)).toHaveLength(2);
  });
});
