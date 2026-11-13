import { Harness, startHarness } from './harness';
import { keptFrom } from '../../src/territories/service-year';

/**
 * The territory section, first stage (11 November 2026): who sees it, and
 * bringing the records over. Real database, real guards.
 */
describe('territories (real database)', () => {
  let h: Harness;
  let congregationId = '';
  let holderCard = '';
  const today = new Date().toISOString().slice(0, 10);

  const square = (x: number, y: number, size = 0.01) => ({
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
      ],
    ],
  });

  /** A rectangle from its south-west to its north-east corner. */
  const area = (x0: number, y0: number, x1: number, y1: number) => ({
    type: 'Polygon',
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
  });

  const give = async (userId: string, type: string) => {
    await h.sql(
      `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, $2, $3)`,
      [congregationId, type, userId],
    );
  };

  beforeAll(async () => {
    h = await startHarness();
    const [c] = await h.sql<{ id: string }>(`SELECT id FROM congregations`);
    congregationId = c.id;
    const card = (firstName: string, appointment = 'publisher') =>
      h.addPublisher({
        firstName,
        lastName: 'Тест',
        gender: 'brother',
        appointment,
        baptismDate: '2001-01-01',
      });
    holderCard = await card('Держатель');
    const keeper = await h.addUser({
      login: 'keeper',
      role: 'ministerial_servant',
      publisherId: await card('Хранитель', 'ministerial_servant'),
    });
    const secretary = await h.addUser({
      login: 'secretary',
      role: 'elder',
      publisherId: await card('Секретарь', 'elder'),
    });
    await h.addUser({
      login: 'plain',
      role: 'publisher',
      publisherId: holderCard,
    });
    await give(keeper, 'territory_servant');
    await give(secretary, 'secretary');
  });

  afterAll(async () => {
    await h?.close();
  });

  afterEach(async () => {
    await h.sql(`DELETE FROM territory_settings`);
    await h.sql(`DELETE FROM territory_assignments`);
    await h.sql(`DELETE FROM territory_no_calls`);
    await h.sql(`DELETE FROM territory_shapes`);
    await h.sql(`DELETE FROM territories`);
    await h.sql(`DELETE FROM territory_boundaries`);
    await h.sql(`DELETE FROM map_houses`);
  });

  const importTwo = async () => {
    const r = await h.as('keeper').post('/territories/import/territories', {
      items: [
        { number: 'A01', locality: 'Ahlen', geometry: square(7, 51) },
        { number: 'A02', locality: 'Ahlen', geometry: square(7.01, 51) },
      ],
    });
    expect(r.status).toBe(201);
    return r;
  };

  it('before confirming: only the keepers see the section', async () => {
    await importTwo();
    expect((await h.as('keeper').get('/territories')).status).toBe(200);
    expect((await h.as('admin').get('/territories')).status).toBe(200);
    expect((await h.as('secretary').get('/territories')).status).toBe(403);
    expect((await h.as('plain').get('/territories')).status).toBe(403);
    const a = await h.as('secretary').get('/territories/access');
    expect(a.body).toMatchObject({
      seesAll: false,
      keeps: false,
      verified: false,
    });
  });

  it('after confirming: the committee sees it, others still do not, the import closes', async () => {
    await importTwo();
    const v = await h.as('keeper').post('/territories/verify');
    expect(v.status).toBe(200);
    expect((await h.as('secretary').get('/territories')).status).toBe(200);
    expect((await h.as('plain').get('/territories')).status).toBe(403);
    // The committee sees, it does not keep.
    expect(
      (await h.as('secretary').post('/territories/import/reset')).status,
    ).toBe(403);
    const again = await h.as('keeper').post('/territories/import/territories', {
      items: [{ number: 'A03', geometry: square(7.02, 51) }],
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TERRITORY_IMPORT_CLOSED');
  });

  it('nothing to confirm is refused', async () => {
    const v = await h.as('keeper').post('/territories/verify');
    expect(v.status).toBe(400);
    expect(v.body.code).toBe('TERRITORY_NONE');
  });

  it('a number twice and a broken outline are refused, nothing saved', async () => {
    const twice = await h.as('keeper').post('/territories/import/territories', {
      items: [
        { number: 'A01', geometry: square(7, 51) },
        { number: 'a01 ', geometry: square(7.01, 51) },
      ],
    });
    expect(twice.status).toBe(400);
    expect(twice.body.code).toBe('TERRITORY_NUMBER_TWICE');
    const broken = await h
      .as('keeper')
      .post('/territories/import/territories', {
        items: [
          { number: 'A01', geometry: { type: 'Point', coordinates: [7, 51] } },
        ],
      });
    expect(broken.status).toBe(400);
    expect(broken.body.code).toBe('TERRITORY_GEOMETRY');
    expect(await h.sql(`SELECT id FROM territories`)).toEqual([]);
  });

  it('importing again updates by number and keeps the earlier outline', async () => {
    await importTwo();
    const r = await h.as('keeper').post('/territories/import/territories', {
      items: [{ number: 'a01', geometry: square(7, 51, 0.02) }],
    });
    expect(r.body).toEqual({ created: 0, updated: 1 });
    const shapes = await h.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM territory_shapes s JOIN territories t ON t.id = s.territory_id WHERE t.number = 'A01'`,
    );
    expect(shapes[0].n).toBe('2');
  });

  it('assignments: only the kept years come in, the holder name is kept as given', async () => {
    await importTwo();
    const from = keptFrom(today);
    const old = '2019-03-01';
    const r = await h.as('keeper').post('/territories/import/assignments', {
      items: [
        // Ended before the kept years: left out.
        {
          number: 'A01',
          holderName: 'Старый',
          assignedOn: old,
          completedOn: '2019-06-01',
        },
        // Inside the kept years, worked.
        {
          number: 'A01',
          holderName: 'Держатель Т.',
          publisherId: holderCard,
          assignedOn: from,
          completedOn: from,
        },
        // Open now.
        { number: 'A02', holderName: 'Ушедший', assignedOn: from },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ saved: 2, skipped: 1 });
    const list = await h.as('keeper').get('/territories');
    const a2 = (
      list.body as {
        number: string;
        holder: { name: string; dueOn: string } | null;
      }[]
    ).find((t) => t.number === 'A02');
    expect(a2?.holder?.name).toBe('Ушедший');
    expect(a2?.holder?.dueOn).toBeTruthy();
    // A plain day, the way every date travels (a raw date column once came
    // back as a timestamp and the app printed «Invalid Date»).
    const a1 = (
      list.body as { number: string; lastCompletedOn: string | null }[]
    ).find((t) => t.number === 'A01');
    expect(a1?.lastCompletedOn).toBe(from);
  });

  it('assignments: two open on one territory, a future date, a card from elsewhere are refused', async () => {
    await importTwo();
    const from = keptFrom(today);
    const two = await h.as('keeper').post('/territories/import/assignments', {
      items: [
        { number: 'A01', holderName: 'X', assignedOn: from },
        { number: 'A01', holderName: 'Y', assignedOn: from },
      ],
    });
    expect(two.body.code).toBe('TERRITORY_TWO_OPEN');
    const future = await h
      .as('keeper')
      .post('/territories/import/assignments', {
        items: [{ number: 'A01', holderName: 'X', assignedOn: '2099-01-01' }],
      });
    expect(future.body.code).toBe('TERRITORY_DATES');
    const stranger = await h
      .as('keeper')
      .post('/territories/import/assignments', {
        items: [
          {
            number: 'A01',
            holderName: 'X',
            assignedOn: from,
            publisherId: '00000000-0000-4000-8000-000000000000',
          },
        ],
      });
    expect(stranger.body.code).toBe('TERRITORY_HOLDER_UNKNOWN');
    expect(await h.sql(`SELECT id FROM territory_assignments`)).toEqual([]);
  });

  it('«не беспокоить» is sealed at rest and readable to the section', async () => {
    await importTwo();
    const r = await h.as('keeper').post('/territories/import/no-calls', {
      items: [{ number: 'A01', address: 'Musterstraße 1', notedOn: from() }],
    });
    expect(r.status).toBe(201);
    const raw = await h.sql<{ address: string }>(
      `SELECT address FROM territory_no_calls`,
    );
    expect(raw[0].address).not.toContain('Musterstraße');
    const [t] = await h.sql<{ id: string }>(
      `SELECT id FROM territories WHERE number = 'A01'`,
    );
    const d = await h.as('keeper').get(`/territories/${t.id}`);
    expect(d.body.noCalls[0].address).toBe('Musterstraße 1');
    expect((await h.as('plain').get(`/territories/${t.id}`)).status).toBe(403);
  });

  it('checks find a territory across the boundary and two laid over each other', async () => {
    await h.as('keeper').post('/territories/import/boundary', {
      geometry: square(7, 51, 0.05),
    });
    await h.as('keeper').post('/territories/import/territories', {
      items: [
        { number: 'IN', geometry: square(7.01, 51.01) },
        { number: 'OVER', geometry: square(7.015, 51.015) },
        { number: 'OUT', geometry: square(7.045, 51.01) },
      ],
    });
    const c = await h.as('keeper').get('/territories/checks');
    expect(c.status).toBe(200);
    expect(
      c.body.outsideBoundary.map((o: { number: string }) => o.number),
    ).toEqual(['OUT']);
    expect(c.body.overlapping).toEqual([['IN', 'OVER']]);
  });

  it('checks: an outline slid over its neighbour is found; houses no territory holds are shown as spots', async () => {
    // An L: the corner square at the north-east is outside, inside its box.
    await h.as('keeper').post('/territories/import/boundary', {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [7, 51],
            [7.05, 51],
            [7.05, 51.025],
            [7.025, 51.025],
            [7.025, 51.05],
            [7, 51.05],
            [7, 51],
          ],
        ],
      },
    });
    const slid = {
      type: 'Polygon',
      coordinates: [
        [
          [7.0, 51.0],
          [7.012, 51.0],
          [7.012, 51.01],
          [7.0, 51.01],
          [7.0, 51.0],
        ],
      ],
    };
    await h.as('keeper').post('/territories/import/territories', {
      items: [
        { number: 'W', geometry: slid },
        { number: 'E', geometry: square(7.01, 51) },
        // Long and thin, its border 165 m from the gap, its middle 1.1 km.
        { number: 'Long', geometry: area(7.016, 51.0315, 7.018, 51.049) },
        // A small square whose middle is nearer the gap than Long's middle,
        // its border farther than Long's border.
        { number: 'Mid', geometry: area(7.0137, 51.0195, 7.0177, 51.0235) },
        { number: 'Shop', geometry: area(7.001, 51.04, 7.005, 51.044) },
        // Small, right at the gap's west end: 49 m from its end house,
        // farther than Long from the gap's middle.
        { number: 'Edge', geometry: area(7.0105, 51.0295, 7.0118, 51.0305) },
      ],
    });
    await h.sql(
      `UPDATE territories SET category = 'business' WHERE number = 'Shop'`,
    );
    const c = await h.as('keeper').get('/territories/checks');
    expect(c.body.overlapping).toEqual([['E', 'W']]);

    // Before the register is built: nothing to show.
    const none = await h.as('keeper').get('/territories/gaps');
    expect(none.body).toMatchObject({ builtAt: null, houses: 0, spots: [] });
    let id = 1;
    const add = async (lon: number, lat: number) =>
      h.sql(
        `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2) VALUES ($1, $2, $3, $4, 100)`,
        [congregationId, id++, lon, lat],
      );
    for (let i = 0; i < 5; i++) await add(7.005, 51.001 + i * 0.001); // in W
    // A gap across two cells of the grid: one spot, not two halves.
    for (let i = 0; i < 14; i++) await add(7.0125 + i * 0.0005, 51.03);
    // An industrial estate: houses to the register, a business territory here.
    for (let i = 0; i < 10; i++) await add(7.002 + i * 0.0002, 51.042);
    for (let i = 0; i < 3; i++) await add(7.02, 51.045 - i * 0.004); // scattered
    for (let i = 0; i < 4; i++) await add(7.045, 51.045 - i * 0.001); // outside the L
    await h.sql(
      `INSERT INTO territory_settings (congregation_id, houses_built_at) VALUES ($1, now())`,
      [congregationId],
    );
    const g = await h.as('keeper').get('/territories/gaps');
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ houses: 27, inBusiness: 10, spotCount: 2 });
    expect(g.body.spots).toHaveLength(2);
    expect(g.body.spots[0]).toMatchObject({
      houses: 14,
      inBusiness: 0,
      near: 'Edge',
    });
    expect(g.body.spots[0].nearMetres).toBeGreaterThan(35);
    expect(g.body.spots[0].nearMetres).toBeLessThan(65);
    // The mark is one of the spot's own houses, not its middle.
    const gapHouses = Array.from({ length: 14 }, (_, i) =>
      Math.round((7.0125 + i * 0.0005) * 1e6),
    );
    expect(gapHouses).toContain(Math.round(g.body.spots[0].lon * 1e6));
    expect(g.body.spots[0].lat).toBe(51.03);
    expect(g.body.spots[1]).toMatchObject({ houses: 10, inBusiness: 10 });
    expect((await h.as('secretary').get('/territories/gaps')).status).toBe(403);

    // Kept between calls, but never past a changed outline: Long reaches
    // down over the gap, and the gap is gone at once.
    await h.sql(`UPDATE territories SET geometry = $1 WHERE number = 'Long'`, [
      JSON.stringify(area(7.011, 51.029, 7.02, 51.049)),
    ]);
    const after = await h.as('keeper').get('/territories/gaps');
    expect(after.body).toMatchObject({ houses: 13, spotCount: 1 });
  });

  function from(): string {
    return keptFrom(today);
  }

  describe('the card by hand (12 November 2026)', () => {
    const idOf = async (n: string) =>
      (
        await h.sql<{ id: string }>(
          `SELECT id FROM territories WHERE number = $1 AND archived_at IS NULL`,
          [n],
        )
      )[0].id;

    it('the keeper corrects number, place, kind and note; a number in use is refused; the S-13 shows the new one', async () => {
      await importTwo();
      const a1 = await idOf('A01');
      // Not before the records are confirmed.
      const early = await h
        .as('keeper')
        .patch(`/territories/${a1}`, { number: 'A10' });
      expect(early.body.code).toBe('TERRITORY_NOT_OPEN');
      expect((await h.as('keeper').post('/territories/verify')).status).toBe(
        200,
      );
      // The committee sees, it does not correct.
      expect(
        (await h.as('secretary').patch(`/territories/${a1}`, { number: 'A10' }))
          .status,
      ).toBe(403);
      const taken = await h
        .as('keeper')
        .patch(`/territories/${a1}`, { number: ' a02 ' });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('TERRITORY_NUMBER_TWICE');
      // The app's words name the number (12 November 2026: «{{number}}» showed).
      expect(taken.body.number).toBe('a02');
      const ok = await h.as('keeper').patch(`/territories/${a1}`, {
        number: ' A10 ',
        locality: '  ',
        kind: 'suburb',
        note: 'Многоэтажки — после 11:00',
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        number: 'A10',
        locality: null,
        kind: 'suburb',
      });
      const bad = await h
        .as('keeper')
        .patch(`/territories/${a1}`, { kind: 'town' });
      expect(bad.status).toBe(400);
      const s13 = await h.as('keeper').get('/territories/s13');
      expect(
        s13.body.territories.map((t: { number: string }) => t.number).sort(),
      ).toEqual(['A02', 'A10']);
      // The old number stays in the journal; the note does not go there.
      const [j] = await h.sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs WHERE entity_type = 'territory' AND entity_id = $1`,
        [a1],
      );
      expect(j.n).toBe('1');
    });

    it('out of use only when nobody holds it; back only while its number is free', async () => {
      await importTwo();
      expect((await h.as('keeper').post('/territories/verify')).status).toBe(
        200,
      );
      const a1 = await idOf('A01');
      const given = await h
        .as('keeper')
        .post(`/territories/${a1}/assign`, { publisherId: holderCard });
      expect(given.status).toBe(201);
      const held = await h.as('keeper').post(`/territories/${a1}/archive`);
      expect(held.body.code).toBe('TERRITORY_HELD');
      expect(
        (
          await h
            .as('keeper')
            .post(`/territories/assignments/${given.body.id}/return`, {})
        ).status,
      ).toBe(200);
      expect(
        (await h.as('keeper').post(`/territories/${a1}/archive`)).status,
      ).toBe(200);
      const list = await h.as('keeper').get('/territories');
      expect(list.body.map((t: { number: string }) => t.number)).toEqual([
        'A02',
      ]);
      const arch = await h.as('keeper').get('/territories/archived');
      expect(arch.body.map((t: { number: string }) => t.number)).toEqual([
        'A01',
      ]);
      // Its number is free: another may take it, and then it cannot come back.
      const a2 = await idOf('A02');
      expect(
        (await h.as('keeper').patch(`/territories/${a2}`, { number: 'A01' }))
          .status,
      ).toBe(200);
      const back = await h.as('keeper').post(`/territories/${a1}/restore`);
      expect(back.body.code).toBe('TERRITORY_NUMBER_TWICE');
      expect(
        (await h.as('keeper').patch(`/territories/${a2}`, { number: 'A02' }))
          .status,
      ).toBe(200);
      expect(
        (await h.as('keeper').post(`/territories/${a1}/restore`)).status,
      ).toBe(200);
      expect((await h.as('keeper').get('/territories')).body).toHaveLength(2);
      // The S-13 line of the archived time is still there.
      const lines = await h.sql(
        `SELECT id FROM territory_assignments WHERE territory_id = $1`,
        [a1],
      );
      expect(lines).toHaveLength(1);
    });

    it('business territories have their own S-13; everything so far is residential', async () => {
      await importTwo();
      expect((await h.as('keeper').post('/territories/verify')).status).toBe(
        200,
      );
      const list = await h.as('keeper').get('/territories');
      expect(list.body.map((t: { category: string }) => t.category)).toEqual([
        'residential',
        'residential',
      ]);
      await h.sql(
        `UPDATE territories SET category = 'business' WHERE number = 'A02'`,
      );
      const res = await h.as('keeper').get('/territories/s13');
      const biz = await h
        .as('keeper')
        .get('/territories/s13?category=business');
      expect(
        res.body.territories.map((t: { number: string }) => t.number),
      ).toEqual(['A01']);
      expect(
        biz.body.territories.map((t: { number: string }) => t.number),
      ).toEqual(['A02']);
      await expect(
        h.sql(`UPDATE territories SET category = 'shop' WHERE number = 'A02'`),
      ).rejects.toThrow();
    });
  });
  describe('a boundary drawn again by hand (12 November 2026)', () => {
    const idOf = async (n: string) =>
      (
        await h.sql<{ id: string }>(
          `SELECT id FROM territories WHERE number = $1 AND archived_at IS NULL`,
          [n],
        )
      )[0].id;
    const rect = (x1: number, x2: number, spike?: [number, number]) => ({
      type: 'Polygon',
      coordinates: [
        [
          [x1, 51],
          [x2, 51],
          ...(spike ? [spike] : []),
          [x2, 51.01],
          [x1, 51.01],
          [x1, 51],
        ],
      ],
    });
    const stamp = async (id: string) =>
      (
        await h.sql<{ u: Date }>(
          `SELECT updated_at AS u FROM territories WHERE id = $1`,
          [id],
        )
      )[0].u.toISOString();
    const outline = async (id: string) =>
      (
        await h.sql<{ g: { coordinates: number[][][] } }>(
          `SELECT geometry AS g FROM territories WHERE id = $1`,
          [id],
        )
      )[0].g.coordinates[0];
    const ready = async () => {
      await importTwo();
      expect((await h.as('keeper').post('/territories/verify')).status).toBe(
        200,
      );
      return { a1: await idOf('A01'), a2: await idOf('A02') };
    };

    it('a shared border moves in both; undo puts both back, once', async () => {
      const { a1, a2 } = await ready();
      const list = await h.as('keeper').get('/territories');
      expect(list.body[0].updatedAt).toBeTruthy();
      const body = {
        geometry: rect(7, 7.012),
        updatedAt: await stamp(a1),
        neighbours: [
          { id: a2, geometry: rect(7.012, 7.02), updatedAt: await stamp(a2) },
        ],
      };
      // The committee sees, it does not draw.
      expect(
        (await h.as('secretary').put(`/territories/${a1}/outline`, body))
          .status,
      ).toBe(403);
      const check = await h
        .as('keeper')
        .post(`/territories/${a1}/outline/check`, body);
      expect(check.status).toBe(200);
      expect(check.body.overlaps).toEqual([]);
      const [r1, r2] = check.body.territories;
      expect(r1).toMatchObject({ number: 'A01', leaving: 0, held: false });
      expect(r1.gaining).toBeGreaterThanOrEqual(15);
      expect(r2).toMatchObject({ number: 'A02', leaving: 20, gaining: 0 });
      // Checking saved nothing.
      expect((await outline(a1))[1][0]).toBe(7.01);

      const saved = await h
        .as('keeper')
        .put(`/territories/${a1}/outline`, body);
      expect(saved.status).toBe(200);
      expect(saved.body.saved).toBe(2);
      expect((await outline(a1))[1][0]).toBe(7.012);
      expect((await outline(a2))[0][0]).toBe(7.012);
      const shapes = await h.sql<{ e: string; reason: string }>(
        `SELECT edit_id AS e, reason FROM territory_shapes WHERE reason <> 'import'`,
      );
      expect(shapes).toHaveLength(2);
      expect(shapes[0].e).toBe(shapes[1].e);
      // One line in the journal for each of the two (sealed at rest).
      const journal = await h.sql<{ id: string }>(
        `SELECT entity_id AS id FROM audit_logs WHERE entity_type = 'territory' AND entity_id IN ($1, $2)`,
        [a1, a2],
      );
      expect(journal.map((j) => j.id).sort()).toEqual([a1, a2].sort());

      // The same request again: the outlines changed in between.
      const stale = await h
        .as('keeper')
        .put(`/territories/${a1}/outline`, body);
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('TERRITORY_CHANGED');

      // Undo from the neighbour's side puts both back.
      const undo = await h.as('keeper').post(`/territories/${a2}/outline/undo`);
      expect(undo.status).toBe(200);
      expect((await outline(a1))[1][0]).toBe(7.01);
      expect((await outline(a2))[0][0]).toBe(7.01);
      const again = await h
        .as('keeper')
        .post(`/territories/${a1}/outline/undo`);
      expect(again.body.code).toBe('TERRITORY_NOTHING_TO_UNDO');
    });

    it('undo waits while a neighbour changed since', async () => {
      const { a1, a2 } = await ready();
      await h.as('keeper').put(`/territories/${a1}/outline`, {
        geometry: rect(7, 7.012),
        updatedAt: await stamp(a1),
        neighbours: [
          { id: a2, geometry: rect(7.012, 7.02), updatedAt: await stamp(a2) },
        ],
      });
      // Then A02 alone gets a new eastern edge.
      const own = await h.as('keeper').put(`/territories/${a2}/outline`, {
        geometry: rect(7.012, 7.019),
        updatedAt: await stamp(a2),
      });
      expect(own.status).toBe(200);
      const undo = await h.as('keeper').post(`/territories/${a1}/outline/undo`);
      expect(undo.body.code).toBe('TERRITORY_CHANGED');
      expect((await outline(a1))[1][0]).toBe(7.012);
    });

    it('a held territory: a small change passes, more than a tenth waits', async () => {
      const { a1, a2 } = await ready();
      const given = await h
        .as('keeper')
        .post(`/territories/${a2}/assign`, { publisherId: holderCard });
      expect(given.status).toBe(201);
      const move = async (x: number) =>
        h.as('keeper').put(`/territories/${a1}/outline`, {
          geometry: rect(7, x),
          updatedAt: await stamp(a1),
          neighbours: [
            { id: a2, geometry: rect(x, 7.02), updatedAt: await stamp(a2) },
          ],
        });
      const big = await move(7.012);
      expect(big.status).toBe(409);
      expect(big.body).toMatchObject({
        code: 'TERRITORY_HELD_SHAPE',
        number: 'A02',
        share: 20,
      });
      // Nothing was saved, A01 neither.
      expect((await outline(a1))[1][0]).toBe(7.01);
      const small = await move(7.0105);
      expect(small.status).toBe(200);
      expect(small.body.territories[1]).toMatchObject({
        held: true,
        leaving: 5,
        tooMuch: false,
      });
    });

    it('a new overlap is refused, also one no corner shows; another kind may lie over', async () => {
      const { a1, a2 } = await ready();
      // Slid over the neighbour, which stays as it was.
      const slid = await h.as('keeper').put(`/territories/${a1}/outline`, {
        geometry: rect(7, 7.012),
        updatedAt: await stamp(a1),
      });
      expect(slid.status).toBe(409);
      expect(slid.body).toMatchObject({
        code: 'TERRITORY_OVERLAP',
        number: 'A01',
        other: 'A02',
      });
      // A neighbour of the other kind cannot share a border with it…
      await h.sql(
        `UPDATE territories SET category = 'business' WHERE id = $1`,
        [a2],
      );
      const mixed = await h.as('keeper').put(`/territories/${a1}/outline`, {
        geometry: rect(7, 7.012),
        updatedAt: await stamp(a1),
        neighbours: [
          { id: a2, geometry: rect(7.012, 7.02), updatedAt: await stamp(a2) },
        ],
      });
      expect(mixed.body.code).toBe('TERRITORY_NOT_NEIGHBOUR');
      // …and lying over it is no fault: business streets run through homes.
      const over = await h.as('keeper').put(`/territories/${a1}/outline`, {
        geometry: rect(7, 7.012, [7.015, 51.005]),
        updatedAt: await stamp(a1),
      });
      expect(over.status).toBe(200);
      // A broken outline is refused with its words.
      const broken = await h.as('keeper').put(`/territories/${a1}/outline`, {
        geometry: { type: 'Point', coordinates: [7, 51] },
        updatedAt: await stamp(a1),
      });
      expect(broken.body.code).toBe('TERRITORY_GEOMETRY');
    });

    describe('the register of houses (12 November 2026)', () => {
      /** Fills the register as the map job does, and marks it built. */
      const register = async (points: [number, number][]) => {
        let n = 1;
        for (const [lon, lat] of points) {
          await h.sql(
            `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2) VALUES ($1, $2, $3, $4, 120)`,
            [congregationId, n++, lon, lat],
          );
        }
        await h.sql(
          `INSERT INTO territory_settings (congregation_id, houses_built_at) VALUES ($1, now())
           ON CONFLICT (congregation_id) DO UPDATE SET houses_built_at = now()`,
          [congregationId],
        );
      };
      /** A02 (7.01–7.02) gets `strip` houses next to A01 and the rest far east. */
      const housesInA02 = (strip: number, total: number) => [
        ...Array.from(
          { length: strip },
          (_, i) => [7.0102, 51.001 + i * 0.0005] as [number, number],
        ),
        ...Array.from(
          { length: total - strip },
          (_, i) => [7.017, 51.001 + i * 0.0004] as [number, number],
        ),
      ];
      const moveBorder = async (a1: string, a2: string, x: number) =>
        h.as('keeper').put(`/territories/${a1}/outline`, {
          geometry: rect(7, x),
          updatedAt: await stamp(a1),
          neighbours: [
            { id: a2, geometry: rect(x, 7.02), updatedAt: await stamp(a2) },
          ],
        });

      it('without the register: no houses in the report', async () => {
        const { a1, a2 } = await ready();
        const r = await h
          .as('keeper')
          .post(`/territories/${a1}/outline/check`, {
            geometry: rect(7, 7.012),
            updatedAt: await stamp(a1),
            neighbours: [
              {
                id: a2,
                geometry: rect(7.012, 7.02),
                updatedAt: await stamp(a2),
              },
            ],
          });
        expect(r.body.territories[1].houses).toBeNull();
      });

      it('a held territory: the tenth is counted in houses, not ground', async () => {
        const { a1, a2 } = await ready();
        expect(
          (
            await h
              .as('keeper')
              .post(`/territories/${a2}/assign`, { publisherId: holderCard })
          ).status,
        ).toBe(201);
        // A fifth of the ground but one house in twenty: allowed now
        // (by ground alone it was refused).
        await register(housesInA02(1, 20));
        const wide = await moveBorder(a1, a2, 7.012);
        expect(wide.status).toBe(200);
        expect(wide.body.territories[1]).toMatchObject({
          number: 'A02',
          leaving: 20,
          houses: { before: 20, leaving: 1, coming: 0 },
          heldShare: 5,
          tooMuch: false,
        });
        expect(wide.body.territories[0].houses).toEqual({
          before: 0,
          leaving: 0,
          coming: 1,
        });
      });

      it('a held territory: little ground, but a fifth of its houses — refused', async () => {
        const { a1, a2 } = await ready();
        await h
          .as('keeper')
          .post(`/territories/${a2}/assign`, { publisherId: holderCard });
        await register(housesInA02(4, 20));
        const r = await moveBorder(a1, a2, 7.0105);
        expect(r.status).toBe(409);
        expect(r.body).toMatchObject({
          code: 'TERRITORY_HELD_SHAPE',
          number: 'A02',
          share: 20,
        });
      });

      it('the houses in a box: for keepers, a sane box only', async () => {
        await ready();
        const before = await h
          .as('keeper')
          .get('/territories/houses?box=7,51,7.02,51.01');
        expect(before.body).toEqual({ builtAt: null, houses: [] });
        await register([
          [7.005, 51.005],
          [7.0151234567, 51.0051234567],
          [7.5, 51.5],
        ]);
        const r = await h
          .as('keeper')
          .get('/territories/houses?box=7,51,7.02,51.01');
        expect(r.status).toBe(200);
        expect(r.body.builtAt).toBeTruthy();
        expect(r.body.houses).toEqual(
          expect.arrayContaining([
            [7.005, 51.005],
            [7.015123, 51.005123],
          ]),
        );
        expect(r.body.houses).toHaveLength(2);
        expect(
          (await h.as('keeper').get('/territories/houses?box=7,51,7.5,51.1'))
            .status,
        ).toBe(400);
        expect(
          (await h.as('keeper').get('/territories/houses?box=7,51,x,52'))
            .status,
        ).toBe(400);
        expect(
          (await h.as('keeper').get('/territories/houses?box=7,51,7.1,51.5'))
            .status,
        ).toBe(400);
        expect(
          (
            await h
              .as('secretary')
              .get('/territories/houses?box=7,51,7.02,51.01')
          ).status,
        ).toBe(403);
      });
    });

    it('a «не посещать» address moves to the neighbour', async () => {
      const { a1, a2 } = await ready();
      const n = await h
        .as('keeper')
        .post(`/territories/${a1}/no-calls`, { address: 'Weg 1' });
      expect(n.status).toBe(201);
      await h
        .as('keeper')
        .post(`/territories/${a2}/no-calls`, { address: 'Weg 2' });
      const moved = await h
        .as('keeper')
        .patch(`/territories/no-calls/${n.body.id}`, { territoryId: a2 });
      expect(moved.status).toBe(200);
      const [row] = await h.sql<{ t: string }>(
        `SELECT territory_id AS t FROM territory_no_calls WHERE id = $1`,
        [n.body.id],
      );
      expect(row.t).toBe(a2);
      // The same address twice in one territory is refused.
      const n3 = await h
        .as('keeper')
        .post(`/territories/${a1}/no-calls`, { address: 'Weg 2' });
      const twice = await h
        .as('keeper')
        .patch(`/territories/no-calls/${n3.body.id}`, { territoryId: a2 });
      expect(twice.body.code).toBe('TERRITORY_NO_CALL_TWICE');
    });
  });
});

describe('cutting, joining and new territories (12 November 2026)', () => {
  let h: Harness;
  let congregationId = '';
  const rect = (x1: number, x2: number, y1 = 51, y2 = 51.01) => ({
    type: 'Polygon',
    coordinates: [
      [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
        [x1, y1],
      ],
    ],
  });
  const idOf = async (n: string) =>
    (
      await h.sql<{ id: string }>(
        `SELECT id FROM territories WHERE number = $1 AND archived_at IS NULL`,
        [n],
      )
    )[0]?.id;
  const stamp = async (id: string) =>
    (
      await h.sql<{ u: Date }>(
        `SELECT updated_at AS u FROM territories WHERE id = $1`,
        [id],
      )
    )[0].u.toISOString();
  const worked = async (id: string, on: string) =>
    h.sql(
      `INSERT INTO territory_assignments (congregation_id, territory_id, holder_name, assigned_on, completed_on, method)
       VALUES ($1, $2, 'Тест', $3, $3, 'door_to_door')`,
      [congregationId, id, on],
    );
  const listed = async (n: string) =>
    (
      (await h.as('keeper').get('/territories')).body as {
        number: string;
        lastCompletedOn: string | null;
      }[]
    ).find((t) => t.number === n);
  const day = (offset: number) => {
    const d = new Date(keptFrom(new Date().toISOString().slice(0, 10)));
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    h = await startHarness();
    const [c] = await h.sql<{ id: string }>(`SELECT id FROM congregations`);
    congregationId = c.id;
    const card = await h.addPublisher({
      firstName: 'Хранитель',
      lastName: 'Тест',
      gender: 'brother',
      appointment: 'ministerial_servant',
      baptismDate: '2001-01-01',
    });
    const keeper = await h.addUser({
      login: 'keeper',
      role: 'ministerial_servant',
      publisherId: card,
    });
    await h.sql(
      `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, 'territory_servant', $2)`,
      [congregationId, keeper],
    );
    const r = await h.as('keeper').post('/territories/import/territories', {
      items: [
        { number: 'A01', locality: 'Ahlen', geometry: rect(7, 7.01) },
        { number: 'A02', locality: 'Ahlen', geometry: rect(7.01, 7.02) },
        { number: 'A05', locality: 'Ahlen', geometry: rect(7.05, 7.06) },
      ],
    });
    expect(r.status).toBe(201);
    expect((await h.as('keeper').post('/territories/verify')).status).toBe(200);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('cut: the chosen part keeps the number, the other gets a new one and the date', async () => {
    const a1 = await idOf('A01');
    await worked(a1, day(10));
    const n1 = await h
      .as('keeper')
      .post(`/territories/${a1}/no-calls`, { address: 'West 1' });
    const n2 = await h
      .as('keeper')
      .post(`/territories/${a1}/no-calls`, { address: 'Ost 1' });
    const line = [
      [7.004, 50.99],
      [7.004, 51.02],
    ];
    const check = await h
      .as('keeper')
      .post(`/territories/${a1}/split/check`, { line });
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({
      newNumber: 'A06',
      lastWorkedOn: day(10),
    });
    expect(check.body.parts).toHaveLength(2);
    // Which part is east: the larger one, which the check offers to keep.
    const east = check.body.parts.findIndex(
      (p: { geometry: { coordinates: number[][][] } }) =>
        p.geometry.coordinates[0].some(([x]) => x > 7.009),
    );
    expect(check.body.keep).toBe(east);
    const west = 1 - east;
    const r = await h.as('keeper').post(`/territories/${a1}/split`, {
      line,
      keep: east,
      newNumber: 'A06',
      updatedAt: await stamp(a1),
      noCalls: [
        { id: n1.body.id, part: west },
        { id: n2.body.id, part: east },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.kept.number).toBe('A01');
    expect(r.body.made.number).toBe('A06');
    const made = r.body.made.id;
    expect((await listed('A06'))?.lastCompletedOn).toBe(day(10));
    const nc = await h.sql<{ id: string; t: string }>(
      `SELECT id, territory_id AS t FROM territory_no_calls WHERE id IN ($1, $2)`,
      [n1.body.id, n2.body.id],
    );
    expect(nc.find((x) => x.id === n1.body.id)?.t).toBe(made);
    expect(nc.find((x) => x.id === n2.body.id)?.t).toBe(a1);
    // The S-13 history stays with A01.
    const lines = await h.sql(
      `SELECT id FROM territory_assignments WHERE territory_id = $1`,
      [a1],
    );
    expect(lines).toHaveLength(1);

    // Undo: A01 whole again, A06 gone, the address back; then nothing more.
    const undo = await h.as('keeper').post(`/territories/${a1}/reshape/undo`);
    expect(undo.status).toBe(200);
    expect(await idOf('A06')).toBeUndefined();
    const [back] = await h.sql<{ g: { coordinates: number[][][] } }>(
      `SELECT geometry AS g FROM territories WHERE id = $1`,
      [a1],
    );
    expect(back.g.coordinates[0].map(([x]) => x).sort()[0]).toBe(7);
    const [nb] = await h.sql<{ t: string }>(
      `SELECT territory_id AS t FROM territory_no_calls WHERE id = $1`,
      [n1.body.id],
    );
    expect(nb.t).toBe(a1);
    const again = await h.as('keeper').post(`/territories/${a1}/reshape/undo`);
    expect(again.body.code).toBe('TERRITORY_NOTHING_TO_UNDO');
  });

  it('cut: refused when held, for a number in use, for a line beside it', async () => {
    const a1 = await idOf('A01');
    const beside = await h.as('keeper').post(`/territories/${a1}/split/check`, {
      line: [
        [7.03, 50.99],
        [7.03, 51.02],
      ],
    });
    expect(beside.body.code).toBe('TERRITORY_LINE_NOT_THROUGH');
    const line = [
      [7.004, 50.99],
      [7.004, 51.02],
    ];
    const taken = await h.as('keeper').post(`/territories/${a1}/split`, {
      line,
      keep: 0,
      newNumber: ' a02 ',
      updatedAt: await stamp(a1),
    });
    expect(taken.body.code).toBe('TERRITORY_NUMBER_TWICE');
    await h.sql(
      `INSERT INTO territory_assignments (congregation_id, territory_id, holder_name, assigned_on)
       VALUES ($1, $2, 'Тест', $3)`,
      [congregationId, a1, day(20)],
    );
    const held = await h.as('keeper').post(`/territories/${a1}/split`, {
      line,
      keep: 0,
      newNumber: 'A07',
      updatedAt: await stamp(a1),
    });
    expect(held.body.code).toBe('TERRITORY_HELD');
    await h.sql(
      `UPDATE territory_assignments SET returned_on = $2 WHERE territory_id = $1 AND completed_on IS NULL`,
      [a1, day(21)],
    );
  });

  it('join: the older date counts; the other goes out of use; undo brings all back', async () => {
    const a1 = await idOf('A01');
    const a2 = await idOf('A02');
    await worked(a1, day(30));
    await worked(a2, day(5));
    const nc = await h
      .as('keeper')
      .post(`/territories/${a2}/no-calls`, { address: 'Gasse 9' });
    // The same address on both: it stays where it was.
    await h
      .as('keeper')
      .post(`/territories/${a1}/no-calls`, { address: 'Ost 1 ' });
    const dup = await h
      .as('keeper')
      .post(`/territories/${a2}/no-calls`, { address: 'Ost 1' });
    const check = await h
      .as('keeper')
      .post(`/territories/${a1}/merge/check`, { otherId: a2 });
    expect(check.status).toBe(200);
    expect(check.body.lastWorkedOn).toBe(day(5));
    expect(check.body.geometry.type).toBe('Polygon');
    const far = await h
      .as('keeper')
      .post(`/territories/${a1}/merge/check`, { otherId: await idOf('A05') });
    expect(far.body.code).toBe('TERRITORY_NOT_TOUCHING');
    const r = await h.as('keeper').post(`/territories/${a1}/merge`, {
      otherId: a2,
      keepId: a1,
      updatedAt: await stamp(a1),
      otherUpdatedAt: await stamp(a2),
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      kept: { number: 'A01' },
      archived: { number: 'A02' },
    });
    // A01 was worked later, but the joined one counts from the older date.
    expect((await listed('A01'))?.lastCompletedOn).toBe(day(5));
    expect(await listed('A02')).toBeUndefined();
    const detail = await h.as('keeper').get(`/territories/${a1}`);
    expect(detail.body.lastWorkedOn).toBe(day(5));
    const moved = await h.sql<{ id: string; t: string }>(
      `SELECT id, territory_id AS t FROM territory_no_calls WHERE id IN ($1, $2)`,
      [nc.body.id, dup.body.id],
    );
    expect(moved.find((x) => x.id === nc.body.id)?.t).toBe(a1);
    expect(moved.find((x) => x.id === dup.body.id)?.t).toBe(a2);

    const undo = await h.as('keeper').post(`/territories/${a1}/reshape/undo`);
    expect(undo.status).toBe(200);
    expect((await listed('A02'))?.lastCompletedOn).toBe(day(5));
    expect((await listed('A01'))?.lastCompletedOn).toBe(day(30));
    const [ncBack] = await h.sql<{ t: string }>(
      `SELECT territory_id AS t FROM territory_no_calls WHERE id = $1`,
      [nc.body.id],
    );
    expect(ncBack.t).toBe(a2);
  });

  it('join: refused when one is held or of the other kind; undo waits once given out', async () => {
    const a1 = await idOf('A01');
    const a2 = await idOf('A02');
    await h.sql(`UPDATE territories SET category = 'business' WHERE id = $1`, [
      a2,
    ]);
    const kind = await h
      .as('keeper')
      .post(`/territories/${a1}/merge/check`, { otherId: a2 });
    expect(kind.body.code).toBe('TERRITORY_NOT_NEIGHBOUR');
    await h.sql(
      `UPDATE territories SET category = 'residential' WHERE id = $1`,
      [a2],
    );
    await h.sql(
      `INSERT INTO territory_assignments (congregation_id, territory_id, holder_name, assigned_on)
       VALUES ($1, $2, 'Тест', $3)`,
      [congregationId, a2, day(40)],
    );
    const held = await h.as('keeper').post(`/territories/${a1}/merge`, {
      otherId: a2,
      keepId: a1,
      updatedAt: await stamp(a1),
      otherUpdatedAt: await stamp(a2),
    });
    expect(held.body.code).toBe('TERRITORY_HELD');
    await h.sql(
      `UPDATE territory_assignments SET returned_on = $2 WHERE territory_id = $1 AND completed_on IS NULL`,
      [a2, day(41)],
    );
    // Joined, then given out: the join stays.
    const r = await h.as('keeper').post(`/territories/${a1}/merge`, {
      otherId: a2,
      keepId: a2,
      updatedAt: await stamp(a1),
      otherUpdatedAt: await stamp(a2),
    });
    expect(r.status).toBe(200);
    expect(r.body.kept.number).toBe('A02');
    await h.sql(
      `INSERT INTO territory_assignments (congregation_id, territory_id, holder_name, assigned_on)
       VALUES ($1, $2, 'Тест', $3)`,
      [congregationId, a2, day(42)],
    );
    const undo = await h.as('keeper').post(`/territories/${a2}/reshape/undo`);
    expect(undo.body.code).toBe('TERRITORY_UNDO_GIVEN');
  });

  it('new: checked for houses and overlaps, made, refused over another, undone', async () => {
    const free = rect(7.03, 7.04);
    const check = await h
      .as('keeper')
      .post('/territories/new/check', { geometry: free });
    expect(check.status).toBe(200);
    expect(check.body.overlaps).toEqual([]);
    const next = await h.as('keeper').get('/territories/next-number?like=A05');
    expect(next.body.number).toBe('A06');
    const over = await h.as('keeper').post('/territories', {
      number: 'A08',
      geometry: rect(7.035, 7.055),
    });
    expect(over.body).toMatchObject({
      code: 'TERRITORY_OVERLAP',
      other: 'A05',
    });
    // A business territory may lie over homes.
    const biz = await h.as('keeper').post('/territories/new/check', {
      geometry: rect(7.035, 7.055),
      category: 'business',
    });
    expect(biz.body.overlaps).toEqual([]);
    const made = await h.as('keeper').post('/territories', {
      number: 'A06',
      locality: 'Ahlen',
      kind: 'city',
      geometry: free,
    });
    expect(made.status).toBe(201);
    expect(await idOf('A06')).toBe(made.body.id);
    const undo = await h
      .as('keeper')
      .post(`/territories/${made.body.id}/reshape/undo`);
    expect(undo.status).toBe(200);
    expect(await idOf('A06')).toBeUndefined();
  });
});
