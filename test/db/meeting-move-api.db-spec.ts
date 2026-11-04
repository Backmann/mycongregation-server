import { Harness, startHarness } from './harness';

/**
 * Moving a meeting for one week, through the real API (4 November 2026):
 * who may, what is refused, and that an attendance figure goes with a meeting
 * moved after the fact.
 */
describe('meeting moves: the API (real database)', () => {
  let h: Harness;
  let tenantId: string;
  const users: Record<string, string> = {};

  // Settings: midweek Wednesday 19:00, weekend Sunday 10:00.
  const WEEK = '2027-04-05'; // Wed 7th, Sun 11th
  const PAST = '2026-10-05'; // Wed 7 October, long past

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    const settings = await h.as('admin').post('/meeting-settings', {
      effectiveFrom: '2025-01-06',
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '10:00',
      address: 'Musterstraße 1, 59065 Hamm',
      confirmPast: true,
    });
    expect([200, 201]).toContain(settings.status);
    for (const [login, role, type] of [
      ['lmoverseer', 'elder', 'life_ministry_overseer'],
      ['bodycoord', 'elder', 'body_coordinator'],
      ['publisher1', 'publisher', null],
    ] as const) {
      const card = await h.addPublisher({
        firstName: login,
        lastName: 'Тест',
        baptismDate: '2000-01-01',
        ...(role === 'elder' ? { appointment: 'elder' } : {}),
      });
      users[login] = await h.addUser({ login, role, publisherId: card });
      if (type) {
        const r = await h
          .as('admin')
          .post('/responsibilities', { type, userId: users[login] });
        expect(r.status).toBe(201);
      }
    }
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    await h.sql(`DELETE FROM meeting_moves WHERE congregation_id = $1`, [
      tenantId,
    ]);
    await h.sql(`DELETE FROM special_events WHERE congregation_id = $1`, [
      tenantId,
    ]);
    await h.sql(`DELETE FROM meeting_attendance WHERE congregation_id = $1`, [
      tenantId,
    ]);
  });

  const put = (who: string, week: string, kind: string, body: object) =>
    h.as(who).put(`/meeting-moves/${week}/${kind}`, body);
  const codeOf = (r: { body: { code?: string } }) => r.body.code;
  const event = (fields: Record<string, unknown>) => {
    const cols = Object.keys(fields);
    return h.sql(
      `INSERT INTO special_events (congregation_id, title, ${cols.join(', ')})
       VALUES ($1, 'Событие', ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
      [tenantId, ...Object.values(fields)],
    );
  };

  describe('who may', () => {
    it('everyone reads; a publisher may not move', async () => {
      expect((await h.as('publisher1').get('/meeting-moves')).status).toBe(200);
      const r = await put('publisher1', WEEK, 'midweek', {
        date: '2027-04-08',
        time: '18:30',
      });
      expect(r.status).toBe(403);
      expect(codeOf(r)).toBe('NEEDS_RESPONSIBILITY');
    });

    it('the Life and Ministry overseer moves the midweek meeting, not the weekend one', async () => {
      const ok = await put('lmoverseer', WEEK, 'midweek', {
        date: '2027-04-08',
        time: '18:30',
      });
      expect(ok.status).toBe(200);
      expect(ok.body.to).toEqual({
        date: '2027-04-08',
        time: '18:30',
        address: null,
      });
      expect(ok.body.from).toEqual({ date: '2027-04-07', time: '19:00' });
      const no = await put('lmoverseer', WEEK, 'weekend', {
        date: '2027-04-10',
        time: '10:00',
      });
      expect(no.status).toBe(403);
    });

    it('the body coordinator moves the weekend meeting', async () => {
      const r = await put('bodycoord', WEEK, 'weekend', {
        date: '2027-04-10',
        time: '15:00',
        address: 'Stadthalle Hamm',
      });
      expect(r.status).toBe(200);
      expect(r.body.to.address).toBe('Stadthalle Hamm');
    });
  });

  describe('what is refused', () => {
    it.each([
      [
        'outside the week',
        WEEK,
        'midweek',
        { date: '2027-04-12', time: '19:00' },
        400,
        'MOVE_OUTSIDE_WEEK',
      ],
      [
        'onto the other meeting’s day',
        WEEK,
        'midweek',
        { date: '2027-04-11', time: '19:00' },
        400,
        'MOVE_OTHER_MEETING_DAY',
      ],
      [
        'nothing different',
        WEEK,
        'midweek',
        { date: '2027-04-07', time: '19:00' },
        400,
        'MOVE_SAME_AS_USUAL',
      ],
      [
        'the hall typed out is still the hall',
        WEEK,
        'midweek',
        {
          date: '2027-04-07',
          time: '19:00',
          address: ' Musterstraße 1, 59065 Hamm ',
        },
        400,
        'MOVE_SAME_AS_USUAL',
      ],
      [
        'a week not given by its Monday',
        '2027-04-06',
        'midweek',
        { date: '2027-04-08', time: '19:00' },
        400,
        'WEEK_NOT_MONDAY',
      ],
      [
        'an unknown meeting',
        WEEK,
        'memorial',
        { date: '2027-04-08', time: '19:00' },
        400,
        'INVALID_FIELD',
      ],
    ])('%s', async (_n, week, kind, body, status, code) => {
      const r = await put('admin', week, kind, body);
      expect(r.status).toBe(status);
      expect(codeOf(r)).toBe(code);
    });

    it('a bad hour, by the field', async () => {
      const r = await put('admin', WEEK, 'midweek', {
        date: '2027-04-08',
        time: '25:00',
      });
      expect(r.status).toBe(400);
    });

    it('the midweek meeting of a visit week; the weekend one may move', async () => {
      await event({
        type: 'circuit_overseer_visit',
        date: WEEK,
        end_date: '2027-04-11',
        co_midweek_dow: 2,
      });
      const mw = await put('admin', WEEK, 'midweek', {
        date: '2027-04-08',
        time: '19:00',
      });
      expect([mw.status, codeOf(mw)]).toEqual([409, 'MOVE_VISIT_WEEK']);
      const we = await put('admin', WEEK, 'weekend', {
        date: '2027-04-10',
        time: '10:00',
      });
      expect(we.status).toBe(200);
    });

    it('a meeting a convention cancels', async () => {
      await event({
        type: 'regional_convention',
        date: '2027-04-09',
        end_date: '2027-04-11',
      });
      const r = await put('admin', WEEK, 'midweek', {
        date: '2027-04-08',
        time: '19:00',
      });
      expect([r.status, codeOf(r)]).toEqual([409, 'MOVE_NOT_HELD']);
    });

    it('a day an event keeps «with changes» — the new one or the usual one', async () => {
      await event({
        type: 'other',
        date: '2027-04-08',
        meeting_mode: 'changed',
        meeting_time: '18:00',
      });
      const onNew = await put('admin', WEEK, 'midweek', {
        date: '2027-04-08',
        time: '19:00',
      });
      expect([onNew.status, codeOf(onNew)]).toEqual([
        409,
        'MOVE_CHANGED_EVENT_DAY',
      ]);
      await h.sql(`DELETE FROM special_events WHERE congregation_id = $1`, [
        tenantId,
      ]);
      await event({
        type: 'other',
        date: '2027-04-07',
        meeting_mode: 'changed',
        meeting_address: 'Stadthalle',
      });
      const onUsual = await put('admin', WEEK, 'midweek', {
        date: '2027-04-08',
        time: '19:00',
      });
      expect([onUsual.status, codeOf(onUsual)]).toEqual([
        409,
        'MOVE_CHANGED_EVENT_DAY',
      ]);
    });
  });

  describe('one move per meeting, and back', () => {
    it('a second move replaces the first; moving back removes it; the journal keeps both', async () => {
      expect(
        (
          await put('admin', WEEK, 'midweek', {
            date: '2027-04-08',
            time: '18:30',
          })
        ).status,
      ).toBe(200);
      const again = await put('admin', WEEK, 'midweek', {
        date: '2027-04-06',
        time: '19:30',
      });
      expect(again.status).toBe(200);
      expect(again.body.from).toEqual({ date: '2027-04-08', time: '18:30' });
      const rows = await h.sql<{ date: string }>(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date FROM meeting_moves WHERE congregation_id = $1`,
        [tenantId],
      );
      expect(rows).toEqual([{ date: '2027-04-06' }]);
      const back = await h.as('admin').delete(`/meeting-moves/${WEEK}/midweek`);
      expect(back.status).toBe(200);
      expect(back.body.to).toEqual({
        date: '2027-04-07',
        time: '19:00',
        address: null,
      });
      const none = await h.as('admin').delete(`/meeting-moves/${WEEK}/midweek`);
      expect([none.status, codeOf(none)]).toEqual([404, 'MOVE_NOT_FOUND']);
      const journal = await h.sql<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity_type = 'meeting_move' AND entity_id = $1 ORDER BY created_at`,
        [again.body.move.id],
      );
      expect(journal.map((j) => j.action)).toEqual([
        'CREATE',
        'UPDATE',
        'DELETE',
      ]);
    });
  });

  describe('after the fact', () => {
    it('only the administrator or the body coordinator; the attendance figure moves with it and back', async () => {
      await h.sql(
        `INSERT INTO meeting_attendance (congregation_id, date, event_type, count, not_held)
         VALUES ($1, '2026-10-07', 'midweek', 95, false)`,
        [tenantId],
      );
      const lmo = await put('lmoverseer', PAST, 'midweek', {
        date: '2026-10-08',
        time: '19:00',
      });
      expect([lmo.status, codeOf(lmo)]).toEqual([
        403,
        'MOVE_PAST_NEEDS_COORDINATOR',
      ]);
      const bc = await h.as('bodycoord').put(`/meeting-moves/${PAST}/midweek`, {
        date: '2026-10-08',
        time: '19:00',
      });
      // The body coordinator holds the weekend right only — the midweek one
      // is the overseer's — so the first door already stops him.
      expect(bc.status).toBe(403);
      const ok = await put('admin', PAST, 'midweek', {
        date: '2026-10-08',
        time: '19:00',
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ past: true, attendanceMoved: true });
      const at = () =>
        h.sql<{ date: string; count: number }>(
          `SELECT to_char(date, 'YYYY-MM-DD') AS date, count FROM meeting_attendance WHERE congregation_id = $1`,
          [tenantId],
        );
      expect(await at()).toEqual([{ date: '2026-10-08', count: 95 }]);
      const back = await h.as('admin').delete(`/meeting-moves/${PAST}/midweek`);
      expect(back.status).toBe(200);
      expect(await at()).toEqual([{ date: '2026-10-07', count: 95 }]);
    });

    it('the body coordinator may move a past weekend meeting', async () => {
      const r = await put('bodycoord', PAST, 'weekend', {
        date: '2026-10-10',
        time: '10:00',
      });
      expect(r.status).toBe(200);
      expect(r.body.past).toBe(true);
    });

    it('refuses when a figure is already on the new day', async () => {
      await h.sql(
        `INSERT INTO meeting_attendance (congregation_id, date, event_type, count, not_held)
         VALUES ($1, '2026-10-07', 'midweek', 95, false), ($1, '2026-10-08', 'midweek', 90, false)`,
        [tenantId],
      );
      const r = await put('admin', PAST, 'midweek', {
        date: '2026-10-08',
        time: '19:00',
      });
      expect([r.status, codeOf(r)]).toEqual([409, 'MOVE_ATTENDANCE_CLASH']);
      const moves = await h.sql(
        `SELECT 1 FROM meeting_moves WHERE congregation_id = $1`,
        [tenantId],
      );
      expect(moves).toEqual([]);
    });
  });
});
