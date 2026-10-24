import { Harness, startHarness } from './harness';
import { AssignmentsService } from '../../src/assignments/assignments.service';

/**
 * The meeting programme: «Вернуть как было» and who is told what
 * (sync audit of 23 October 2026, decided with Lionel on 24 October).
 */
describe('programme: undo and notices (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let svc: AssignmentsService;
  let n = 0;

  const monday = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * (4 + 2 * ++n));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };

  const brother = async (login: string, first: string, last: string) => {
    const card = await h.addPublisher({
      firstName: first,
      lastName: last,
      appointment: 'ministerial_servant',
      baptismDate: '2010-01-01',
    });
    const user = await h.addUser({
      login,
      role: 'ministerial_servant',
      publisherId: card,
    });
    return { card, user };
  };

  /** A published midweek part with a brother, and him told of it. */
  const toldPart = async (
    week: string,
    publisherId: string,
    partKey = 'treasures_talk',
  ): Promise<string> => {
    const r = await h.as('admin').post('/assignments', {
      weekStartDate: week,
      eventType: 'midweek',
      partKey,
      partTitle: 'Сокровища',
      publisherId,
    });
    expect(r.status).toBe(201);
    // A second part, so the meeting stays published around the first.
    await h.as('admin').post('/assignments', {
      weekStartDate: week,
      eventType: 'midweek',
      partKey: 'midweek_chairman',
    });
    const p = await h.as('admin').post('/assignments/publish', {
      weekStartDate: week,
      eventType: 'midweek',
      notify: true,
    });
    expect([200, 201]).toContain(p.status);
    await settle();
    return r.body.id as string;
  };

  /** The notices go out fire-and-forget: give them a moment. */
  const settle = () => new Promise((r) => setTimeout(r, 400));

  const outbox = (userId: string) =>
    h.sql<{ key: string | null; body: string }>(
      `SELECT dedupe_key AS key, body FROM notification_outbox WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );

  const lastEntry = async (entityId: string) =>
    (
      await h.sql<{ id: string }>(
        `SELECT id FROM audit_logs WHERE entity_type = 'assignment' AND entity_id = $1 AND action = 'UPDATE'
          ORDER BY created_at DESC LIMIT 1`,
        [entityId],
      )
    )[0]?.id;

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    svc = h.app.get(AssignmentsService);
    // The meeting's day: what a brother is told of is dated by it.
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

  describe('«Вернуть как было»', () => {
    it('another brother put on a part can be undone, and the first comes back', async () => {
      const a = await brother('undo1', 'Марк', 'Фогт');
      const b = await brother('undo2', 'Тимо', 'Ланг');
      const r = await h.as('admin').post('/assignments', {
        weekStartDate: monday(),
        eventType: 'midweek',
        partKey: 'treasures_talk',
        publisherId: a.card,
      });
      await h
        .as('admin')
        .patch(`/assignments/${r.body.id as string}`, { publisherId: b.card });
      const entry = await lastEntry(r.body.id);
      const plan = await h.as('admin').get(`/journal/${entry}/revert`);
      expect(plan.body.supported).toBe(true);
      const undo = await h.as('admin').post(`/journal/${entry}/revert`);
      expect(undo.status).toBe(204);
      const [row] = await h.sql<{ p: string }>(
        `SELECT publisher_id AS p FROM assignments WHERE id = $1`,
        [r.body.id],
      );
      expect(row.p).toBe(a.card);
    });

    it('«Снять назначение» undone brings back the brother AND his assistant', async () => {
      const a = await brother('undo3', 'Юрий', 'Беккер');
      const b = await brother('undo4', 'Кай', 'Брандт');
      const r = await h.as('admin').post('/assignments', {
        weekStartDate: monday(),
        eventType: 'midweek',
        partKey: 'apply_yourself_1',
        publisherId: a.card,
        assistantPublisherId: b.card,
      });
      await h.as('admin').patch(`/assignments/${r.body.id as string}`, {
        publisherId: null,
        assistantPublisherId: null,
      });
      const entry = await lastEntry(r.body.id);
      expect(
        (await h.as('admin').post(`/journal/${entry}/revert`)).status,
      ).toBe(204);
      const [row] = await h.sql<{ p: string; a: string }>(
        `SELECT publisher_id AS p, assistant_publisher_id AS a FROM assignments WHERE id = $1`,
        [r.body.id],
      );
      expect(row).toEqual({ p: a.card, a: b.card });
    });

    it('a changed title is in the journal and can be put back', async () => {
      const r = await h.as('admin').post('/assignments', {
        weekStartDate: monday(),
        eventType: 'midweek',
        partKey: 'living_christians_1',
        partTitle: 'Как было',
      });
      await h.as('admin').patch(`/assignments/${r.body.id as string}`, {
        partTitle: 'Как стало',
      });
      const entry = await lastEntry(r.body.id);
      expect(entry).toBeDefined();
      expect(
        (await h.as('admin').post(`/journal/${entry}/revert`)).status,
      ).toBe(204);
      const [row] = await h.sql<{ t: string }>(
        `SELECT part_title AS t FROM assignments WHERE id = $1`,
        [r.body.id],
      );
      expect(row.t).toBe('Как было');
    });
  });

  describe('a part taken away or given back', () => {
    it('cancelled: its brother is told it is gone', async () => {
      const week = monday();
      const a = await brother('cancel1', 'Пауль', 'Майер');
      const part = await toldPart(week, a.card);
      const before = (await outbox(a.user)).length;
      expect(before).toBeGreaterThan(0);
      await h
        .as('admin')
        .patch(`/assignments/${part}`, { status: 'cancelled' });
      expect(
        (await svc.notifyChanges(tenantId, week, 'midweek' as never)).notified,
      ).toBeGreaterThan(0);
      await settle();
      const after = await outbox(a.user);
      expect(after.length).toBe(before + 1);
      expect(after[after.length - 1].key).toContain(':removed:');
    });

    it('given back after a cancel: published again, and its brother told he has it', async () => {
      const week = monday();
      const a = await brother('cancel2', 'Ханс', 'Шульц');
      const part = await toldPart(week, a.card);
      await h
        .as('admin')
        .patch(`/assignments/${part}`, { status: 'cancelled' });
      await svc.notifyChanges(tenantId, week, 'midweek' as never);
      await settle();
      const before = (await outbox(a.user)).length;
      // A press of «сообщить» absorbs a double tap of ten seconds; a person
      // gives a part back minutes later, not within the same ten seconds.
      await new Promise((r) => setTimeout(r, 10_500));
      const back = await h
        .as('admin')
        .patch(`/assignments/${part}`, { status: 'draft' });
      expect(back.status).toBe(200);
      expect(back.body.status).toBe('published');
      await svc.notifyChanges(tenantId, week, 'midweek' as never);
      await settle();
      expect((await outbox(a.user)).length).toBe(before + 1);
    });

    it('deleted: its brother is told it is gone', async () => {
      const week = monday();
      const a = await brother('delete1', 'Отто', 'Кляйн');
      const part = await toldPart(week, a.card, 'living_christians_extra');
      const before = (await outbox(a.user)).length;
      const del = await h.as('admin').delete(`/assignments/${part}`);
      expect([200, 204]).toContain(del.status);
      expect(
        (await svc.notifyChanges(tenantId, week, 'midweek' as never)).notified,
      ).toBeGreaterThan(0);
      await settle();
      const after = await outbox(a.user);
      expect(after.length).toBe(before + 1);
      expect(after[after.length - 1].key).toContain(':removed:');
      // Said once: the mark on the removed part is put away.
      const [{ flagged }] = await h.sql<{ flagged: number }>(
        `SELECT count(*)::int AS flagged FROM assignments WHERE id = $1 AND changed_since_publish`,
        [part],
      );
      expect(flagged).toBe(0);
    });
  });

  describe('a local-needs topic in a part', () => {
    const topicState = async (id: string) =>
      (
        await h.sql<{ a: string | null }>(
          `SELECT used_assignment_id AS a FROM local_needs_topics WHERE id = $1`,
          [id],
        )
      )[0].a;

    it('bound first and titled after stays bound — the title is its own', async () => {
      const part = await h.as('admin').post('/assignments', {
        weekStartDate: monday(),
        eventType: 'midweek',
        partKey: 'living_christians_1',
        partTitle: 'Из тетради',
      });
      const topic = await h
        .as('admin')
        .post('/local-needs', { title: 'Гостеприимство к новым' });
      expect([200, 201]).toContain(topic.status);
      // The app's two requests, in the order that lost the topic.
      await h.as('admin').post(`/local-needs/${topic.body.id as string}/used`, {
        week: part.body.weekStartDate,
        assignmentId: part.body.id,
      });
      await h.as('admin').patch(`/assignments/${part.body.id as string}`, {
        partTitle: 'Гостеприимство к новым',
      });
      expect(await topicState(topic.body.id)).toBe(part.body.id);
    });

    it('a cancelled part gives its topic back to the plan', async () => {
      const part = await h.as('admin').post('/assignments', {
        weekStartDate: monday(),
        eventType: 'midweek',
        partKey: 'living_christians_1',
        partTitle: 'Скромность',
      });
      const topic = await h
        .as('admin')
        .post('/local-needs', { title: 'Скромность' });
      await h.as('admin').post(`/local-needs/${topic.body.id as string}/used`, {
        week: part.body.weekStartDate,
        assignmentId: part.body.id,
      });
      await h.as('admin').patch(`/assignments/${part.body.id as string}`, {
        status: 'cancelled',
      });
      expect(await topicState(topic.body.id)).toBeNull();
    });
  });
});
