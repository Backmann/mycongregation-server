import { Harness, startHarness } from './harness';
import { CoWifeComes1934000000000 } from '../../src/migrations/1934000000000-CoWifeComes';

/**
 * Two rules of 18 November 2026 (Lionel), against a real database:
 * - the overseer's wife is part of the week only when she comes on this
 *   visit: the copy of the last visit leaves her outings behind, the server
 *   refuses new ones, her stray rows are cleared in one undoable step and
 *   meanwhile nobody is told about them;
 * - shepherding calls are seen in full and planned by elders only: the
 *   service overseer's assistant who is a ministerial servant sees the time
 *   they take and nothing else, here and in the publishing window.
 */
describe('the wife who stays at home, and calls for elders (real database)', () => {
  let h: Harness;
  let tenant: string;
  let married: string;
  let alone: string;
  const cards: Record<string, string> = {};

  const visit = async (s: string, e: string, wife: boolean) =>
    (
      await h.sql<{ id: string }>(
        `INSERT INTO special_events (congregation_id, title, type, date, end_date, co_first_name, co_last_name, co_wife_name, co_wife_comes)
         VALUES ($1, 'Визит', 'circuit_overseer_visit', $2, $3, 'Пётр', 'Иванов', $4, $5) RETURNING id`,
        [tenant, s, e, wife ? 'Мария' : null, wife],
      )
    )[0].id;
  const item = async (
    ev: string,
    kind: string,
    date: string,
    time: string,
    o: {
      who?: string;
      forWife?: boolean;
      withWife?: boolean;
      note?: string;
    } = {},
  ) =>
    (
      await h.sql<{ id: string }>(
        `INSERT INTO co_visit_items (congregation_id, special_event_id, kind, item_date, start_time, place_kind, assignee_publisher_id, note, for_wife, with_wife, sort_order)
         VALUES ($1, $2, $3, $4, $5, 'kingdom_hall', $6, $7, $8, $9, 0) RETURNING id`,
        [
          tenant,
          ev,
          kind,
          date,
          time,
          o.who ?? null,
          o.note ?? null,
          o.forWife ?? false,
          o.withWife ?? false,
        ],
      )
    )[0].id;
  const live = (ev: string) =>
    h.sql<{ kind: string; for_wife: boolean; with_wife: boolean }>(
      `SELECT kind, for_wife, with_wife FROM co_visit_items
        WHERE special_event_id = $1 AND deleted_at IS NULL
        ORDER BY item_date, start_time, for_wife`,
      [ev],
    );

  beforeAll(async () => {
    h = await startHarness();
    tenant = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    const person = async (
      login: string,
      role: 'elder' | 'ministerial_servant' | 'publisher',
      body: Record<string, unknown>,
    ) => {
      const id = await h.addPublisher({ baptismDate: '2000-01-01', ...body });
      cards[login] = id;
      const userId = await h.addUser({ login, role, publisherId: id });
      return userId;
    };
    const elderUser = await person('wpelder', 'elder', {
      firstName: 'Борис',
      lastName: 'Лаптев',
      appointment: 'elder',
    });
    await h.sql(
      `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, 'service_overseer', $2)`,
      [tenant, elderUser],
    );
    const assistant = await person('wpasst', 'ministerial_servant', {
      firstName: 'Олег',
      lastName: 'Сидоров',
      appointment: 'ministerial_servant',
    });
    await h.sql(
      `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, 'service_overseer_assistant', $2)`,
      [tenant, assistant],
    );
    await person('wpsis', 'publisher', {
      firstName: 'Вера',
      lastName: 'Гусева',
      gender: 'sister',
    });
    await person('wpbro', 'publisher', {
      firstName: 'Захар',
      lastName: 'Уваров',
    });

    // August 2093, with his wife: the week to copy from.
    married = await visit('2093-08-04', '2093-08-09', true);
    await item(married, 'field_service', '2093-08-05', '10:00', {
      note: 'по домам',
    });
    await item(married, 'field_service', '2093-08-05', '10:00', {
      forWife: true,
    });
    await item(married, 'field_service', '2093-08-06', '10:00', {
      withWife: true,
    });
    await item(married, 'pastoral', '2093-08-05', '16:00', {
      note: 'семья',
    });
    // February 2094: he comes alone.
    alone = await visit('2094-02-23', '2094-02-28', false);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('a week copied for an overseer who comes alone has nothing of hers', async () => {
    const pre = await h
      .as('wpelder')
      .get(`/co-visit-items/template?specialEventId=${alone}`)
      .expect(200);
    expect(pre.body.total).toBe(3);
    const r = await h
      .as('wpelder')
      .post('/co-visit-items/template', { specialEventId: alone })
      .expect(201);
    expect(r.body.created).toBe(3);
    expect(await live(alone)).toEqual([
      { kind: 'field_service', for_wife: false, with_wife: false },
      { kind: 'pastoral', for_wife: false, with_wife: false },
      { kind: 'field_service', for_wife: false, with_wife: false },
    ]);
  });

  it('nobody can add an outing of hers, or «together», while she does not come', async () => {
    for (const extra of [{ forWife: true }, { withWife: true }])
      await h
        .as('wpelder')
        .post('/co-visit-items', {
          specialEventId: alone,
          kind: 'field_service',
          itemDate: '2094-02-24',
          startTime: '14:00',
          ...extra,
        })
        .expect(409);
  });

  it('stray rows of hers are not said to anyone, then cleared and put back in one step each', async () => {
    // Left from before the visit said she stays at home.
    const hers = await item(alone, 'field_service', '2094-02-24', '10:00', {
      forWife: true,
      who: cards.wpsis,
    });
    const joint = await item(alone, 'field_service', '2094-02-26', '10:00', {
      withWife: true,
      who: cards.wpbro,
    });
    const pub = await h
      .as('wpelder')
      .get(`/co-visit-items/publication?specialEventId=${alone}`)
      .expect(200);
    const names = pub.body.rows.map((r: { name: string }) => r.name);
    expect(names).not.toContain('Гусева Вера');
    const zakhar = pub.body.rows.find(
      (r: { name: string }) => r.name === 'Уваров Захар',
    );
    expect(zakhar.body).not.toMatch(/супруг|Мари/);

    // While she comes, the step is refused: her rows are real.
    await h
      .as('wpelder')
      .post('/co-visit-items/clear-wife', { specialEventId: married })
      .expect(409);

    const cleared = await h
      .as('wpasst')
      .post('/co-visit-items/clear-wife', { specialEventId: alone })
      .expect(201);
    expect(cleared.body).toEqual({ removed: [hers], unjoined: [joint] });
    expect((await live(alone)).some((r) => r.for_wife || r.with_wife)).toBe(
      false,
    );

    await h
      .as('wpasst')
      .post('/co-visit-items/clear-wife/undo', {
        specialEventId: alone,
        ...cleared.body,
      })
      .expect(204);
    const back = await h.sql<{
      id: string;
      for_wife: boolean;
      with_wife: boolean;
    }>(
      `SELECT id, for_wife, with_wife FROM co_visit_items WHERE id = ANY($1) AND deleted_at IS NULL ORDER BY for_wife`,
      [[hers, joint]],
    );
    expect(back).toEqual([
      { id: joint, for_wife: false, with_wife: true },
      { id: hers, for_wife: true, with_wife: false },
    ]);
    // Undo touches only this visit's rows.
    const other = await item(married, 'field_service', '2093-08-07', '10:00', {
      forWife: true,
    });
    await h.sql(`UPDATE co_visit_items SET deleted_at = now() WHERE id = $1`, [
      other,
    ]);
    await h
      .as('wpasst')
      .post('/co-visit-items/clear-wife/undo', {
        specialEventId: alone,
        removed: [other],
        unjoined: [],
      })
      .expect(204);
    expect(
      await h.sql(
        `SELECT 1 FROM co_visit_items WHERE id = $1 AND deleted_at IS NULL`,
        [other],
      ),
    ).toHaveLength(0);
    // Clean again for the tests below.
    await h
      .as('wpelder')
      .post('/co-visit-items/clear-wife', { specialEventId: alone })
      .expect(201);
  });

  it('turning «she comes» on lets her rows in again', async () => {
    await h
      .as('admin')
      .patch(`/special-events/${alone}`, { coWifeComes: true })
      .expect(200);
    await h
      .as('wpelder')
      .post('/co-visit-items', {
        specialEventId: alone,
        kind: 'field_service',
        itemDate: '2094-02-24',
        startTime: '15:00',
        forWife: true,
      })
      .expect(201);
    await h
      .as('admin')
      .patch(`/special-events/${alone}`, { coWifeComes: false })
      .expect(200);
  });

  it('the assistant sees that a call takes 16:00 — not who goes, not to whom', async () => {
    const elder = cards.wpelder;
    const call = (
      await h.sql<{ id: string }>(
        `SELECT id FROM co_visit_items WHERE special_event_id = $1 AND kind = 'pastoral' AND deleted_at IS NULL`,
        [alone],
      )
    )[0].id;
    await h
      .as('wpelder')
      .patch(`/co-visit-items/${call}`, {
        assigneePublisherId: elder,
        note: 'семья Петровых',
      })
      .expect(200);

    const asElder = await h
      .as('wpelder')
      .get(`/co-visit-items?specialEventId=${alone}`)
      .expect(200);
    const seen = asElder.body.find((i: { id: string }) => i.id === call);
    expect(seen).toMatchObject({
      assigneePublisherId: elder,
      note: 'семья Петровых',
      restricted: false,
    });

    const asAssistant = await h
      .as('wpasst')
      .get(`/co-visit-items?specialEventId=${alone}`)
      .expect(200);
    const masked = asAssistant.body.find((i: { id: string }) => i.id === call);
    expect(masked).toMatchObject({
      kind: 'pastoral',
      itemDate: '2094-02-24',
      restricted: true,
      assigneePublisherId: null,
      assigneeName: null,
      note: null,
    });
    expect(JSON.stringify(asAssistant.body)).not.toContain('Петровых');
    expect(JSON.stringify(asAssistant.body)).not.toContain('Лаптев');

    const reader = await h
      .as('wpasst')
      .get(`/co-visit-items/reader?specialEventId=${alone}`)
      .expect(200);
    expect(reader.body).toEqual({ elder: false });
    expect(
      (await h.as('wpelder').get('/co-visit-items/reader').expect(200)).body,
    ).toEqual({ elder: true });

    // The publishing window: the elder is counted, not named, and his
    // message is not shown.
    const pub = await h
      .as('wpasst')
      .get(`/co-visit-items/publication?specialEventId=${alone}`)
      .expect(200);
    expect(JSON.stringify(pub.body)).not.toContain('Петровых');
    expect(JSON.stringify(pub.body)).not.toContain('Лаптев');
    expect(pub.body.eldersOnly).toBe(1);
    const full = await h
      .as('wpelder')
      .get(`/co-visit-items/publication?specialEventId=${alone}`)
      .expect(200);
    expect(full.body.eldersOnly).toBe(0);
    expect(JSON.stringify(full.body)).toContain('Петровых');

    // Who went on which call is not in the rotation he reads either.
    const stats = await h
      .as('wpasst')
      .get('/co-visit-items/host-stats')
      .expect(200);
    expect(
      stats.body.some((s: { kind: string }) => s.kind === 'pastoral'),
    ).toBe(false);

    // And he may not touch it.
    await h
      .as('wpasst')
      .patch(`/co-visit-items/${call}`, { startTime: '17:00' })
      .expect(403);
    await h.as('wpasst').delete(`/co-visit-items/${call}`).expect(403);
    await h
      .as('wpasst')
      .post('/co-visit-items', {
        specialEventId: alone,
        kind: 'pastoral',
        itemDate: '2094-02-25',
      })
      .expect(403);
    // The other kinds are his to plan, as before.
    await h
      .as('wpasst')
      .post('/co-visit-items', {
        specialEventId: alone,
        kind: 'lunch',
        itemDate: '2094-02-25',
        startTime: '12:15',
      })
      .expect(201);
  });

  it('the migration read the old sign: a name written down means she comes', async () => {
    // A visit row in the old shape, then the migration's own statement.
    const old = (
      await h.sql<{ id: string }>(
        `INSERT INTO special_events (congregation_id, title, type, date, co_wife_name)
         VALUES ($1, 'Визит', 'circuit_overseer_visit', '2095-02-22', ' Анна ') RETURNING id`,
        [tenant],
      )
    )[0].id;
    const none = (
      await h.sql<{ id: string }>(
        `INSERT INTO special_events (congregation_id, title, type, date, co_wife_name)
         VALUES ($1, 'Визит', 'circuit_overseer_visit', '2095-05-24', '  ') RETURNING id`,
        [tenant],
      )
    )[0].id;
    const qr = h.db.createQueryRunner();
    await new CoWifeComes1934000000000().up(qr);
    await qr.release();
    const rows = await h.sql<{ id: string; co_wife_comes: boolean }>(
      `SELECT id, co_wife_comes FROM special_events WHERE id = ANY($1)`,
      [[old, none]],
    );
    expect(
      Object.fromEntries(rows.map((r) => [r.id, r.co_wife_comes])),
    ).toEqual({ [old]: true, [none]: false });
  });
});
