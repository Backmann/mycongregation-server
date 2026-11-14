import { createHmac } from 'crypto';
import { Harness, startHarness } from './harness';
import { dbEnv } from './env';

/**
 * A territory divided between groups for a day (13 November 2026): who may
 * divide and divide again, the parts, «street walked», a part's link without
 * login and what it may never carry. Real database, real guards.
 */
describe('territory divisions between groups (real database)', () => {
  let h: Harness;
  let congregationId = '';
  const card: Record<string, string> = {};
  let groupOne = '';
  let territoryId = '';

  // About 700 m east-west, 1.1 km north-south at 51° N.
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

  // Three streets across the territory, ten houses along each (north side).
  const STREETS: [string, number][] = [
    ['Ahornweg', 51.002],
    ['Birkenweg', 51.005],
    ['Kastanienallee', 51.008],
  ];

  beforeAll(async () => {
    h = await startHarness();
    const [c] = await h.sql<{ id: string }>(`SELECT id FROM congregations`);
    congregationId = c.id;
    const user = async (
      login: string,
      role: 'publisher' | 'elder' | 'ministerial_servant',
      firstName: string,
    ) => {
      card[login] = await h.addPublisher({
        firstName,
        lastName: 'Тест',
        gender: 'brother',
        appointment: role,
        baptismDate: '2001-01-01',
      });
      return h.addUser({ login, role, publisherId: card[login] });
    };
    const keeper = await user('dkeeper', 'ministerial_servant', 'Хранитель');
    await user('dholder', 'publisher', 'Держатель');
    await user('dmember', 'publisher', 'Участник');
    await user('dstranger', 'publisher', 'Чужой');
    await h.sql(
      `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, 'territory_servant', $2)`,
      [congregationId, keeper],
    );
    const [g1] = await h.sql<{ id: string }>(
      `INSERT INTO service_groups (congregation_id, name) VALUES ($1, 'Группа Д') RETURNING id`,
      [congregationId],
    );
    groupOne = g1.id;
    await h.sql(
      `UPDATE publishers SET service_group_id = $1 WHERE id = ANY($2::uuid[])`,
      [g1.id, [card.dholder, card.dmember]],
    );
    let no = 0;
    for (const [name, y] of STREETS) {
      no += 1;
      await h.sql(
        `INSERT INTO map_streets (congregation_id, street_no, name, kind, west, south, east, north, lines)
         VALUES ($1, $2, $3, 'minor_road', 7.0, $4, 7.01, $4, $5)`,
        [
          congregationId,
          no,
          name,
          y,
          JSON.stringify([
            [
              [7.0, y],
              [7.01, y],
            ],
          ]),
        ],
      );
      for (let i = 0; i < 10; i++) {
        await h.sql(
          `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2) VALUES ($1, $2, $3, $4, 120)`,
          [congregationId, no * 100 + i, 7.0005 + i * 0.0009, y + 0.0002],
        );
      }
    }
    // A street and a house of the next territory: never in this one.
    await h.sql(
      `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2) VALUES ($1, 999, 7.5, 51.5, 120)`,
      [congregationId],
    );
  });

  afterAll(async () => {
    await h.sql(`DELETE FROM map_houses`);
    await h.sql(`DELETE FROM map_streets`);
    await h?.close();
  });

  beforeEach(async () => {
    const r = await h.as('dkeeper').post('/territories/import/territories', {
      items: [{ number: 'D01', geometry: square(7, 51) }],
    });
    expect(r.status).toBe(201);
    await h.as('dkeeper').post('/territories/import/no-calls', {
      items: [
        { number: 'D01', address: 'Birkenweg 4', notedOn: '2026-01-10' },
        { number: 'D01', address: 'Musterstraße 1', notedOn: '2026-01-10' },
      ],
    });
    const [t] = await h.sql<{ id: string }>(
      `SELECT id FROM territories WHERE number = 'D01'`,
    );
    territoryId = t.id;
    expect((await h.as('dkeeper').post('/territories/verify')).status).toBe(
      200,
    );
  });

  afterEach(async () => {
    await h.sql(`DELETE FROM territory_street_marks`);
    await h.sql(`DELETE FROM territory_splits`);
    await h.sql(`DELETE FROM territory_settings`);
    await h.sql(`DELETE FROM territory_assignments`);
    await h.sql(`DELETE FROM territory_no_calls`);
    await h.sql(`DELETE FROM territory_shapes`);
    await h.sql(`DELETE FROM territories`);
  });

  type Street = {
    key: string;
    name: string;
    houses: number;
    walkedAt: string | null;
  };
  type Part = {
    n: number;
    houses: number;
    streets: Street[];
    noCalls?: { address: string }[];
  };
  type Division = {
    houses: number;
    walked: number;
    mayRedo: boolean;
    mayComplete: boolean;
    split: null | { id: string; parts: Part[]; byMe: boolean };
  };

  const give = async () => {
    const r = await h.as('dkeeper').post(`/territories/${territoryId}/assign`, {
      publisherId: card.dholder,
      forGroupId: groupOne,
    });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  const division = async (who: string) =>
    (await h.as(who).get(`/territories/${territoryId}/division`))
      .body as Division;
  // «Own» unless asked: the first tests read the parts north to south.
  const divide = (
    who: string,
    parts: number,
    again = false,
    mode: 'own' | 'near' = 'own',
  ) =>
    h.as(who).post(`/territories/${territoryId}/division`, {
      parts,
      mode,
      ...(again ? { again } : {}),
    });
  const names = (d: Division) =>
    d.split!.parts.map((p) => p.streets.map((s) => s.name));

  it('divides the houses into even parts, north first, each told its «не посещать» addresses', async () => {
    // Not given out: nothing to divide.
    const none = await h
      .as('dkeeper')
      .get(`/territories/${territoryId}/division`);
    expect(none.body.code).toBe('TERRITORY_NOT_GIVEN');
    await give();
    const before = await division('dholder');
    expect([before.houses, before.walked, before.split]).toEqual([30, 0, null]);
    // Someone who does not see the territory today: refused.
    expect(
      (await h.as('dstranger').get(`/territories/${territoryId}/division`))
        .status,
    ).toBe(403);
    const made = await divide('dmember', 3);
    expect(made.status).toBe(201);
    const d = made.body as Division;
    expect(names(d)).toEqual([['Kastanienallee'], ['Birkenweg'], ['Ahornweg']]);
    expect(d.split!.parts.map((p) => p.houses)).toEqual([10, 10, 10]);
    expect(d.split!.byMe).toBe(true);
    // An address on a part's street goes to that part; one on no street of
    // the division goes to every part, so nobody misses it.
    expect(
      d.split!.parts.map((p) => p.noCalls!.map((c) => c.address).sort()),
    ).toEqual([
      ['Musterstraße 1'],
      ['Birkenweg 4', 'Musterstraße 1'],
      ['Musterstraße 1'],
    ]);
  });

  it('the first division of the day holds; dividing again is for the one who did it, the holder and the keepers', async () => {
    await give();
    expect((await divide('dmember', 3)).status).toBe(201);
    // The holder opens it: the member's division, not a new one.
    expect((await divide('dholder', 2)).body.code).toBe(
      'TERRITORY_SPLIT_EXISTS',
    );
    const seenByHolder = await division('dholder');
    expect(seenByHolder.split!.parts).toHaveLength(3);
    expect(seenByHolder.split!.byMe).toBe(false);
    expect(seenByHolder.mayRedo).toBe(true);
    // The holder divides again into two: allowed, and replaces it.
    const again = await divide('dholder', 2, true);
    expect(again.status).toBe(201);
    expect((again.body as Division).split!.parts).toHaveLength(2);
    // Now the member did not make it: he may not replace it.
    const member = await division('dmember');
    expect(member.mayRedo).toBe(false);
    // Ending the territory is the holder's and the keepers', not the group's.
    expect(
      [seenByHolder, member, await division('dkeeper')].map(
        (x) => x.mayComplete,
      ),
    ).toEqual([true, false, true]);
    const refused = await divide('dmember', 3, true);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('TERRITORY_SPLIT_NOT_YOURS');
    // Nor move a street from one part to another.
    const key = member.split!.parts[0].streets[0].key;
    expect(
      (
        await h
          .as('dmember')
          .put(`/territories/divisions/${member.split!.id}/move`, {
            key,
            to: 2,
          })
      ).status,
    ).toBe(403);
    // The keeper may.
    const moved = await h
      .as('dkeeper')
      .put(`/territories/divisions/${member.split!.id}/move`, { key, to: 2 });
    expect(moved.status).toBe(200);
    const parts = (moved.body as Division).split!.parts;
    expect(parts.map((p) => p.houses).reduce((a, b) => a + b)).toBe(30);
    expect(parts[1].streets.some((s) => s.key === key)).toBe(true);
  });

  it('«street walked» is seen by every part, and the next division leaves those houses out', async () => {
    await give();
    const d = (await divide('dholder', 3)).body as Division;
    const birken = d.split!.parts[1].streets[0];
    const marked = await h
      .as('dmember')
      .put(`/territories/divisions/${d.split!.id}/mark`, {
        key: birken.key,
        walked: true,
      });
    expect(marked.status).toBe(200);
    const after = marked.body as Division;
    expect(after.walked).toBe(10);
    expect(after.split!.parts[1].streets[0].walkedAt).not.toBeNull();
    // Never who: the mark holds the houses and the time only.
    const [row] = await h.sql<Record<string, unknown>>(
      `SELECT * FROM territory_street_marks`,
    );
    expect(Object.keys(row).sort()).toEqual([
      'assignment_id',
      'congregation_id',
      'homes',
      'id',
      'marked_at',
      'street_key',
    ]);
    // Divided again: only the twenty houses not walked.
    const next = (await divide('dholder', 2, true)).body as Division;
    expect(next.split!.parts.map((p) => p.houses).reduce((a, b) => a + b)).toBe(
      20,
    );
    expect(names(next).flat().sort()).toEqual(['Ahornweg', 'Kastanienallee']);
    // A wrong tap undone takes back only that street.
    const k = next.split!.parts[0].streets[0].key;
    await h.as('dholder').put(`/territories/divisions/${next.split!.id}/mark`, {
      key: k,
      walked: true,
    });
    // …and an earlier outing's houses under the same key stay (a long
    // street walked in pieces on two days).
    await h.sql(
      `UPDATE territory_street_marks SET homes = homes || '["earlier"]'::jsonb WHERE street_key = $1`,
      [k],
    );
    const undone = await h
      .as('dholder')
      .put(`/territories/divisions/${next.split!.id}/mark`, {
        key: k,
        walked: false,
      });
    expect(undone.status).toBe(200);
    expect(
      await h.sql(
        `SELECT homes FROM territory_street_marks WHERE street_key = $1`,
        [k],
      ),
    ).toEqual([{ homes: ['earlier'] }]);
    await h.sql(`DELETE FROM territory_street_marks WHERE street_key = $1`, [
      k,
    ]);
    expect((await division('dholder')).walked).toBe(10);
    // Everything walked: nothing left to divide.
    for (const p of next.split!.parts)
      for (const s of p.streets)
        await h
          .as('dholder')
          .put(`/territories/divisions/${next.split!.id}/mark`, {
            key: s.key,
            walked: true,
          });
    const all = await divide('dholder', 2, true);
    expect(all.body.code).toBe('TERRITORY_ALL_WALKED');
  });

  it('a part by link: its streets and how many «не посещать», never which; good today only; gone when the territory comes back', async () => {
    const assignmentId = await give();
    const d = (await divide('dholder', 3)).body as Division;
    const link = await h
      .as('dmember')
      .post(`/territories/divisions/${d.split!.id}/parts/2/link`);
    expect(link.status).toBe(201);
    const token = (link.body.path as string).replace('/p/', '');
    const page = await h.as(null).get(`/territory-parts/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('private, no-store');
    expect(page.body.part.streets.map((s: Street) => s.name)).toEqual([
      'Birkenweg',
    ]);
    expect(page.body.noCalls).toBe(2);
    const text = JSON.stringify(page.body);
    expect(text).not.toContain('Birkenweg 4');
    expect(text).not.toContain('Musterstraße');
    expect(text).not.toContain('Тест');
    // Marks its own street; another part's street is not its business.
    const other = d.split!.parts[0].streets[0].key;
    expect(
      (
        await h
          .as(null)
          .put(`/territory-parts/${token}/mark`, { key: other, walked: true })
      ).status,
    ).toBe(404);
    const own = await h.as(null).put(`/territory-parts/${token}/mark`, {
      key: 'Birkenweg',
      walked: true,
    });
    expect(own.status).toBe(200);
    expect(own.body.part.streets[0].walkedAt).not.toBeNull();
    // A forged signature, another part's number: the same plain 404.
    const forged = token.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    expect((await h.as(null).get(`/territory-parts/${forged}`)).status).toBe(
      404,
    );
    const otherPart = token.replace(/^p\.([0-9a-f]{32})\.2\./, 'p.$1.3.');
    expect((await h.as(null).get(`/territory-parts/${otherPart}`)).status).toBe(
      404,
    );
    // Yesterday's division: its link stops, and the app shows no division.
    await h.sql(`UPDATE territory_splits SET day = day - 1`);
    expect((await h.as(null).get(`/territory-parts/${token}`)).status).toBe(
      404,
    );
    expect((await division('dholder')).split).toBeNull();
    // …even a link signed for that day: it was good then, not now.
    const [{ day }] = await h.sql<{ day: string }>(
      `SELECT to_char(day, 'YYYYMMDD') AS day FROM territory_splits`,
    );
    const hexId = d.split!.id.replace(/-/g, '');
    const sig = createHmac('sha256', dbEnv().JWT_SECRET)
      .update(`territory-part|${hexId}|2|${day}`)
      .digest('hex')
      .slice(0, 32);
    expect(
      (await h.as(null).get(`/territory-parts/p.${hexId}.2.${day}.${sig}`))
        .status,
    ).toBe(404);
    await h.sql(`UPDATE territory_splits SET day = day + 1`);
    expect((await h.as(null).get(`/territory-parts/${token}`)).status).toBe(
      200,
    );
    // Back: the division and the marks go, the link with them.
    expect(
      (
        await h
          .as('dkeeper')
          .post(`/territories/assignments/${assignmentId}/return`, {})
      ).status,
    ).toBe(200);
    expect(await h.sql(`SELECT id FROM territory_splits`)).toEqual([]);
    expect(await h.sql(`SELECT id FROM territory_street_marks`)).toEqual([]);
    expect((await h.as(null).get(`/territory-parts/${token}`)).status).toBe(
      404,
    );
  });

  describe('pairs on a territory (13 November 2026)', () => {
    afterEach(async () => {
      await h.sql(`UPDATE map_houses SET numbers = NULL`);
      await h.sql(`DELETE FROM field_service_meetings`);
    });

    it('a preview is saved nowhere; the keepers may look at a free territory; a block of flats weighs its entrances', async () => {
      // Birkenweg: five blocks with two entrances each.
      await h.sql(
        `UPDATE map_houses SET numbers = (osm_id - 200) * 2 || ';' || ((osm_id - 200) * 2 + 1)
          WHERE osm_id BETWEEN 200 AND 204`,
      );
      const r = await h
        .as('dkeeper')
        .post(`/territories/${territoryId}/division/preview`, {
          parts: 2,
          mode: 'near',
        });
      expect(r.status).toBe(200);
      const parts = r.body.parts as { doors: number; houses: number }[];
      expect(parts.reduce((a, p) => a + p.doors, 0)).toBe(35);
      expect(parts.reduce((a, p) => a + p.houses, 0)).toBe(30);
      expect([r.body.houses, r.body.numbered]).toEqual([30, 5]);
      expect(r.body.startFrom).toBe('middle');
      expect(await h.sql(`SELECT id FROM territory_splits`)).toEqual([]);
      // Someone who does not see the territory may not look.
      expect(
        (
          await h
            .as('dstranger')
            .post(`/territories/${territoryId}/division/preview`, {
              parts: 2,
            })
        ).status,
      ).toBe(403);
    });

    it("starts from today's meeting place, found on our own map by street and number", async () => {
      await give();
      await h.sql(`UPDATE map_houses SET numbers = '7' WHERE osm_id = 103`);
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Berlin',
      }).format(new Date());
      const d = new Date(`${today}T12:00:00Z`);
      const dow = ((d.getUTCDay() + 6) % 7) + 1;
      const monday = new Date(d.getTime() - (dow - 1) * 86400000)
        .toISOString()
        .slice(0, 10);
      await h.sql(
        `INSERT INTO field_service_meetings
           (congregation_id, week_start_date, day_of_week, start_time, address, territory_id, published_at)
         VALUES ($1, $2, $3, '10:00', 'Ahornweg 7', $4, now())`,
        [congregationId, monday, dow, territoryId],
      );
      const r = await h
        .as('dholder')
        .post(`/territories/${territoryId}/division/preview`, {
          parts: 3,
          mode: 'near',
        });
      expect(r.status).toBe(200);
      expect(r.body.startFrom).toBe('meeting');
      // House 103 of Ahornweg: 7.0005 + 3 × 0.0009 east, just north of the street.
      expect(r.body.start).toEqual([7.0032, 51.0022]);
    });

    it('numbers by side of the street: odd and even each a range; a division saved before has them from its numbers (14 November 2026)', async () => {
      await give();
      // Birkenweg: 1–9 odd and 2–10 even, one number a house.
      await h.sql(
        `UPDATE map_houses SET numbers = ((osm_id - 199))::text
          WHERE osm_id BETWEEN 200 AND 209`,
      );
      type Ranges = {
        odd: { from: string; to: string } | null;
        even: { from: string; to: string } | null;
      };
      const birken = (d: Division) =>
        d
          .split!.parts.flatMap(
            (p) => p.streets as unknown as { name: string; ranges: Ranges }[],
          )
          .filter((x) => x.name === 'Birkenweg')
          .map((x) => x.ranges);
      const d = (await divide('dholder', 2)).body as Division;
      expect(birken(d)).toEqual([
        { odd: { from: '1', to: '9' }, even: { from: '2', to: '10' } },
      ]);
      // A division saved before 14 November 2026: no `ranges` in its parts.
      const [row] = await h.sql<{ id: string; parts: unknown }>(
        `SELECT id, parts FROM territory_splits`,
      );
      const old = JSON.parse(JSON.stringify(row.parts)) as {
        streets: Record<string, unknown>[];
      }[];
      for (const p of old) for (const x of p.streets) delete x.ranges;
      await h.sql(`UPDATE territory_splits SET parts = $1 WHERE id = $2`, [
        JSON.stringify(old),
        row.id,
      ]);
      expect(birken(await division('dmember'))).toEqual([
        { odd: { from: '1', to: '9' }, even: { from: '2', to: '10' } },
      ]);
    });

    it('a house goes to the street of its official address, not the nearest (14 November 2026)', async () => {
      // Birkenweg's sixth house carries «7»; its official address is Ahornweg 7.
      await h.sql(`UPDATE map_houses SET numbers = '7' WHERE osm_id = 205`);
      const preview = async () =>
        (
          await h
            .as('dkeeper')
            .post(`/territories/${territoryId}/division/preview`, {
              parts: 3,
              mode: 'own',
            })
        ).body as { parts: { streets: { name: string; houses: number }[] }[] };
      // Houses by street name, its pieces together.
      const count = (b: Awaited<ReturnType<typeof preview>>) => {
        const out: Record<string, number> = {};
        for (const x of b.parts.flatMap((p) => p.streets))
          out[x.name] = (out[x.name] ?? 0) + x.houses;
        return out;
      };
      expect(count(await preview())).toEqual({
        Ahornweg: 10,
        Birkenweg: 10,
        Kastanienallee: 10,
      });
      const [house] = await h.sql<{ lon: number; lat: number }>(
        `SELECT lon, lat FROM map_houses WHERE osm_id = 205`,
      );
      await h.sql(
        `INSERT INTO map_addresses (congregation_id, oid, lon, lat, number, street)
         VALUES ($1, 'DENW01TEST000001', $2, $3, '7', 'Ahornweg')`,
        [congregationId, house.lon + 0.00005, house.lat],
      );
      try {
        expect(count(await preview())).toEqual({
          Ahornweg: 11,
          Birkenweg: 9,
          Kastanienallee: 10,
        });
      } finally {
        await h.sql(`DELETE FROM map_addresses`);
      }
    });

    it('a division taken away: its links stop, the marks stay; only for whoever may divide again', async () => {
      await give();
      const d = (await divide('dholder', 3)).body as Division;
      const k = d.split!.parts[1].streets[0].key;
      await h.as('dmember').put(`/territories/divisions/${d.split!.id}/mark`, {
        key: k,
        walked: true,
      });
      const link = await h
        .as('dmember')
        .post(`/territories/divisions/${d.split!.id}/parts/1/link`);
      const token = (link.body.path as string).replace('/p/', '');
      const refused = await h
        .as('dmember')
        .delete(`/territories/divisions/${d.split!.id}`);
      expect(refused.status).toBe(403);
      const removed = await h
        .as('dholder')
        .delete(`/territories/divisions/${d.split!.id}`);
      expect(removed.status).toBe(200);
      expect((removed.body as Division).split).toBeNull();
      expect((removed.body as Division).walked).toBe(10);
      expect(await h.sql(`SELECT id FROM territory_splits`)).toEqual([]);
      expect((await h.as(null).get(`/territory-parts/${token}`)).status).toBe(
        404,
      );
    });

    it('a pair done early takes a street from a pair that has not started — never from one that has', async () => {
      await give();
      const d = (await divide('dholder', 3)).body as Division;
      const id = d.split!.id;
      const [p1, p2, p3] = d.split!.parts;
      // Pair 3 has not started: pair 1 takes its street, by its link.
      const link = await h
        .as('dholder')
        .post(`/territories/divisions/${id}/parts/1/link`);
      const token = (link.body.path as string).replace('/p/', '');
      const taken = await h
        .as(null)
        .put(`/territory-parts/${token}/take`, { key: p3.streets[0].key });
      expect(taken.status).toBe(200);
      expect(taken.body.part.streets.map((s: Street) => s.name).sort()).toEqual(
        [p1.streets[0].name, p3.streets[0].name].sort(),
      );
      // Pair 2 has started: its street stays, in the app too.
      await h.as('dmember').put(`/territories/divisions/${id}/mark`, {
        key: p2.streets[0].key,
        walked: true,
      });
      const no = await h
        .as('dmember')
        .put(`/territories/divisions/${id}/take`, {
          key: p2.streets[0].key,
          to: 1,
        });
      expect(no.status).toBe(409);
      expect(no.body.code).toBe('TERRITORY_PART_STARTED');
    });

    it("a street heavier than a pair's share is cut further, so it cannot hold a part up (14 November 2026)", async () => {
      // Birkenweg: ten blocks of eight entrances — 80 of the 100 doors.
      // By length alone (570 m) it would be two pieces of 40; a pair's share is 34.
      await h.sql(
        `UPDATE map_houses SET numbers = '1;3;5;7;9;11;13;15' WHERE osm_id BETWEEN 200 AND 209`,
      );
      const r = await h
        .as('dkeeper')
        .post(`/territories/${territoryId}/division/preview`, {
          parts: 3,
          mode: 'own',
        });
      expect(r.status).toBe(200);
      const birken = (
        r.body.parts as { streets: { name: string; doors: number }[] }[]
      )
        .flatMap((p) => p.streets)
        .filter((x) => x.name === 'Birkenweg');
      expect(birken.map((x) => x.doors).sort()).toEqual([24, 24, 32]);
    });
  });
});
