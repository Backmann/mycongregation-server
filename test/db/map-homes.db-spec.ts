import { officialUse } from '../../src/territories/official-use';
import { OFFICIAL_WORDS } from '../../src/territories/official-use.words';
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

  // The homes survey (14 November 2026): what the cadastre says against
  // what is counted now — counts and samples, nothing changed.
  it('the survey sets the cadastre against what is counted now', async () => {
    const say = (id: number, official: string) =>
      h.sql(`UPDATE map_houses SET official = $2 WHERE osm_id = $1`, [
        id,
        official,
      ]);
    await say(1, 'Wohngebäude');
    await say(3, 'Wohngebäude'); // left out now, a home by the cadastre
    await say(4, 'Gebäude für Land- und Forstwirtschaft'); // counted now, a barn
    await say(5, 'Sonstiges');
    const before = await homes();
    const r = await h.as('hkeeper').get(`/territories/homes-survey`);
    expect(r.status).toBe(200);
    expect(r.body.houses).toBe(6);
    expect(r.body.known).toBe(4);
    const n = (use: string, homeNow: boolean) =>
      r.body.table.find(
        (x: { use: string; homeNow: boolean }) =>
          x.use === use && x.homeNow === homeNow,
      )?.outside ?? 0;
    expect([n('home', true), n('home', false), n('not', true)]).toEqual([
      1, 1, 1,
    ]);
    expect([
      n('unsure', true),
      n('unknown', true),
      n('unknown', false),
    ]).toEqual([1, 1, 1]);
    const s = r.body.samples;
    expect(s.homeNowNotByCadastre).toHaveLength(1);
    expect(s.homeNowNotByCadastre[0].official).toBe(
      'Gebäude für Land- und Forstwirtschaft',
    );
    expect(s.notNowHomeByCadastre).toHaveLength(1);
    expect(s.unsure).toHaveLength(1);
    expect(s.unknown).toHaveLength(2);
    expect(r.body.words[0]).toEqual({
      official: 'Wohngebäude',
      use: 'home',
      n: 2,
    });
    // Nothing changed.
    expect(await homes()).toEqual(before);
  });

  // The rule by the cadastre (15 November 2026), inside a territory: it
  // takes away (a barn; a further piece of one building), never adds.
  it('the survey counts the rule inside the territories', async () => {
    const ring = [
      [X - 0.01, Y - 0.01],
      [X + 0.01, Y - 0.01],
      [X + 0.01, Y + 0.01],
      [X - 0.01, Y + 0.01],
      [X - 0.01, Y - 0.01],
    ];
    await h.sql(
      `INSERT INTO territories (congregation_id, number, category, geometry) VALUES ($1, 'T1', 'residential', $2)`,
      [
        congregationId,
        JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
      ],
    );
    const set = (id: number, official: string, officialId: string) =>
      h.sql(
        `UPDATE map_houses SET official = $2, official_id = $3 WHERE osm_id = $1`,
        [id, official, officialId],
      );
    await set(1, 'Wohngebäude', 'A'); // Ahornweg 12
    await set(2, 'Wohngebäude', 'A'); // drawn as a second piece of it
    await set(3, 'Wohngebäude', 'C'); // left out now: stays out (no address)
    await set(4, 'Gebäude für Land- und Forstwirtschaft', 'D'); // dropped
    await set(5, 'Sonstiges', 'E'); // unsure: stays
    const before = await homes();
    const r = await h.as('hkeeper').get(`/territories/homes-survey`);
    expect(r.status).toBe(200);
    expect(r.body.rule).toEqual({
      now: 3,
      then: 2,
      added: 0,
      dropped: 1,
      pieces: 1,
      inPieces: 1,
    });
    expect(r.body.samples.piece).toHaveLength(1);
    expect(r.body.samples.added).toHaveLength(0);
    expect(await homes()).toEqual(before);
  });

  // homes_rule() in detail (15 November 2026), on its own houses.
  describe('homes by the cadastre', () => {
    let n = 100;
    const at = async (
      official: string | null,
      officialId: string | null,
      numbers: string | null,
      area: number,
      dx: number,
    ) => {
      n += 1;
      await h.sql(
        `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2, numbers, official, official_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          congregationId,
          n,
          X + east(dx),
          Y + north(-500),
          area,
          numbers,
          official,
          officialId,
        ],
      );
      return n;
    };
    const rule = async () =>
      Object.fromEntries(
        (
          await h.sql<{ osm_id: string; home: boolean }>(
            `SELECT osm_id, home FROM homes_rule($1) WHERE osm_id > 100`,
            [congregationId],
          )
        ).map((r) => [Number(r.osm_id), r.home]),
      );

    it('says, per house, what the map build will write', async () => {
      // No addresses round here: the rule without the cadastre keeps all.
      const semiA = await at('Wohngebäude', 'S', '7', 90, 0);
      const semiB = await at('Wohngebäude', 'S', '7a', 85, 12);
      const semiAnnex = await at('Wohngebäude', 'S', null, 20, 24);
      const twinBig = await at('Wohngebäude', 'T', '12', 90, 60);
      const twinSmall = await at('Wohngebäude', 'T', '12', 30, 72);
      const loneBig = await at('Wohngebäude', 'L', null, 120, 120);
      const loneSmall = await at('Wohngebäude', 'L', null, 40, 132);
      const barn = await at(
        'Gebäude für Land- und Forstwirtschaft',
        'B',
        '5',
        600,
        180,
      );
      const unsure = await at('Sonstiges', 'U', null, 60, 240);
      const unknown = await at(null, null, null, 60, 300);
      const r = await rule();
      expect([r[semiA], r[semiB], r[semiAnnex]]).toEqual([true, true, false]);
      expect([r[twinBig], r[twinSmall]]).toEqual([true, false]);
      expect([r[loneBig], r[loneSmall]]).toEqual([true, false]);
      expect([r[barn], r[unsure], r[unknown]]).toEqual([false, true, true]);
      // mark_homes() writes exactly that.
      await h.sql(`SELECT mark_homes($1)`, [congregationId]);
      const stored = Object.fromEntries(
        (
          await h.sql<{ osm_id: string; home: boolean }>(
            `SELECT osm_id, home FROM map_houses WHERE osm_id > 100`,
          )
        ).map((x) => [Number(x.osm_id), x.home]),
      );
      expect(stored).toEqual(r);
    });

    it("the database and the app read the cadastre's words alike", async () => {
      for (const [word, want] of OFFICIAL_WORDS) {
        const [x] = await h.sql<{ u: string | null }>(
          `SELECT official_use($1) AS u`,
          [word],
        );
        expect([word, x.u]).toEqual([word, want]);
        expect(officialUse(word)).toBe(want);
      }
      const [none] = await h.sql<{ u: string | null }>(
        `SELECT official_use(NULL) AS u`,
      );
      expect(none.u).toBeNull();
    });
  });

  it('the survey is for the keepers only', async () => {
    await h.addUser({
      login: 'hplain',
      role: 'publisher',
      publisherId: await h.addPublisher({
        firstName: 'Простой',
        lastName: 'Тест',
        gender: 'brother',
        baptismDate: '2001-01-01',
      }),
    });
    const r = await h.as('hplain').get(`/territories/homes-survey`);
    expect(r.status).toBe(403);
  });
});
