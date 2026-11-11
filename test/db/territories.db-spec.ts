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

  function from(): string {
    return keptFrom(today);
  }
});
