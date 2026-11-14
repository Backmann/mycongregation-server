import { Harness, startHarness } from './harness';

/**
 * Only homes count (14 November 2026): `mark_homes()` on the real
 * database, and the register as the keepers' map shows it afterwards.
 */
describe('only homes count (real database)', () => {
  let h: Harness;
  let congregationId = '';

  // Metres to degrees at 51° N.
  const east = (m: number) => m / (111_320 * Math.cos((51 * Math.PI) / 180));
  const north = (m: number) => m / 110_540;
  const X = 7.0;
  const Y = 51.0;

  const house = (
    id: number,
    dx: number,
    dy: number,
    area: number,
    numbers: string | null = null,
  ) =>
    h.sql(
      `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2, numbers) VALUES ($1, $2, $3, $4, $5, $6)`,
      [congregationId, id, X + east(dx), Y + north(dy), area, numbers],
    );
  const address = (
    oid: string,
    dx: number,
    dy: number,
    number: string,
    street: string,
  ) =>
    h.sql(
      `INSERT INTO map_addresses (congregation_id, oid, lon, lat, number, street) VALUES ($1, $2, $3, $4, $5, $6)`,
      [congregationId, oid, X + east(dx), Y + north(dy), number, street],
    );
  const homes = async () =>
    Object.fromEntries(
      (
        await h.sql<{ osm_id: string; home: boolean }>(
          `SELECT osm_id, home FROM map_houses ORDER BY osm_id`,
        )
      ).map((r) => [Number(r.osm_id), r.home]),
    );

  beforeAll(async () => {
    h = await startHarness();
    const [c] = await h.sql<{ id: string }>(`SELECT id FROM congregations`);
    congregationId = c.id;
    const keeper = await h.addUser({
      login: 'hkeeper',
      role: 'ministerial_servant',
      publisherId: await h.addPublisher({
        firstName: 'Хранитель',
        lastName: 'Тест',
        gender: 'brother',
        appointment: 'ministerial_servant',
        baptismDate: '2001-01-01',
      }),
    });
    await h.sql(
      `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, 'territory_servant', $2)`,
      [congregationId, keeper],
    );
    // Ahornweg 12 with its garage 10 m behind it.
    await address('a12', 0, 0, '12', 'Ahornweg');
    await house(1, 0, 0, 120, '12');
    await house(2, 0, 10, 30);
    // A shed of 100 m² with no address near (60 m from Ahornweg 12).
    await house(3, 60, 0, 100);
    // A barn: big, kept until a keeper marks it.
    await house(4, 120, 0, 400);
    // Birkenweg 12 round the corner, 35 m off: a home the map has no
    // number for — not Ahornweg 12's.
    await address('b12', 0, 35, '12', 'Birkenweg');
    await house(5, 0, 35, 110);
    // Far from any address (another Land, an older build): kept.
    await house(6, 3000, 0, 40);
  });

  afterAll(async () => {
    await h.sql(`DELETE FROM map_houses`);
    await h.sql(`DELETE FROM map_addresses`);
    await h.sql(`DELETE FROM territory_settings`);
    await h?.close();
  });

  it('every building counts until the rule has run', async () => {
    expect(Object.values(await homes()).every(Boolean)).toBe(true);
  });

  it('garages and sheds without an address of their own are left out', async () => {
    const [r] = await h.sql<{ n: number }>(`SELECT mark_homes($1) AS n`, [
      congregationId,
    ]);
    expect(r.n).toBe(2);
    expect(await homes()).toEqual({
      1: true,
      2: false,
      3: false,
      4: true,
      5: true,
      6: true,
    });
    // Run again: nothing changes.
    const [again] = await h.sql<{ n: number }>(`SELECT mark_homes($1) AS n`, [
      congregationId,
    ]);
    expect(again.n).toBe(0);
  });

  it('the keepers map shows the homes only', async () => {
    await h.sql(
      `INSERT INTO territory_settings (congregation_id, houses_built_at, verified_at) VALUES ($1, now(), now())`,
      [congregationId],
    );
    const r = await h
      .as('hkeeper')
      .get(`/territories/houses?box=6.99,50.99,7.1,51.01`);
    expect(r.status).toBe(200);
    expect(r.body.houses).toHaveLength(4);
  });
});
