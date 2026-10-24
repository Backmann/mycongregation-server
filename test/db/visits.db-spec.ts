import { Harness, startHarness } from './harness';
import { CongregationClock } from '../../src/common/congregation-clock.service';
import { MeetingAttendanceService } from '../../src/meeting-attendance/meeting-attendance.service';

/**
 * Circuit visits after they were saved (events audit of 23 October 2026,
 * decided with Lionel on 24 October): the name given later, a swap into the
 * visit's week, the attendance of a changed visit, a meeting already held,
 * a part added on its own, the trip absence.
 */
describe('circuit visits (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let n = 0;
  const week = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * (8 + 3 * ++n));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const plus = (iso: string, k: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + k);
    return d.toISOString().slice(0, 10);
  };
  const talkLine = async (w: string) =>
    (
      await h.sql<{ id: string; pub: string | null; name: string | null }>(
        `SELECT id, publisher_id AS pub, speaker_name AS name FROM assignments
          WHERE week_start_date = $1 AND part_key = 'public_talk_speaker' AND deleted_at IS NULL`,
        [w],
      )
    )[0];
  const visit = (w: string, body: object = {}) =>
    h.as('admin').post('/special-events', {
      title: 'Визит районного',
      type: 'circuit_overseer_visit',
      date: plus(w, 1),
      ...body,
    });
  const createWeek = async (w: string, parts: object[]) => {
    const r = await h.as('admin').post('/assignments/bulk', {
      assignments: parts.map((p) => ({ weekStartDate: w, ...p })),
    });
    expect(r.status).toBe(201);
  };
  let brother: string;

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    brother = await h.addPublisher({
      firstName: 'Юрген',
      lastName: 'Бауэр',
      appointment: 'elder',
      baptismDate: '2000-01-01',
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('a visit given the overseer’s name later takes the slot whole and gives it back', async () => {
    const w = week();
    await createWeek(w, [
      {
        eventType: 'weekend',
        partKey: 'public_talk_speaker',
        publisherId: brother,
      },
    ]);
    const v = await visit(w);
    expect(v.status).toBe(201);
    const named = await h.as('admin').patch(`/special-events/${v.body.id}`, {
      coFirstName: 'Андреас',
      coLastName: 'Районный',
    });
    expect(named.status).toBe(200);
    expect(await talkLine(w)).toEqual(
      expect.objectContaining({ pub: null, name: 'Андреас Районный' }),
    );
    await h.as('admin').delete(`/special-events/${v.body.id}`);
    expect(await talkLine(w)).toEqual(
      expect.objectContaining({ pub: brother, name: null }),
    );
  });

  it('a public talk is not swapped into the visit’s week, nor out of it', async () => {
    const a = week();
    const b = week();
    for (const w of [a, b]) {
      await createWeek(w, [
        { eventType: 'weekend', partKey: 'public_talk_speaker' },
      ]);
    }
    expect(
      (await visit(b, { coFirstName: 'Андреас', coLastName: 'Районный' }))
        .status,
    ).toBe(201);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const r = await h.as('admin').post('/assignments/public-talk/swap', {
        eventType: 'weekend',
        sourceWeekStartDate: from,
        targetWeekStartDate: to,
        mode: 'swap',
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('TALK_SWAP_VISIT_WEEK');
    }
  });

  it('a part added on its own in the visit’s week gets the overseer', async () => {
    const w = week();
    expect(
      (await visit(w, { coFirstName: 'Андреас', coLastName: 'Районный' }))
        .status,
    ).toBe(201);
    const r = await h.as('admin').post('/assignments', {
      weekStartDate: w,
      eventType: 'weekend',
      partKey: 'public_talk_speaker',
    });
    expect(r.status).toBe(201);
    expect((await talkLine(w)).name).toBe('Андреас Районный');
  });

  it('renaming the overseer on the visit reaches all his parts (the app need not write them again)', async () => {
    const w = week();
    await createWeek(w, [
      { eventType: 'midweek', partKey: 'cbs_conductor' },
      { eventType: 'weekend', partKey: 'public_talk_speaker' },
      { eventType: 'weekend', partKey: 'watchtower_conductor' },
    ]);
    const v = await visit(w, {
      coFirstName: 'Андреас',
      coLastName: 'Районный',
    });
    expect(v.status).toBe(201);
    const r = await h.as('admin').patch(`/special-events/${v.body.id}`, {
      coFirstName: 'Андрей',
      coLastName: 'Районный',
    });
    expect(r.status).toBe(200);
    const names = await h.sql<{ key: string; name: string | null }>(
      `SELECT part_key AS key, speaker_name AS name FROM assignments
        WHERE week_start_date = $1 AND deleted_at IS NULL
          AND part_key IN ('co_service_talk', 'co_concluding_talk', 'public_talk_speaker')
        ORDER BY part_key`,
      [w],
    );
    expect(names).toEqual([
      { key: 'co_concluding_talk', name: 'Андрей Районный' },
      { key: 'co_service_talk', name: 'Андрей Районный' },
      { key: 'public_talk_speaker', name: 'Андрей Районный' },
    ]);
  });

  it('a midweek meeting already held is left as it was said', async () => {
    const w = week();
    await createWeek(w, [{ eventType: 'midweek', partKey: 'cbs_conductor' }]);
    const clock = h.app.get(CongregationClock);
    // Wednesday of that week: the Tuesday meeting is behind us.
    const spy = jest.spyOn(clock, 'todayFor').mockResolvedValue(plus(w, 2));
    try {
      const v = await visit(w, {
        coFirstName: 'Андреас',
        coLastName: 'Районный',
        coMidweekDow: 2,
      });
      expect(v.status).toBe(201);
    } finally {
      spy.mockRestore();
    }
    const rows = await h.sql<{ key: string }>(
      `SELECT part_key AS key FROM assignments
        WHERE week_start_date = $1 AND event_type = 'midweek' AND deleted_at IS NULL`,
      [w],
    );
    expect(rows.map((r) => r.key)).toEqual(['cbs_conductor']);
  });

  it('a past visit keeps its midweek day, and a figure off the usual days stays in the year', async () => {
    const svc = h.app.get(MeetingAttendanceService);
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
    // A visit in a past week: its midweek meeting on the Tuesday.
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 21);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const w = d.toISOString().slice(0, 10);
    const [{ id }] = await h.sql<{ id: string }>(
      `INSERT INTO special_events (congregation_id, title, type, date, end_date, co_first_name, co_last_name, co_midweek_dow)
       VALUES ($1, 'Визит', 'circuit_overseer_visit', $2, $3, 'Андреас', 'Районный', 2) RETURNING id`,
      [tenantId, plus(w, 1), plus(w, 6)],
    );
    const moved = await h
      .as('admin')
      .patch(`/special-events/${id}`, { coMidweekDow: 4 });
    expect(moved.status).toBe(400);
    expect(moved.body.code).toBe('EVENT_PAST_LOCKED');
    await h.sql(
      `INSERT INTO meeting_attendance (congregation_id, date, event_type, count, not_held)
       VALUES ($1, $2, 'midweek', 57, false)`,
      [tenantId, plus(w, 1)],
    );
    // The visit removed afterwards: the meeting goes back to Wednesday.
    await h.sql(`UPDATE special_events SET deleted_at = now() WHERE id = $1`, [
      id,
    ]);
    const y =
      d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    const year = await svc.serviceYear(tenantId, y);
    const row = year.months
      .flatMap((m) => m.midweek)
      .find((r) => r.date === plus(w, 1));
    expect(row).toEqual(
      expect.objectContaining({ count: 57, offSchedule: true }),
    );
  });

  it('a trip absence is changed and brought back only with its trip', async () => {
    const host = await h
      .as('admin')
      .post('/external-congregations', { name: 'Падерборн' });
    expect([200, 201]).toContain(host.status);
    const r = await h.as('admin').post('/talk-exchange', {
      direction: 'outgoing',
      date: plus(week(), 6),
      publisherId: brother,
      hostCongregationId: host.body.id,
    });
    expect(r.status).toBe(201);
    const [abs] = await h.sql<{ id: string }>(
      `SELECT id FROM absences WHERE talk_exchange_id = $1`,
      [r.body.id],
    );
    expect(abs).toBeDefined();
    const edit = await h
      .as('admin')
      .patch(`/absences/${abs.id}`, { note: 'x' });
    expect(edit.status).toBe(400);
    expect(edit.body.code).toBe('ABSENCE_FROM_TRIP');
    // Turned into a visit: the absence goes.
    const turned = await h
      .as('admin')
      .patch(`/talk-exchange/${r.body.id}`, { direction: 'incoming' });
    expect(turned.status).toBe(200);
    const [left] = await h.sql<{ gone: boolean }>(
      `SELECT deleted_at IS NOT NULL AS gone FROM absences WHERE id = $1`,
      [abs.id],
    );
    expect(left.gone).toBe(true);
  });
});
