import { Harness, startHarness } from './harness';

/**
 * The draft of re-cutting the territories (15 November 2026), on the real
 * database: the territory servant draws proposals, the service committee
 * remarks and records its decision, nothing touches a territory, and a
 * proposal changed much after the decision goes back to the committee.
 */
describe('the draft of re-cutting (real database)', () => {
  let h: Harness;
  let congregationId = '';
  const ids: Record<string, string> = {};

  /** A strip of the map, 0.01° wide, from x0. */
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
  const recut = () => h.as('keeper').get('/territory-recut');
  const proposalOf = async (number: string) =>
    (await recut()).body.proposals.find(
      (p: { territories: { number: string }[] }) =>
        p.territories.some((t) => t.number === number),
    );

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
    const give = (userId: string, type: string) =>
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
    await h.addUser({
      login: 'plain',
      role: 'publisher',
      publisherId: await card('Простой', 'publisher'),
    });
    await give(keeper, 'territory_servant');
    await give(overseer, 'service_overseer');
    const r = await h.as('keeper').post('/territories/import/territories', {
      items: [
        // One large strip to cut, three small ones in a row to join, one
        // apart from them.
        { number: 'Big1', locality: 'Hamm', geometry: rect(7.0, 7.03) },
        { number: 'S1', locality: 'Hamm', geometry: rect(7.03, 7.04) },
        { number: 'S2', locality: 'Hamm', geometry: rect(7.04, 7.05) },
        { number: 'S3', locality: 'Hamm', geometry: rect(7.05, 7.06) },
        { number: 'Far1', locality: 'Hamm', geometry: rect(7.2, 7.21) },
      ],
    });
    expect(r.status).toBe(201);
    expect((await h.as('keeper').post('/territories/verify')).status).toBe(200);
    for (const row of await h.sql<{ id: string; number: string }>(
      `SELECT id, number FROM territories`,
    ))
      ids[row.number] = row.id;
    // Thirty homes along the large strip, ten in each small one.
    let osm = 1;
    const home = (lon: number) =>
      h.sql(
        `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2, home)
         VALUES ($1, $2, $3, 51.0045, 120, true)`,
        [congregationId, osm++, lon],
      );
    for (let i = 0; i < 30; i++) await home(7.0005 + i * 0.001);
    for (let i = 0; i < 30; i++) await home(7.0305 + i * 0.001);
    await h.sql(
      `UPDATE territory_settings SET houses_built_at = now() WHERE congregation_id = $1`,
      [congregationId],
    );
  });

  afterAll(async () => {
    await h?.close();
  });

  it('nobody but the keepers draws; others with the section only look', async () => {
    expect((await h.as('plain').get('/territory-recut')).status).toBe(403);
    const view = await h.as('overseer').get('/territory-recut');
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      canEdit: false,
      canDecide: true,
      proposals: [],
    });
    expect(view.body.measure).toMatchObject({
      cityMaxKm: 25,
      remoteMaxKm: 30,
      remoteMinutes: 11,
    });
    expect(
      (
        await h.as('overseer').post('/territory-recut/proposals', {
          kind: 'merge',
          territoryIds: [ids.S1, ids.S2],
          keepId: ids.S1,
        })
      ).status,
    ).toBe(403);
  });

  it('a cut into three: the parts, their homes and numbers, nothing changed on the territory', async () => {
    const before = await h.sql(
      `SELECT geometry, updated_at FROM territories WHERE id = $1`,
      [ids.Big1],
    );
    const r = await h.as('keeper').post('/territory-recut/proposals', {
      kind: 'cut',
      territoryIds: [ids.Big1],
      lines: [vertical(7.01), vertical(7.02)],
      keep: 0,
      numbers: ['Big2', 'Big3'],
      queue: 2,
    });
    expect(r.status).toBe(201);
    const p = await proposalOf('Big1');
    expect(p.kind).toBe('cut');
    expect(p.queue).toBe(2);
    expect(
      p.parts.map((x: { number: string; homes: number }) => [
        x.number,
        x.homes,
      ]),
    ).toEqual([
      ['Big1', 10],
      ['Big2', 10],
      ['Big3', 10],
    ]);
    expect(p.blocks).toEqual(['notApproved']);
    expect(
      await h.sql(
        `SELECT geometry, updated_at FROM territories WHERE id = $1`,
        [ids.Big1],
      ),
    ).toEqual(before);
  });

  it('refused: a line beside it, a number in use, a territory already in a proposal', async () => {
    const beside = await h.as('keeper').post('/territory-recut/proposals', {
      kind: 'cut',
      territoryIds: [ids.Far1],
      lines: [vertical(7.5)],
      keep: 0,
      numbers: ['Far2'],
    });
    expect(beside.status).toBe(409);
    expect(beside.body.code).toBe('TERRITORY_LINE_NOT_THROUGH');
    const taken = await h.as('keeper').post('/territory-recut/proposals', {
      kind: 'cut',
      territoryIds: [ids.Far1],
      lines: [vertical(7.205)],
      keep: 0,
      numbers: ['S1'],
    });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('TERRITORY_NUMBER_TWICE');
    const promised = await h.as('keeper').post('/territory-recut/proposals', {
      kind: 'cut',
      territoryIds: [ids.Far1],
      lines: [vertical(7.205)],
      keep: 0,
      numbers: ['Big2'],
    });
    expect(promised.status).toBe(409);
    expect(promised.body.code).toBe('TERRITORY_NUMBER_TWICE');
    const twice = await h.as('keeper').post('/territory-recut/proposals', {
      kind: 'merge',
      territoryIds: [ids.Big1, ids.S1],
      keepId: ids.S1,
    });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('TERRITORY_IN_PROPOSAL');
    const apart = await h.as('keeper').post('/territory-recut/proposals', {
      kind: 'merge',
      territoryIds: [ids.S3, ids.Far1],
      keepId: ids.S3,
    });
    expect(apart.status).toBe(409);
    expect(apart.body.code).toBe('TERRITORY_NOT_TOUCHING');
  });

  it('a join of three: one part with all their homes, the kept number', async () => {
    const r = await h.as('keeper').post('/territory-recut/proposals', {
      kind: 'merge',
      territoryIds: [ids.S1, ids.S3, ids.S2],
      keepId: ids.S2,
    });
    expect(r.status).toBe(201);
    const p = await proposalOf('S1');
    expect(
      p.parts.map((x: { number: string; homes: number }) => [
        x.number,
        x.homes,
      ]),
    ).toEqual([['S2', 30]]);
  });

  it('remarks: «no remarks» or words about the border; words are needed; not for everybody', async () => {
    const p = await proposalOf('Big1');
    expect(
      (
        await h
          .as('overseer')
          .put(`/territory-recut/proposals/${p.id}/remark`, { ok: false })
      ).status,
    ).toBe(400);
    const r = await h
      .as('overseer')
      .put(`/territory-recut/proposals/${p.id}/remark`, {
        ok: false,
        text: 'Северную линию лучше по главной улице',
      });
    expect(r.status).toBe(200);
    expect(
      (
        await h
          .as('plain')
          .put(`/territory-recut/proposals/${p.id}/remark`, { ok: true })
      ).status,
    ).toBe(403);
    const seen = await proposalOf('Big1');
    expect(seen.remarks).toEqual([
      expect.objectContaining({
        mine: false,
        by: 'Служебный Тест',
        ok: false,
        text: 'Северную линию лучше по главной улице',
      }),
    ]);
  });

  it('the decision: only the committee records it; a small redraw keeps it, a large one reopens it', async () => {
    expect((await h.as('keeper').post('/territory-recut/approve')).status).toBe(
      403,
    );
    const ok = await h.as('overseer').post('/territory-recut/approve');
    expect(ok.status).toBe(201);
    const p = await proposalOf('Big1');
    expect(p.approvedAt).not.toBeNull();
    expect(p.blocks).toEqual([]);
    const redraw = (x: number) =>
      h.as('keeper').put(`/territory-recut/proposals/${p.id}`, {
        kind: 'cut',
        territoryIds: [ids.Big1],
        lines: [vertical(x), vertical(7.02)],
        keep: 0,
        numbers: ['Big2', 'Big3'],
        queue: 2,
      });
    // One home of thirty moves (≈3%): the decision stands.
    expect((await redraw(7.0112)).status).toBe(200);
    expect((await proposalOf('Big1')).approvedAt).not.toBeNull();
    // Five of thirty (≈17%): back to the committee.
    expect((await redraw(7.016)).status).toBe(200);
    const back = await proposalOf('Big1');
    expect(back.approvedAt).toBeNull();
    expect(back.reopenedAt).not.toBeNull();
    expect(back.blocks).toContain('notApproved');
  });

  it('a new measure sends decided proposals back; a measure that does not hold is refused', async () => {
    await h.as('overseer').post('/territory-recut/approve');
    const bad = await h.as('keeper').put('/territory-recut/measure', {
      cityMaxKm: 25,
      cityTargetKm: 30,
      remoteMaxKm: 30,
      remoteTargetKm: 20,
      minKm: 5,
      remoteMinutes: 11,
    });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('TERRITORY_RECUT_MEASURE');
    const r = await h.as('keeper').put('/territory-recut/measure', {
      cityMaxKm: 25,
      cityTargetKm: 15,
      remoteMaxKm: 35,
      remoteTargetKm: 20,
      minKm: 5,
      remoteMinutes: 11,
    });
    expect(r.status).toBe(200);
    expect(r.body.measure.remoteMaxKm).toBe(35);
    expect(
      r.body.proposals.every(
        (p: { approvedAt: string | null }) => !p.approvedAt,
      ),
    ).toBe(true);
  });

  it('what stands in the way: held, a border moved since — not giving out alone', async () => {
    await h.as('overseer').post('/territory-recut/approve');
    // Given out and taken back: the row changes, the border does not.
    await h.sql(
      `INSERT INTO territory_assignments (congregation_id, territory_id, holder_name, assigned_on, completed_on)
       VALUES ($1, $2, 'Тест', current_date - 30, current_date - 1)`,
      [congregationId, ids.Big1],
    );
    await h.sql(`UPDATE territories SET updated_at = now() WHERE id = $1`, [
      ids.Big1,
    ]);
    expect((await proposalOf('Big1')).blocks).toEqual([]);
    await h.sql(
      `INSERT INTO territory_assignments (congregation_id, territory_id, holder_name, assigned_on)
       VALUES ($1, $2, 'Тест', current_date)`,
      [congregationId, ids.Big1],
    );
    expect((await proposalOf('Big1')).blocks).toEqual(['held']);
    await h.sql(`DELETE FROM territory_assignments WHERE completed_on IS NULL`);
    await h.sql(`UPDATE territories SET geometry = $2 WHERE id = $1`, [
      ids.Big1,
      JSON.stringify(rect(7.0, 7.031)),
    ]);
    const moved = await proposalOf('Big1');
    expect(moved.blocks).toEqual(['changed']);
    expect(moved.territories[0].changed).toBe(true);
  });

  it('a proposal taken out goes with its remarks; the journal names no remark', async () => {
    const p = await proposalOf('Big1');
    const r = await h.as('keeper').delete(`/territory-recut/proposals/${p.id}`);
    expect(r.status).toBe(200);
    expect(
      await h.sql(
        `SELECT 1 FROM territory_recut_remarks WHERE proposal_id = $1`,
        [p.id],
      ),
    ).toEqual([]);
    const journal = await h
      .as('admin')
      .get('/journal?entityType=territory&limit=50');
    expect(journal.status).toBe(200);
    const text = JSON.stringify(journal.body);
    expect(text).toContain('"recut":"approved"');
    expect(text).not.toContain('главной улице');
  });
});
