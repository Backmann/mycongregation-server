import { Harness, startHarness } from './harness';
import { CongregationClock } from '../../src/common/congregation-clock.service';
import { TalkAttentionService } from '../../src/talk-exchange/talk-attention.service';

/**
 * A guest whose weekend a circuit visit takes (Lionel, 25 October 2026):
 * set aside by the visit and shown, not removed without a word; moved to
 * another week whole with «Перенести»; given back by the visit's own mark;
 * and the visit's entry known by its id, not by the overseer's name.
 */
describe('a guest set aside by a circuit visit (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let n = 0;
  const week = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * (9 + 4 * ++n));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const plus = (iso: string, k: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + k);
    return d.toISOString().slice(0, 10);
  };
  const line = async (w: string) =>
    (
      await h.sql<{ pub: string | null; name: string | null }>(
        `SELECT publisher_id AS pub, speaker_name AS name FROM assignments
          WHERE week_start_date = $1 AND part_key = 'public_talk_speaker' AND deleted_at IS NULL`,
        [w],
      )
    )[0];
  const entry = async (id: string) =>
    (
      await h.sql<{
        date: string;
        gone: boolean;
        aside: string | null;
        visit: string | null;
      }>(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date, deleted_at IS NOT NULL AS gone,
                set_aside_by AS aside, circuit_visit_id AS visit
           FROM talk_exchange WHERE id = $1`,
        [id],
      )
    )[0];
  const liveIn = (w: string) =>
    h.sql<{ id: string; name: string | null; visit: string | null }>(
      `SELECT id, speaker_name AS name, circuit_visit_id AS visit FROM talk_exchange
        WHERE direction = 'incoming' AND deleted_at IS NULL AND status <> 'did_not_happen'
          AND date BETWEEN $1 AND $1::date + 6`,
      [w],
    );
  const createWeek = async (w: string) => {
    const r = await h.as('admin').post('/assignments/bulk', {
      assignments: [
        {
          weekStartDate: w,
          eventType: 'weekend',
          partKey: 'public_talk_speaker',
        },
      ],
    });
    expect(r.status).toBe(201);
  };
  const guest = async (w: string, first: string) => {
    const card = await h
      .as('admin')
      .post('/visiting-speakers', { firstName: first, lastName: 'Гостев' });
    expect(card.status).toBe(201);
    const r = await h.as('admin').post('/talk-exchange', {
      direction: 'incoming',
      date: plus(w, 6),
      visitingSpeakerId: card.body.id,
      note: 'обед у семьи',
    });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  const visit = async (w: string, body: object = {}) => {
    const r = await h.as('admin').post('/special-events', {
      title: 'Визит районного',
      type: 'circuit_overseer_visit',
      date: plus(w, 1),
      coFirstName: 'Андреас',
      coLastName: 'Районный',
      ...body,
    });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  const told = async (key: string) =>
    (
      await h.sql<{ n: number }>(
        `SELECT count(DISTINCT dedupe_key)::int AS n FROM notification_outbox
          WHERE dedupe_key LIKE $1`,
        [`${key}%`],
      )
    )[0].n;

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  it('the visit sets the guest aside by its mark, shows him, and tells those who answer once', async () => {
    const w = week();
    await createWeek(w);
    const g = await guest(w, 'Пётр');
    const v = await visit(w);
    expect(await entry(g)).toEqual(
      expect.objectContaining({ gone: true, aside: v }),
    );
    const [his] = await liveIn(w);
    expect(his).toEqual(
      expect.objectContaining({ name: 'Андреас Районный', visit: v }),
    );
    const listed = await h.as('admin').get('/talk-exchange/set-aside');
    expect(listed.status).toBe(200);
    expect(listed.body.map((e: { id: string }) => e.id)).toContain(g);
    expect(listed.body.find((e: { id: string }) => e.id === g)).toEqual(
      expect.objectContaining({ name: 'Пётр Гостев', setAsideBy: v }),
    );
    expect(await told(`talk-attention:aside:${g}`)).toBe(1);
  });

  it('a name corrected on the visit keeps its entry; removing the visit gives the guest back whole', async () => {
    const w = week();
    await createWeek(w);
    const g = await guest(w, 'Павел');
    const v = await visit(w);
    const [his] = await liveIn(w);
    const r = await h.as('admin').patch(`/special-events/${v}`, {
      coFirstName: 'Андрей',
      coLastName: 'Окружной',
    });
    expect(r.status).toBe(200);
    expect(await liveIn(w)).toEqual([
      expect.objectContaining({
        id: his.id,
        name: 'Андрей Окружной',
        visit: v,
      }),
    ]);
    expect(await entry(g)).toEqual(expect.objectContaining({ aside: v }));
    await h.as('admin').delete(`/special-events/${v}`);
    expect(await entry(g)).toEqual(
      expect.objectContaining({ gone: false, aside: null }),
    );
    expect((await liveIn(w)).map((e) => e.id)).toEqual([g]);
    expect((await line(w)).name).toBe('Павел Гостев');
    const [{ note }] = await h.sql<{ note: string }>(
      `SELECT note FROM talk_exchange WHERE id = $1`,
      [g],
    );
    expect(note).toBe('обед у семьи');
  });

  it('«Перенести» takes the guest to a free week whole; the visit no longer gives him back to its week', async () => {
    const w = week();
    const free = week();
    await createWeek(w);
    await createWeek(free);
    const g = await guest(w, 'Семён');
    const v = await visit(w);
    const moved = await h
      .as('admin')
      .post(`/talk-exchange/${g}/move-aside`, { weekStartDate: free });
    expect(moved.status).toBe(200);
    expect(await entry(g)).toEqual(
      expect.objectContaining({
        gone: false,
        aside: null,
        date: plus(free, 6),
      }),
    );
    expect((await line(free)).name).toBe('Семён Гостев');
    const listed = await h.as('admin').get('/talk-exchange/set-aside');
    expect(listed.body.map((e: { id: string }) => e.id)).not.toContain(g);
    await h.as('admin').delete(`/special-events/${v}`);
    expect((await line(w)).name).toBeNull();
    expect(await liveIn(w)).toEqual([]);
    expect((await liveIn(free)).map((e) => e.id)).toEqual([g]);
  });

  it('«Перенести» is refused into a taken week, a visit week and a past one', async () => {
    const w = week();
    const taken = week();
    const other = week();
    await createWeek(w);
    const g = await guest(w, 'Глеб');
    await visit(w);
    await guest(taken, 'Борис');
    await visit(other);
    const go = (to: string) =>
      h
        .as('admin')
        .post(`/talk-exchange/${g}/move-aside`, { weekStartDate: to });
    expect((await go(taken)).body.code).toBe('TALK_WEEK_TAKEN');
    expect((await go(other)).body.code).toBe('TALK_MOVE_VISIT_WEEK');
    expect((await go('2026-01-05')).body.code).toBe('WEEK_ALREADY_PAST');
    expect(await entry(g)).toEqual(expect.objectContaining({ gone: true }));
  });

  it('three days on and still set aside: told once more, and not after he is moved', async () => {
    const w = week();
    const free = week();
    await createWeek(w);
    const g = await guest(w, 'Фома');
    await visit(w);
    const attention = h.app.get(TalkAttentionService);
    await attention.runFor(tenantId);
    expect(await told(`talk-attention:aside-again:${g}`)).toBe(0);
    await h.sql(
      `UPDATE talk_exchange SET deleted_at = now() - interval '4 days' WHERE id = $1`,
      [g],
    );
    await attention.runFor(tenantId);
    await attention.runFor(tenantId);
    expect(await told(`talk-attention:aside-again:${g}`)).toBe(1);
    await h
      .as('admin')
      .post(`/talk-exchange/${g}/move-aside`, { weekStartDate: free });
    await h.sql(`DELETE FROM notification_outbox WHERE dedupe_key LIKE $1`, [
      `talk-attention:aside-again:${g}%`,
    ]);
    await attention.runFor(tenantId);
    expect(await told(`talk-attention:aside-again:${g}`)).toBe(0);
  });

  it('a visit moved to another week gives its guest back to the week it left', async () => {
    const w = week();
    const to = week();
    await createWeek(w);
    const g = await guest(w, 'Лука');
    const v = await visit(w);
    const r = await h.as('admin').patch(`/special-events/${v}`, {
      date: plus(to, 1),
      endDate: plus(to, 6),
    });
    expect(r.status).toBe(200);
    expect(await entry(g)).toEqual(
      expect.objectContaining({ gone: false, aside: null, date: plus(w, 6) }),
    );
    expect((await line(w)).name).toBe('Лука Гостев');
    expect(await liveIn(to)).toEqual([
      expect.objectContaining({ name: 'Андреас Районный', visit: v }),
    ]);
  });

  it('the visit page says what the visit did to each meeting', async () => {
    const w = week();
    await h.as('admin').post('/assignments/bulk', {
      assignments: [
        { weekStartDate: w, eventType: 'midweek', partKey: 'cbs_conductor' },
        {
          weekStartDate: w,
          eventType: 'weekend',
          partKey: 'public_talk_speaker',
        },
      ],
    });
    const clock = h.app.get(CongregationClock);
    const spy = jest.spyOn(clock, 'todayFor').mockResolvedValue(plus(w, 2));
    let v: string;
    try {
      v = await visit(w, { coMidweekDow: 2 });
    } finally {
      spy.mockRestore();
    }
    const r = await h.as('admin').get(`/special-events/${v}`);
    expect(r.status).toBe(200);
    expect(r.body.programmeApplied).toEqual({ midweek: false, weekend: true });
    expect(r.body.coRevertData).toBeUndefined();
  });
});
