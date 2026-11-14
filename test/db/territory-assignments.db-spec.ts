import { todayIn } from '../../src/common/congregation-clock';
import { DataSource } from 'typeorm';
import { Harness, startHarness } from './harness';
import { AuditLog } from '../../src/entities/audit-log.entity';
import { TerritoryRemindersService } from '../../src/territories/territory-reminders.service';
import { InactiveHoldsService } from '../../src/tasks/inactive-holds.service';
import {
  addDays,
  addMonths,
  serviceYearOf,
  serviceYearStart,
  TERM_DAYS,
} from '../../src/territories/service-year';

/**
 * Giving territories out and taking them back (11 November 2026), and who
 * sees which territory outside the whole section. Real database, real guards.
 */
describe('territory assignments (real database)', () => {
  let h: Harness;
  let congregationId = '';
  const card: Record<string, string> = {};
  let groupOne = '';
  let territoryId = '';
  // The congregation's own day (Europe/Berlin in the harness), not UTC:
  // between 23:00 and 24:00 UTC the two differ (failed on main, 14 November 2026).
  const today = todayIn(new Date(), 'Europe/Berlin');

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
    const secretary = await user('secretary', 'elder', 'Секретарь');
    await user('holder', 'publisher', 'Держатель');
    await user('overseer', 'elder', 'Старший');
    await user('member', 'publisher', 'Участник');
    await user('stranger', 'publisher', 'Чужой');
    card.inactive = await person('Неактивный');
    for (const [userId, type] of [
      [keeper, 'territory_servant'],
      [secretary, 'secretary'],
    ]) {
      await h.sql(
        `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, $2, $3)`,
        [congregationId, type, userId],
      );
    }
    const [g1] = await h.sql<{ id: string }>(
      `INSERT INTO service_groups (congregation_id, name, overseer_publisher_id)
       VALUES ($1, 'Группа 1', $2) RETURNING id`,
      [congregationId, card.overseer],
    );
    const [g2] = await h.sql<{ id: string }>(
      `INSERT INTO service_groups (congregation_id, name) VALUES ($1, 'Группа 2') RETURNING id`,
      [congregationId],
    );
    groupOne = g1.id;
    await h.sql(
      `UPDATE publishers SET service_group_id = $1 WHERE id = ANY($2::uuid[])`,
      [g1.id, [card.holder, card.member, card.overseer]],
    );
    await h.sql(`UPDATE publishers SET service_group_id = $1 WHERE id = $2`, [
      g2.id,
      card.stranger,
    ]);
    await h.sql(`UPDATE publishers SET status = 'inactive' WHERE id = $1`, [
      card.inactive,
    ]);
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    const r = await h.as('keeper').post('/territories/import/territories', {
      items: [
        { number: 'A01', geometry: square(7, 51) },
        { number: 'A02', geometry: square(7.01, 51) },
      ],
    });
    expect(r.status).toBe(201);
    await h.as('keeper').post('/territories/import/no-calls', {
      items: [{ number: 'A01', address: 'Musterstraße 1', notedOn: today }],
    });
    const [t] = await h.sql<{ id: string }>(
      `SELECT id FROM territories WHERE number = 'A01'`,
    );
    territoryId = t.id;
  });

  afterEach(async () => {
    await h.sql(`DELETE FROM field_service_meetings`);
    await h.sql(`DELETE FROM notification_outbox`);
    await h.sql(`UPDATE publishers SET removed_at = NULL`);
    await h.sql(`DELETE FROM territory_settings`);
    await h.sql(`DELETE FROM territory_assignments`);
    await h.sql(`DELETE FROM territory_no_calls`);
    await h.sql(`DELETE FROM territory_shapes`);
    await h.sql(`DELETE FROM territories`);
  });

  const verify = async () => {
    expect((await h.as('keeper').post('/territories/verify')).status).toBe(200);
  };

  const giveToHolder = async (forGroupId?: string) => {
    const r = await h.as('keeper').post(`/territories/${territoryId}/assign`, {
      publisherId: card.holder,
      ...(forGroupId ? { forGroupId } : {}),
    });
    expect(r.status).toBe(201);
    return r.body as { id: string; dueOn: string; holderName: string };
  };

  const seen = async (login: string) =>
    (
      (await h.as(login).get('/territories/mine')).body as {
        number: string;
        noCalls: { address: string }[];
        assignment: { mine: boolean };
      }[]
    ).map((t) => t.number);

  it('before the records are confirmed nothing is given out and nobody sees anything', async () => {
    const r = await h
      .as('keeper')
      .post(`/territories/${territoryId}/assign`, { publisherId: card.holder });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TERRITORY_NOT_OPEN');
    expect(await seen('holder')).toEqual([]);
  });

  it('a group territory: the holder, the overseer and the members of that group see it — nobody else', async () => {
    await verify();
    const a = await giveToHolder(groupOne);
    expect(a.holderName).toBe('Тест Держатель');
    expect(a.dueOn).toBe(addDays(today, TERM_DAYS));
    expect(await seen('holder')).toEqual(['A01']);
    expect(await seen('overseer')).toEqual(['A01']);
    expect(await seen('member')).toEqual(['A01']);
    expect(await seen('stranger')).toEqual([]);
    // The «не беспокоить» addresses go with it: these are the people walking it.
    const mine = (await h.as('member').get('/territories/mine')).body;
    expect(mine[0].noCalls[0].address).toBe('Musterstraße 1');
    expect(mine[0].assignment.mine).toBe(false);
    // The whole section stays closed to them.
    expect((await h.as('member').get('/territories')).status).toBe(403);
    expect(
      (await h.as('member').get(`/territories/${territoryId}`)).status,
    ).toBe(403);
  });

  it('a personal territory is seen by its holder alone', async () => {
    await verify();
    await giveToHolder();
    expect(await seen('holder')).toEqual(['A01']);
    expect(await seen('member')).toEqual([]);
    expect(await seen('overseer')).toEqual([]);
    const door = (await h.as('holder').get('/territories/access')).body;
    expect(door.mine).toEqual([
      expect.objectContaining({ number: 'A01', mine: true }),
    ]);
  });

  it('a territory already held is not given twice', async () => {
    await verify();
    await giveToHolder();
    const again = await h
      .as('keeper')
      .post(`/territories/${territoryId}/assign`, { publisherId: card.member });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TERRITORY_HELD');
  });

  it('the committee sees but does not give out', async () => {
    await verify();
    expect((await h.as('secretary').get('/territories')).status).toBe(200);
    const r = await h
      .as('secretary')
      .post(`/territories/${territoryId}/assign`, { publisherId: card.holder });
    expect(r.status).toBe(403);
  });

  it('an inactive publisher is not offered and not accepted', async () => {
    await verify();
    const c = await h
      .as('keeper')
      .get(`/territories/${territoryId}/candidates`);
    expect(c.status).toBe(200);
    const ids = (c.body.people as { publisherId: string }[]).map(
      (p) => p.publisherId,
    );
    expect(ids).toContain(card.holder);
    expect(ids).not.toContain(card.inactive);
    const r = await h.as('keeper').post(`/territories/${territoryId}/assign`, {
      publisherId: card.inactive,
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PERSON_NOT_ASSIGNABLE');
  });

  it('the holder asks once for a month more; then only the territory servant', async () => {
    await verify();
    const a = await giveToHolder();
    const once = await h
      .as('holder')
      .post(`/territories/assignments/${a.id}/extend`, {});
    expect(once.status).toBe(200);
    expect(once.body.dueOn).toBe(addMonths(a.dueOn, 1));
    const twice = await h
      .as('holder')
      .post(`/territories/assignments/${a.id}/extend`, {});
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('TERRITORY_EXTENDED');
    const later = addDays(a.dueOn, 90);
    const keeper = await h
      .as('keeper')
      .post(`/territories/assignments/${a.id}/extend`, { dueOn: later });
    expect(keeper.status).toBe(200);
    expect(keeper.body.dueOn).toBe(later);
  });

  it('an overdue territory is extended a month from today, not from its long-gone day', async () => {
    await verify();
    const a = await giveToHolder();
    await h.sql(
      `UPDATE territory_assignments SET assigned_on = $1, due_on = $2 WHERE id = $3`,
      [addDays(today, -300), addDays(today, -180), a.id],
    );
    const r = await h
      .as('holder')
      .post(`/territories/assignments/${a.id}/extend`, {});
    expect(r.status).toBe(200);
    expect(r.body.dueOn).toBe(addMonths(today, 1));
  });

  it('the holder marks it worked; a group member cannot; worked twice is refused', async () => {
    await verify();
    const a = await giveToHolder(groupOne);
    const member = await h
      .as('member')
      .post(`/territories/assignments/${a.id}/complete`, {});
    expect(member.status).toBe(404);
    const done = await h
      .as('holder')
      .post(`/territories/assignments/${a.id}/complete`, {});
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      completedOn: today,
      method: 'door_to_door',
    });
    expect(await seen('holder')).toEqual([]);
    const again = await h
      .as('keeper')
      .post(`/territories/assignments/${a.id}/complete`, {});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TERRITORY_ENDED');
    const list = (await h.as('keeper').get('/territories')).body as {
      number: string;
      lastCompletedOn: string | null;
      holder: unknown;
    }[];
    expect(list.find((t) => t.number === 'A01')).toMatchObject({
      lastCompletedOn: today,
      holder: null,
    });
  });

  it('handed back without working: free again, and no «worked» date', async () => {
    await verify();
    const a = await giveToHolder();
    const r = await h
      .as('holder')
      .post(`/territories/assignments/${a.id}/return`, {});
    expect(r.status).toBe(200);
    expect(r.body.returnedOn).toBe(today);
    const list = (await h.as('keeper').get('/territories')).body as {
      number: string;
      lastCompletedOn: string | null;
      holder: unknown;
    }[];
    expect(list.find((t) => t.number === 'A01')).toMatchObject({
      lastCompletedOn: null,
      holder: null,
    });
  });

  it('corrections stay inside the current service year', async () => {
    await verify();
    const start = serviceYearStart(serviceYearOf(today));
    const before = addDays(start, -20);
    const [old] = await h.sql<{ id: string }>(
      `INSERT INTO territory_assignments
         (congregation_id, territory_id, holder_name, assigned_on, completed_on, method)
       VALUES ($1, $2, 'Прежний', $3, $4, 'door_to_door') RETURNING id`,
      [congregationId, territoryId, addDays(before, -30), before],
    );
    const edit = await h
      .as('keeper')
      .patch(`/territories/assignments/${old.id}`, { completedOn: start });
    expect(edit.status).toBe(400);
    expect(edit.body.code).toBe('TERRITORY_PAST_YEAR');
    expect(
      (await h.as('keeper').delete(`/territories/assignments/${old.id}`))
        .status,
    ).toBe(400);
    const a = await giveToHolder();
    expect(
      (await h.as('holder').delete(`/territories/assignments/${a.id}`)).status,
    ).toBe(403);
    expect(
      (await h.as('keeper').delete(`/territories/assignments/${a.id}`)).status,
    ).toBe(200);
    expect(await seen('holder')).toEqual([]);
  });
  it('a correction may not lay one line over another of the same territory; end to start the same day is fine', async () => {
    await verify();
    const start = serviceYearStart(serviceYearOf(today));
    const d = (n: number) => addDays(start, n);
    const [first] = await h.sql<{ id: string }>(
      `INSERT INTO territory_assignments
         (congregation_id, territory_id, holder_name, assigned_on, completed_on, method)
       VALUES ($1, $2, 'Первый', $3, $4, 'door_to_door') RETURNING id`,
      [congregationId, territoryId, d(1), d(20)],
    );
    const [second] = await h.sql<{ id: string }>(
      `INSERT INTO territory_assignments
         (congregation_id, territory_id, holder_name, assigned_on, returned_on)
       VALUES ($1, $2, 'Второй', $3, $4) RETURNING id`,
      [congregationId, territoryId, d(30), d(40)],
    );
    // The second moved to start inside the first: refused.
    const over = await h
      .as('keeper')
      .patch(`/territories/assignments/${second.id}`, { assignedOn: d(10) });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('TERRITORY_DATES');
    // The first stretched into the second: refused.
    const into = await h
      .as('keeper')
      .patch(`/territories/assignments/${first.id}`, { completedOn: d(35) });
    expect(into.body.code).toBe('TERRITORY_DATES');
    // Starting the day the first was worked: fine.
    expect(
      (
        await h
          .as('keeper')
          .patch(`/territories/assignments/${second.id}`, { assignedOn: d(20) })
      ).status,
    ).toBe(200);
  });
  it('the map file is asked for only once the map job has put it in place', async () => {
    const before = (await h.as('holder').get('/territories/access')).body;
    expect(before.mapReady).toBe(false);
    // What the «Territory map» job writes on the server after the copy.
    await h.sql(
      `INSERT INTO territory_settings (congregation_id, map_built_at) VALUES ($1, now())
       ON CONFLICT (congregation_id) DO UPDATE SET map_built_at = now()`,
      [congregationId],
    );
    const after = (await h.as('holder').get('/territories/access')).body;
    expect(after.mapReady).toBe(true);
    // A map in place is not a confirmation of the records.
    expect(after.verified).toBe(false);
  });
  const outbox = async (kind: string) =>
    h.sql<{ user_id: string; title: string }>(
      `SELECT user_id, title FROM notification_outbox WHERE kind = $1`,
      [kind],
    );
  const userOf = async (login: string) =>
    (
      await h.sql<{ id: string }>(
        `SELECT id FROM users WHERE login_name = $1`,
        [login],
      )
    )[0].id;

  it('a share link shows the map without login until it comes back, and nothing else', async () => {
    await verify();
    const a = await giveToHolder();
    // Only the holder or a keeper makes one.
    expect(
      (await h.as('member').post(`/territories/assignments/${a.id}/share-link`))
        .status,
    ).toBe(404);
    const made = await h
      .as('holder')
      .post(`/territories/assignments/${a.id}/share-link`);
    expect(made.status).toBe(200);
    const token = String(made.body.path).replace('/t/', '');
    // Only the hash is kept.
    const [row] = await h.sql<{ link_hash: string }>(
      `SELECT link_hash FROM territory_assignments WHERE id = $1`,
      [a.id],
    );
    expect(row.link_hash).not.toContain(token);
    const page = await h.as(null).get(`/territory-links/${token}`);
    expect(page.status).toBe(200);
    expect(page.body.number).toBe('A01');
    // No addresses, no names on a page without login.
    expect(JSON.stringify(page.body)).not.toContain('Musterstraße');
    expect(JSON.stringify(page.body)).not.toContain('Тест');
    expect(page.headers['cache-control']).toContain('no-store');
    // A wrong link and an ended one look the same.
    expect(
      (await h.as(null).get(`/territory-links/${'x'.repeat(32)}`)).status,
    ).toBe(404);
    await h.as('holder').post(`/territories/assignments/${a.id}/complete`, {});
    expect((await h.as(null).get(`/territory-links/${token}`)).status).toBe(
      404,
    );
  });

  it('a share link: two months past the day still, then not; it says how many «не посещать», never which (13 November 2026)', async () => {
    await verify();
    const a = await giveToHolder();
    const made = await h
      .as('holder')
      .post(`/territories/assignments/${a.id}/share-link`);
    const token = String(made.body.path).replace('/t/', '');
    const page = await h.as(null).get(`/territory-links/${token}`);
    expect(page.body.noCalls).toBe(1);
    expect(JSON.stringify(page.body)).not.toContain('Musterstraße');
    const dueOn = async (d: string) =>
      h.sql(`UPDATE territory_assignments SET due_on = $1 WHERE id = $2`, [
        d,
        a.id,
      ]);
    // A day late: he still holds it, and still needs its map.
    await dueOn(addDays(today, -1));
    expect((await h.as(null).get(`/territory-links/${token}`)).status).toBe(
      200,
    );
    await dueOn(addDays(today, -59));
    expect((await h.as(null).get(`/territory-links/${token}`)).status).toBe(
      200,
    );
    // Long past: it stops.
    await dueOn(addDays(today, -62));
    expect((await h.as(null).get(`/territory-links/${token}`)).status).toBe(
      404,
    );
  });

  it('the desk: people and whether they have the app, what is out (also without a card), who had what; the paper queue (13 November 2026)', async () => {
    await verify();
    // The committee sees the section but does not give out.
    expect((await h.as('secretary').get('/territories/desk')).status).toBe(403);
    const first = await giveToHolder();
    await h
      .as('keeper')
      .post(`/territories/assignments/${first.id}/complete`, {});
    // A line brought over without a card, still out.
    const [old] = await h.sql<{ id: string }>(
      `INSERT INTO territory_assignments (congregation_id, territory_id, holder_name, assigned_on, due_on, imported)
       VALUES ($1, $2, 'Old Holder', $3, $4, true) RETURNING id`,
      [congregationId, territoryId, addDays(today, -30), addDays(today, 90)],
    );
    const desk = await h.as('keeper').get('/territories/desk');
    expect(desk.status).toBe(200);
    const holder = (
      desk.body.people as { publisherId: string; hasApp: boolean }[]
    ).find((p) => p.publisherId === card.holder);
    expect(holder?.hasApp).toBe(true);
    expect(desk.body.out).toEqual([
      expect.objectContaining({
        assignmentId: old.id,
        number: 'A01',
        publisherId: null,
        holderName: 'Old Holder',
        paperWanted: false,
      }),
    ]);
    // How many «не посещать» each has; houses only once a register exists.
    expect(desk.body.noCalls).toEqual({ [territoryId]: 1 });
    expect(desk.body.houses).toBeNull();
    expect(desk.body.history).toEqual([
      expect.objectContaining({
        publisherId: card.holder,
        territoryId,
        completedOn: today,
      }),
    ]);
    // With a register: the houses of each territory (A01 square 7..7.01).
    await h.sql(
      `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2) VALUES ($1, 1, 7.005, 51.005, 90), ($1, 2, 7.006, 51.005, 90), ($1, 3, 7.015, 51.005, 90), ($1, 4, 7.5, 51.5, 90)`,
      [congregationId],
    );
    await h.sql(
      `INSERT INTO territory_settings (congregation_id, houses_built_at) VALUES ($1, now())
        ON CONFLICT (congregation_id) DO UPDATE SET houses_built_at = now()`,
      [congregationId],
    );
    const sized = await h.as('keeper').get('/territories/desk');
    const [a2] = await h.sql<{ id: string }>(
      `SELECT id FROM territories WHERE number = 'A02'`,
    );
    expect(sized.body.houses).toEqual({ [territoryId]: 2, [a2.id]: 1 });
    // Only homes count (14 November 2026): a garage marked so is not a house.
    await h.sql(`UPDATE map_houses SET home = false WHERE osm_id = 2`);
    await h.sql(
      `UPDATE territory_settings SET houses_built_at = now() + interval '1 second' WHERE congregation_id = $1`,
      [congregationId],
    );
    const homesOnly = await h.as('keeper').get('/territories/desk');
    expect(homesOnly.body.houses).toEqual({ [territoryId]: 1, [a2.id]: 1 });
    await h.sql(`DELETE FROM map_houses`);
    // Candidates say it too.
    const cand = await h
      .as('keeper')
      .get(`/territories/${territoryId}/candidates`);
    expect(
      (cand.body.people as { publisherId: string; hasApp: boolean }[]).find(
        (p) => p.publisherId === card.holder,
      )?.hasApp,
    ).toBe(true);

    // Paper wanted: in the list and on the desk; printed: out again.
    const want = await h
      .as('keeper')
      .put(`/territories/assignments/${old.id}/paper`, { wanted: true });
    expect(want.status).toBe(200);
    const list = await h.as('keeper').get('/territories');
    expect(
      (
        list.body as {
          number: string;
          holder: { paperWanted: boolean } | null;
        }[]
      ).find((t) => t.number === 'A01')?.holder?.paperWanted,
    ).toBe(true);
    expect(
      (await h.as('keeper').get('/territories/desk')).body.out[0].paperWanted,
    ).toBe(true);
    await h
      .as('keeper')
      .put(`/territories/assignments/${old.id}/paper`, { wanted: false });
    expect(
      (await h.as('keeper').get('/territories/desk')).body.out[0].paperWanted,
    ).toBe(false);
    // Not for a territory already back; not for the holder himself.
    const back = await h
      .as('keeper')
      .put(`/territories/assignments/${first.id}/paper`, { wanted: true });
    expect(back.body.code).toBe('TERRITORY_ENDED');
    expect(
      (
        await h
          .as('holder')
          .put(`/territories/assignments/${old.id}/paper`, { wanted: true })
      ).status,
    ).toBe(403);
  });

  it('a new share link replaces the old one', async () => {
    await verify();
    const a = await giveToHolder();
    const first = await h
      .as('keeper')
      .post(`/territories/assignments/${a.id}/share-link`);
    const second = await h
      .as('keeper')
      .post(`/territories/assignments/${a.id}/share-link`);
    const tok = (r: { body: { path: string } }) => r.body.path.slice(3);
    expect(
      (await h.as(null).get(`/territory-links/${tok(first)}`)).status,
    ).toBe(404);
    expect(
      (await h.as(null).get(`/territory-links/${tok(second)}`)).status,
    ).toBe(200);
  });

  it('a view link: for whoever sees the territory, and it cannot be forged', async () => {
    await verify();
    const a = await giveToHolder(groupOne);
    const member = await h
      .as('member')
      .post(`/territories/assignments/${a.id}/view-link`);
    expect(member.status).toBe(200);
    const token = String(member.body.path).replace('/t/', '');
    expect((await h.as(null).get(`/territory-links/${token}`)).status).toBe(
      200,
    );
    expect(
      (
        await h
          .as('stranger')
          .post(`/territories/assignments/${a.id}/view-link`)
      ).status,
    ).toBe(404);
    // One changed character in the signature.
    const forged = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    expect((await h.as(null).get(`/territory-links/${forged}`)).status).toBe(
      404,
    );
  });

  it('the holder is told when it is given, and two weeks before the day', async () => {
    await verify();
    const a = await giveToHolder();
    const holder = await userOf('holder');
    expect((await outbox('territory_assigned')).map((r) => r.user_id)).toEqual([
      holder,
    ]);
    const soon = addDays(today, 14);
    await h.sql(`UPDATE territory_assignments SET due_on = $1 WHERE id = $2`, [
      soon,
      a.id,
    ]);
    const reminders = h.app.get(TerritoryRemindersService);
    await reminders.forCongregation(congregationId);
    await reminders.forCongregation(congregationId);
    // Once, however often the morning job runs.
    expect((await outbox('territory_due')).map((r) => r.user_id)).toEqual([
      holder,
    ]);
  });

  it('the day itself: told once more, once; the words say whether he may still extend (13 November 2026)', async () => {
    await verify();
    const a = await giveToHolder();
    const holder = await userOf('holder');
    await h.sql(`UPDATE territory_assignments SET due_on = $1 WHERE id = $2`, [
      today,
      a.id,
    ]);
    const reminders = h.app.get(TerritoryRemindersService);
    await reminders.forCongregation(congregationId);
    await reminders.forCongregation(congregationId);
    const rows = await h.sql<{
      user_id: string;
      body: string;
      dedupe_key: string;
    }>(
      `SELECT user_id, body, dedupe_key FROM notification_outbox WHERE kind = 'territory_due' ORDER BY dedupe_key`,
    );
    expect(rows.map((r) => r.user_id)).toEqual([holder, holder]);
    const todayRow = rows.find((r) =>
      r.dedupe_key.startsWith('territory-due-today:'),
    );
    expect(todayRow).toBeDefined();
    // Not extended yet: he may extend once in the app.
    expect(todayRow!.body).toMatch(/продлите|extend|verlängern/);
  });

  it('a day missed, or less than two weeks left when brought over: still told, once; not after the day', async () => {
    await verify();
    const a = await giveToHolder();
    const holder = await userOf('holder');
    const reminders = h.app.get(TerritoryRemindersService);
    // Further off than two weeks: nothing yet.
    await h.sql(`UPDATE territory_assignments SET due_on = $1 WHERE id = $2`, [
      addDays(today, 15),
      a.id,
    ]);
    await reminders.forCongregation(congregationId);
    expect(await outbox('territory_due')).toEqual([]);
    // Four days left (the fourteenth day was missed): told, once.
    await h.sql(`UPDATE territory_assignments SET due_on = $1 WHERE id = $2`, [
      addDays(today, 4),
      a.id,
    ]);
    await reminders.forCongregation(congregationId);
    await reminders.forCongregation(congregationId);
    expect((await outbox('territory_due')).map((r) => r.user_id)).toEqual([
      holder,
    ]);
    // Past the day: overdue is the keeper's business, not a reminder.
    await h.sql(`DELETE FROM notification_outbox`);
    await h.sql(`UPDATE territory_assignments SET due_on = $1 WHERE id = $2`, [
      addDays(today, -1),
      a.id,
    ]);
    await reminders.forCongregation(congregationId);
    expect(await outbox('territory_due')).toEqual([]);
  });

  it('a holder who has left: the territory servant is told once, nobody else', async () => {
    await verify();
    await giveToHolder();
    await h.sql(`UPDATE publishers SET removed_at = now() WHERE id = $1`, [
      card.holder,
    ]);
    const reminders = h.app.get(TerritoryRemindersService);
    await reminders.forCongregation(congregationId);
    await reminders.forCongregation(congregationId);
    expect((await outbox('territory_return')).map((r) => r.user_id)).toEqual([
      await userOf('keeper'),
    ]);
  });
  it("an inactive holder: his territory is on the elders' list, not reported to the territory servant", async () => {
    await verify();
    await giveToHolder();
    const holds = await h.app
      .get(InactiveHoldsService)
      .holdsOf(congregationId, { id: card.holder, userId: null }, today);
    expect(holds).toEqual([
      expect.objectContaining({ kind: 'territory', label: 'A01' }),
    ]);
    await h.sql(`UPDATE publishers SET status = 'inactive' WHERE id = $1`, [
      card.holder,
    ]);
    try {
      await h.app
        .get(TerritoryRemindersService)
        .forCongregation(congregationId);
      expect(await outbox('territory_return')).toEqual([]);
    } finally {
      await h.sql(`UPDATE publishers SET status = NULL WHERE id = $1`, [
        card.holder,
      ]);
    }
  });
  const idOf = async (number: string) =>
    (
      await h.sql<{ id: string }>(
        `SELECT id FROM territories WHERE number = $1`,
        [number],
      )
    )[0].id;

  it("a campaign: free territories worked at once in the keeper's name; one in someone's hands is refused", async () => {
    await verify();
    const a1 = await idOf('A01');
    const a2 = await idOf('A02');
    const r = await h
      .as('keeper')
      .post('/territories/campaign', { territoryIds: [a1, a2] });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ saved: 2 });
    const rows = await h.sql<{
      holder_name: string;
      method: string;
      completed_on: string;
    }>(
      `SELECT holder_name, method, completed_on::text FROM territory_assignments ORDER BY holder_name`,
    );
    expect(rows).toEqual([
      {
        holder_name: 'Тест Хранитель',
        method: 'campaign',
        completed_on: today,
      },
      {
        holder_name: 'Тест Хранитель',
        method: 'campaign',
        completed_on: today,
      },
    ]);
    // Worked again later is fine; one in someone's hands is not touched.
    await h.sql(`DELETE FROM territory_assignments`);
    await giveToHolder();
    const held = await h
      .as('keeper')
      .post('/territories/campaign', { territoryIds: [a1, a2] });
    expect(held.status).toBe(409);
    expect(held.body.code).toBe('TERRITORY_HELD');
    expect(
      (
        await h
          .as('secretary')
          .post('/territories/campaign', { territoryIds: [a2] })
      ).status,
    ).toBe(403);
  });

  it('a group territory whose holder no longer oversees the group is handed on, keeping its day', async () => {
    await verify();
    const a = await giveToHolder(groupOne);
    const list = (await h.as('keeper').get('/territories')).body as {
      number: string;
      holder: { handOnTo: { publisherId: string } | null } | null;
    }[];
    expect(
      list.find((t) => t.number === 'A01')?.holder?.handOnTo?.publisherId,
    ).toBe(card.overseer);
    const reminders = h.app.get(TerritoryRemindersService);
    await reminders.forCongregation(congregationId);
    await reminders.forCongregation(congregationId);
    expect((await outbox('territory_hand_on')).map((r) => r.user_id)).toEqual([
      await userOf('keeper'),
    ]);
    // A day other than four months on, so keeping it is visible.
    const due = addDays(today, 30);
    await h.sql(`UPDATE territory_assignments SET due_on = $1 WHERE id = $2`, [
      due,
      a.id,
    ]);
    const r = await h
      .as('keeper')
      .post(`/territories/assignments/${a.id}/transfer`, {});
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ publisherId: card.overseer, dueOn: due });
    const old = await h.sql<{ returned_on: string }>(
      `SELECT returned_on::text FROM territory_assignments WHERE id = $1`,
      [a.id],
    );
    expect(old[0].returned_on).toBe(today);
    expect(await seen('overseer')).toEqual(['A01']);
    const after = (await h.as('keeper').get('/territories')).body as {
      number: string;
      holder: { handOnTo: unknown } | null;
    }[];
    expect(after.find((t) => t.number === 'A01')?.holder?.handOnTo).toBeNull();
  });

  it('a meeting for field service: its conductor sends it to his territory, and those it is for see it the day before', async () => {
    await verify();
    // A02 to the holder personally; a general meeting he conducts tomorrow.
    const a2 = await idOf('A02');
    const given = await h
      .as('keeper')
      .post(`/territories/${a2}/assign`, { publisherId: card.holder });
    expect(given.status).toBe(201);
    const tomorrow = addDays(today, 1);
    const d = new Date(`${tomorrow}T00:00:00Z`);
    const dow = d.getUTCDay() || 7;
    const monday = addDays(tomorrow, 1 - dow);
    const [m] = await h.sql<{ id: string }>(
      `INSERT INTO field_service_meetings
         (congregation_id, week_start_date, day_of_week, start_time, address,
          conductor_publisher_id, is_general, published_at)
       VALUES ($1, $2, $3, '10:00', 'Зал', $4, true, now()) RETURNING id`,
      [congregationId, monday, dow, card.holder],
    );
    expect(await seen('stranger')).toEqual([]);
    // Not his: refused. Somebody else: as if there were no meeting.
    const free = await h
      .as('holder')
      .put(`/territories/meetings/${m.id}`, { territoryId: await idOf('A01') });
    expect(free.body.code).toBe('TERRITORY_NOT_FOR_MEETING');
    expect(
      (
        await h
          .as('member')
          .put(`/territories/meetings/${m.id}`, { territoryId: a2 })
      ).status,
    ).toBe(404);
    const mine = (await h.as('holder').get('/territories/my-meetings')).body;
    expect(mine[0].options.map((o: { number: string }) => o.number)).toEqual([
      'A02',
    ]);
    const set = await h
      .as('holder')
      .put(`/territories/meetings/${m.id}`, { territoryId: a2 });
    expect(set.status).toBe(200);
    // A general meeting is for everyone: the stranger sees it, with the
    // addresses, and may open its map.
    const seenBy = (await h.as('stranger').get('/territories/mine')).body;
    expect(seenBy.map((t: { number: string }) => t.number)).toEqual(['A02']);
    expect(seenBy[0].meeting.date).toBe(tomorrow);
    expect(
      (
        await h
          .as('stranger')
          .post(`/territories/assignments/${given.body.id}/view-link`)
      ).status,
    ).toBe(200);
    // Called off: gone again.
    await h.sql(
      `UPDATE field_service_meetings SET cancelled_at = now() WHERE id = $1`,
      [m.id],
    );
    expect(await seen('stranger')).toEqual([]);
  });

  // 12 November 2026: a meeting kept pointing at a territory after it left
  // its conductor's hands — the group would go out to someone else's.
  const meetingTomorrow = async (conductor: string) => {
    const tomorrow = addDays(today, 1);
    const d = new Date(`${tomorrow}T00:00:00Z`);
    const dow = d.getUTCDay() || 7;
    const monday = addDays(tomorrow, 1 - dow);
    const [m] = await h.sql<{ id: string }>(
      `INSERT INTO field_service_meetings
         (congregation_id, week_start_date, day_of_week, start_time, address,
          conductor_publisher_id, is_general, published_at)
       VALUES ($1, $2, $3, '10:00', 'Зал', $4, true, now()) RETURNING id`,
      [congregationId, monday, dow, conductor],
    );
    return m.id;
  };
  const meetingTerritory = async (id: string) =>
    (
      await h.sql<{ territory_id: string | null }>(
        `SELECT territory_id FROM field_service_meetings WHERE id = $1`,
        [id],
      )
    )[0].territory_id;

  it('a territory that leaves the conductor comes off his meetings, and he is told', async () => {
    await verify();
    const a2 = await idOf('A02');
    const given = await h
      .as('keeper')
      .post(`/territories/${a2}/assign`, { publisherId: card.holder });
    expect(given.status).toBe(201);
    const m = await meetingTomorrow(card.holder);
    expect(
      (
        await h
          .as('holder')
          .put(`/territories/meetings/${m}`, { territoryId: a2 })
      ).status,
    ).toBe(200);
    expect(await seen('stranger')).toEqual(['A02']);
    // Taken back and given to someone else the day before the meeting.
    const back = await h
      .as('keeper')
      .post(`/territories/assignments/${given.body.id}/return`, {});
    expect(back.status).toBe(200);
    const again = await h
      .as('keeper')
      .post(`/territories/${a2}/assign`, { publisherId: card.member });
    expect(again.status).toBe(201);
    // The meeting no longer goes there; nobody it is for sees it any more.
    expect(await meetingTerritory(m)).toBeNull();
    expect(await seen('stranger')).toEqual([]);
    expect(
      (
        await h
          .as('stranger')
          .post(`/territories/assignments/${again.body.id}/view-link`)
      ).status,
    ).not.toBe(200);
    // The conductor hears of it once.
    const told = await h.sql<{ kind: string }>(
      `SELECT kind FROM notification_outbox WHERE kind = 'territory_meeting_dropped'`,
    );
    expect(told).toHaveLength(1);
  });

  it('a meeting whose conductor changed does not send anyone to a territory that is not his', async () => {
    await verify();
    const a2 = await idOf('A02');
    expect(
      (
        await h
          .as('keeper')
          .post(`/territories/${a2}/assign`, { publisherId: card.holder })
      ).status,
    ).toBe(201);
    const m = await meetingTomorrow(card.holder);
    expect(
      (
        await h
          .as('holder')
          .put(`/territories/meetings/${m}`, { territoryId: a2 })
      ).status,
    ).toBe(200);
    // The meeting is handed to another conductor elsewhere in the app.
    await h.sql(
      `UPDATE field_service_meetings SET conductor_publisher_id = $1 WHERE id = $2`,
      [card.stranger, m],
    );
    expect(await seen('member')).toEqual([]);
    const theirs = (await h.as('stranger').get('/territories/my-meetings'))
      .body;
    expect(theirs[0].territoryId).toBeNull();
    expect(theirs[0].dropped).toEqual({ number: 'A02' });
  });

  it('the month in figures, seen in the section; the committee is sent no notice of it', async () => {
    await verify();
    const a = await giveToHolder();
    await h.as('holder').post(`/territories/assignments/${a.id}/complete`, {});
    const month = today.slice(0, 7);
    const r = await h
      .as('secretary')
      .get(`/territories/summary?month=${month}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      month,
      given: 1,
      worked: 1,
      held: 0,
      total: 2,
    });
    expect((await h.as('member').get('/territories/summary')).status).toBe(403);
    // Lionel, 12 November 2026: the committee hears of the territories only
    // when «не посещать» addresses come up for review.
    await h.app.get(TerritoryRemindersService).tick();
    expect(
      await h.sql(`SELECT kind FROM notification_outbox WHERE user_id = $1`, [
        await userOf('secretary'),
      ]),
    ).toEqual([]);
  });
  it('the month in figures counts brought-over lines with their own days', async () => {
    const month = today.slice(0, 7);
    const r = await h.as('keeper').post('/territories/import/assignments', {
      items: [
        {
          number: 'A01',
          holderName: 'Прежний П.',
          assignedOn: `${month}-01`,
          completedOn: today,
        },
      ],
    });
    expect(r.status).toBe(201);
    await verify();
    const sum = await h
      .as('secretary')
      .get(`/territories/summary?month=${month}`);
    expect(sum.body).toMatchObject({ given: 1, worked: 1 });
  });
  it('the S-13 of a year: last worked before it, carried-over lines with their old day, a return without a worked day', async () => {
    const start = serviceYearStart(serviceYearOf(today));
    // Before confirming: lines brought over. Worked last year; still open
    // from last year; given this year and handed back.
    const r = await h.as('keeper').post('/territories/import/assignments', {
      items: [
        {
          number: 'A01',
          holderName: 'Прежний П.',
          assignedOn: addDays(start, -100),
          completedOn: addDays(start, -40),
        },
        {
          number: 'A01',
          holderName: 'Тест Держатель',
          publisherId: card.holder,
          assignedOn: addDays(start, -10),
        },
        {
          number: 'A02',
          holderName: 'Тест Участник',
          assignedOn: start,
          returnedOn: start,
        },
      ],
    });
    expect(r.status).toBe(201);
    expect((await h.as('keeper').get('/territories/s13')).status).toBe(409);
    await verify();
    const s = await h.as('secretary').get('/territories/s13');
    expect(s.status).toBe(200);
    const a01 = s.body.territories.find(
      (t: { number: string }) => t.number === 'A01',
    );
    expect(a01.lastCompletedBefore).toBe(addDays(start, -40));
    expect(a01.assignments).toEqual([
      expect.objectContaining({
        holderName: 'Тест Держатель',
        assignedOn: addDays(start, -10),
        completedOn: null,
      }),
    ]);
    const a02 = s.body.territories.find(
      (t: { number: string }) => t.number === 'A02',
    );
    expect(a02.assignments).toEqual([
      expect.objectContaining({ assignedOn: start, completedOn: null }),
    ]);
    // Only the kept years; nobody outside the section.
    expect(
      (
        await h
          .as('keeper')
          .get(`/territories/s13?serviceYear=${serviceYearOf(today) - 2}`)
      ).status,
    ).toBe(400);
    expect((await h.as('member').get('/territories/s13')).status).toBe(403);
  });
  it('links for printed maps: one per sheet, the earlier sheet stops, addresses only when asked', async () => {
    await verify();
    const a = await giveToHolder();
    const first = await h
      .as('keeper')
      .post('/territories/print-links', { assignmentIds: [a.id] });
    expect(first.status).toBe(200);
    expect(first.body[0].noCalls).toEqual([]);
    expect(first.body[0].replacedLinkOf).toBeNull();
    const second = await h.as('keeper').post('/territories/print-links', {
      assignmentIds: [a.id],
      withNoCalls: true,
    });
    expect(second.body[0].replacedLinkOf).not.toBeNull();
    expect(second.body[0].noCalls).toEqual([
      { address: 'Musterstraße 1', surname: null },
    ]);
    const tok = (b: { path: string }) => b.path.slice(3);
    expect(
      (await h.as(null).get(`/territory-links/${tok(first.body[0])}`)).status,
    ).toBe(404);
    expect(
      (await h.as(null).get(`/territory-links/${tok(second.body[0])}`)).status,
    ).toBe(200);
    // The holder makes his own link elsewhere; printing is the keepers'.
    expect(
      (
        await h
          .as('holder')
          .post('/territories/print-links', { assignmentIds: [a.id] })
      ).status,
    ).toBe(404);
  });

  describe('«не посещать» kept by hand (12 November 2026)', () => {
    const list = async () =>
      (await h.as('keeper').get(`/territories/${territoryId}`)).body
        .noCalls as {
        id: string;
        address: string;
        surname: string | null;
        notedOn: string;
        reviewOn: string;
      }[];

    it('the keeper adds, corrects and deletes; the same address twice is refused; others may not', async () => {
      const add = await h
        .as('keeper')
        .post(`/territories/${territoryId}/no-calls`, {
          address: 'Schleusenstr. 8',
          surname: 'Vogt',
          notedOn: '2026-10-25',
        });
      expect(add.status).toBe(201);
      expect(add.body).toMatchObject({
        address: 'Schleusenstr. 8',
        surname: 'Vogt',
        notedOn: '2026-10-25',
        reviewOn: addDays('2026-10-25', 730),
      });
      // Written otherwise, still the same address.
      const twice = await h
        .as('keeper')
        .post(`/territories/${territoryId}/no-calls`, {
          address: 'Schleusenstrasse 8',
        });
      expect(twice.body.code).toBe('TERRITORY_NO_CALL_TWICE');
      const twiceToo = await h
        .as('keeper')
        .post(`/territories/${territoryId}/no-calls`, {
          address: 'musterstrasse  1',
        });
      expect(twiceToo.body.code).toBe('TERRITORY_NO_CALL_TWICE');
      // Another house in the same street is another address.
      expect(
        (
          await h.as('keeper').post(`/territories/${territoryId}/no-calls`, {
            address: 'Schleusenstr. 18',
          })
        ).status,
      ).toBe(201);
      const future = await h
        .as('keeper')
        .post(`/territories/${territoryId}/no-calls`, {
          address: 'Neue Str. 1',
          notedOn: addDays(today, 3),
        });
      expect(future.body.code).toBe('TERRITORY_DATES');
      // Not his to add: the secretary before the review, a publisher ever.
      await verify();
      for (const who of ['secretary', 'member']) {
        expect(
          (
            await h.as(who).post(`/territories/${territoryId}/no-calls`, {
              address: 'Andere Str. 2',
            })
          ).status,
        ).toBe(403);
      }
      const fix = await h
        .as('keeper')
        .patch(`/territories/no-calls/${add.body.id}`, {
          surname: '',
          notedOn: '2026-10-24',
        });
      expect(fix.status).toBe(200);
      expect(fix.body).toMatchObject({
        surname: null,
        reviewOn: addDays('2026-10-24', 730),
      });
      expect(
        (await h.as('secretary').delete(`/territories/no-calls/${add.body.id}`))
          .status,
      ).toBe(403);
      expect(
        (await h.as('keeper').delete(`/territories/no-calls/${add.body.id}`))
          .status,
      ).toBe(200);
      expect((await list()).map((n) => n.address).sort()).toEqual([
        'Musterstraße 1',
        'Schleusenstr. 18',
      ]);
      // The journal says what changed, never the address.
      // Read through the app, so the journal's sealed text is opened.
      const journal = await h.app
        .get(DataSource)
        .getRepository(AuditLog)
        .find({
          where: { entityType: 'territory_no_call' },
          order: { createdAt: 'ASC' },
        });
      expect(journal.map((j) => j.action)).toEqual([
        'CREATE',
        'CREATE',
        'UPDATE',
        'DELETE',
      ]);
      expect(journal[0].afterJson).toContain('A01');
      for (const j of journal) {
        expect(j.afterJson ?? '').not.toContain('Schleusen');
        expect(j.afterJson ?? '').not.toContain('Vogt');
      }
    });

    it('the address and surname lie in the database as cipher, not as text', async () => {
      await h.as('keeper').post(`/territories/${territoryId}/no-calls`, {
        address: 'Geheimweg 7',
        surname: 'Verborgen',
      });
      const raw = await h.sql<{ address: string; surname: string }>(
        `SELECT address, surname FROM territory_no_calls WHERE surname IS NOT NULL`,
      );
      expect(raw).toHaveLength(1);
      expect(raw[0].address.startsWith('enc:v1:')).toBe(true);
      expect(raw[0].surname.startsWith('enc:v1:')).toBe(true);
      expect(JSON.stringify(raw)).not.toContain('Geheimweg');
      expect(JSON.stringify(raw)).not.toContain('Verborgen');
    });

    it('up for review: the committee may keep or remove only then, and hears of it once a day', async () => {
      await verify();
      const noted = addDays(today, -730 + 30);
      const due = await h
        .as('keeper')
        .post(`/territories/${territoryId}/no-calls`, {
          address: 'Am Dahlhof 6',
          notedOn: noted,
        });
      expect(due.body.reviewOn).toBe(addDays(today, 30));
      const fresh = (await list()).find((n) => n.address === 'Musterstraße 1')!;
      const review = await h
        .as('secretary')
        .get('/territories/no-calls/review');
      expect(review.status).toBe(200);
      expect(review.body).toEqual([
        expect.objectContaining({
          id: due.body.id,
          number: 'A01',
          address: 'Am Dahlhof 6',
        }),
      ]);
      expect(
        (await h.as('member').get('/territories/no-calls/review')).status,
      ).toBe(403);
      // Not up for review yet: not the committee's.
      expect(
        (await h.as('secretary').post(`/territories/no-calls/${fresh.id}/keep`))
          .status,
      ).toBe(403);
      // The month-ahead notice: keepers and committee, once.
      const reminders = h.app.get(TerritoryRemindersService);
      await reminders.tick();
      await reminders.tick();
      const sent = await outbox('territory_no_call_review');
      expect(sent.map((x) => x.user_id).sort()).toEqual(
        [await userOf('keeper'), await userOf('secretary')].sort(),
      );
      expect(sent[0].title).not.toContain('Dahlhof');
      // And on the home screen, one line: how many, for keeper and committee.
      for (const who of ['keeper', 'secretary']) {
        const home = (await h.as(who).get('/me/pending')).body.items;
        expect(
          home.filter((i: { kind: string }) => i.kind === 'territory_review'),
        ).toEqual([
          expect.objectContaining({ title: '1', dueOn: addDays(today, 30) }),
        ]);
      }
      expect(
        (await h.as('member').get('/me/pending')).body.items.some(
          (i: { kind: string }) => i.kind === 'territory_review',
        ),
      ).toBe(false);
      const kept = await h
        .as('secretary')
        .post(`/territories/no-calls/${due.body.id}/keep`);
      expect(kept.status).toBe(200);
      expect(kept.body.reviewOn).toBe(addDays(today, 730));
      expect(
        (await h.as('secretary').get('/territories/no-calls/review')).body,
      ).toEqual([]);
      // Up again: the committee may remove it.
      await h.sql(
        `UPDATE territory_no_calls SET review_on = $1 WHERE id = $2`,
        [today, due.body.id],
      );
      expect(
        (await h.as('secretary').delete(`/territories/no-calls/${due.body.id}`))
          .status,
      ).toBe(200);
    });
  });
});
