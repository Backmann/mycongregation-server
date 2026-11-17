import { Harness, startHarness } from './harness';
import { CoVisitFolderService } from '../../src/co-visit-folder/co-visit-folder.service';

/**
 * The folder for the circuit overseer, form S-61 (17 November 2026), against
 * a real database: who sees what, a saved file that goes stale when its data
 * changes, the S-21 one group at a time, page 2 before «передано», the
 * reminders and page 2 erased after the visit.
 */
describe('the S-61 folder (real database)', () => {
  let h: Harness;
  let tenant: string;
  let visit: string;
  let groupId: string;
  const users: Record<string, string> = {};
  const cards: Record<string, string> = {};

  const year = new Date().getUTCFullYear() + 1;
  const start = `${year}-02-23`; // a coming visit, far enough ahead
  const end = `${year}-02-28`;

  beforeAll(async () => {
    h = await startHarness();
    tenant = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    const g = await h.as('admin').post('/service-groups', { name: 'Группа 1' });
    groupId = g.body.id;
    const elder = async (login: string, last: string) => {
      cards[login] = await h.addPublisher({
        firstName: 'Брат',
        lastName: last,
        appointment: 'elder',
        baptismDate: '1990-01-01',
        serviceGroupId: groupId,
      });
      users[login] = await h.addUser({
        login,
        role: 'elder',
        publisherId: cards[login],
      });
    };
    await elder('coordx', 'Иванов');
    await elder('secrx', 'Петров');
    await elder('sover', 'Сидоров');
    await elder('otherx', 'Кузнецов');
    for (const [login, type] of [
      ['coordx', 'body_coordinator'],
      ['secrx', 'secretary'],
      ['sover', 'service_overseer'],
    ]) {
      await h
        .as('admin')
        .post('/responsibilities', { type, userId: users[login] })
        .expect(201);
    }
    cards.pubx = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Ланг',
      gender: 'sister',
      baptismDate: '2000-01-01',
      serviceGroupId: groupId,
      mobilePhone: '+49 000 0000',
    });
    users.pubx = await h.addUser({
      login: 'pubx',
      role: 'publisher',
      publisherId: cards.pubx,
    });
    cards.loose = await h.addPublisher({
      firstName: 'Пётр',
      lastName: 'Безгруппы',
      baptismDate: '2000-01-01',
    });
    visit = (
      await h.sql<{ id: string }>(
        `INSERT INTO special_events (congregation_id, title, type, date, end_date)
         VALUES ($1, 'Визит', 'circuit_overseer_visit', $2, $3) RETURNING id`,
        [tenant, start, end],
      )
    )[0].id;
  });
  afterAll(async () => {
    await h?.close();
  });

  it('shows the three everything, another elder section 1, a publisher nothing', async () => {
    const full = await h
      .as('secrx')
      .get(`/co-visit-folder/${visit}`)
      .expect(200);
    expect(full.body.total).toBe(16);
    expect(full.body.byRole.map((r: { total: number }) => r.total)).toEqual([
      5, 5, 6,
    ]);
    expect(full.body.dueOn).toBe(start);
    expect(full.body.s62.dueOn).toBe(`${year}-01-23`);
    expect(full.body.page2.total).toBe(15);
    const s21 = full.body.items.find((i: { key: string }) => i.key === '2.1');
    // Группа 1 and the people without a group.
    expect(s21.groups.map((g: { name: string | null }) => g.name)).toEqual([
      'Группа 1',
      null,
    ]);

    const other = await h
      .as('otherx')
      .get(`/co-visit-folder/${visit}`)
      .expect(200);
    expect(other.body.items.map((i: { key: string }) => i.key)).toEqual([
      '1.1',
      '1.2',
      '1.3',
      '1.4',
      '1.5',
    ]);
    expect(other.body.page2).toBeUndefined();
    expect(other.body.deletions).toBeUndefined();
    await h
      .as('otherx')
      .put(`/co-visit-folder/${visit}/marks/1.3`, { state: 'saved' })
      .expect(403);
    await h.as('otherx').get(`/co-visit-folder/${visit}/contacts`).expect(403);
    await h
      .as('otherx')
      .get(`/co-visit-folder/${visit}/s21/${groupId}`)
      .expect(403);

    const pub = await h.as('pubx').get(`/co-visit-folder/${visit}`).expect(403);
    expect(pub.body.code).toBe('FOLDER_NO_ACCESS');
  });

  it('marks a manual item and refuses a mark that does not fit', async () => {
    await h
      .as('coordx')
      .put(`/co-visit-folder/${visit}/marks/1.1`, { state: 'paper' })
      .expect(200);
    const bad = await h
      .as('coordx')
      .put(`/co-visit-folder/${visit}/marks/1.1`, { state: 'saved' })
      .expect(400);
    expect(bad.body.code).toBe('FOLDER_MARK_INVALID');
    await h
      .as('coordx')
      .put(`/co-visit-folder/${visit}/marks/9.9`, { state: 'na' })
      .expect(400);
    const f = await h.as('sover').get(`/co-visit-folder/${visit}`).expect(200);
    const one = f.body.items.find((i: { key: string }) => i.key === '1.1');
    expect(one.state).toBe('paper');
    expect(one.ready).toBe(true);
    expect(one.markedBy).toBe('Иванов Брат');
  });

  it('a saved file turns «changed» when its data changes', async () => {
    const before = await h
      .as('secrx')
      .get(`/co-visit-folder/${visit}`)
      .expect(200);
    const stamp = before.body.items.find(
      (i: { key: string }) => i.key === '2.5',
    ).stamp;
    expect(stamp).toMatch(/^[0-9a-f]{32}$/);
    await h
      .as('secrx')
      .put(`/co-visit-folder/${visit}/marks/2.5`, { state: 'saved', stamp })
      .expect(200);
    let now = await h.as('secrx').get(`/co-visit-folder/${visit}`).expect(200);
    let line = now.body.items.find((i: { key: string }) => i.key === '2.5');
    expect(line.ready).toBe(true);
    expect(line.changed).toBe(false);

    await h.sql(
      `UPDATE publishers SET mobile_phone = '+49 111 1111' WHERE id = $1`,
      [cards.pubx],
    );
    now = await h.as('secrx').get(`/co-visit-folder/${visit}`).expect(200);
    line = now.body.items.find((i: { key: string }) => i.key === '2.5');
    expect(line.changed).toBe(true);
    expect(line.ready).toBe(false);

    // A note on the card is not in the file: no change.
    await h
      .as('secrx')
      .put(`/co-visit-folder/${visit}/marks/2.5`, {
        state: 'saved',
        stamp: line.stamp,
      })
      .expect(200);
    await h.sql(`UPDATE publishers SET notes = 'x' WHERE id = $1`, [
      cards.pubx,
    ]);
    now = await h.as('secrx').get(`/co-visit-folder/${visit}`).expect(200);
    expect(
      now.body.items.find((i: { key: string }) => i.key === '2.5').changed,
    ).toBe(false);
  });

  it('the S-21 goes one group at a time, ready when every group is saved and fresh', async () => {
    const res = await h
      .as('secrx')
      .get(`/co-visit-folder/${visit}/s21/${groupId}`)
      .expect(200);
    expect(res.body.years).toEqual([year - 1, year]);
    // Four elders and a sister in the group, two years each.
    expect(res.body.cards).toHaveLength(5);
    expect(res.body.cards[0]).toHaveLength(2);
    const none = await h
      .as('secrx')
      .get(`/co-visit-folder/${visit}/s21/none`)
      .expect(200);
    expect(none.body.cards).toHaveLength(1);

    await h
      .as('secrx')
      .put(
        `/co-visit-folder/${visit}/marks/${encodeURIComponent(`2.1:${groupId}`)}`,
        { state: 'saved', stamp: res.body.stamp },
      )
      .expect(200);
    let f = await h.as('secrx').get(`/co-visit-folder/${visit}`).expect(200);
    let item = f.body.items.find((i: { key: string }) => i.key === '2.1');
    expect(item.ready).toBe(false);
    expect(item.facts).toEqual({ groups: 2, saved: 1, again: 0 });

    await h
      .as('secrx')
      .put(
        `/co-visit-folder/${visit}/marks/${encodeURIComponent('2.1:none')}`,
        {
          state: 'saved',
          stamp: none.body.stamp,
        },
      )
      .expect(200);
    f = await h.as('secrx').get(`/co-visit-folder/${visit}`).expect(200);
    expect(
      f.body.items.find((i: { key: string }) => i.key === '2.1').ready,
    ).toBe(true);

    // A report entered later: the group's file is stale.
    await h.sql(
      `INSERT INTO service_reports (congregation_id, publisher_id, report_month, served_this_month)
       VALUES ($1, $2, $3, true)`,
      [tenant, cards.pubx, `${year - 1}-10-01`],
    );
    f = await h.as('secrx').get(`/co-visit-folder/${visit}`).expect(200);
    item = f.body.items.find((i: { key: string }) => i.key === '2.1');
    expect(item.ready).toBe(false);
    expect(item.facts.again).toBe(1);
  });

  it('takes back as «saved» the fingerprint the folder gave, for every file', async () => {
    const f = await h.as('secrx').get(`/co-visit-folder/${visit}`).expect(200);
    const lines = (
      f.body.items as {
        key: string;
        source: string;
        stamp: string | null;
        groups?: { key: string; stamp: string }[];
      }[]
    ).flatMap((i): { key: string; stamp: string | null }[] =>
      i.key === '2.1' ? i.groups! : i.source === 'pdf' ? [i] : [],
    );
    expect(lines.length).toBeGreaterThanOrEqual(12);
    for (const l of lines) {
      expect(l.stamp).toMatch(/^[0-9a-f]{32,40}$/);
      const res = await h
        .as('secrx')
        .put(`/co-visit-folder/${visit}/marks/${encodeURIComponent(l.key)}`, {
          state: 'saved',
          stamp: l.stamp,
        });
      expect([l.key, res.status]).toEqual([l.key, 200]);
    }
  });

  it('gives the contacts to the three only, for the file', async () => {
    const res = await h
      .as('sover')
      .get(`/co-visit-folder/${visit}/contacts`)
      .expect(200);
    const anna = res.body.people.find(
      (p: { lastName: string }) => p.lastName === 'Ланг',
    );
    expect(anna.mobilePhone).toBe('+49 111 1111');
    expect(anna.group).toBe('Группа 1');
  });

  it('page 2: only fitting answers, «передано» only when all fifteen are given', async () => {
    const bad = await h
      .as('coordx')
      .put(`/co-visit-folder/${visit}/answers/1`, { answer: 'na' })
      .expect(400);
    expect(bad.body.code).toBe('FOLDER_ANSWER_INVALID');
    for (let q = 1; q <= 14; q += 1) {
      await h
        .as('coordx')
        .put(`/co-visit-folder/${visit}/answers/${q}`, { answer: 'yes' })
        .expect(200);
    }
    const early = await h
      .as('coordx')
      .put(`/co-visit-folder/${visit}/handed-over`, { on: true })
      .expect(409);
    expect(early.body.code).toBe('FOLDER_PAGE2_INCOMPLETE');
    await h
      .as('coordx')
      .put(`/co-visit-folder/${visit}/answers/15`, { answer: 'na' })
      .expect(200);
    await h
      .as('coordx')
      .put(`/co-visit-folder/${visit}/handed-over`, { on: true })
      .expect(200);

    // Whoever saved a file is asked to delete it; each marks his own.
    const keys = await h.sql<{ user_id: string }>(
      `SELECT user_id FROM notification_outbox WHERE dedupe_key = $1`,
      [`co-visit-folder:${visit}:deleteFiles`],
    );
    expect(keys.map((k) => k.user_id).sort()).toEqual([users.secrx].sort());
    await h
      .as('secrx')
      .post(`/co-visit-folder/${visit}/files-deleted`)
      .expect(201);
    const f = await h.as('secrx').get(`/co-visit-folder/${visit}`).expect(200);
    expect(f.body.handedOver.by).toBe('Иванов Брат');
    expect(f.body.deletions).toEqual([
      expect.objectContaining({ me: true, deletedAt: expect.any(String) }),
    ]);
  });

  it('reminds of the S-62 and the open items once, and erases page 2 after the visit', async () => {
    const svc = h.app.get(CoVisitFolderService);
    // A second visit, to see the reminders without the handed-over one.
    const v2 = (
      await h.sql<{ id: string }>(
        `INSERT INTO special_events (congregation_id, title, type, date, end_date)
         VALUES ($1, 'Визит 2', 'circuit_overseer_visit', $2, $3) RETURNING id`,
        [tenant, `${year + 1}-03-02`, `${year + 1}-03-07`],
      )
    )[0].id;
    const at = (d: string) => new Date(`${d}T09:00:00Z`);
    await svc.daily(at(`${year}-12-23`)); // before the S-62 reminder of v2 (29 Dec)
    await svc.daily(at(`${year + 1}-01-02`));
    const s62 = await h.sql<{ user_id: string }>(
      `SELECT user_id FROM notification_outbox WHERE dedupe_key = $1`,
      [`co-visit-folder:${v2}:s62`],
    );
    expect(s62.map((r) => r.user_id).sort()).toEqual(
      [users.coordx, users.secrx].sort(),
    );

    await svc.daily(at(`${year + 1}-02-23`)); // within the week before its Tuesday
    const gaps = await h.sql<{ user_id: string }>(
      `SELECT user_id FROM notification_outbox WHERE dedupe_key = $1`,
      [`co-visit-folder:${v2}:gaps`],
    );
    expect(gaps.map((r) => r.user_id).sort()).toEqual(
      [users.coordx, users.secrx, users.sover].sort(),
    );

    // The first visit is over: its answers go, the handing over stays.
    await svc.daily(at(`${year}-03-01`));
    const row = await h.sql<{ answers: unknown; handed_over_at: unknown }>(
      `SELECT answers, handed_over_at FROM co_visit_folders WHERE special_event_id = $1`,
      [visit],
    );
    expect(row[0].answers).toBeNull();
    expect(row[0].handed_over_at).not.toBeNull();
    const late = await h
      .as('coordx')
      .put(`/co-visit-folder/${visit}/answers/3`, { answer: 'yes' })
      .expect(409);
    expect(late.body.code).toBe('FOLDER_ANSWERS_ERASED');
  });

  it('hints count since the previous visit: the moved, the departed pioneer', async () => {
    const prev = `${year - 1}-08-04`;
    await h.sql(
      `INSERT INTO special_events (congregation_id, title, type, date, end_date)
       VALUES ($1, 'Прошлый визит', 'circuit_overseer_visit', $2, $2)`,
      [tenant, prev],
    );
    const movedCard = await h.addPublisher({
      firstName: 'Ушёл',
      lastName: 'Переехал',
      baptismDate: '2000-01-01',
    });
    await h.sql(
      `UPDATE publishers SET removed_at = $2, removal_reason = 'moved' WHERE id = $1`,
      [movedCard, `${year - 1}-10-10`],
    );
    const oldCard = await h.addPublisher({
      firstName: 'Давно',
      lastName: 'Ушедший',
      baptismDate: '2000-01-01',
    });
    await h.sql(
      `UPDATE publishers SET removed_at = $2, removal_reason = 'moved' WHERE id = $1`,
      [oldCard, `${year - 1}-06-01`],
    );
    const f = await h.as('coordx').get(`/co-visit-folder/${visit}`).expect(200);
    expect(f.body.page2.hints.since).toBe(prev);
    expect(f.body.page2.hints['9'].moved).toEqual(['Переехал Ушёл']);
    expect(f.body.page2.hints['12'].total).toBeGreaterThan(0);
  });
});
