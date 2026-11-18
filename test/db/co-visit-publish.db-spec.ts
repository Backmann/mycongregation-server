import { Harness, startHarness } from './harness';
import { CoVisitNoticeService } from '../../src/co-visit-items/co-visit-notice.service';
import { AssignmentRemindersService } from '../../src/assignment-reminders/assignment-reminders.service';

/**
 * The visit week is published once, then speaks for itself (18 November
 * 2026), against a real database: a draft is the planner's alone; publishing
 * tells each person his own lines; an edit is told ten minutes after the
 * last one; a line taken away is told; the evening reminders find the lines
 * of a published visit and the meeting of each group.
 */
describe('publishing a visit week (real database)', () => {
  let h: Harness;
  let tenant: string;
  let visit: string;
  let fs: string;
  const users: Record<string, string> = {};
  const cards: Record<string, string> = {};

  const outbox = (userId: string) =>
    h.sql<{ kind: string; dedupe_key: string }>(
      `SELECT kind, dedupe_key FROM notification_outbox WHERE user_id = $1 AND kind = 'co_visit' ORDER BY created_at`,
      [userId],
    );

  beforeAll(async () => {
    h = await startHarness();
    tenant = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    const person = async (
      login: string | null,
      body: Record<string, unknown>,
    ) => {
      const id = await h.addPublisher({ baptismDate: '2000-01-01', ...body });
      if (login) {
        cards[login] = id;
        users[login] = await h.addUser({
          login,
          role: 'publisher',
          publisherId: id,
        });
      }
      return id;
    };
    await person('copart', { firstName: 'Захар', lastName: 'Уваров' });
    await person('cosis', {
      firstName: 'Вера',
      lastName: 'Гусева',
      gender: 'sister',
    });
    await person('coeld', {
      firstName: 'Борис',
      lastName: 'Лаптев',
      appointment: 'elder',
    });
    const host = await person(null, {
      firstName: 'Денис',
      lastName: 'Сафонов',
    });
    // Tuesday 23 to Sunday 28 February 2094.
    visit = (
      await h.sql<{ id: string }>(
        `INSERT INTO special_events (congregation_id, title, type, date, end_date, co_first_name, co_last_name, co_wife_name, co_wife_comes)
         VALUES ($1, 'Визит', 'circuit_overseer_visit', '2094-02-23', '2094-02-28', 'Пётр', 'Иванов', 'Мария', true) RETURNING id`,
        [tenant],
      )
    )[0].id;
    const item = async (
      kind: string,
      date: string,
      time: string,
      who: string | null,
      extra = '',
    ) =>
      (
        await h.sql<{ id: string }>(
          `INSERT INTO co_visit_items (congregation_id, special_event_id, kind, item_date, start_time, place_kind, assignee_publisher_id, note, for_wife, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0) RETURNING id`,
          [
            tenant,
            visit,
            kind,
            date,
            time,
            kind === 'lunch' ? null : 'kingdom_hall',
            who,
            kind === 'field_service' ? 'по домам' : null,
            extra === 'wife',
          ],
        )
      )[0].id;
    fs = await item('field_service', '2094-02-24', '10:00', cards.copart);
    await item('field_service', '2094-02-24', '10:00', cards.cosis, 'wife');
    await item('lunch', '2094-02-24', '12:15', host);
    await item('elders', '2094-02-26', '19:00', null);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('a draft is the planner’s alone', async () => {
    const mine = await h.as('copart').get('/co-visit-items/mine').expect(200);
    expect(JSON.stringify(mine.body)).not.toContain(visit);
    const pub = await h
      .as('admin')
      .get(`/co-visit-items/publication?specialEventId=${visit}`)
      .expect(200);
    expect(pub.body.publishedAt).toBeNull();
    const zakhar = pub.body.rows.find(
      (r: { publisherId: string }) => r.publisherId === cards.copart,
    );
    expect(zakhar.title).toBe('Вам назначено — визит районного старейшины');
    expect(zakhar.body).toBe(
      'ср 24 · 10:00 — служение с районным старейшиной (Пётр Иванов), Зал Царства · по домам',
    );
    const host = pub.body.rows.find(
      (r: { name: string }) => r.name === 'Сафонов Денис',
    );
    expect(host.reach).toBe('no_login');
    expect(await outbox(users.copart)).toHaveLength(0);
  });

  it('a publisher may neither look nor publish', async () => {
    await h
      .as('copart')
      .get(`/co-visit-items/publication?specialEventId=${visit}`)
      .expect(403);
    await h
      .as('copart')
      .post('/co-visit-items/publish', { specialEventId: visit })
      .expect(403);
  });

  it('publishing tells each person his own lines, once', async () => {
    const r = await h
      .as('admin')
      .post('/co-visit-items/publish', { specialEventId: visit })
      .expect(201);
    expect(r.body.told).toBe(2);
    expect(await outbox(users.copart)).toHaveLength(1);
    expect(await outbox(users.cosis)).toHaveLength(1);
    expect(await outbox(users.coeld)).toHaveLength(0);
    // A second press says nothing new.
    await h
      .as('admin')
      .post('/co-visit-items/publish', { specialEventId: visit })
      .expect(201);
    expect(await outbox(users.copart)).toHaveLength(1);
    const mine = await h.as('copart').get('/co-visit-items/mine').expect(200);
    expect(JSON.stringify(mine.body)).toContain(visit);
  });

  it('the evening reminders find his line and the elders’ meeting for every elder', async () => {
    const svc = h.app.get(AssignmentRemindersService) as unknown as {
      coVisitLines: (
        c: string,
        t: string,
      ) => Promise<[string, { labelKey: string }][]>;
    };
    const got = await svc.coVisitLines(tenant, '2094-02-23');
    const of = (pid: string) =>
      got
        .filter(([p]) => p === pid)
        .map(([, i]) => i.labelKey)
        .sort();
    expect(of(cards.copart)).toEqual(['field_service']);
    expect(of(cards.cosis)).toEqual(['field_service']);
    expect(of(cards.coeld)).toEqual(['elders']);
  });

  it('an edit is told ten minutes after the last one, not before', async () => {
    const svc = h.app.get(CoVisitNoticeService);
    await h
      .as('admin')
      .patch(`/co-visit-items/${fs}`, { startTime: '11:00' })
      .expect(200);
    expect(await svc.tick(new Date())).toBe(0);
    expect(await svc.tick(new Date(Date.now() + 11 * 60 * 1000))).toBe(1);
    expect(await outbox(users.copart)).toHaveLength(2);
    // The sister's outing did not change: nothing for her.
    expect(await outbox(users.cosis)).toHaveLength(1);
    // Told once: the next pass is silent.
    expect(await svc.tick(new Date(Date.now() + 12 * 60 * 1000))).toBe(0);
  });

  it('a line taken away is told, and forgotten', async () => {
    const svc = h.app.get(CoVisitNoticeService);
    await h.as('admin').delete(`/co-visit-items/${fs}`).expect(204);
    await svc.tick(new Date(Date.now() + 11 * 60 * 1000));
    const rows = await outbox(users.copart);
    expect(rows).toHaveLength(3);
    expect(await svc.toldLines(visit, cards.copart)).toEqual([]);
  });

  it('an undone deletion is said again, and a time put back is said again', async () => {
    const svc = h.app.get(CoVisitNoticeService);
    const later = (m: number) => new Date(Date.now() + m * 60 * 1000);
    // Restored: he hears he has it again — the same lines as the first word,
    // a new word (review, 18 November 2026).
    await h.as('admin').post(`/co-visit-items/${fs}/restore`).expect(204);
    await svc.tick(later(11));
    expect(await outbox(users.copart)).toHaveLength(4);
    // A time changed and changed back: each is news.
    await h
      .as('admin')
      .patch(`/co-visit-items/${fs}`, { startTime: '09:30' })
      .expect(200);
    await svc.tick(later(22));
    await h
      .as('admin')
      .patch(`/co-visit-items/${fs}`, { startTime: '11:00' })
      .expect(200);
    await svc.tick(later(33));
    await h
      .as('admin')
      .patch(`/co-visit-items/${fs}`, { startTime: '09:30' })
      .expect(200);
    await svc.tick(later(44));
    expect(await outbox(users.copart)).toHaveLength(7);
  });

  it('a visit that is over cannot be published', async () => {
    const old = (
      await h.sql<{ id: string }>(
        `INSERT INTO special_events (congregation_id, title, type, date, end_date)
         VALUES ($1, 'Визит', 'circuit_overseer_visit', '2023-03-07', '2023-03-12') RETURNING id`,
        [tenant],
      )
    )[0].id;
    const r = await h
      .as('admin')
      .post('/co-visit-items/publish', { specialEventId: old })
      .expect(409);
    expect(r.body.code).toBe('CO_VISIT_PAST_LOCKED');
  });
});
