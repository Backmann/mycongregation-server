import { Harness, startHarness } from './harness';

/**
 * The workbook import and the Memorial (sync audit of 23 October 2026,
 * decided with Lionel on 24 October).
 */
describe('workbook import and the Memorial (real database)', () => {
  let h: Harness;
  let n = 0;

  const monday = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * (5 + 3 * ++n));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const plus = (iso: string, days: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const load = (week: string, parts: Array<[string, number, string | null]>) =>
    h.as('admin').post('/mwb-import/apply', {
      epubFile: 'mwb_test.epub',
      weeks: [
        {
          weekStartDate: week,
          weekEndDate: plus(week, 6),
          parts: parts.map(([partKey, partOrder, partTitle]) => ({
            partKey,
            partOrder,
            partTitle,
          })),
        },
      ],
    });
  const part = async (week: string, key: string) =>
    (
      await h.sql<{ id: string; title: string | null; gone: boolean }>(
        `SELECT id, part_title AS title, deleted_at IS NOT NULL AS gone
           FROM assignments WHERE week_start_date = $1 AND part_key = $2
          ORDER BY created_at DESC LIMIT 1`,
        [week, key],
      )
    )[0];

  beforeAll(async () => {
    h = await startHarness();
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
  });
  afterAll(async () => {
    await h?.close();
  });

  describe('loading the workbook again', () => {
    it('keeps a title a person changed, says so, and writes the load to the journal', async () => {
      const week = monday();
      const first = await load(week, [
        ['treasures_talk', 1, 'Сокровища из Слова Бога'],
        ['living_christians_1', 10, 'Из тетради'],
      ]);
      expect([200, 201]).toContain(first.status);
      const lc = await part(week, 'living_christians_1');
      await h
        .as('admin')
        .patch(`/assignments/${lc.id}`, { partTitle: 'Наша местная тема' });
      const again = await load(week, [
        ['treasures_talk', 1, 'Сокровища из Слова Бога'],
        ['living_christians_1', 10, 'Из тетради'],
      ]);
      expect([200, 201]).toContain(again.status);
      expect((await part(week, 'living_christians_1')).title).toBe(
        'Наша местная тема',
      );
      expect(again.body.notices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'kept_by_hand',
            weekStartDate: week,
            parts: 1,
          }),
        ]),
      );
      const [{ loads }] = await h.sql<{ loads: number }>(
        `SELECT count(*)::int AS loads FROM audit_logs
          WHERE entity_type = 'assignment' AND action = 'CREATE'
            AND entity_id IN (SELECT id FROM assignments WHERE week_start_date = $1)`,
        [week],
      );
      expect(loads).toBeGreaterThanOrEqual(2);
    });

    it('a title the workbook itself wrote is refreshed as before', async () => {
      const week = monday();
      await load(week, [['living_christians_1', 10, 'Старое название']]);
      await load(week, [['living_christians_1', 10, 'Новое название']]);
      expect((await part(week, 'living_christians_1')).title).toBe(
        'Новое название',
      );
    });

    it('a week made by hand loses the empty numbered parts the workbook does not have', async () => {
      const week = monday();
      for (const key of [
        'apply_yourself_1',
        'apply_yourself_4',
        'midweek_chairman',
      ]) {
        const r = await h.as('admin').post('/assignments', {
          weekStartDate: week,
          eventType: 'midweek',
          partKey: key,
        });
        expect(r.status).toBe(201);
      }
      const res = await load(week, [
        ['apply_yourself_1', 5, 'Начинайте разговор'],
      ]);
      expect((await part(week, 'apply_yourself_4')).gone).toBe(true);
      // Not a numbered workbook part: stays.
      expect((await part(week, 'midweek_chairman')).gone).toBe(false);
      expect(res.body.notices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'empty_parts_removed', parts: 1 }),
        ]),
      );
    });
  });

  describe('the Memorial', () => {
    let eventId: string;
    let card: string;
    let user: string;
    let week: string;

    beforeAll(async () => {
      week = monday();
      const ev = await h.as('admin').post('/special-events', {
        title: 'Вечеря воспоминания',
        type: 'memorial',
        date: plus(week, 3),
        time: '19:30',
      });
      expect([200, 201]).toContain(ev.status);
      eventId = ev.body.id;
      card = await h.addPublisher({
        firstName: 'Юрген',
        lastName: 'Бауэр',
        appointment: 'ministerial_servant',
        baptismDate: '2005-01-01',
      });
      user = await h.addUser({
        login: 'memorial1',
        role: 'ministerial_servant',
        publisherId: card,
      });
    });

    it('its places move with it to another week, brothers and all', async () => {
      const gen = await h.as('admin').post('/duties/generate', {
        weekStartDate: week,
        eventType: 'memorial',
      });
      expect([200, 201]).toContain(gen.status);
      const [duty] = await h.sql<{ id: string }>(
        `SELECT id FROM duties WHERE week_start_date = $1 AND event_type = 'memorial' LIMIT 1`,
        [week],
      );
      expect(duty).toBeDefined();
      const a = await h
        .as('admin')
        .patch(`/duties/${duty.id}/assign`, { publisherId: card });
      expect(a.status).toBe(200);
      const moved = await h
        .as('admin')
        .patch(`/special-events/${eventId}`, { date: plus(week, 10) });
      expect(moved.status).toBe(200);
      const [now] = await h.sql<{ w: string; p: string }>(
        `SELECT to_char(week_start_date, 'YYYY-MM-DD') AS w, publisher_id AS p FROM duties WHERE id = $1`,
        [duty.id],
      );
      expect(now).toEqual({ w: plus(week, 7), p: card });
      week = plus(week, 7);
    });

    it('after publishing, a brother given or taken off a line is told', async () => {
      await h.as('admin').post(`/memorial/${eventId}/prepare`);
      await h.as('admin').post(`/memorial/${eventId}/publish`);
      const [line] = await h.sql<{ id: string }>(
        `SELECT id FROM memorial_items WHERE special_event_id = $1 AND deleted_at IS NULL ORDER BY sort_order LIMIT 1`,
        [eventId],
      );
      const keys = async () =>
        (
          await h.sql<{ key: string }>(
            `SELECT dedupe_key AS key FROM notification_outbox WHERE user_id = $1 ORDER BY created_at`,
            [user],
          )
        ).map((r) => r.key);
      const before = (await keys()).length;
      await h
        .as('admin')
        .patch(`/memorial/lines/${line.id}`, { publisherId: card });
      const given = await keys();
      expect(given.filter((k) => k.includes(':add:'))).toHaveLength(1);
      expect(before).toBeGreaterThanOrEqual(0);
      await new Promise((r) => setTimeout(r, 10_500));
      await h
        .as('admin')
        .patch(`/memorial/lines/${line.id}`, { publisherId: null });
      const taken = await keys();
      expect(taken.filter((k) => k.includes(':off:'))).toHaveLength(1);
    });
  });
});
