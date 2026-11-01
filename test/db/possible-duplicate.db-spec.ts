import { Harness, startHarness } from './harness';
import { PossibleDuplicateService } from '../../src/tasks/possible-duplicate.service';

/**
 * «Возможно, одна и та же карточка» against a real database (1 November
 * 2026): the elders hear of duplicates already in the list.
 */
describe('the duplicate watcher (real database)', () => {
  let h: Harness;
  let svc: PossibleDuplicateService;
  let cong: string;
  let a: string;
  let b: string;
  let c: string;
  let d: string;

  const open = async () =>
    h.sql<{ id: string; kind_period: string }>(
      `SELECT id, kind_period FROM elder_tasks
        WHERE kind = 'possible_duplicate' AND status = 'open' ORDER BY kind_period`,
    );

  beforeAll(async () => {
    h = await startHarness();
    svc = h.app.get(PossibleDuplicateService);
    a = await h.addPublisher({
      firstName: 'Ольга',
      lastName: 'Повторная',
      gender: 'sister',
      appointment: 'publisher',
    });
    b = await h.addPublisher({
      firstName: 'повторная',
      lastName: 'ОЛЬГА ',
      gender: 'sister',
      appointment: 'publisher',
    });
    c = await h.addPublisher({
      firstName: 'Иван',
      lastName: 'Телефонов',
      appointment: 'publisher',
      mobilePhone: '0151 2345 6789',
    });
    d = await h.addPublisher({
      firstName: 'Johann',
      lastName: 'Telefonow',
      appointment: 'publisher',
      mobilePhone: '+49 151 23456789',
    });
    cong = (
      await h.sql<{ c: string }>(
        `SELECT congregation_id AS c FROM publishers WHERE id = $1`,
        [a],
      )
    )[0].c;
  });
  afterAll(async () => {
    await h?.close();
  });

  it('raises one task per alike pair — by name in any order, by phone', async () => {
    await svc.sync(cong);
    const tasks = await open();
    expect(tasks).toHaveLength(2);
  });

  it('the task shows both cards and why they look alike', async () => {
    const [t] = await open();
    const r = await h.as('admin').get(`/tasks/${t.id}/possible-duplicate`);
    expect(r.status).toBe(200);
    const ids = r.body.cards.map((x: { id: string }) => x.id).sort();
    expect([[a, b].sort(), [c, d].sort()]).toContainEqual(ids);
    expect(r.body.why.length).toBeGreaterThan(0);
  });

  it('«это разные люди» closes it and it is not raised again', async () => {
    const tasks = await open();
    const phone: string[] = [];
    for (const t of tasks) {
      const r = await h.as('admin').get(`/tasks/${t.id}/possible-duplicate`);
      if (r.body.why.includes('phone')) phone.push(t.id);
    }
    expect(phone).toHaveLength(1);
    const r = await h
      .as('admin')
      .post(`/tasks/${phone[0]}/possible-duplicate/distinct`);
    expect(r.status).toBe(200);
    await svc.sync(cong);
    const left = await open();
    expect(left).toHaveLength(1);
    expect(left[0].id).not.toBe(phone[0]);
    // Remembered beyond the task: the pair drops out (a number corrected)
    // and comes back (corrected again) — still not asked about.
    await h.sql(`UPDATE publishers SET mobile_phone = NULL WHERE id = $1`, [d]);
    await svc.sync(cong);
    await h
      .as('admin')
      .patch(`/publishers/${d}`, { mobilePhone: '+49 151 23456789' });
    await svc.sync(cong);
    expect(await open()).toHaveLength(1);
  });

  it('a merge answers the task at once', async () => {
    const p = await h
      .as('admin')
      .post('/card-merge/preview', { keptId: a, mergedId: b });
    expect(p.status).toBe(201);
    const m = await h.as('admin').post('/card-merge', {
      keptId: a,
      mergedId: b,
      fingerprint: p.body.fingerprint,
    });
    expect(m.status).toBe(201);
    expect(await open()).toHaveLength(0);
    await svc.sync(cong); // the watcher passes while the pair is merged
    // …and an undone merge is «two people after all»: not raised again.
    const u = await h.as('admin').post(`/card-merge/${m.body.mergeId}/undo`);
    expect(u.status).toBe(201);
    await svc.sync(cong);
    expect(await open()).toHaveLength(0);
  });
});
