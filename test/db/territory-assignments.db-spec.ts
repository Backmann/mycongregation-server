import { Harness, startHarness } from './harness';
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
  const today = new Date().toISOString().slice(0, 10);

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
});
