import { Harness, startHarness } from './harness';

/**
 * The auxiliary pioneer's goal is his choice (Lionel, 29 October 2026): 15
 * or 30 in a month that allows 15 — March, April, the Memorial's month, the
 * circuit overseer's visit, a campaign that says so — and 30 elsewhere.
 */
describe('the goal of an auxiliary month (real database)', () => {
  let h: Harness;
  let sister: string;

  beforeAll(async () => {
    h = await startHarness();
    sister = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Вебер',
      gender: 'sister',
      appointment: 'publisher',
      baptismDate: '2010-05-01',
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  const rowsOf = async (month: string) =>
    (await h.as('admin').get(`/auxiliary-pioneers?month=${month}`)).body as {
      reasons: string[];
      rows: { id: string; hourGoal: number }[];
    };

  it('left unsaid, a month that allows 15 takes 15 — as before', async () => {
    const r = await h.as('admin').post('/auxiliary-pioneers', {
      publisherId: sister,
      startMonth: '2031-03-01',
      endMonth: '2031-05-01',
    });
    expect(r.status).toBe(201);
    expect(r.body.reducedMonths).toEqual(['2031-03', '2031-04']);
    const march = await rowsOf('2031-03-01');
    expect(march.reasons).toEqual(['march_april']);
    expect(march.rows[0].hourGoal).toBe(15);
    const may = await rowsOf('2031-05-01');
    expect(may.reasons).toEqual([]);
    expect(may.rows[0].hourGoal).toBe(30);
  });

  it('she may take 30 in March instead, and 15 is refused in May', async () => {
    const { rows } = await rowsOf('2031-03-01');
    const id = rows[0].id;
    const thirty = await h
      .as('admin')
      .patch(`/auxiliary-pioneers/${id}/norm`, { month: '2031-03', hours: 30 });
    expect(thirty.status).toBe(200);
    expect((await rowsOf('2031-03-01')).rows[0].hourGoal).toBe(30);
    const may = await h
      .as('admin')
      .patch(`/auxiliary-pioneers/${id}/norm`, { month: '2031-05', hours: 15 });
    expect(may.status).toBe(400);
    expect(may.body.code).toBe('AUX_NORM_NOT_ALLOWED');
    expect(may.body.month).toBe('2031-05');
  });

  it('a campaign that says so opens 15 in its months; one that does not, does not', async () => {
    const make = (title: string, date: string, endDate: string, on: boolean) =>
      h.as('admin').post('/special-events', {
        title,
        type: 'campaign',
        date,
        endDate,
        auxReducedHours: on,
      });
    expect(
      (await make('Кампания', '2031-06-15', '2031-07-10', true)).status,
    ).toBe(201);
    expect(
      (await make('Без нормы', '2031-09-01', '2031-09-30', false)).status,
    ).toBe(201);
    const r = await h.as('admin').post('/auxiliary-pioneers', {
      publisherId: sister,
      startMonth: '2031-06-01',
      endMonth: '2031-09-01',
      reducedMonths: ['2031-06', '2031-07'],
    });
    expect(r.status).toBe(201);
    expect((await rowsOf('2031-07-01')).reasons).toEqual(['campaign']);
    const sept = await h
      .as('admin')
      .patch(`/auxiliary-pioneers/${r.body.id}/norm`, {
        month: '2031-09',
        hours: 15,
      });
    expect(sept.body.code).toBe('AUX_NORM_NOT_ALLOWED');
  });

  it('only a campaign keeps the mark', async () => {
    const r = await h.as('admin').post('/special-events', {
      title: 'Конгресс',
      type: 'regional_convention',
      date: '2031-10-10',
      endDate: '2031-10-12',
      auxReducedHours: true,
    });
    expect(r.status).toBe(201);
    const [row] = await h.sql<{ aux_reduced_hours: boolean }>(
      `SELECT aux_reduced_hours FROM special_events WHERE id = $1`,
      [r.body.id],
    );
    expect(row.aux_reduced_hours).toBe(false);
  });

  it('says which months allow 15, and why — to anybody signed in', async () => {
    await h.addUser({ login: 'plain', role: 'publisher' });
    const r = await h
      .as('plain')
      .get('/auxiliary-pioneers/reducible?from=2031-01&to=2031-08');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([
      { month: '2031-03', reasons: ['march_april'] },
      { month: '2031-04', reasons: ['march_april'] },
      { month: '2031-06', reasons: ['campaign'] },
      { month: '2031-07', reasons: ['campaign'] },
    ]);
  });
});
