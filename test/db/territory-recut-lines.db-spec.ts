import { Harness, startHarness } from './harness';

/**
 * Moving the lines of a cut in the draft (16 November 2026, step 3b): lines
 * tried are shown and not saved; a save over a newer one is refused; a large
 * change leaves the «no remarks» given before waiting for a new look and,
 * once decided, sends the proposal back to the service committee.
 */
describe('moving the lines of a cut (real database)', () => {
  let h: Harness;
  let congregationId = '';
  const ids: Record<string, string> = {};
  let id = '';

  const rect = (x0: number, x1: number) => ({
    type: 'Polygon',
    coordinates: [
      [
        [x0, 51],
        [x1, 51],
        [x1, 51.009],
        [x0, 51.009],
        [x0, 51],
      ],
    ],
  });
  const vertical = (x: number) => ({
    points: [
      [x, 50.99],
      [x, 51.02],
    ],
  });
  const proposal = async () =>
    (await h.as('keeper').get('/territory-recut')).body.proposals.find(
      (p: { id: string }) => p.id === id,
    );
  const save = (lines: number[], baseUpdatedAt?: string, numbers?: string[]) =>
    h.as('keeper').put(`/territory-recut/proposals/${id}`, {
      kind: 'cut',
      territoryIds: [ids.Big1],
      lines: lines.map(vertical),
      keep: 0,
      numbers: numbers ?? ['Big2', 'Big3'],
      queue: 2,
      ...(baseUpdatedAt ? { baseUpdatedAt } : {}),
    });
  const preview = (lines: number[], who = 'keeper') =>
    h.as(who).post(`/territory-recut/proposals/${id}/preview`, {
      lines: lines.map(vertical),
    });

  beforeAll(async () => {
    h = await startHarness();
    const [c] = await h.sql<{ id: string }>(`SELECT id FROM congregations`);
    congregationId = c.id;
    const card = (firstName: string, appointment: string) =>
      h.addPublisher({
        firstName,
        lastName: 'Тест',
        gender: 'brother',
        appointment,
        baptismDate: '2001-01-01',
      });
    const give = (userId: string, type: string) =>
      h.sql(
        `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, $2, $3)`,
        [congregationId, type, userId],
      );
    const keeper = await h.addUser({
      login: 'keeper',
      role: 'ministerial_servant',
      publisherId: await card('Хранитель', 'ministerial_servant'),
    });
    const overseer = await h.addUser({
      login: 'overseer',
      role: 'elder',
      publisherId: await card('Служебный', 'elder'),
    });
    await give(keeper, 'territory_servant');
    await give(overseer, 'secretary');
    const r = await h.as('keeper').post('/territories/import/territories', {
      items: [
        { number: 'Big1', locality: 'Hamm', geometry: rect(7.0, 7.03) },
        { number: 'Big4', locality: 'Hamm', geometry: rect(7.2, 7.21) },
      ],
    });
    expect(r.status).toBe(201);
    expect((await h.as('keeper').post('/territories/verify')).status).toBe(200);
    for (const row of await h.sql<{ id: string; number: string }>(
      `SELECT id, number FROM territories`,
    ))
      ids[row.number] = row.id;
    let osm = 1;
    for (let i = 0; i < 30; i++)
      await h.sql(
        `INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2, home)
         VALUES ($1, $2, $3, 51.0045, 120, true)`,
        [congregationId, osm++, 7.0005 + i * 0.001],
      );
    await h.sql(
      `UPDATE territory_settings SET houses_built_at = now() WHERE congregation_id = $1`,
      [congregationId],
    );
    const made = await h.as('keeper').post('/territory-recut/proposals', {
      kind: 'cut',
      territoryIds: [ids.Big1],
      lines: [vertical(7.01), vertical(7.02)],
      keep: 0,
      numbers: ['Big2', 'Big3'],
      queue: 2,
    });
    expect(made.status).toBe(201);
    id = made.body.proposals[0].id;
  });

  afterAll(async () => {
    await h?.close();
  });

  it('lines tried: the parts, their homes and the share moved — nothing saved', async () => {
    const before = await proposal();
    const r = await preview([7.016, 7.02]);
    expect(r.status).toBe(201);
    expect(r.body.parts.map((x: { homes: number }) => x.homes)).toEqual([
      16, 4, 10,
    ]);
    expect(r.body.parts.map((x: { number: string }) => x.number)).toEqual([
      'Big1',
      'Big2',
      'Big3',
    ]);
    for (const x of r.body.parts) expect(x.geometry.type).toBe('Polygon');
    // Six homes of thirty change part: 20%.
    expect(r.body.moved).toBe(0.2);
    expect(r.body.changesMuch).toBe(true);
    // Not decided yet: nothing to send back.
    expect(r.body.reopens).toBe(false);
    expect(r.body.numbers).toEqual(['Big2', 'Big3']);
    const after = await proposal();
    expect(after.lines).toEqual(before.lines);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('one more line: a free number for the new part, not one in use', async () => {
    const r = await preview([7.01, 7.02, 7.025]);
    expect(r.status).toBe(201);
    expect(r.body.parts).toHaveLength(4);
    expect(r.body.numbers.slice(0, 2)).toEqual(['Big2', 'Big3']);
    expect(['Big1', 'Big2', 'Big3', 'Big4']).not.toContain(r.body.numbers[2]);
    // Another number of parts is another proposal.
    expect(r.body.moved).toBe(1);
  });

  it('refused: a line that does not cross it; not for those who only look', async () => {
    const off = await preview([7.5, 7.02]);
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('TERRITORY_LINE_NOT_THROUGH');
    expect((await preview([7.01, 7.02], 'overseer')).status).toBe(403);
  });

  it('a save over a newer one is refused; with the version read, it goes through', async () => {
    const p = await proposal();
    const stale = await save([7.0112, 7.02], '2020-01-01T00:00:00.000Z');
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('TERRITORY_RECUT_STALE');
    expect((await proposal()).lines).toEqual(p.lines);
    const ok = await save([7.0112, 7.02], p.updatedAt);
    expect(ok.status).toBe(200);
    // The version read is now old.
    expect((await save([7.0112, 7.02], p.updatedAt)).status).toBe(409);
  });

  it('a large change: «no remarks» given before waits for a new look; a decided one goes back', async () => {
    expect(
      (
        await h
          .as('overseer')
          .put(`/territory-recut/proposals/${id}/remark`, { ok: true })
      ).status,
    ).toBe(200);
    expect(
      (await h.as('overseer').post('/territory-recut/approve')).status,
    ).toBe(201);
    // A small move (one home of thirty): the mark and the decision stand.
    let p = await proposal();
    const tried = await preview([7.0122, 7.02]);
    expect(tried.body.changesMuch).toBe(false);
    expect((await save([7.0122, 7.02], p.updatedAt)).status).toBe(200);
    p = await proposal();
    expect(p.approvedAt).not.toBeNull();
    expect(p.linesChangedAt).toBeNull();
    expect(p.remarks.map((r: { stale: boolean }) => r.stale)).toEqual([false]);
    // Tried large: the screen says it before the save.
    const large = await preview([7.018, 7.02]);
    expect(large.body.changesMuch).toBe(true);
    expect(large.body.reopens).toBe(true);
    expect((await save([7.018, 7.02], p.updatedAt)).status).toBe(200);
    p = await proposal();
    expect(p.approvedAt).toBeNull();
    expect(p.reopenedAt).not.toBeNull();
    expect(p.linesChangedAt).not.toBeNull();
    expect(p.remarks.map((r: { stale: boolean }) => r.stale)).toEqual([true]);
    // Looked at again: the new mark is about these lines.
    await h
      .as('overseer')
      .put(`/territory-recut/proposals/${id}/remark`, { ok: true });
    p = await proposal();
    expect(p.remarks.map((r: { stale: boolean }) => r.stale)).toEqual([false]);
  });
});
