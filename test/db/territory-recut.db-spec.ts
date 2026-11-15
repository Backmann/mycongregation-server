import { ConflictException } from '@nestjs/common';
import { TerritoryRecutService } from '../../src/territories/territory-recut.service';
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
      remoteMinutes: 13,
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
    await h.sql(`UPDATE territories SET geometry = $2 WHERE id = $1`, [
      ids.Big1,
      JSON.stringify(rect(7.0, 7.03)),
    ]);
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

  it('the figures: walk and homes of each territory, minutes from the hall found on the map', async () => {
    // A main road through all of them; one hall on it, one not on the map.
    await h.sql(
      `INSERT INTO map_streets (congregation_id, street_no, name, kind, west, south, east, north, lines)
       VALUES ($1, 1, 'Hauptstraße', 'major_road', 6.995, 51.0045, 7.1, 51.0045, $2)`,
      [
        congregationId,
        JSON.stringify([
          [
            [6.995, 51.0045],
            [7.1, 51.0045],
          ],
        ]),
      ],
    );
    // Further on the road has only a number: map_roads, not map_streets.
    await h.sql(
      `INSERT INTO map_roads (congregation_id, road_no, kind, west, south, east, north, lines)
       VALUES ($1, 1, 'major_road', 7.1, 51.0045, 7.215, 51.0045, $2)`,
      [
        congregationId,
        JSON.stringify([
          [
            [7.1, 51.0045],
            [7.215, 51.0045],
          ],
        ]),
      ],
    );
    await h.sql(
      `INSERT INTO map_addresses (congregation_id, oid, lon, lat, number, street)
       VALUES ($1, 'h1', 7.0, 51.0045, '1', 'Hauptstraße')`,
      [congregationId],
    );
    await h.sql(
      `INSERT INTO halls (congregation_id, name, address) VALUES
         ($1, 'Зал А', 'Hauptstr. 1, 59000 Hamm'),
         ($1, 'Зал Б', 'Unbekanntweg 3, 59000 Hamm')`,
      [congregationId],
    );
    expect(
      (await h.as('overseer').post('/territory-recut/figures')).status,
    ).toBe(403);
    const started = await h.as('keeper').post('/territory-recut/figures');
    expect(started.status).toBe(201);
    expect(started.body.computing).toBe(true);
    // Done in the background: looked at until the figures are in.
    let r = started;
    for (let i = 0; i < 100 && (r.body.computing || !r.body.metricsAt); i++) {
      await new Promise((ok) => setTimeout(ok, 100));
      r = await h.as('keeper').get('/territory-recut');
    }
    expect(r.body.computing).toBe(false);
    expect(r.body.metricsAt).not.toBeNull();
    expect(r.body.halls).toEqual([
      { name: 'Зал А', found: true },
      { name: 'Зал Б', found: false },
    ]);
    const t = (n: string) =>
      r.body.territories.find((x: { number: string }) => x.number === n);
    expect(t('Big1').homes).toBe(30);
    expect(t('Big1').walkKm).toBeGreaterThan(1.8);
    expect(t('Big1').walkKm).toBeLessThan(2.6);
    expect(t('S2').homes).toBe(10);
    expect(t('Big1').hall).toBe('Зал А');
    // ≈1 km along a main road from the hall: a minute or two; Far1 is 14 km out.
    expect(t('Big1').driveMinutes).toBeLessThan(3);
    expect(t('Big1').cls).toBe('city');
    expect(t('Far1').driveMinutes).toBeGreaterThan(11);
    expect(t('Far1').cls).toBe('far');
  });

  it('the keepers’ word over the minutes, and back', async () => {
    const r = await h
      .as('keeper')
      .put(`/territory-recut/classes/${ids.Big1}`, { cls: 'far' });
    expect(r.status).toBe(200);
    const big = r.body.territories.find(
      (x: { number: string }) => x.number === 'Big1',
    );
    expect([big.cls, big.word]).toEqual(['far', 'far']);
    const back = await h
      .as('keeper')
      .put(`/territory-recut/classes/${ids.Big1}`, { cls: null });
    expect(
      back.body.territories.find((x: { number: string }) => x.number === 'Big1')
        .word,
    ).toBeNull();
  });

  it('a first draft by the measure: the long one cut in even parts, the small ones joined', async () => {
    await h.sql(`DELETE FROM territory_recut_proposals`);
    // Big1 is far by the keepers' word; far walks of up to 1.5 km.
    await h
      .as('keeper')
      .put(`/territory-recut/classes/${ids.Big1}`, { cls: 'far' });
    await h.as('keeper').put('/territory-recut/measure', {
      cityMaxKm: 25,
      cityTargetKm: 15,
      remoteMaxKm: 1.5,
      remoteTargetKm: 1,
      minKm: 1,
      remoteMinutes: 11,
    });
    const r = await h.as('keeper').post('/territory-recut/suggest');
    expect(r.status).toBe(201);
    const cut = r.body.proposals.find(
      (p: { kind: string }) => p.kind === 'cut',
    );
    expect(cut.territories[0].number).toBe('Big1');
    expect(cut.queue).toBe(2);
    const homes = cut.parts.map((x: { homes: number }) => x.homes);
    expect(homes).toHaveLength(3);
    for (const n of homes) expect(Math.abs(n - 10)).toBeLessThanOrEqual(2);
    expect(cut.parts.map((x: { number: string }) => x.number).sort()).toEqual([
      'Big1',
      'Big2',
      'Big3',
    ]);
    const join = r.body.proposals.find(
      (p: { kind: string }) => p.kind === 'merge',
    );
    expect(
      join.territories.map((x: { number: string }) => x.number).sort(),
    ).toEqual(['S1', 'S2', 'S3']);
    expect(join.queue).toBe(1);
    // Asked again: nothing twice.
    const again = await h.as('keeper').post('/territory-recut/suggest');
    expect(again.body.proposals).toHaveLength(2);
    expect(again.body.suggested.made).toEqual([]);
  });

  it('the walk of each part: worked out in the background, about the whole between them', async () => {
    // Looked at until no part waits for its walk.
    let r = await recut();
    for (
      let i = 0;
      i < 100 &&
      (r.body.walking ||
        r.body.proposals.some((p: { parts: { walkKm: number | null }[] }) =>
          p.parts.some((x) => x.walkKm === null),
        ));
      i++
    ) {
      await new Promise((ok) => setTimeout(ok, 100));
      r = await recut();
    }
    const whole = r.body.territories.find(
      (x: { number: string }) => x.number === 'Big1',
    ).walkKm;
    const cut = r.body.proposals.find(
      (p: { kind: string }) => p.kind === 'cut',
    );
    const walks: number[] = cut.parts.map((x: { walkKm: number }) => x.walkKm);
    for (const w of walks) expect(w).toBeGreaterThan(0);
    // Each a third or so; together about the whole (no link between them).
    const sum = walks.reduce((n, w) => n + w, 0);
    expect(sum).toBeGreaterThan(whole * 0.8);
    expect(sum).toBeLessThan(whole * 1.1);
    const join = r.body.proposals.find(
      (p: { kind: string }) => p.kind === 'merge',
    );
    expect(join.parts[0].walkKm).toBeGreaterThan(0);
    // Kept by the border: only the parts there are now.
    const [row] = await h.sql<{ walks: Record<string, number> }>(
      `SELECT walks FROM territory_recuts`,
    );
    expect(Object.keys(row.walks)).toHaveLength(walks.length + 1);
    // A line moved: the new parts' walks, the old ones dropped.
    const moved = await h
      .as('keeper')
      .put(`/territory-recut/proposals/${cut.id}`, {
        kind: 'cut',
        territoryIds: [ids.Big1],
        lines: [vertical(7.011), vertical(7.021)],
        keep: 0,
        numbers: cut.numbers,
        queue: cut.queue,
      });
    expect(moved.status).toBe(200);
    r = await recut();
    for (
      let i = 0;
      i < 100 &&
      (r.body.walking ||
        r.body.proposals.some((p: { parts: { walkKm: number | null }[] }) =>
          p.parts.some((x) => x.walkKm === null),
        ));
      i++
    ) {
      await new Promise((ok) => setTimeout(ok, 100));
      r = await recut();
    }
    const [after] = await h.sql<{ walks: Record<string, number> }>(
      `SELECT walks FROM territory_recuts`,
    );
    expect(Object.keys(after.walks)).toHaveLength(walks.length + 1);
    expect(Object.keys(after.walks)).not.toEqual(Object.keys(row.walks));
  });

  it('a cut its own lines are refused for goes to the hand, the rest of the draft still made', async () => {
    await h.sql(`DELETE FROM territory_recut_proposals`);
    const service = h.app.get(TerritoryRecutService);
    const real = service.create.bind(service);
    const spy = jest
      .spyOn(service, 'create')
      .mockImplementation(async (user, dto, ...rest) => {
        if (dto.kind === 'cut') {
          throw new ConflictException({ code: 'TERRITORY_LINE_BAD' });
        }
        return real(user, dto, ...rest);
      });
    try {
      const r = await h.as('keeper').post('/territory-recut/suggest');
      expect(r.status).toBe(201);
      expect(r.body.suggested.byHand).toEqual(['Big1']);
      expect(r.body.suggested.made).toHaveLength(1);
      expect(r.body.proposals.map((p: { kind: string }) => p.kind)).toEqual([
        'merge',
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it('no first draft before the figures', async () => {
    await h.sql(
      `UPDATE territory_recuts SET metrics = NULL, metrics_at = NULL`,
    );
    const r = await h.as('keeper').post('/territory-recut/suggest');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TERRITORY_RECUT_NO_FIGURES');
  });
});
