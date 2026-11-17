import { Harness, startHarness } from './harness';

/**
 * Applying a decided proposal of the re-cutting draft (16 November 2026,
 * step 5): only decided, free, unchanged; a cut into all its parts at once
 * with its «не посещать» placed by the official addresses or by the
 * keeper's choice; «Вернуть как было» while nothing was given out; a join
 * waiting for all its territories, with one held back from giving out.
 */
describe('applying the re-cutting draft (real database)', () => {
  let h: Harness;
  let congregationId = '';
  const ids: Record<string, string> = {};
  let cutId = '';
  let joinId = '';
  let holder = '';

  const rect = (x0: number, x1: number) => ({
    type: 'Polygon',
    coordinates: [
      [
        [x0, 51],
        [x1, 51],
        [x1, 51.009],
        [x0, 51.009],
        [x0, 51],
      ],
    ],
  });
  const vertical = (x: number) => ({
    points: [
      [x, 50.99],
      [x, 51.02],
    ],
  });
  const check = async (id: string) =>
    (await h.as('keeper').get(`/territory-recut/proposals/${id}/apply`))
      .body as {
      blocks: string[];
      updatedAt: string;
      parts: { number: string; keeps: boolean }[];
      lastWorkedOn: string | null;
      noCalls: { id: string; address: string; part: number | null }[];
      standing: { free: number; total: number } | null;
    };
  const territories = async () =>
    h.sql<{ number: string; archived: boolean; last: string | null }>(
      `SELECT number, archived_at IS NOT NULL AS archived, last_completed_on::text AS last
         FROM territories ORDER BY number`,
    );
  const give = (number: string, extra: Record<string, unknown> = {}) =>
    h.as('keeper').post(`/territories/${ids[number]}/assign`, {
      publisherId: holder,
      ...extra,
    });
  const takeBack = async (number: string) => {
    const [a] = await h.sql<{ id: string }>(
      `SELECT id FROM territory_assignments
        WHERE territory_id = $1 AND completed_on IS NULL AND returned_on IS NULL`,
      [ids[number]],
    );
    const r = await h
      .as('keeper')
      .post(`/territories/assignments/${a.id}/complete`, {});
    expect(r.status).toBe(200);
  };

  beforeAll(async () => {
    h = await startHarness();
    const [c] = await h.sql<{ id: string }>(`SELECT id FROM congregations`);
    congregationId = c.id;
    const card = (firstName: string, appointment: string) =>
      h.addPublisher({
        firstName,
        lastName: 'Тест',
        gender: 'brother',
        appointment,
        baptismDate: '2001-01-01',
      });
    const giveResp = (userId: string, type: string) =>
      h.sql(
        `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, $2, $3)`,
        [congregationId, type, userId],
      );
    const keeper = await h.addUser({
      login: 'keeper',
      role: 'ministerial_servant',
      publisherId: await card('Хранитель', 'ministerial_servant'),
    });
    const overseer = await h.addUser({
      login: 'overseer',
      role: 'elder',
      publisherId: await card('Служебный', 'elder'),
    });
    await giveResp(keeper, 'territory_servant');
    await giveResp(overseer, 'secretary');
    holder = await card('Держатель', 'publisher');
    await h.addUser({
      login: 'holder',
      role: 'publisher',
      publisherId: holder,
    });
    const r = await h.as('keeper').post('/territories/import/territories', {
      items: [
        { number: 'Big1', locality: 'Hamm', geometry: rect(7.0, 7.03) },
        { number: 'J1', locality: 'Hamm', geometry: rect(7.2, 7.21) },
        { number: 'J2', locality: 'Hamm', geometry: rect(7.21, 7.22) },
      ],
    });
    expect(r.status).toBe(201);
    await h.as('keeper').post('/territories/import/no-calls', {
      items: [
        // Its official address lies in the second part.
        { number: 'Big1', address: 'Musterstraße 12', notedOn: '2026-10-01' },
        // No official address: the keeper chooses.
        { number: 'Big1', address: 'Unbekannter Weg 4', notedOn: '2026-10-01' },
        { number: 'J2', address: 'Feldweg 3', notedOn: '2026-10-01' },
      ],
    });
    await h.sql(
      `INSERT INTO map_addresses (congregation_id, oid, lon, lat, number, street)
       VALUES ($1, 'DENW1', 7.015, 51.004, '12', 'Musterstraße')`,
      [congregationId],
    );
    expect((await h.as('keeper').post('/territories/verify')).status).toBe(200);
    for (const row of await h.sql<{ id: string; number: string }>(
      `SELECT id, number FROM territories`,
    ))
      ids[row.number] = row.id;
    await h.sql(
      `UPDATE territories SET last_completed_on = '2026-09-03' WHERE number = 'Big1'`,
    );
    await h.sql(
      `UPDATE territories SET last_completed_on = '2026-05-01' WHERE number = 'J2'`,
    );
    await h.sql(
      `UPDATE territories SET last_completed_on = '2026-08-01' WHERE number = 'J1'`,
    );
    const cut = await h.as('keeper').post('/territory-recut/proposals', {
      kind: 'cut',
      territoryIds: [ids.Big1],
      lines: [vertical(7.01), vertical(7.02)],
      keep: 0,
      numbers: ['Big2', 'Big3'],
      queue: 2,
    });
    expect(cut.status).toBe(201);
    const join = await h.as('keeper').post('/territory-recut/proposals', {
      kind: 'merge',
      territoryIds: [ids.J1, ids.J2],
      keepId: ids.J1,
      queue: 1,
    });
    expect(join.status).toBe(201);
    const view = (await h.as('keeper').get('/territory-recut')).body as {
      proposals: { id: string; kind: string }[];
    };
    cutId = view.proposals.find((p) => p.kind === 'cut')!.id;
    joinId = view.proposals.find((p) => p.kind === 'merge')!.id;
    await h
      .as('overseer')
      .put(`/territory-recut/proposals/${cutId}/remark`, { ok: true });
  });

  afterAll(async () => {
    await h?.close();
  });

  it('not decided yet: shown as such, refused', async () => {
    const c = await check(cutId);
    expect(c.blocks).toEqual(['notApproved']);
    const r = await h
      .as('keeper')
      .post(`/territory-recut/proposals/${cutId}/apply`, {
        updatedAt: c.updatedAt,
      });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TERRITORY_RECUT_NOT_READY');
    expect(r.body.reason).toBe('notApproved');
  });

  it('only a keeper applies; the service committee decides', async () => {
    const r = await h
      .as('overseer')
      .get(`/territory-recut/proposals/${cutId}/apply`);
    expect(r.status).toBe(403);
    // One queue at a time (17 November 2026): the join's queue first, and
    // the cut of queue 2 stays undecided until its own decision.
    expect(
      (await h.as('overseer').post('/territory-recut/approve', { queue: 1 }))
        .status,
    ).toBe(201);
    const cutCheck = await h
      .as('keeper')
      .get(`/territory-recut/proposals/${cutId}/apply`);
    expect(cutCheck.body.blocks).toContain('notApproved');
    const early = await h
      .as('keeper')
      .post(`/territory-recut/proposals/${cutId}/apply`, {
        updatedAt: cutCheck.body.updatedAt,
      });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('TERRITORY_RECUT_NOT_READY');
    // No queue named: refused, not «everything».
    expect(
      (await h.as('overseer').post('/territory-recut/approve', {})).status,
    ).toBe(400);
    expect(
      (await h.as('overseer').post('/territory-recut/approve', { queue: 2 }))
        .status,
    ).toBe(201);
    expect(
      (await h.as('keeper').get(`/territory-recut/proposals/${cutId}/apply`))
        .body.blocks,
    ).not.toContain('notApproved');
  });

  it('a join waits for all its territories; one held back is not given out', async () => {
    expect((await give('J2')).status).toBe(201);
    let waiting = (await h.as('keeper').get('/territory-recut/waiting'))
      .body as {
      number: string;
      free: number;
      total: number;
      hold: boolean;
      ready: boolean;
      waiting: { number: string }[];
    }[];
    const j1 = waiting.find((w) => w.number === 'J1')!;
    expect([j1.free, j1.total, j1.ready]).toEqual([1, 2, false]);
    expect(j1.waiting.map((w) => w.number)).toEqual(['J2']);
    expect((await check(joinId)).blocks).toEqual(['held']);
    // Worked, but not «kept for working again» (17 November 2026): the
    // decided join waits for it; the line stays open, nothing changes.
    const [line] = await h.sql<{ id: string }>(
      `SELECT id FROM territory_assignments
        WHERE territory_id = $1 AND completed_on IS NULL AND returned_on IS NULL`,
      [ids.J2],
    );
    const again = await h
      .as('keeper')
      .post(`/territories/assignments/${line.id}/complete`, { again: true });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TERRITORY_AWAITS_RECUT');
    expect(again.body.params?.number ?? again.body.number).toBe('J2');
    expect(
      await h.sql(
        `SELECT 1 FROM territory_assignments WHERE id = $1 AND completed_on IS NULL`,
        [line.id],
      ),
    ).toHaveLength(1);
    expect(
      (await h.as('keeper').get(`/territories/${ids.J2}`)).body.awaitsRecut,
    ).toBe(true);
    const mine = (await h.as('holder').get('/territories/mine')).body as {
      number: string;
      assignment: { awaitsRecut: boolean };
    }[];
    expect(mine.map((x) => [x.number, x.assignment.awaitsRecut])).toEqual([
      ['J2', true],
    ]);

    const held = await h
      .as('keeper')
      .put(`/territory-recut/proposals/${joinId}/hold`, {
        territoryId: ids.J1,
        hold: true,
      });
    expect(held.status).toBe(200);
    const refused = await give('J1');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('TERRITORY_HELD_FOR_RECUT');
    // Given out anyway: the hold is let go.
    expect((await give('J1', { releaseHold: true })).status).toBe(201);
    waiting = (await h.as('keeper').get('/territory-recut/waiting')).body;
    expect(waiting.find((w) => w.number === 'J1')!.hold).toBe(false);
    await takeBack('J1');
  });

  it('a cut: the parts, the day last worked, the addresses placed', async () => {
    const c = await check(cutId);
    expect(c.blocks).toEqual([]);
    expect(c.parts.map((p) => [p.number, p.keeps])).toEqual([
      ['Big1', true],
      ['Big2', false],
      ['Big3', false],
    ]);
    expect(c.lastWorkedOn).toBe('2026-09-03');
    const placed = Object.fromEntries(
      c.noCalls.map((n) => [n.address, n.part]),
    );
    expect(placed['Unbekannter Weg 4']).toBeNull();
    expect(placed['Musterstraße 12']).not.toBeNull();
  });

  it('an address left unplaced is refused, never guessed', async () => {
    const c = await check(cutId);
    const r = await h
      .as('keeper')
      .post(`/territory-recut/proposals/${cutId}/apply`, {
        updatedAt: c.updatedAt,
      });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TERRITORY_RECUT_NO_CALLS');
    expect((await territories()).filter((t) => !t.archived)).toHaveLength(3);
  });

  it('applied as read only', async () => {
    const r = await h
      .as('keeper')
      .post(`/territory-recut/proposals/${cutId}/apply`, {
        updatedAt: '2020-01-01T00:00:00.000Z',
      });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TERRITORY_RECUT_STALE');
  });

  it('applies a cut at once, and «Вернуть как было» puts it all back', async () => {
    const c = await check(cutId);
    const unknown = c.noCalls.find((n) => n.part === null)!;
    const musterPart = c.noCalls.find(
      (n) => n.address === 'Musterstraße 12',
    )!.part!;
    const r = await h
      .as('keeper')
      .post(`/territory-recut/proposals/${cutId}/apply`, {
        updatedAt: c.updatedAt,
        noCalls: [{ id: unknown.id, part: 2 }],
      });
    expect(r.status).toBe(201);
    expect(r.body.made.sort()).toEqual(['Big2', 'Big3']);
    const now = await territories();
    expect(
      now.filter((t) => !t.archived).map((t) => [t.number, t.last]),
    ).toEqual([
      ['Big1', '2026-09-03'],
      ['Big2', '2026-09-03'],
      ['Big3', '2026-09-03'],
      ['J1', expect.any(String)],
      ['J2', '2026-05-01'],
    ]);
    // Addresses are stored encrypted: followed by their ids.
    const placedIn = async (id: string) =>
      (
        await h.sql<{ number: string }>(
          `SELECT t.number FROM territory_no_calls n
             JOIN territories t ON t.id = n.territory_id WHERE n.id = $1`,
          [id],
        )
      )[0]?.number;
    const muster = c.noCalls.find((n) => n.address === 'Musterstraße 12')!;
    expect(await placedIn(muster.id)).toBe(c.parts[musterPart].number);
    expect(await placedIn(unknown.id)).toBe(c.parts[2].number);
    // The discussion goes with it; the proposal is applied.
    expect(
      await h.sql(
        `SELECT id FROM territory_recut_remarks WHERE proposal_id = $1`,
        [cutId],
      ),
    ).toEqual([]);
    const [p] = await h.sql<{ state: string }>(
      `SELECT state FROM territory_recut_proposals WHERE id = $1`,
      [cutId],
    );
    expect(p.state).toBe('applied');

    const undo = await h
      .as('keeper')
      .post(`/territory-recut/proposals/${cutId}/unapply`);
    expect(undo.status).toBe(201);
    expect(
      (await territories()).filter((t) => !t.archived).map((t) => t.number),
    ).toEqual(['Big1', 'J1', 'J2']);
    const back = await h.sql<{ number: string }>(
      `SELECT DISTINCT t.number FROM territory_no_calls n
         JOIN territories t ON t.id = n.territory_id WHERE t.number <> 'J2'`,
    );
    expect(back).toEqual([{ number: 'Big1' }]);
    const again = await check(cutId);
    expect(again.blocks).toEqual([]);
  });

  it('once a part is given out, it cannot be undone', async () => {
    const c = await check(cutId);
    const unknown = c.noCalls.find((n) => n.part === null)!;
    expect(
      (
        await h.as('keeper').post(`/territory-recut/proposals/${cutId}/apply`, {
          updatedAt: c.updatedAt,
          noCalls: [{ id: unknown.id, part: 0 }],
        })
      ).status,
    ).toBe(201);
    const [big2] = await h.sql<{ id: string }>(
      `SELECT id FROM territories WHERE number = 'Big2'`,
    );
    ids.Big2 = big2.id;
    expect((await give('Big2')).status).toBe(201);
    const undo = await h
      .as('keeper')
      .post(`/territory-recut/proposals/${cutId}/unapply`);
    expect(undo.status).toBe(409);
    expect(undo.body.code).toBe('TERRITORY_UNDO_GIVEN');
  });

  it('a join applies once all are free: the oldest day, one number', async () => {
    await takeBack('J2');
    const [feld] = await h.sql<{ id: string }>(
      `SELECT id FROM territory_no_calls WHERE territory_id = $1`,
      [ids.J2],
    );
    const c = await check(joinId);
    expect(c.blocks).toEqual([]);
    expect(c.standing).toEqual({ free: 2, total: 2, waiting: [] });
    const r = await h
      .as('keeper')
      .post(`/territory-recut/proposals/${joinId}/apply`, {
        updatedAt: c.updatedAt,
      });
    expect(r.status).toBe(201);
    const now = await territories();
    expect(now.find((t) => t.number === 'J2')!.archived).toBe(true);
    // J1 and J2 were both just completed: the oldest of the two days.
    const [j1] = await h.sql<{ last: string }>(
      `SELECT last_completed_on::text AS last FROM territories WHERE number = 'J1'`,
    );
    expect(j1.last).toBe(c.lastWorkedOn);
    const calls = await h.sql<{ number: string }>(
      `SELECT t.number FROM territory_no_calls n
         JOIN territories t ON t.id = n.territory_id WHERE n.id = $1`,
      [feld.id],
    );
    expect(calls).toEqual([{ number: 'J1' }]);
    // The year's sheet keeps J2's line, marked where it went (17 November
    // 2026); a territory put away without a line this year is not on it.
    const sheet = (await h.as('keeper').get('/territories/s13')).body as {
      territories: {
        number: string;
        archived: { on: string; joinedInto: string | null } | null;
        assignments: unknown[];
      }[];
    };
    const j2row = sheet.territories.find((t) => t.number === 'J2')!;
    expect(j2row.archived?.joinedInto).toBe('J1');
    expect(j2row.assignments.length).toBeGreaterThan(0);
    expect(
      sheet.territories.find((t) => t.number === 'J1')!.archived,
    ).toBeNull();
    // Back as it was: J2 in use again, its address with it.
    expect(
      (
        await h
          .as('keeper')
          .post(`/territory-recut/proposals/${joinId}/unapply`)
      ).status,
    ).toBe(201);
    const after = await territories();
    expect(after.find((t) => t.number === 'J2')!.archived).toBe(false);
    const [j2call] = await h.sql<{ number: string }>(
      `SELECT t.number FROM territory_no_calls n
         JOIN territories t ON t.id = n.territory_id WHERE n.id = $1`,
      [feld.id],
    );
    expect(j2call.number).toBe('J2');
  });

  it('a new measure sends the join back to the committee: nothing stays held back', async () => {
    expect(
      (
        await h.as('keeper').put(`/territory-recut/proposals/${joinId}/hold`, {
          territoryId: ids.J1,
          hold: true,
        })
      ).status,
    ).toBe(200);
    const view = (await h.as('keeper').get('/territory-recut')).body as {
      measure: Record<string, number>;
    };
    const r = await h.as('keeper').put('/territory-recut/measure', {
      ...view.measure,
      cityMaxKm: view.measure.cityMaxKm + 1,
    });
    expect(r.status).toBe(200);
    const [p] = await h.sql<{ hold_ids: string[]; approved: boolean }>(
      `SELECT hold_ids, approved_at IS NOT NULL AS approved FROM territory_recut_proposals WHERE id = $1`,
      [joinId],
    );
    expect(p).toEqual({ hold_ids: [], approved: false });
    // Not decided: nothing can be held back for it.
    const again = await h
      .as('keeper')
      .put(`/territory-recut/proposals/${joinId}/hold`, {
        territoryId: ids.J1,
        hold: true,
      });
    expect(again.status).toBe(409);
    expect((await give('J1')).status).toBe(201);
  });
});
