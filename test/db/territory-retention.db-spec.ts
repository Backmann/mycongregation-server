import { Harness, startHarness } from './harness';
import {
  linesKeptFrom,
  namesKeptFrom,
} from '../../src/territories/territory-retention';
import { addDays } from '../../src/territories/service-year';

/**
 * The S-13 under the retention rules (12 November 2026): names for the
 * current and the previous service year, lines for five, a territory in
 * someone's hands never — counted only, nothing changed. And a holder's own
 * lines in «my data».
 */
describe('territory records: retention and «my data» (real database)', () => {
  let h: Harness;
  let congregationId = '';
  let holder = '';
  const today = new Date().toISOString().slice(0, 10);
  const names = namesKeptFrom(today);
  const lines = linesKeptFrom(today);

  const square = (x: number) => ({
    type: 'Polygon',
    coordinates: [
      [
        [x, 51],
        [x + 0.01, 51],
        [x + 0.01, 51.01],
        [x, 51.01],
        [x, 51],
      ],
    ],
  });

  beforeAll(async () => {
    h = await startHarness();
    [{ id: congregationId }] = await h.sql<{ id: string }>(
      `SELECT id FROM congregations`,
    );
    holder = await h.addPublisher({
      firstName: 'Держатель',
      lastName: 'Тест',
      gender: 'brother',
      appointment: 'publisher',
      baptismDate: '2001-01-01',
    });
    await h.addUser({
      login: 'holder',
      role: 'publisher',
      publisherId: holder,
    });
    const r = await h.as('admin').post('/territories/import/territories', {
      items: [
        { number: 'R01', geometry: square(7) },
        { number: 'R02', geometry: square(7.01) },
      ],
    });
    expect(r.status).toBe(201);
  });

  afterAll(async () => {
    await h?.close();
  });

  const idOf = async (n: string) =>
    (
      await h.sql<{ id: string }>(
        `SELECT id FROM territories WHERE number = $1`,
        [n],
      )
    )[0].id;

  const line = async (
    number: string,
    holderName: string,
    publisherId: string | null,
    assignedOn: string,
    completedOn: string | null,
  ) =>
    h.sql(
      `INSERT INTO territory_assignments
         (congregation_id, territory_id, publisher_id, holder_name, assigned_on, completed_on, method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        congregationId,
        await idOf(number),
        publisherId,
        holderName,
        assignedOn,
        completedOn,
        completedOn ? 'door_to_door' : null,
      ],
    );

  it('counts names past the S-13 years and lines past five years; changes nothing', async () => {
    // Worked last-but-one year by the holder: his name is past its time.
    await line(
      'R01',
      'Держатель Тест',
      holder,
      addDays(names, -200),
      addDays(names, -100),
    );
    // Worked six years ago by someone else: name and line both past.
    await line(
      'R01',
      'Другой Брат',
      null,
      addDays(lines, -300),
      addDays(lines, -200),
    );
    // Inside the kept years: nothing.
    await line(
      'R01',
      'Свежий Брат',
      null,
      addDays(names, 10),
      addDays(names, 50),
    );
    // Already without a name: not counted again.
    await line('R01', '—', null, addDays(names, -90), addDays(names, -60));
    // Given to the holder long ago and still in his hands: never touched.
    await line('R02', 'Держатель Тест', holder, addDays(lines, -400), null);

    const before = await h.sql<{ holder_name: string }>(
      `SELECT holder_name FROM territory_assignments ORDER BY holder_name`,
    );
    const res = await h.as('admin').get('/retention/preview');
    expect(res.status).toBe(200);
    const rows = res.body as {
      key: string;
      count: number;
      before: string;
      does?: string;
    }[];
    const row = (key: string) => rows.find((r) => r.key === key)!;
    expect(row('territory-names')).toMatchObject({
      count: 2,
      before: names,
      does: 'anonymise',
    });
    expect(row('territory-lines')).toMatchObject({
      count: 1,
      before: lines,
      does: 'delete',
    });
    // Counting only.
    expect(
      await h.sql(
        `SELECT holder_name FROM territory_assignments ORDER BY holder_name`,
      ),
    ).toEqual(before);
  });

  it("«my data» lists the lines that carry one's own name, with the territory number", async () => {
    const res = await h.as('holder').get('/me/export');
    expect(res.status).toBe(200);
    const mine = (
      res.body.territories as {
        territory: string;
        completedOn: string | null;
      }[]
    )
      .map((t) => [t.territory, t.completedOn ? 'worked' : 'held'])
      .sort();
    expect(mine).toEqual([
      ['R01', 'worked'],
      ['R02', 'held'],
    ]);
    // Nobody else's line, nothing but the number and the days.
    expect(JSON.stringify(res.body.territories)).not.toContain('Другой');
    expect(JSON.stringify(res.body.territories)).not.toContain('geometry');
  });
});
