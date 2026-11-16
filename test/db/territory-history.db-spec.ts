import { todayIn } from '../../src/common/congregation-clock';
import { Harness, startHarness } from './harness';
import { RetentionService } from '../../src/retention/retention.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import {
  addDays,
  serviceYearOf,
  serviceYearStart,
} from '../../src/territories/service-year';

/**
 * The S-13 kept by hand (17 November 2026): corrections of who held a
 * territory and when, lines from before the app, handing a territory on
 * through the keeper, the journal of a territory and «Что происходит», the
 * database refusing two lines that lie over each other, and the S-13's
 * names and lines going when their time is past. Real database, real guards.
 */
describe('territory history (real database)', () => {
  let h: Harness;
  let congregationId = '';
  const card: Record<string, string> = {};
  let groupOne = '';
  let territoryId = '';
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
    const person = (firstName: string, appointment = 'publisher') =>
      h.addPublisher({
        firstName,
        lastName: 'Тест',
        gender: 'brother',
        appointment,
        baptismDate: '2001-01-01',
      });
    const user = async (
      login: string,
      role: 'publisher' | 'elder' | 'ministerial_servant',
      firstName: string,
    ) => {
      card[login] = await person(firstName, role);
      return h.addUser({ login, role, publisherId: card[login] });
    };
    const keeper = await user('keeper', 'ministerial_servant', 'Хранитель');
    const overseer = await user('serviceov', 'elder', 'Служебный');
    await user('holder', 'publisher', 'Держатель');
    await user('next', 'publisher', 'Следующий');
    await user('plain', 'publisher', 'Простой');
    card.noApp = await person('Безприложения');
    for (const [userId, type] of [
      [keeper, 'territory_servant'],
      [overseer, 'service_overseer'],
    ]) {
      await h.sql(
        `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, $2, $3)`,
        [congregationId, type, userId],
      );
    }
    const [g1] = await h.sql<{ id: string }>(
      `INSERT INTO service_groups (congregation_id, name) VALUES ($1, 'Группа 1') RETURNING id`,
      [congregationId],
    );
    groupOne = g1.id;
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    const r = await h.as('keeper').post('/territories/import/territories', {
      items: [
        { number: 'B01', geometry: square(7, 51) },
        { number: 'B02', geometry: square(7.01, 51) },
      ],
    });
    expect(r.status).toBe(201);
    territoryId = (
      await h.sql<{ id: string }>(
        `SELECT id FROM territories WHERE number = 'B01'`,
      )
    )[0].id;
    expect((await h.as('keeper').post('/territories/verify')).status).toBe(200);
  });

  afterEach(async () => {
    await h.sql(`DELETE FROM notification_outbox`);
    await h.sql(`DELETE FROM audit_logs WHERE entity_type LIKE 'territory%'`);
    await h.sql(`DELETE FROM territory_street_marks`);
    await h.sql(`DELETE FROM territory_settings`);
    await h.sql(`DELETE FROM territory_assignments`);
    await h.sql(`DELETE FROM territory_shapes`);
    await h.sql(`DELETE FROM territories`);
  });

  const outbox = async (kind: string) =>
    (
      await h.sql<{ user_id: string }>(
        `SELECT user_id FROM notification_outbox WHERE kind = $1`,
        [kind],
      )
    ).map((r) => r.user_id);

  const userOf = async (login: string) =>
    (
      await h.sql<{ id: string }>(
        `SELECT id FROM users WHERE login_name = $1`,
        [login],
      )
    )[0].id;

  const line = async (id: string) =>
    (
      await h.sql<Record<string, unknown>>(
        `SELECT publisher_id, holder_name, for_group_name, transferred,
                assigned_on::text, due_on::text, completed_on::text,
                returned_on::text
           FROM territory_assignments WHERE id = $1`,
        [id],
      )
    )[0];

  const past = (body: object) =>
    h.as('keeper').post(`/territories/${territoryId}/past`, body);
  const past_ = past;

  it('the database refuses two lines that lie over each other; touching days are fine', async () => {
    const insert = (from: string, to: string | null) =>
      h.sql(
        `INSERT INTO territory_assignments
           (congregation_id, territory_id, holder_name, assigned_on, completed_on, method)
         VALUES ($1, $2, 'Кто-то', $3, $4, 'door_to_door')`,
        [congregationId, territoryId, from, to],
      );
    await insert(addDays(today, -60), addDays(today, -30));
    // Starts the day the other ended.
    await insert(addDays(today, -30), addDays(today, -10));
    await expect(
      insert(addDays(today, -40), addDays(today, -35)),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('a line from before the app: previous service year, no notice, never over another line', async () => {
    const r = await past({
      publisherId: card.holder,
      assignedOn: addDays(lastYear, 10),
      end: 'completed',
      endedOn: addDays(lastYear, 90),
    });
    expect(r.status).toBe(201);
    expect(await line(r.body.id)).toMatchObject({
      publisher_id: card.holder,
      completed_on: addDays(lastYear, 90),
    });
    // «Нет в списке»: a name by hand, no card.
    const off = await past({
      holderName: 'Уехавший В.',
      assignedOn: addDays(lastYear, 100),
      end: 'returned',
      endedOn: addDays(lastYear, 120),
    });
    expect(off.status).toBe(201);
    expect(await line(off.body.id)).toMatchObject({
      publisher_id: null,
      holder_name: 'Уехавший В.',
      returned_on: addDays(lastYear, 120),
    });
    // Before the previous service year: the S-13 keeps no names there.
    const old = await past({
      publisherId: card.holder,
      assignedOn: addDays(lastYear, -5),
      end: 'completed',
      endedOn: addDays(lastYear, 5),
    });
    expect(old.status).toBe(400);
    expect(old.body.code).toBe('TERRITORY_PAST_YEAR');
    // Over the first line.
    const over = await past({
      publisherId: card.next,
      assignedOn: addDays(lastYear, 50),
      end: 'completed',
      endedOn: addDays(lastYear, 60),
    });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('TERRITORY_OVERLAP');
    // Still in someone's hands needs a card.
    const openOff = await past({
      holderName: 'Кто-то',
      assignedOn: addDays(today, -3),
      end: 'open',
    });
    expect(openOff.status).toBe(400);
    expect(await outbox('territory_assigned')).toEqual([]);
    // Ordinary publishers and the service committee do not write.
    expect(
      (
        await h.as('serviceov').post(`/territories/${territoryId}/past`, {
          publisherId: card.holder,
          assignedOn: addDays(today, -3),
          end: 'open',
        })
      ).status,
    ).toBe(403);
  });

  it('a correction changes who held it; the holder of a territory in hand is told, the past tells nobody', async () => {
    const ended = await past({
      publisherId: card.holder,
      assignedOn: addDays(lastYear, 10),
      end: 'completed',
      endedOn: addDays(lastYear, 40),
    });
    // The previous service year can be corrected now.
    const toName = await h
      .as('keeper')
      .patch(`/territories/assignments/${ended.body.id}`, {
        holderName: 'Ткач Н.',
        completedOn: addDays(lastYear, 45),
      });
    expect(toName.status).toBe(200);
    expect(await line(ended.body.id)).toMatchObject({
      publisher_id: null,
      holder_name: 'Ткач Н.',
      completed_on: addDays(lastYear, 45),
    });
    // Back to a card, for the group.
    const toGroup = await h
      .as('keeper')
      .patch(`/territories/assignments/${ended.body.id}`, {
        publisherId: card.next,
        forGroupId: groupOne,
      });
    expect(toGroup.status).toBe(200);
    expect(await line(ended.body.id)).toMatchObject({
      publisher_id: card.next,
      for_group_name: 'Группа 1',
    });
    expect(await outbox('territory_assigned')).toEqual([]);
    // Saved with nothing changed: no line in the journal.
    const corrections = async () =>
      (
        await h.as('keeper').get(`/territories/history?filter=fixes`)
      ).body.items.filter((i: { kind: string }) => i.kind === 'corrected')
        .length;
    const n = await corrections();
    expect(
      (
        await h
          .as('keeper')
          .patch(`/territories/assignments/${ended.body.id}`, {
            publisherId: card.next,
          })
      ).status,
    ).toBe(200);
    expect(await corrections()).toBe(n);

    const given = await h
      .as('keeper')
      .post(`/territories/${territoryId}/assign`, { publisherId: card.holder });
    expect(given.status).toBe(201);
    await h.sql(`DELETE FROM notification_outbox`);
    const swap = await h
      .as('keeper')
      .patch(`/territories/assignments/${given.body.id}`, {
        publisherId: card.next,
      });
    expect(swap.status).toBe(200);
    expect(await outbox('territory_assigned')).toEqual([await userOf('next')]);
    // A territory in hand cannot be held by a name by hand.
    const off = await h
      .as('keeper')
      .patch(`/territories/assignments/${given.body.id}`, {
        holderName: 'Кто-то',
      });
    expect(off.status).toBe(400);
    // Moving a date over another line is refused in words the screen knows.
    const over = await h
      .as('keeper')
      .patch(`/territories/assignments/${given.body.id}`, {
        assignedOn: addDays(lastYear, 20),
      });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('TERRITORY_OVERLAP');
  });

  it('handed on to someone else: «передан», the walk goes with it, both are told', async () => {
    const given = await h
      .as('keeper')
      .post(`/territories/${territoryId}/assign`, {
        publisherId: card.holder,
        assignedOn: addDays(today, -10),
      });
    expect(given.status).toBe(201);
    await h.sql(
      `INSERT INTO territory_street_marks (congregation_id, assignment_id, street_key, homes, marked_at)
       VALUES ($1, $2, 'musterstrasse', '[]'::jsonb, now())`,
      [congregationId, given.body.id],
    );
    await h.sql(`DELETE FROM notification_outbox`);
    const due = addDays(today, 120);
    const r = await h
      .as('keeper')
      .post(`/territories/assignments/${given.body.id}/transfer`, {
        toPublisherId: card.next,
        dueOn: due,
      });
    expect(r.status).toBe(201);
    expect(await line(given.body.id)).toMatchObject({
      returned_on: today,
      transferred: true,
    });
    expect(await line(r.body.id)).toMatchObject({
      publisher_id: card.next,
      assigned_on: today,
      due_on: due,
    });
    const marks = await h.sql<{ assignment_id: string }>(
      `SELECT assignment_id FROM territory_street_marks`,
    );
    expect(marks.map((m) => m.assignment_id)).toEqual([r.body.id]);
    expect(await outbox('territory_assigned')).toEqual([await userOf('next')]);
    expect(await outbox('territory_transferred')).toEqual([
      await userOf('holder'),
    ]);
    // Only the keeper hands on.
    expect(
      (
        await h
          .as('next')
          .post(`/territories/assignments/${r.body.id}/transfer`, {
            toPublisherId: card.holder,
          })
      ).status,
    ).toBe(403);
  });

  it('the journal of a territory and «Что происходит»: who did what, to whom; the committee sees, publishers do not', async () => {
    await past({
      holderName: 'Ткач Н.',
      assignedOn: addDays(lastYear, 10),
      end: 'completed',
      endedOn: addDays(lastYear, 40),
    });
    const given = await h
      .as('keeper')
      .post(`/territories/${territoryId}/assign`, {
        publisherId: card.holder,
        assignedOn: addDays(today, -5),
      });
    const b02 = (
      await h.sql<{ id: string }>(
        `SELECT id FROM territories WHERE number = 'B02'`,
      )
    )[0].id;
    await h
      .as('keeper')
      .post(`/territories/${b02}/assign`, { publisherId: card.plain });
    await h
      .as('keeper')
      .post(`/territories/assignments/${given.body.id}/transfer`, {
        toPublisherId: card.next,
      });

    type Item = {
      kind: string;
      number: string | null;
      holder: string | null;
      fromHolder: string | null;
      actor: string | null;
    };
    const feed = await h.as('serviceov').get('/territories/history');
    expect(feed.status).toBe(200);
    const kinds = (feed.body.items as Item[]).map(
      (i) => `${i.kind} ${i.number}`,
    );
    expect(kinds).toEqual([
      'transferred B01',
      'given B02',
      'given B01',
      'past B01',
    ]);
    const moved = (feed.body.items as Item[])[0];
    expect(moved).toMatchObject({
      holder: 'Тест Следующий',
      fromHolder: 'Тест Держатель',
      actor: 'Тест Хранитель',
    });

    const one = await h
      .as('keeper')
      .get(`/territories/history?territoryId=${territoryId}`);
    expect((one.body.items as Item[]).map((i) => i.kind)).toEqual([
      'transferred',
      'given',
      'past',
    ]);
    const fixes = await h.as('keeper').get(`/territories/history?filter=fixes`);
    expect((fixes.body.items as Item[]).map((i) => i.holder)).toEqual([
      'Ткач Н.',
    ]);
    // Paging: one at a time reaches the end.
    const p1 = await h.as('keeper').get('/territories/history?limit=1');
    expect(p1.body.items).toHaveLength(1);
    const p2 = await h
      .as('keeper')
      .get(`/territories/history?limit=1&before=${p1.body.nextCursor}`);
    expect(p2.body.items[0].kind).toBe('given');

    expect((await h.as('plain').get('/territories/history')).status).toBe(403);

    // The re-cutting: the draft's own work stays out, a hold shows on its
    // territory.
    const audit = h.app.get(AuditLogService);
    await audit.logFact({
      tenantId: congregationId,
      entityType: 'territory',
      entityId: congregationId,
      action: 'UPDATE',
      actorUserId: null,
      detail: { recut: 'proposal', kind: 'join' },
    });
    await audit.logFact({
      tenantId: congregationId,
      entityType: 'territory',
      entityId: territoryId,
      action: 'UPDATE',
      actorUserId: null,
      detail: { recut: 'held', number: 'B01' },
    });
    const withHold = await h
      .as('keeper')
      .get(`/territories/history?territoryId=${territoryId}`);
    expect((withHold.body.items as Item[]).map((i) => i.kind)).toEqual([
      'territory',
      'transferred',
      'given',
      'past',
    ]);
    const all = await h.as('keeper').get('/territories/history');
    expect(
      (all.body.items as Item[]).filter((i) => i.kind === 'territory'),
    ).toHaveLength(1);
  });

  it('review 17.11: an import with overlapping lines is refused in words, not a 500', async () => {
    await h.sql(`DELETE FROM territory_settings`);
    const r = await h.as('keeper').post('/territories/import/assignments', {
      items: [
        {
          number: 'B01',
          holderName: 'Первый П.',
          assignedOn: addDays(today, -60),
          completedOn: addDays(today, -30),
        },
        {
          number: 'B01',
          holderName: 'Второй П.',
          assignedOn: addDays(today, -40),
          completedOn: addDays(today, -20),
        },
      ],
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('TERRITORY_OVERLAP');
  });

  it('review 17.11: a deleted group, a removed card, a share link, a same-day chain, marks back on removal', async () => {
    // A line held for a group that is then deleted can still be handed on.
    const given = await h
      .as('keeper')
      .post(`/territories/${territoryId}/assign`, {
        publisherId: card.holder,
        forGroupId: groupOne,
        assignedOn: addDays(today, -20),
      });
    expect(given.status).toBe(201);
    // A link without login, then the holder corrected: the link is his, it goes.
    expect(
      (
        await h
          .as('keeper')
          .post(`/territories/assignments/${given.body.id}/share-link`)
      ).status,
    ).toBe(200);
    expect(
      (
        await h
          .as('keeper')
          .patch(`/territories/assignments/${given.body.id}`, {
            publisherId: card.plain,
          })
      ).status,
    ).toBe(200);
    const [linked] = await h.sql<{ link_hash: string | null }>(
      `SELECT link_hash FROM territory_assignments WHERE id = $1`,
      [given.body.id],
    );
    expect(linked.link_hash).toBeNull();
    await h.sql(`UPDATE service_groups SET deleted_at = now() WHERE id = $1`, [
      groupOne,
    ]);
    await h.sql(
      `INSERT INTO territory_street_marks (congregation_id, assignment_id, street_key, homes, marked_at)
       VALUES ($1, $2, 'musterstrasse', '[]'::jsonb, now())`,
      [congregationId, given.body.id],
    );
    const on = addDays(today, -10);
    const moved = await h
      .as('keeper')
      .post(`/territories/assignments/${given.body.id}/transfer`, {
        toPublisherId: card.next,
        on,
      });
    expect(moved.status).toBe(201);
    expect(await line(moved.body.id)).toMatchObject({
      for_group_name: 'Группа 1',
    });
    // Handed on again the same day, then back the next day.
    const again = await h
      .as('keeper')
      .post(`/territories/assignments/${moved.body.id}/transfer`, {
        toPublisherId: card.holder,
        on,
      });
    expect(again.status).toBe(201);
    expect(
      (
        await h
          .as('keeper')
          .post(`/territories/assignments/${again.body.id}/return`, {
            returnedOn: addDays(today, -5),
          })
      ).status,
    ).toBe(200);
    // Given out on a day inside the chain: refused in words.
    const into = await h
      .as('keeper')
      .post(`/territories/${territoryId}/assign`, {
        publisherId: card.plain,
        assignedOn: addDays(today, -7),
      });
    expect(into.status).toBe(400);
    expect(into.body.code).toBe('TERRITORY_DATES');
    await h.sql(`UPDATE service_groups SET deleted_at = NULL WHERE id = $1`, [
      groupOne,
    ]);

    // The second hand-on was a mistake: removing it gives the marks back.
    // (The return wiped the marks of `again`; put one there to follow.)
    await h.sql(
      `INSERT INTO territory_street_marks (congregation_id, assignment_id, street_key, homes, marked_at)
       VALUES ($1, $2, 'other', '[]'::jsonb, now())`,
      [congregationId, again.body.id],
    );
    expect(
      (await h.as('keeper').delete(`/territories/assignments/${again.body.id}`))
        .status,
    ).toBe(200);
    const marks = await h.sql<{ assignment_id: string }>(
      `SELECT assignment_id FROM territory_street_marks WHERE street_key = 'other'`,
    );
    expect(marks.map((m) => m.assignment_id)).toEqual([moved.body.id]);

    // Only the group changed on a line whose card was removed since: allowed,
    // and the name stays as written.
    const past = await past_({
      publisherId: card.noApp,
      assignedOn: addDays(lastYear, 10),
      end: 'completed',
      endedOn: addDays(lastYear, 30),
    });
    await h.sql(`UPDATE publishers SET removed_at = now() WHERE id = $1`, [
      card.noApp,
    ]);
    const regroup = await h
      .as('keeper')
      .patch(`/territories/assignments/${past.body.id}`, {
        publisherId: card.noApp,
        forGroupId: groupOne,
      });
    expect(regroup.status).toBe(200);
    expect(await line(past.body.id)).toMatchObject({
      holder_name: 'Тест Безприложения',
      for_group_name: 'Группа 1',
    });
    await h.sql(`UPDATE publishers SET removed_at = NULL WHERE id = $1`, [
      card.noApp,
    ]);
  });

  it('review 17.11: names the S-13 has let go show as «—» in the journal too', async () => {
    const audit = h.app.get(AuditLogService);
    const oldEnd = addDays(lastYear, -20);
    await audit.logFact({
      tenantId: congregationId,
      entityType: 'territory_assignment',
      entityId: congregationId,
      action: 'DELETE',
      actorUserId: null,
      detail: {
        territoryId,
        number: 'B01',
        holder: 'Давний Д.',
        assignedOn: addDays(oldEnd, -30),
        completedOn: oldEnd,
      },
    });
    const r = await h
      .as('keeper')
      .get(`/territories/history?territoryId=${territoryId}`);
    expect(r.body.items[0]).toMatchObject({ kind: 'removed', holder: '—' });
    expect(JSON.stringify(r.body.items[0])).not.toContain('Давний');
  });

  it('the S-13 lets go of names after the previous service year and of lines after five; last worked stays', async () => {
    const named = addDays(lastYear, -10);
    const ancient = addDays(serviceYearStart(serviceYearOf(today) - 5), -10);
    const [a] = await h.sql<{ id: string }>(
      `INSERT INTO territory_assignments
         (congregation_id, territory_id, publisher_id, holder_name, assigned_on, completed_on, method)
       VALUES ($1, $2, $3, 'Тест Держатель', $4, $5, 'door_to_door') RETURNING id`,
      [congregationId, territoryId, card.holder, addDays(named, -30), named],
    );
    const [gone] = await h.sql<{ id: string }>(
      `INSERT INTO territory_assignments
         (congregation_id, territory_id, holder_name, assigned_on, completed_on, method)
       VALUES ($1, $2, 'Давний', $3, $4, 'door_to_door') RETURNING id`,
      [congregationId, territoryId, addDays(ancient, -30), ancient],
    );
    // Held for years: never touched.
    const b02 = (
      await h.sql<{ id: string }>(
        `SELECT id FROM territories WHERE number = 'B02'`,
      )
    )[0].id;
    const [held] = await h.sql<{ id: string }>(
      `INSERT INTO territory_assignments
         (congregation_id, territory_id, publisher_id, holder_name, assigned_on)
       VALUES ($1, $2, $3, 'Тест Простой', $4) RETURNING id`,
      [congregationId, b02, card.plain, addDays(ancient, -30)],
    );
    // A recent line that stays named.
    const [kept] = await h.sql<{ id: string }>(
      `INSERT INTO territory_assignments
         (congregation_id, territory_id, publisher_id, holder_name, assigned_on, completed_on, method)
       VALUES ($1, $2, $3, 'Тест Следующий', $4, $5, 'door_to_door') RETURNING id`,
      [
        congregationId,
        territoryId,
        card.next,
        addDays(lastYear, 5),
        addDays(lastYear, 20),
      ],
    );
    await h.sql(
      `UPDATE territories SET last_completed_on = NULL WHERE id = $1`,
      [territoryId],
    );

    const retention = h.app.get(RetentionService);
    const preview = await retention.preview(congregationId);
    expect(preview.find((r) => r.key === 'territory-names')).toMatchObject({
      count: 2,
      on: true,
    });
    expect(await retention.applyCounted(congregationId)).toEqual({
      'territory-names': 2,
      'territory-lines': 1,
    });
    expect(await line(a.id)).toMatchObject({
      publisher_id: null,
      holder_name: '—',
      completed_on: named,
    });
    expect(
      await h.sql(`SELECT id FROM territory_assignments WHERE id = $1`, [
        gone.id,
      ]),
    ).toEqual([]);
    const [t] = await h.sql<{ last_completed_on: string }>(
      `SELECT last_completed_on::text FROM territories WHERE id = $1`,
      [territoryId],
    );
    // The deleted line's worked day moved onto the territory before it went.
    expect(t.last_completed_on).toBe(ancient);
    expect(await line(held.id)).toMatchObject({ holder_name: 'Тест Простой' });
    expect(await line(kept.id)).toMatchObject({
      holder_name: 'Тест Следующий',
    });
    // A second night does nothing.
    expect(await retention.applyCounted(congregationId)).toEqual({
      'territory-names': 0,
      'territory-lines': 0,
    });
  });
});
