import { Harness, startHarness } from './harness';

/**
 * The keepers' marks on buildings (15 November 2026): «a home» or «not a
 * home» over the rule — kept through a map build, applied at once, and
 * written to the journal without any word about people.
 */
describe('marks on buildings (real database)', () => {
  let h: Harness;
  let congregationId = '';
  let territoryId = '';

  const east = (m: number) => m / (111_320 * Math.cos((51 * Math.PI) / 180));
  const north = (m: number) => m / 110_540;
  const X = 7.2;
  const Y = 51.2;
  const at = (dx: number, dy: number) => ({
    lon: X + east(dx),
    lat: Y + north(dy),
  });

  const house = (
    id: number,
    dx: number,
    dy: number,
    area: number,
    numbers: string | null,
    official: string | null,
    officialId: string | null,
  ) =>
    h.sql(
      `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2, numbers, official, official_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        congregationId,
        id,
        X + east(dx),
        Y + north(dy),
        area,
        numbers,
        official,
        officialId,
      ],
    );
  const homes = async () =>
    Object.fromEntries(
      (
        await h.sql<{ osm_id: string; home: boolean }>(
          `SELECT osm_id, home FROM map_houses WHERE congregation_id = $1 ORDER BY osm_id`,
          [congregationId],
        )
      ).map((r) => [Number(r.osm_id), r.home]),
    );
  /** The map build: the houses come again (new ids), then the rule. */
  const rebuild = async (shift: number) => {
    const rows = await h.sql<{
      osm_id: string;
      lon: number;
      lat: number;
      area_m2: number;
      numbers: string | null;
      official: string | null;
      official_id: string | null;
    }>(
      `SELECT osm_id, lon, lat, area_m2, numbers, official, official_id FROM map_houses WHERE congregation_id = $1`,
      [congregationId],
    );
    await h.sql(`DELETE FROM map_houses WHERE congregation_id = $1`, [
      congregationId,
    ]);
    for (const r of rows)
      await h.sql(
        `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2, numbers, official, official_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          congregationId,
          Number(r.osm_id) + shift,
          r.lon,
          r.lat,
          r.area_m2,
          r.numbers,
          r.official,
          r.official_id,
        ],
      );
    await h.sql(`SELECT mark_homes($1)`, [congregationId]);
  };

  beforeAll(async () => {
    h = await startHarness();
    const [c] = await h.sql<{ id: string }>(`SELECT id FROM congregations`);
    congregationId = c.id;
    const keeper = await h.addUser({
      login: 'mkeeper',
      role: 'ministerial_servant',
      publisherId: await h.addPublisher({
        firstName: 'Хранитель',
        lastName: 'Отметок',
        gender: 'brother',
        appointment: 'ministerial_servant',
        baptismDate: '2001-01-01',
      }),
    });
    await h.sql(
      `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, 'territory_servant', $2)`,
      [congregationId, keeper],
    );
    await h.addUser({
      login: 'mplain',
      role: 'publisher',
      publisherId: await h.addPublisher({
        firstName: 'Простой',
        lastName: 'Возвещатель',
        gender: 'brother',
        baptismDate: '2001-01-01',
      }),
    });
    const ring = [
      [X - 0.005, Y - 0.005],
      [X + 0.005, Y - 0.005],
      [X + 0.005, Y + 0.005],
      [X - 0.005, Y + 0.005],
      [X - 0.005, Y - 0.005],
    ];
    const [t] = await h.sql<{ id: string }>(
      `INSERT INTO territories (congregation_id, number, category, geometry)
       VALUES ($1, 'M1', 'residential', $2) RETURNING id`,
      [
        congregationId,
        JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
      ],
    );
    territoryId = t.id;
    await h.sql(
      `INSERT INTO territory_settings (congregation_id, houses_built_at, verified_at) VALUES ($1, now(), now())
       ON CONFLICT (congregation_id) DO UPDATE SET houses_built_at = now(), verified_at = now()`,
      [congregationId],
    );
    // Ahornweg 12, its annex drawn as a second piece, a shed with no
    // address of its own, a barn with a number.
    const address = (oid: string, dx: number, dy: number, number: string) =>
      h.sql(
        `INSERT INTO map_addresses (congregation_id, oid, lon, lat, number, street) VALUES ($1, $2, $3, $4, $5, 'Ahornweg')`,
        [congregationId, oid, X + east(dx), Y + north(dy), number],
      );
    await address('m12', 0, 0, '12');
    await address('m20', 200, 0, '20');
    await house(1, 0, 0, 120, '12', 'Wohngebäude', 'A');
    await house(2, 0, 12, 40, null, 'Wohngebäude', 'A');
    await house(3, 0, 25, 30, null, 'Sonstiges', 'S');
    await house(
      4,
      200,
      0,
      500,
      '20',
      'Gebäude für Land- und Forstwirtschaft',
      'B',
    );
    await h.sql(`SELECT mark_homes($1)`, [congregationId]);
  });

  afterAll(async () => {
    await h.sql(`DELETE FROM map_home_marks`);
    await h.sql(`DELETE FROM map_houses`);
    await h.sql(`DELETE FROM map_addresses`);
    await h?.close();
  });

  it('the rule first: the house, its annex with it, the shed and the barn out', async () => {
    expect(await homes()).toEqual({ 1: true, 2: false, 3: false, 4: false });
    const r = await h.as('mkeeper').get(`/territories/${territoryId}/homes`);
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({
      homes: 1,
      notHomes: 3,
      unsure: 1,
      marked: 0,
      gone: 0,
    });
    const by = (k: string) =>
      r.body.houses.find((x: { key: string }) => x.key === k);
    expect(by('1').label).toBe('Ahornweg 12');
    expect(by('2').pieceOf).toBe('Ahornweg 12');
    expect(by('3').near).toEqual({ label: 'Ahornweg 12', m: 25 });
    expect(by('3').pieceOf).toBeNull();
    expect(by('4').use).toBe('not');
  });

  it('a mark counts at once, and only the building is written down', async () => {
    const r = await h
      .as('mkeeper')
      .put(`/territories/${territoryId}/homes/mark`, {
        ...at(0, 25),
        home: true,
      });
    expect(r.status).toBe(200);
    expect(r.body.counts.homes).toBe(2);
    expect(r.body.counts.marked).toBe(1);
    const shed = r.body.houses.find((x: { key: string }) => x.key === '3');
    expect([shed.home, shed.byRule, shed.mark]).toEqual([true, false, true]);
    expect(await homes()).toEqual({ 1: true, 2: false, 3: true, 4: false });
    const journal = await h
      .as('admin')
      .get('/journal?entityType=territory&limit=20');
    expect(journal.status).toBe(200);
    const entry = journal.body.items.find(
      (e: { entityId: string }) => e.entityId === territoryId,
    );
    expect(JSON.stringify(entry)).toContain('"homeMark":"home"');
    // Nothing about the building or people: no address, no point.
    expect(JSON.stringify(entry)).not.toContain('Ahornweg');
  });

  it('the barn marked not a home stays out; marked again, one mark only', async () => {
    await h.as('mkeeper').put(`/territories/${territoryId}/homes/mark`, {
      ...at(200, 0),
      home: true,
    });
    await h.as('mkeeper').put(`/territories/${territoryId}/homes/mark`, {
      ...at(200, 0),
      home: false,
    });
    const [n] = await h.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM map_home_marks WHERE congregation_id = $1`,
      [congregationId],
    );
    expect(n.n).toBe(2);
    expect((await homes())[4]).toBe(false);
  });

  it('a map build keeps the marks: new ids, the same buildings', async () => {
    await rebuild(100);
    expect(await homes()).toEqual({
      101: true,
      102: false,
      103: true,
      104: false,
    });
  });

  it('taken back, the rule decides again', async () => {
    const r = await h
      .as('mkeeper')
      .put(`/territories/${territoryId}/homes/mark`, {
        ...at(0, 25),
        home: null,
      });
    expect(r.status).toBe(200);
    expect((await homes())[103]).toBe(false);
    expect(r.body.counts.marked).toBe(1);
  });

  it('a building gone from the map: its mark is shown as gone, and can be dropped', async () => {
    await h.sql(`DELETE FROM map_houses WHERE osm_id = 104`);
    const r = await h.as('mkeeper').get(`/territories/${territoryId}/homes`);
    expect(r.body.counts.gone).toBe(1);
    const g = r.body.gone[0];
    const drop = await h
      .as('mkeeper')
      .put(`/territories/${territoryId}/homes/mark`, {
        lon: g.lon,
        lat: g.lat,
        home: null,
      });
    expect(drop.status).toBe(200);
    expect(drop.body.counts.gone).toBe(0);
  });

  it('for the keepers only, and only inside the territory', async () => {
    expect(
      (await h.as('mplain').get(`/territories/${territoryId}/homes`)).status,
    ).toBe(403);
    expect(
      (
        await h.as('mplain').put(`/territories/${territoryId}/homes/mark`, {
          ...at(0, 0),
          home: false,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.as('mkeeper').put(`/territories/${territoryId}/homes/mark`, {
          ...at(3000, 0),
          home: false,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.as('mkeeper').put(`/territories/${territoryId}/homes/mark`, {
          ...at(0, 0),
          home: 'yes',
        })
      ).status,
    ).toBe(400);
  });
});
