import { Harness, startHarness } from './harness';
import { LocalNeedsService } from '../../src/local-needs/local-needs.service';

/**
 * Local needs (28 October 2026): the coordinator manages the topics, the
 * screen sees the weeks ahead with their «В жизни христианина» parts, a topic
 * is placed on a part or as one more, and each use is kept two years.
 */
describe('local needs (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let week: string;
  let lnPart: string;
  let otherPart: string;
  let topicId: string;

  const mondayIn = (days: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    h = await startHarness();
    tenantId = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    const card = await h.addPublisher({
      firstName: 'Карл',
      lastName: 'Координатор',
      appointment: 'elder',
      baptismDate: '2001-05-12',
    });
    const coord = await h.addUser({
      login: 'coord',
      role: 'elder',
      publisherId: card,
    });
    const r = await h
      .as('admin')
      .post('/responsibilities', { type: 'body_coordinator', userId: coord });
    expect([200, 201]).toContain(r.status);
    await h.addUser({ login: 'plain', role: 'elder' });

    week = mondayIn(14);
    const add = async (
      partKey: string,
      partOrder: number,
      partTitle: string,
    ) => {
      const res = await h.as('admin').post('/assignments', {
        weekStartDate: week,
        eventType: 'midweek',
        partKey,
        partOrder,
        partTitle,
        status: 'draft',
      });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    lnPart = await add('living_christians_1', 8, 'Местные потребности');
    otherPart = await add('living_christians_2', 9, 'Другой пункт');
    await add('cbs_conductor', 10, 'Изучение Библии в собрании');
    // As the workbook import writes it.
    await h.sql(
      `UPDATE assignments SET imported_title = part_title WHERE id IN ($1, $2)`,
      [lnPart, otherPart],
    );
  });

  afterAll(async () => h?.close());

  it('the coordinator may write a topic, a plain elder may only read', async () => {
    const mine = await h
      .as('coord')
      .post('/local-needs', { title: 'Чистота в зале' });
    expect(mine.status).toBe(201);
    topicId = mine.body.id;
    expect(mine.body.createdById).toBeTruthy();

    expect(
      (await h.as('plain').post('/local-needs', { title: 'X' })).status,
    ).toBe(403);
    expect((await h.as('plain').get('/local-needs')).status).toBe(200);
  });

  it('lists the weeks ahead and finds the «Местные потребности» part', async () => {
    const r = await h.as('plain').get('/local-needs/weeks');
    expect(r.status).toBe(200);
    const w = r.body.find((x: any) => x.weekStartDate === week);
    expect(w).toBeDefined();
    // No meeting settings in a fresh congregation: the day may be unknown.
    expect(w).toHaveProperty('meetingDate');
    const parts = Object.fromEntries(w.parts.map((p: any) => [p.id, p]));
    expect(parts[lnPart].localNeeds).toBe(true);
    expect(parts[otherPart].localNeeds).toBe(false);
    // Only «В жизни христианина».
    expect(w.parts).toHaveLength(2);
  });

  it('counts the empty part for the coordinator’s reminder', async () => {
    const svc = h.app.get(LocalNeedsService);
    const open = await svc.unfilledWeeks(tenantId);
    expect(open.map((o) => o.weekStartDate)).toContain(week);
  });

  it('a planned week is kept, snapped to its Monday', async () => {
    const r = await h
      .as('coord')
      .patch(`/local-needs/${topicId}`, { plannedWeek: mondayIn(70) });
    expect(r.status).toBe(200);
    expect(r.body.plannedWeek).toBe(mondayIn(70));
  });

  it('places the topic instead of the «Местные потребности» part', async () => {
    const r = await h.as('coord').post(`/local-needs/${topicId}/place`, {
      weekStartDate: week,
      assignmentId: lnPart,
    });
    expect(r.status).toBe(201);
    expect(r.body.usedWeek).toBe(week);
    expect(r.body.usedAssignmentId).toBe(lnPart);
    expect(r.body.plannedWeek).toBeNull();

    const [part] = await h.sql<{ part_title: string }>(
      `SELECT part_title FROM assignments WHERE id = $1`,
      [lnPart],
    );
    expect(part.part_title).toBe('Чистота в зале');

    const weeks = await h.as('coord').get('/local-needs/weeks');
    const p = weeks.body
      .find((x: any) => x.weekStartDate === week)
      .parts.find((x: any) => x.id === lnPart);
    expect(p.topicId).toBe(topicId);
    // Still the local-needs part: the import's own name says so.
    expect(p.localNeeds).toBe(true);

    const svc = h.app.get(LocalNeedsService);
    expect(
      (await svc.unfilledWeeks(tenantId)).map((o) => o.weekStartDate),
    ).not.toContain(week);
  });

  it('keeps the use in the topic’s history', async () => {
    const r = await h.as('plain').get('/local-needs');
    const t = r.body.find((x: any) => x.id === topicId);
    expect(t.uses).toHaveLength(1);
    expect(t.uses[0]).toMatchObject({
      weekStartDate: week,
      assignmentId: lnPart,
    });
  });

  it('adds one more part when asked, after the last «В жизни христианина»', async () => {
    const t = await h
      .as('coord')
      .post('/local-needs', { title: 'Проповедь зимой' });
    const r = await h.as('coord').post(`/local-needs/${t.body.id}/place`, {
      weekStartDate: week,
      durationMin: 10,
    });
    expect(r.status).toBe(201);
    const rows = await h.sql<{
      part_key: string;
      part_order: number;
      part_title: string;
    }>(
      `SELECT part_key, part_order, part_title FROM assignments
        WHERE week_start_date = $1 AND deleted_at IS NULL ORDER BY part_order`,
      [week],
    );
    expect(rows.map((x) => x.part_key)).toEqual([
      'living_christians_1',
      'living_christians_2',
      'living_christians_extra',
      'cbs_conductor',
    ]);
    expect(rows[2].part_title).toBe('Проповедь зимой');
  });

  it('a part taken back from the topic releases it and its use', async () => {
    const r = await h
      .as('admin')
      .patch(`/assignments/${lnPart}`, { partTitle: 'Местные потребности' });
    expect(r.status).toBe(200);
    const list = await h.as('coord').get('/local-needs');
    const t = list.body.find((x: any) => x.id === topicId);
    expect(t.usedWeek).toBeNull();
    expect(t.uses).toHaveLength(0);
  });

  it('refuses a part outside «В жизни христианина» and a week with no programme', async () => {
    const [cbs] = await h.sql<{ id: string }>(
      `SELECT id FROM assignments WHERE week_start_date = $1 AND part_key = 'cbs_conductor'`,
      [week],
    );
    const a = await h.as('coord').post(`/local-needs/${topicId}/place`, {
      weekStartDate: week,
      assignmentId: cbs.id,
    });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe('LOCAL_NEEDS_NOT_A_PART');
    const b = await h
      .as('coord')
      .post(`/local-needs/${topicId}/place`, { weekStartDate: mondayIn(300) });
    expect(b.status).toBe(400);
    expect(b.body.code).toBe('LOCAL_NEEDS_NO_PROGRAMME');
  });

  it('forgets uses older than two years', async () => {
    await h.sql(
      `INSERT INTO local_needs_uses (congregation_id, topic_id, week_start_date)
       VALUES ($1, $2, current_date - interval '800 days'), ($1, $2, current_date - interval '300 days')`,
      [tenantId, topicId],
    );
    const n = await h.app.get(LocalNeedsService).pruneHistory();
    expect(n).toBe(1);
  });
});
