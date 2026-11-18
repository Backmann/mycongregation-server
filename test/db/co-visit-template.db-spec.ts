import { Harness, startHarness } from './harness';

/**
 * Starting an empty visit week from the last one (17 November 2026), against
 * a real database: the preview and the copy agree, no person is carried, a
 * week that has anything is refused, a planner only, all or nothing.
 */
describe('the visit week from the last visit (real database)', () => {
  let h: Harness;
  let tenant: string;
  let past: string;
  let next: string;
  let host: string;

  // Fixed dates, both weeks Tuesday to Sunday: the weekday is what carries
  // over, so a year that moves the weekdays must not move the test.
  const pastStart = '2026-08-04';
  const pastEnd = '2026-08-09';
  const nextStart = '2094-02-23';
  const nextEnd = '2094-02-28';

  beforeAll(async () => {
    h = await startHarness();
    tenant = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    const ev = async (s: string, e: string) =>
      (
        await h.sql<{ id: string }>(
          `INSERT INTO special_events (congregation_id, title, type, date, end_date)
           VALUES ($1, 'Визит', 'circuit_overseer_visit', $2, $3) RETURNING id`,
          [tenant, s, e],
        )
      )[0].id;
    past = await ev(pastStart, pastEnd);
    next = await ev(nextStart, nextEnd);
    host = await h.addPublisher({
      firstName: 'Глеб',
      lastName: 'Хозяин',
      baptismDate: '2000-01-01',
    });
    const item = (
      date: string,
      kind: string,
      time: string | null,
      extra: Record<string, unknown> = {},
    ) =>
      h.sql(
        `INSERT INTO co_visit_items (congregation_id, special_event_id, kind, item_date, start_time,
           place_kind, place_text, assignee_publisher_id, note, for_wife, with_wife, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0)`,
        [
          tenant,
          past,
          kind,
          date,
          time,
          extra.placeKind ?? null,
          extra.placeText ?? null,
          extra.host ? host : null,
          extra.note ?? null,
          extra.forWife ?? false,
          extra.withWife ?? false,
        ],
      );
    const wed = '2026-08-05';
    await item(wed, 'field_service', '10:00', {
      placeKind: 'kingdom_hall',
      placeText: 'Hall 1',
      host: true,
      note: 'по домам',
    });
    await item(wed, 'field_service', '10:00', {
      placeKind: 'kingdom_hall',
      placeText: 'Hall 1',
      host: true,
      forWife: true,
    });
    await item(wed, 'lunch', '12:15', { host: true, note: 'у Хозяиных' });
    await item(wed, 'lunch', '12:15', { forWife: true });
    await item(wed, 'pastoral', '16:00', {
      host: true,
      note: 'семья Озеровых',
    });
    await item('2026-08-04', 'lunch_box', null, { host: true });
    await item('2026-08-09', 'lunch_box', null, { host: true });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('the preview names the source week and counts per day', async () => {
    const r = await h
      .as('admin')
      .get(`/co-visit-items/template?specialEventId=${next}`)
      .expect(200);
    expect(r.body.empty).toBe(true);
    expect(r.body.source.id).toBe(past);
    expect(r.body.total).toBe(6);
    expect(r.body.skipped).toBe(0);
    expect(r.body.days.map((d: { count: number }) => d.count)).toEqual([
      1, 4, 0, 0, 0, 1,
    ]);
  });

  it('a publisher may neither see nor apply it', async () => {
    const pub = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Ланг',
      baptismDate: '2000-01-01',
    });
    await h.addUser({ login: 'tplpub', role: 'publisher', publisherId: pub });
    await h
      .as('tplpub')
      .get(`/co-visit-items/template?specialEventId=${next}`)
      .expect(403);
    await h
      .as('tplpub')
      .post('/co-visit-items/template', { specialEventId: next })
      .expect(403);
    expect(
      await h.sql(`SELECT 1 FROM co_visit_items WHERE special_event_id = $1`, [
        next,
      ]),
    ).toHaveLength(0);
  });

  it('copies the form of the week and no person', async () => {
    const r = await h
      .as('admin')
      .post('/co-visit-items/template', { specialEventId: next })
      .expect(201);
    expect(r.body).toEqual({ created: 6, skipped: 0, sourceId: past });
    const rows = await h.sql<{
      item_date: string;
      kind: string;
      start_time: string | null;
      for_wife: boolean;
      place_text: string | null;
      note: string | null;
      assignee_publisher_id: string | null;
      assignee_text: string | null;
    }>(
      `SELECT to_char(item_date,'YYYY-MM-DD') item_date, kind, start_time::text start_time, for_wife, place_text, note,
              assignee_publisher_id, assignee_text
         FROM co_visit_items WHERE special_event_id = $1 AND deleted_at IS NULL
        ORDER BY item_date, start_time NULLS LAST, for_wife`,
      [next],
    );
    expect(
      rows.map((r) => [
        r.item_date.slice(5),
        r.kind,
        r.start_time?.slice(0, 5) ?? null,
        r.for_wife,
      ]),
    ).toEqual([
      ['02-23', 'lunch_box', null, false],
      ['02-24', 'field_service', '10:00', false],
      ['02-24', 'field_service', '10:00', true],
      ['02-24', 'lunch', '12:15', false],
      ['02-24', 'pastoral', '16:00', false],
      ['02-28', 'lunch_box', null, false],
    ]);
    expect(
      rows.every(
        (r) => r.assignee_publisher_id === null && r.assignee_text === null,
      ),
    ).toBe(true);
    expect(
      rows.find((r) => r.kind === 'field_service' && !r.for_wife)?.note,
    ).toBe('по домам');
    expect(rows.find((r) => r.kind === 'field_service')?.place_text).toBe(
      'Hall 1',
    );
    expect(rows.find((r) => r.kind === 'pastoral')?.note).toBeNull();
    expect(rows.find((r) => r.kind === 'lunch')?.note).toBeNull();
    const log = await h.sql<{ after_json: string }>(
      `SELECT after_json FROM audit_logs WHERE entity_type='co_visit_item' AND entity_id=$1 AND action='CREATE'`,
      [next],
    );
    expect(log).toHaveLength(1);
    // The journal keeps one line for the whole copy (its text is encrypted).
  });

  it('refuses a week that already has items', async () => {
    const r = await h
      .as('admin')
      .post('/co-visit-items/template', { specialEventId: next })
      .expect(409);
    expect(r.body.code).toBe('CO_VISIT_TEMPLATE_NOT_EMPTY');
    const pre = await h
      .as('admin')
      .get(`/co-visit-items/template?specialEventId=${next}`)
      .expect(200);
    expect(pre.body.empty).toBe(false);
  });

  it('says so when no earlier visit has a week', async () => {
    const first = (
      await h.sql<{ id: string }>(
        `INSERT INTO special_events (congregation_id, title, type, date, end_date)
         VALUES ($1, 'Визит', 'circuit_overseer_visit', $2, $3) RETURNING id`,
        [tenant, '2023-03-07', '2023-03-12'],
      )
    )[0].id;
    const pre = await h
      .as('admin')
      .get(`/co-visit-items/template?specialEventId=${first}`)
      .expect(200);
    expect(pre.body.source).toBeNull();
    // A past visit is frozen before anything else is asked.
    await h
      .as('admin')
      .post('/co-visit-items/template', { specialEventId: first })
      .expect(409);
  });
});
