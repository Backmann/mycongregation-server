import { Harness, startHarness } from './harness';

/**
 * A part added to a meeting already published (programme audit, 20 November
 * 2026): the hospitality sister and an extra Christian-life part were made
 * as drafts — and a draft in a published meeting is seen by nobody, its
 * person told nothing, until somebody published the meeting again.
 */
describe('a part added to a published meeting (real database)', () => {
  let h: Harness;
  let sister = '';
  // A Christian-life part goes to an elder or a servant (guidelines п. 16).
  let elder = '';
  let n = 0;

  const monday = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * (6 + 2 * ++n));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const post = (body: Record<string, unknown>) =>
    h.as('admin').post('/assignments', body);
  const row = async (id: string) =>
    (
      await h.sql<{ status: string; changed: boolean }>(
        `SELECT status::text, changed_since_publish AS changed FROM assignments WHERE id = $1`,
        [id],
      )
    )[0];

  beforeAll(async () => {
    h = await startHarness();
    sister = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Тест',
      gender: 'sister',
      baptismDate: '2001-01-01',
    });
    elder = await h.addPublisher({
      firstName: 'Борис',
      lastName: 'Тест',
      baptismDate: '1990-01-01',
      appointment: 'elder',
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('hospitality on a published weekend: published, and news for her', async () => {
    const week = monday();
    await post({
      weekStartDate: week,
      eventType: 'weekend',
      partKey: 'weekend_chairman',
    });
    const p = await h.as('admin').post('/assignments/publish', {
      weekStartDate: week,
      eventType: 'weekend',
      notify: false,
    });
    expect([200, 201]).toContain(p.status);
    const r = await post({
      weekStartDate: week,
      eventType: 'weekend',
      partKey: 'weekend_hospitality',
      partTitle: 'Гостеприимство',
      partOrder: 99,
      publisherId: sister,
      status: 'draft',
    });
    expect(r.status).toBe(201);
    expect(await row(r.body.id)).toEqual({
      status: 'published',
      changed: true,
    });
  });

  it('an empty line on a published meeting: published, no news', async () => {
    const week = monday();
    await post({
      weekStartDate: week,
      eventType: 'midweek',
      partKey: 'midweek_chairman',
    });
    await h.as('admin').post('/assignments/publish', {
      weekStartDate: week,
      eventType: 'midweek',
      notify: false,
    });
    const r = await post({
      weekStartDate: week,
      eventType: 'midweek',
      partKey: 'living_christians_extra',
      partTitle: 'Дополнительная часть',
      status: 'draft',
    });
    expect(r.status).toBe(201);
    expect(await row(r.body.id)).toEqual({
      status: 'published',
      changed: false,
    });
  });

  it('a meeting not yet published: the draft stays a draft', async () => {
    const week = monday();
    await post({
      weekStartDate: week,
      eventType: 'midweek',
      partKey: 'midweek_chairman',
    });
    const r = await post({
      weekStartDate: week,
      eventType: 'midweek',
      partKey: 'living_christians_extra',
      status: 'draft',
      publisherId: elder,
    });
    expect(await row(r.body.id)).toEqual({ status: 'draft', changed: false });
  });

  it('published by the caller into a published meeting: news for its person', async () => {
    const week = monday();
    await post({
      weekStartDate: week,
      eventType: 'midweek',
      partKey: 'midweek_chairman',
    });
    await h.as('admin').post('/assignments/publish', {
      weekStartDate: week,
      eventType: 'midweek',
      notify: false,
    });
    const r = await post({
      weekStartDate: week,
      eventType: 'midweek',
      partKey: 'living_christians_extra',
      status: 'published',
      publisherId: elder,
    });
    expect(await row(r.body.id)).toEqual({
      status: 'published',
      changed: true,
    });
  });
});
