import { todayIn } from '../../src/common/congregation-clock';
import { Harness, startHarness } from './harness';
import { RetentionService } from '../../src/retention/retention.service';
import {
  addDays,
  serviceYearOf,
  serviceYearStart,
} from '../../src/territories/service-year';

/**
 * Step 2 of the territory history (17 November 2026, «Организованы…»
 * ch. 9 §31–34): a territory is the holder's duty — he reports it worked and
 * keeps it or gives it back; returning it unworked is the keepers' decision
 * (the service overseer among them); a personal territory is asked of the
 * keepers; the coverage of the whole territory; the congregation's boundary
 * is the branch's. Real database, real guards.
 */
describe('territory duty (real database)', () => {
  let h: Harness;
  let congregationId = '';
  const card: Record<string, string> = {};
  const userId: Record<string, string> = {};
  let territoryId = '';
  let otherId = '';
  const today = todayIn(new Date(), 'Europe/Berlin');
  const lastYear = serviceYearStart(serviceYearOf(today) - 1);

  const square = (x: number, y: number) => ({
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x + 0.01, y],
        [x + 0.01, y + 0.01],
        [x, y + 0.01],
        [x, y],
      ],
    ],
  });

  beforeAll(async () => {
    h = await startHarness();
    const [c] = await h.sql<{ id: string }>(`SELECT id FROM congregations`);
    congregationId = c.id;
    const user = async (
      login: string,
      role: 'publisher' | 'elder' | 'ministerial_servant',
      firstName: string,
    ) => {
      card[login] = await h.addPublisher({
        firstName,
        lastName: 'Тест',
        gender: 'brother',
        appointment: role,
        baptismDate: '2001-01-01',
      });
      userId[login] = await h.addUser({
        login,
        role,
        publisherId: card[login],
      });
    };
    await user('keeper', 'ministerial_servant', 'Хранитель');
    await user('serviceov', 'elder', 'Служебный');
    await user('coord', 'elder', 'Координатор');
    await user('holder', 'publisher', 'Держатель');
    await user('asker', 'publisher', 'Просящий');
    for (const [login, type] of [
      ['keeper', 'territory_servant'],
      ['serviceov', 'service_overseer'],
      ['coord', 'body_coordinator'],
    ]) {
      await h.sql(
        `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, $2, $3)`,
        [congregationId, type, userId[login]],
      );
    }
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    const r = await h.as('keeper').post('/territories/import/territories', {
      items: [
        { number: 'D01', geometry: square(7, 51) },
        { number: 'D02', geometry: square(7.02, 51) },
      ],
    });
    expect(r.status).toBe(201);
    const rows = await h.sql<{ id: string; number: string }>(
      `SELECT id, number FROM territories ORDER BY number`,
    );
    territoryId = rows[0].id;
    otherId = rows[1].id;
    await h.as('keeper').post('/territories/import/boundary', {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [6.9, 50.9],
            [7.1, 50.9],
            [7.1, 51.1],
            [6.9, 51.1],
            [6.9, 50.9],
          ],
        ],
      },
    });
    expect((await h.as('keeper').post('/territories/verify')).status).toBe(200);
  });

  afterEach(async () => {
    await h.sql(`DELETE FROM notification_outbox`);
    await h.sql(`DELETE FROM territory_requests`);
    await h.sql(`DELETE FROM map_houses`);
    await h.sql(`DELETE FROM territory_street_marks`);
    await h.sql(`DELETE FROM territory_settings`);
    await h.sql(`DELETE FROM territory_assignments`);
    await h.sql(`DELETE FROM territory_boundaries`);
    await h.sql(`DELETE FROM territory_shapes`);
    await h.sql(`DELETE FROM territories`);
  });

  const outbox = async (kind: string) =>
    (
      await h.sql<{ user_id: string }>(
        `SELECT user_id FROM notification_outbox WHERE kind = $1 ORDER BY user_id`,
        [kind],
      )
    ).map((r) => r.user_id);

  const give = (login: string, body: object) =>
    h.as(login).post(`/territories/${territoryId}/assign`, body);

  it("the holder reports it worked and keeps it or gives it back; returning it unworked is the keepers'", async () => {
    const given = await give('keeper', {
      publisherId: card.holder,
      assignedOn: addDays(today, -30),
    });
    expect(given.status).toBe(201);
    // Not the holder: only after a word with the keepers.
    const back = await h
      .as('holder')
      .post(`/territories/assignments/${given.body.id}/return`, {});
    expect(back.status).toBe(403);
    expect(back.body.code).toBe('TERRITORY_ASK_KEEPER');
    // Worked and kept for working again: a new line from the same day.
    const done = await h
      .as('holder')
      .post(`/territories/assignments/${given.body.id}/complete`, {
        again: true,
        method: 'door_to_door',
      });
    expect(done.status).toBe(200);
    const lines = await h.sql<{
      id: string;
      publisher_id: string;
      assigned_on: string;
      due_on: string;
      completed_on: string | null;
    }>(
      `SELECT id, publisher_id, assigned_on::text, due_on::text, completed_on::text
         FROM territory_assignments ORDER BY created_at`,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].completed_on).toBe(today);
    expect(lines[1]).toMatchObject({
      id: done.body.id,
      publisher_id: card.holder,
      assigned_on: today,
      due_on: addDays(today, 120),
      completed_on: null,
    });
    // The service overseer has the keepers' rights: he takes it back.
    const taken = await h
      .as('serviceov')
      .post(`/territories/assignments/${done.body.id}/return`, {});
    expect(taken.status).toBe(200);
  });

  it('«Мои участки»: own past lines, how far it is worked, the servant to talk to', async () => {
    await h.as('keeper').post(`/territories/${otherId}/past`, {
      publisherId: card.holder,
      assignedOn: addDays(lastYear, 10),
      end: 'completed',
      endedOn: addDays(lastYear, 40),
    });
    const given = await give('keeper', {
      publisherId: card.holder,
      assignedOn: addDays(today, -10),
    });
    // Four homes inside, one outside; two walked.
    for (const [id, lon] of [
      [1, 7.002],
      [2, 7.004],
      [3, 7.006],
      [4, 7.008],
      [5, 7.5],
    ] as const) {
      await h.sql(
        `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2, home)
         VALUES ($1, $2, $3, 51.005, 120, true)`,
        [congregationId, id, lon],
      );
    }
    await h.sql(
      `INSERT INTO territory_street_marks (congregation_id, assignment_id, street_key, homes, marked_at)
       VALUES ($1, $2, 'a', '["1","2","5"]'::jsonb, now())`,
      [congregationId, given.body.id],
    );
    expect((await h.as('asker').get('/territories/access')).body.mayAsk).toBe(
      true,
    );
    const me = await h.as('holder').get('/territories/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      mayAsk: true,
      keeper: 'Тест Хранитель',
      request: null,
      overdue: [],
      progress: { [territoryId]: 50 },
    });
    expect(me.body.past).toEqual([
      expect.objectContaining({
        number: 'D02',
        completedOn: addDays(lastYear, 40),
      }),
    ]);
  });

  it('«Попросить участок»: to the keepers, once; not while one is overdue; answered by giving or «not now»', async () => {
    const asked = await h.as('asker').post('/territories/requests', {});
    expect(asked.status).toBe(201);
    const again = await h.as('asker').post('/territories/requests', {});
    expect(again.body.id).toBe(asked.body.id);
    // The keepers are told — the servant and the service overseer, not the coordinator.
    expect(await outbox('territory_request')).toEqual(
      [userId.keeper, userId.serviceov].sort(),
    );
    const desk = await h.as('keeper').get('/territories/desk');
    expect(desk.body.requests).toEqual([
      expect.objectContaining({ id: asked.body.id, publisherId: card.asker }),
    ]);
    // «Not now»: closed, he is told.
    expect(
      (
        await h
          .as('keeper')
          .post(`/territories/requests/${asked.body.id}/not-now`, {})
      ).status,
    ).toBe(201);
    expect(await outbox('territory_request_answer')).toEqual([userId.asker]);
    // Asks again, is given a territory: the request closes itself.
    const second = await h.as('asker').post('/territories/requests', {});
    expect(second.body.id).not.toBe(asked.body.id);
    const givenToAsker = await give('keeper', { publisherId: card.asker });
    expect(givenToAsker.status).toBe(201);
    const [closed] = await h.sql<{ closed_how: string }>(
      `SELECT closed_how FROM territory_requests WHERE id = $1`,
      [second.body.id],
    );
    expect(closed.closed_how).toBe('given');
    // That territory is now overdue: no new request until it is done.
    await h.sql(`UPDATE territory_assignments SET due_on = $1 WHERE id = $2`, [
      addDays(today, -1),
      givenToAsker.body.id,
    ]);
    const blocked = await h.as('asker').post('/territories/requests', {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('TERRITORY_ASK_OVERDUE');
    // Ordinary publishers cannot answer.
    const third = await h.as('holder').post('/territories/requests', {});
    expect(
      (
        await h
          .as('asker')
          .post(`/territories/requests/${third.body.id}/not-now`, {})
      ).status,
    ).toBe(403);
    // He may take his request back.
    expect(
      (await h.as('holder').delete('/territories/requests/mine')).body,
    ).toEqual({
      closed: 1,
    });
  });

  it('coverage of the whole territory: held or free alike; two years and longer for the committee', async () => {
    await h.sql(`UPDATE territories SET last_completed_on = $1 WHERE id = $2`, [
      addDays(today, -800),
      otherId,
    ]);
    // D01 held for 400 days, no record of it ever being worked: unknown,
    // counted apart and not reported as «two years».
    const held = await h.as('keeper').post(`/territories/${territoryId}/past`, {
      publisherId: card.holder,
      assignedOn: addDays(today, -400),
      end: 'open',
    });
    expect(held.status).toBe(201);
    const desk = await h.as('keeper').get('/territories/desk');
    expect(desk.body.coverage.residential).toMatchObject({
      total: 2,
      within12: 0,
      overTwo: 1,
      noRecord: 1,
    });
    const long = await h.as('coord').get('/territories/coverage/long');
    expect(long.status).toBe(200);
    expect(long.body.items.map((i: { number: string }) => i.number)).toEqual([
      'D02',
    ]);
    expect(long.body.items[0].lastWorkedOn).toBe(addDays(today, -800));
    expect(long.body.items[0].heldSince).toBeNull();
    expect(long.body.noRecord).toBe(1);
    // Held for 800 days and worked before that: in the list, with since when.
    await h.sql(`UPDATE territories SET last_completed_on = $1 WHERE id = $2`, [
      addDays(today, -900),
      territoryId,
    ]);
    await h.sql(
      `UPDATE territory_assignments SET assigned_on = $1 WHERE territory_id = $2 AND completed_on IS NULL AND returned_on IS NULL`,
      [addDays(today, -800), territoryId],
    );
    const both = await h.as('coord').get('/territories/coverage/long');
    expect(both.body.items.map((i: { number: string }) => i.number)).toEqual([
      'D01',
      'D02',
    ]);
    expect(both.body.items[0].heldSince).toBe(addDays(today, -800));
    expect(both.body.noRecord).toBe(0);
    expect(
      (await h.as('holder').get('/territories/coverage/long')).status,
    ).toBe(403);
    const summary = await h.as('coord').get('/territories/summary');
    expect(summary.body.idle).toBe(2);
  });

  it("the boundary is the branch's: the S-54 date, a new file only with it, a preview first", async () => {
    expect(
      (
        await h
          .as('keeper')
          .patch('/territories/boundary/s54', { s54On: '2019-03-12' })
      ).status,
    ).toBe(200);
    const small = {
      type: 'Polygon',
      coordinates: [
        [
          [6.9, 50.9],
          [7.015, 50.9],
          [7.015, 51.1],
          [6.9, 51.1],
          [6.9, 50.9],
        ],
      ],
    };
    const preview = await h
      .as('keeper')
      .post('/territories/boundary/preview', { geometry: small });
    expect(preview.body.outside).toEqual(['D02']);
    // Drawn along the border: D01's east side IS the new border — not outside.
    const edge = {
      type: 'Polygon',
      coordinates: [
        [
          [6.9, 50.9],
          [7.01, 50.9],
          [7.01, 51.1],
          [6.9, 51.1],
          [6.9, 50.9],
        ],
      ],
    };
    expect(
      (
        await h
          .as('keeper')
          .post('/territories/boundary/preview', { geometry: edge })
      ).body.outside,
    ).toEqual(['D02']);
    // A form is not dated ahead, nor before the one in force.
    for (const s54On of [addDays(today, 1), '2019-03-11']) {
      const wrong = await h
        .as('keeper')
        .post('/territories/boundary/replace', { geometry: small, s54On });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('TERRITORY_BOUNDARY_S54_DATE');
    }
    const noDate = await h
      .as('keeper')
      .post('/territories/boundary/replace', { geometry: small });
    expect(noDate.status).toBe(400);
    expect(noDate.body.code).toBe('TERRITORY_BOUNDARY_S54');
    expect(
      (
        await h.as('holder').post('/territories/boundary/replace', {
          geometry: small,
          s54On: '2026-11-05',
        })
      ).status,
    ).toBe(403);
    const done = await h.as('keeper').post('/territories/boundary/replace', {
      geometry: small,
      s54On: '2026-11-05',
      description: { north: 'Fluss', south: 'Bahn' },
    });
    expect(done.status).toBe(201);
    const [kept] = await h.sql<{ description: Record<string, string> }>(
      `SELECT description FROM territory_boundaries WHERE id = $1`,
      [done.body.id],
    );
    expect(kept.description).toEqual({ north: 'Fluss', south: 'Bahn' });
    const b = await h.as('keeper').get('/territories/boundary');
    expect(b.body).toMatchObject({ id: done.body.id, s54On: '2026-11-05' });
    expect(await h.sql(`SELECT id FROM territory_boundaries`)).toHaveLength(2);
  });

  it('review 17.11: a request only from whom a territory can be given; answered however one of his own reaches him', async () => {
    const [g] = await h.sql<{ id: string }>(
      `INSERT INTO service_groups (congregation_id, name, overseer_publisher_id)
       VALUES ($1, 'Группа D', $2) RETURNING id`,
      [congregationId, card.asker],
    );
    try {
      const asked = await h.as('asker').post('/territories/requests', {});
      expect(asked.status).toBe(201);
      const pushes = (await outbox('territory_request')).length;
      // A territory for his group is not his own: the request stays open,
      // and the group's overdue territory does not stand in his way.
      const forGroup = await give('keeper', {
        publisherId: card.asker,
        forGroupId: g.id,
        assignedOn: addDays(today, -30),
      });
      expect(forGroup.status).toBe(201);
      await h.sql(
        `UPDATE territory_assignments SET due_on = $1 WHERE id = $2`,
        [addDays(today, -1), forGroup.body.id],
      );
      const me = await h.as('asker').get('/territories/me');
      expect(me.body.overdue).toEqual([]);
      expect(me.body.request?.id).toBe(asked.body.id);
      // Withdrawn and asked again the same day: on the list, no new ring.
      await h.as('asker').delete('/territories/requests/mine');
      const again = await h.as('asker').post('/territories/requests', {});
      expect(again.status).toBe(201);
      expect((await outbox('territory_request')).length).toBe(pushes);
      // «Мои данные» lists his own requests, and how each closed.
      const exported = await h.as('asker').get('/me/export');
      expect(
        (exported.body.territoryRequests as { closedHow: string | null }[]).map(
          (r) => r.closedHow,
        ),
      ).toEqual(['cancelled', null]);
      expect(JSON.stringify(exported.body.territoryRequests)).not.toContain(
        userId.asker,
      );
      const desk = await h.as('keeper').get('/territories/desk');
      expect(desk.body.requests).toEqual([
        expect.objectContaining({
          id: again.body.id,
          publisherId: card.asker,
          askedOn: today,
        }),
      ]);
      // Handed on to him: his request is answered.
      const toHolder = await h
        .as('keeper')
        .post(`/territories/${otherId}/assign`, {
          publisherId: card.holder,
          assignedOn: addDays(today, -10),
        });
      expect(toHolder.status).toBe(201);
      const handed = await h
        .as('keeper')
        .post(`/territories/assignments/${toHolder.body.id}/transfer`, {
          toPublisherId: card.asker,
        });
      expect(handed.status).toBe(201);
      const [answered] = await h.sql<{ closed_how: string }>(
        `SELECT closed_how FROM territory_requests WHERE id = $1`,
        [again.body.id],
      );
      expect(answered.closed_how).toBe('given');
      // An inactive card: no request, and an earlier one is not shown to
      // the keepers nor to him — none of them could answer it.
      const holderAsks = await h.as('holder').post('/territories/requests', {});
      expect(holderAsks.status).toBe(201);
      await h.sql(`UPDATE publishers SET status = 'inactive' WHERE id = $1`, [
        card.holder,
      ]);
      const mine = await h.as('holder').get('/territories/me');
      expect(mine.body).toMatchObject({ mayAsk: false, request: null });
      expect(
        (await h.as('keeper').get('/territories/desk')).body.requests,
      ).toEqual([]);
      const refused = await h.as('holder').post('/territories/requests', {});
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('PERSON_NOT_ASSIGNABLE');
    } finally {
      await h.sql(`UPDATE publishers SET status = 'active' WHERE id = $1`, [
        card.holder,
      ]);
      await h.sql(`DELETE FROM territory_assignments`);
      await h.sql(`DELETE FROM service_groups WHERE id = $1`, [g.id]);
    }
  });

  it('review 17.11: kept again only by a card that can hold one; pressed twice is a refusal, not an error', async () => {
    const given = await give('keeper', {
      publisherId: card.holder,
      assignedOn: addDays(today, -30),
    });
    const twice = await Promise.all(
      [0, 1].map(() =>
        h
          .as('holder')
          .post(`/territories/assignments/${given.body.id}/complete`, {
            again: true,
          }),
      ),
    );
    expect(twice.map((r) => r.status).sort()).toEqual([200, 409]);
    const open = await h.sql(
      `SELECT id FROM territory_assignments WHERE completed_on IS NULL AND returned_on IS NULL`,
    );
    expect(open).toHaveLength(1);
    try {
      await h.sql(`UPDATE publishers SET status = 'inactive' WHERE id = $1`, [
        card.holder,
      ]);
      const [line] = open as { id: string }[];
      const no = await h
        .as('keeper')
        .post(`/territories/assignments/${line.id}/complete`, { again: true });
      expect(no.status).toBe(400);
      expect(no.body.code).toBe('PERSON_NOT_ASSIGNABLE');
      const [still] = await h.sql<{ completed_on: string | null }>(
        `SELECT completed_on::text FROM territory_assignments WHERE id = $1`,
        [line.id],
      );
      expect(still.completed_on).toBeNull();
    } finally {
      await h.sql(`UPDATE publishers SET status = 'active' WHERE id = $1`, [
        card.holder,
      ]);
    }
  });

  it('closed requests go after 30 days', async () => {
    const asked = await h.as('asker').post('/territories/requests', {});
    await h.sql(
      `UPDATE territory_requests SET closed_at = now() - interval '31 days', closed_how = 'cancelled' WHERE id = $1`,
      [asked.body.id],
    );
    const fresh = await h.as('holder').post('/territories/requests', {});
    await h.sql(
      `UPDATE territory_requests SET closed_at = now() - interval '5 days', closed_how = 'cancelled' WHERE id = $1`,
      [fresh.body.id],
    );
    const done = await h.app.get(RetentionService).applyCounted(congregationId);
    expect(done['territory-requests']).toBe(1);
    expect(await h.sql(`SELECT id FROM territory_requests`)).toEqual([
      { id: fresh.body.id },
    ]);
  });
});
