import { Harness, startHarness } from './harness';

/**
 * Reports (28 October 2026): the form a month wants is asked of the spells
 * for THAT month; the reporter's own standing carries what he handed in, the
 * studies hint and — for a regular pioneer — his year by the review's rule,
 * with the 560 figures only for elders.
 */
describe('reports: form by month, standing, pioneer year (real database)', () => {
  let h: Harness;
  let pioneer: string;
  let former: string;
  let plain: string;

  const monthBack = (n: number): string => {
    const d = new Date();
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
    return x.toISOString().slice(0, 7);
  };
  const P = monthBack(1);
  const P2 = monthBack(2);

  beforeAll(async () => {
    h = await startHarness();
    pioneer = await h.addPublisher({
      firstName: 'Мира',
      lastName: 'Пионерова',
      gender: 'sister',
      appointment: 'publisher',
      baptismDate: '2010-01-01',
      pioneerType: 'regular',
      pioneerSince: '2020-09-01',
    });
    await h.addUser({ login: 'mira', role: 'publisher', publisherId: pioneer });

    former = await h.addPublisher({
      firstName: 'Ида',
      lastName: 'Бывшая',
      gender: 'sister',
      appointment: 'publisher',
      baptismDate: '2010-01-01',
      pioneerType: 'regular',
      pioneerSince: '2020-09-01',
    });
    // She stopped: her spell ended two months back, the card says «none».
    await h.sql(
      `UPDATE pioneer_spells SET end_month = $2 WHERE publisher_id = $1`,
      [former, `${P2}-01`],
    );
    await h.sql(`UPDATE publishers SET pioneer_type = 'none' WHERE id = $1`, [
      former,
    ]);

    plain = await h.addPublisher({
      firstName: 'Тим',
      lastName: 'Простов',
      appointment: 'publisher',
      baptismDate: '2010-01-01',
    });
    await h.addUser({ login: 'tim', role: 'publisher', publisherId: plain });
  });

  afterAll(async () => h?.close());

  it('asks the spells of THAT month: hours while she pioneered, the question after', async () => {
    const before = await h
      .as('admin')
      .get(`/service-reports/form?reportMonth=${P2}&publisherId=${former}`);
    expect(before.status).toBe(200);
    expect(before.body.wantsHours).toBe(true);

    const after = await h
      .as('admin')
      .get(`/service-reports/form?reportMonth=${P}&publisherId=${former}`);
    expect(after.body.wantsHours).toBe(false);
  });

  it('offers the studies of the latest report, and says when a month is in', async () => {
    const r = await h.as('tim').post('/service-reports', {
      reportMonth: P2,
      servedThisMonth: true,
      bibleStudies: 2,
    });
    expect(r.status).toBe(201);
    const form = await h
      .as('tim')
      .get(`/service-reports/form?reportMonth=${P}`);
    expect(form.body).toMatchObject({
      wantsHours: false,
      lastStudies: 2,
      lastStudiesMonth: `${P2}-01`,
      submitted: false,
    });
    const same = await h
      .as('tim')
      .get(`/service-reports/form?reportMonth=${P2}`);
    expect(same.body.submitted).toBe(true);
  });

  it('refuses the form of somebody else to a plain publisher', async () => {
    const r = await h
      .as('tim')
      .get(`/service-reports/form?reportMonth=${P}&publisherId=${pioneer}`);
    expect(r.status).toBe(403);
  });

  it('gives the pioneer her year by the goal only, and the elders the minimum too', async () => {
    const sent = await h.as('mira').post('/service-reports', {
      reportMonth: P,
      hoursReported: 40,
      bibleStudies: 1,
    });
    expect(sent.status).toBe(201);

    const mine = await h.as('mira').get('/service-reports/my-standing');
    expect(mine.status).toBe(200);
    expect(mine.body.report).toMatchObject({
      hoursReported: 40,
      bibleStudies: 1,
    });
    expect(mine.body.form.wantsHours).toBe(true);
    expect(mine.body.pioneerYear.goal).toBe(600);
    expect(mine.body.pioneerYear.pace).toBe(50);
    expect(mine.body.pioneerYear.months).toHaveLength(12);
    expect(mine.body.pioneerYear.elders).toBeUndefined();

    const hist = await h
      .as('admin')
      .get(`/service-reports/by-publisher/${pioneer}`);
    expect(hist.status).toBe(200);
    expect(hist.body.pioneerYear.elders.yearMinimum).toBe(560);

    // Her own history shows her year without the elders' measure.
    const own = await h
      .as('mira')
      .get(`/service-reports/by-publisher/${pioneer}`);
    expect(own.status).toBe(200);
    expect(own.body.pioneerYear.elders).toBeUndefined();
  });

  it('gives an ordinary publisher no year card', async () => {
    const mine = await h.as('tim').get('/service-reports/my-standing');
    expect(mine.body.pioneerYear).toBeNull();
  });
});
