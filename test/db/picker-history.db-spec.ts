import { Harness, startHarness } from './harness';

/**
 * The people pickers' history (20 November 2026): it reaches 12 weeks ahead,
 * where most planned parts are still drafts — so a reader who may not see
 * drafts gets the published programme only, as in the programme itself; a
 * cancelled part is nobody's history; each line names its part and partner.
 */
describe('publisher activity for the pickers (real database)', () => {
  let h: Harness;
  let elder = '';
  let sister = '';
  let sister2 = '';
  let week = '';
  const ahead = (n: number) => {
    const d = new Date(`${week}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * n);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    h = await startHarness();
    elder = await h.addPublisher({
      firstName: 'Борис',
      lastName: 'Тест',
      baptismDate: '1990-01-01',
      appointment: 'elder',
    });
    sister = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Тест',
      gender: 'sister',
      baptismDate: '2001-01-01',
    });
    sister2 = await h.addPublisher({
      firstName: 'Вера',
      lastName: 'Тест',
      gender: 'sister',
      baptismDate: '2001-01-01',
    });
    await h.addUser({
      login: 'reader.tst',
      role: 'publisher',
      publisherId: sister2,
    });
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * 30);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    week = d.toISOString().slice(0, 10);
    // A draft four weeks ahead, with a pair.
    const r = await h.as('admin').post('/assignments', {
      weekStartDate: ahead(4),
      eventType: 'midweek',
      partKey: 'apply_yourself_1',
      partTitle: 'Начинайте разговор',
      publisherId: sister,
      assistantPublisherId: sister2,
    });
    expect(r.status).toBe(201);
    // A cancelled part in the week itself.
    const c = await h.as('admin').post('/assignments', {
      weekStartDate: week,
      eventType: 'midweek',
      partKey: 'living_christians_1',
      partTitle: 'Тема',
      publisherId: elder,
      status: 'cancelled',
    });
    expect(c.status).toBe(201);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('an editor sees the planned draft ahead, with its part and partner', async () => {
    const r = await h
      .as('admin')
      .get(`/publisher-activity?weekStart=${week}&weeks=26&ahead=12`);
    expect(r.status).toBe(200);
    const mine = r.body.find(
      (x: { publisherId: string }) => x.publisherId === sister,
    );
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].partnerId).toBe(sister2);
    expect(mine.items[0].assignmentId).toBeTruthy();
    expect(mine.items[0].weekStartDate.slice(0, 10)).toBe(ahead(4));
  });

  it('nothing ahead unless asked', async () => {
    const r = await h
      .as('admin')
      .get(`/publisher-activity?weekStart=${week}&weeks=4`);
    expect(
      r.body.find((x: { publisherId: string }) => x.publisherId === sister),
    ).toBeUndefined();
  });

  it('a cancelled part is nobody’s history', async () => {
    const r = await h
      .as('admin')
      .get(`/publisher-activity?weekStart=${week}&weeks=4&ahead=2`);
    expect(
      r.body.find((x: { publisherId: string }) => x.publisherId === elder),
    ).toBeUndefined();
  });

  it('a publisher does not see drafts through it', async () => {
    const r = await h
      .as('reader.tst')
      .get(`/publisher-activity?weekStart=${week}&weeks=26&ahead=12`);
    expect(r.status).toBe(200);
    expect(
      r.body.find((x: { publisherId: string }) => x.publisherId === sister),
    ).toBeUndefined();
  });

  it('the suggestions follow the same rule on drafts', async () => {
    const q = `/publisher-activity/suggestions?weekStart=${ahead(5)}&partKeys=apply_yourself_1`;
    const editor = await h.as('admin').get(q);
    expect(editor.status).toBe(200);
    expect(
      editor.body.some(
        (x: { publisherId: string }) => x.publisherId === sister,
      ),
    ).toBe(true);
    const reader = await h.as('reader.tst').get(q);
    expect(reader.status).toBe(200);
    expect(
      reader.body.some(
        (x: { publisherId: string }) => x.publisherId === sister,
      ),
    ).toBe(false);
  });
});
