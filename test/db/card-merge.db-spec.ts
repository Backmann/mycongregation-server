import { Harness, startHarness } from './harness';
import { assertAssignable } from '../../src/common/inactive';

/**
 * «Объединить карточки» against a real database (1 November 2026).
 *
 * The case it was built for: one brother entered twice — one card has his
 * sign-in and nothing else, the other his group, his reports, everything.
 */
describe('merging two cards of one person (real database)', () => {
  let h: Harness;
  let groupId: string;
  let kept: string; // the full card: group, reports, overseer of the group
  let dupe: string; // the duplicate: the sign-in, a phone, a report or two
  let userId: string;

  /** Rows of the tables a merge touches, comparable before and after. */
  const TABLES = [
    'publishers',
    'service_reports',
    'pioneer_spells',
    'service_groups',
    'service_log_entries',
    'report_snapshots',
    'elder_task_assignees',
    'publisher_distinct_pairs',
  ];
  // The standing is computed from the reports and recomputed after a merge
  // and after its undo; the fixtures here put reports in by hand without it.
  const IGNORED = new Set(['updated_at', 'status']);
  const snapshot = async (): Promise<Record<string, string[]>> => {
    const out: Record<string, string[]> = {};
    for (const t of TABLES) {
      const rows = await h.sql<{ j: Record<string, unknown> }>(
        `SELECT row_to_json(x) AS j FROM "${t}" x`,
      );
      out[t] = rows
        .map((r) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(r.j)
                .filter(([k]) => !IGNORED.has(k))
                .sort(([a], [b]) => a.localeCompare(b)),
            ),
          ),
        )
        .sort();
    }
    return out;
  };
  const congregation = async () =>
    (
      await h.sql<{ c: string }>(
        `SELECT congregation_id AS c FROM publishers WHERE id = $1`,
        [kept],
      )
    )[0].c;

  beforeAll(async () => {
    h = await startHarness();
    const g = await h.as('admin').post('/service-groups', { name: 'Слияние' });
    groupId = g.body.id;
    kept = await h.addPublisher({
      firstName: 'Пётр',
      lastName: 'Двойной',
      appointment: 'publisher',
      baptismDate: '2005-05-05',
      birthDate: '1980-01-01',
      memberSince: null,
    });
    await h.sql(`UPDATE publishers SET service_group_id = $1 WHERE id = $2`, [
      groupId,
      kept,
    ]);
    await h.sql(
      `UPDATE service_groups SET assistant_publisher_id = $1 WHERE id = $2`,
      [kept, groupId],
    );
    dupe = await h.addPublisher({
      firstName: 'Петр',
      lastName: 'двойной',
      appointment: 'publisher',
      mobilePhone: '+49 151 0000 1234',
    });
    userId = await h.addUser({
      login: 'dvoinoy',
      role: 'publisher',
      publisherId: dupe,
    });
    const c = await congregation();
    // Kept: September and October. Duplicate: August and October.
    await h.sql(
      `INSERT INTO service_reports (congregation_id, publisher_id, report_month, served_this_month, bible_studies)
       VALUES ($1, $2, '2026-09-01', true, 0), ($1, $2, '2026-10-01', true, 0),
              ($1, $3, '2026-08-01', true, 1), ($1, $3, '2026-10-01', true, 2)`,
      [c, kept, dupe],
    );
    await h.sql(
      `INSERT INTO service_log_entries (id, congregation_id, publisher_id, user_id, day, minutes)
       VALUES (gen_random_uuid(), $1, $2, $3, '2026-10-30', 90)`,
      [c, dupe, userId],
    );
    // A sent month that counted the two cards as two people.
    await h.sql(
      `INSERT INTO report_snapshots (congregation_id, kind, period, members, appointments)
       VALUES ($1, 'monthly', '2026-08', $2::jsonb, $3::jsonb)`,
      [
        c,
        JSON.stringify({ publishers: [kept, dupe] }),
        JSON.stringify({ [kept]: 'publisher', [dupe]: 'publisher' }),
      ],
    );
    await h.sql(
      `INSERT INTO publisher_distinct_pairs (congregation_id, a_id, b_id)
       SELECT $1, LEAST($2::uuid, $3::uuid), GREATEST($2::uuid, $3::uuid)`,
      [c, kept, dupe],
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  const preview = (body: Record<string, unknown> = {}) =>
    h
      .as('admin')
      .post('/card-merge/preview', { keptId: kept, mergedId: dupe, ...body });

  it('finds the duplicate when the card is entered again', async () => {
    const r = await h
      .as('admin')
      .get(
        '/card-merge/duplicates?firstName=%20двойной&lastName=ПЁТР&exceptId=' +
          kept,
      );
    expect(r.status).toBe(200);
    expect(r.body.map((x: { id: string }) => x.id)).toEqual([dupe]);
    const byPhone = await h
      .as('admin')
      .get('/card-merge/duplicates?phone=0151-00001234');
    expect(byPhone.body.map((x: { id: string }) => x.id)).toEqual([dupe]);
  });

  it('the preview says what would happen and changes nothing', async () => {
    const before = await snapshot();
    const r = await preview();
    expect(r.status).toBe(201);
    expect(r.body.blockers).toEqual([]);
    expect(r.body.accounts).toBe('move');
    expect(r.body.needsAdmin).toBe(true);
    expect(r.body.moves.service_reports).toBe(2);
    expect(r.body.conflicts).toHaveLength(1);
    expect(r.body.conflicts[0].key).toBe('report:2026-10');
    expect(
      r.body.fields.find((f: { field: string }) => f.field === 'mobilePhone')
        ?.rule,
    ).toBe('take');
    expect(r.body.countedTwice).toEqual(['2026-08']);
    // The pair was marked «different people»: said, and not «joined».
    expect(r.body.markedDistinct).toBe(true);
    expect(r.body.joined.publisher_distinct_pairs).toBeUndefined();
    expect(await snapshot()).toEqual(before);
  });

  it('a report handed in after the preview stops the merge', async () => {
    const p = await preview();
    await h.sql(
      `INSERT INTO service_reports (congregation_id, publisher_id, report_month, served_this_month)
       VALUES ($1, $2, '2026-07-01', true)`,
      [await congregation(), dupe],
    );
    const r = await h.as('admin').post('/card-merge', {
      keptId: kept,
      mergedId: dupe,
      fingerprint: p.body.fingerprint,
      choices: { 'report:2026-10': p.body.conflicts[0].options[0].id },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('MERGE_PLAN_CHANGED');
    expect(
      await h.sql(`SELECT 1 FROM publishers WHERE id = $1`, [dupe]),
    ).toHaveLength(1);
  });

  let before: Record<string, string[]>;
  let mergeId: string;

  it('merges: everything on one card, nothing names the other', async () => {
    before = await snapshot();
    const myBefore = await h.as('dvoinoy').get('/me/publisher');
    expect(myBefore.body.publisher.id).toBe(dupe);

    const p = await preview();
    const dupeOct = p.body.conflicts[0].options.find(
      (o: { side: string }) => o.side === 'merged',
    ).id;
    const r = await h.as('admin').post('/card-merge', {
      keptId: kept,
      mergedId: dupe,
      fingerprint: p.body.fingerprint,
      choices: { 'report:2026-10': dupeOct },
    });
    expect(r.status).toBe(201);
    mergeId = r.body.mergeId;

    // The duplicate is gone; its reports, its hours and its sign-in are here.
    expect(
      await h.sql(`SELECT 1 FROM publishers WHERE id = $1`, [dupe]),
    ).toHaveLength(0);
    const months = await h.sql<{ m: string; s: number }>(
      `SELECT to_char(report_month, 'YYYY-MM') AS m, bible_studies AS s
         FROM service_reports WHERE publisher_id = $1 ORDER BY 1`,
      [kept],
    );
    expect(months).toEqual([
      { m: '2026-07', s: 0 },
      { m: '2026-08', s: 1 },
      { m: '2026-09', s: 0 },
      { m: '2026-10', s: 2 }, // the duplicate's October, as chosen
    ]);
    const card = (
      await h.sql<{ user_id: string; mobile_phone: string | null }>(
        `SELECT user_id, mobile_phone FROM publishers WHERE id = $1`,
        [kept],
      )
    )[0];
    expect(card.user_id).toBe(userId);
    expect(card.mobile_phone).not.toBeNull();
    // He notices nothing: the same session now answers with the full card.
    const me = await h.as('dvoinoy').get('/me/publisher');
    expect(me.status).toBe(200);
    expect(me.body.publisher.id).toBe(kept);
    // Nothing in the database names the duplicate, but the journal.
    const tables = await h.sql<{ t: string }>(
      `SELECT c.relname AS t FROM pg_class c
        WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
          AND c.relname NOT IN ('audit_logs', 'publisher_merges')`,
    );
    for (const { t } of tables) {
      const [{ n }] = await h.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${t}" x WHERE x::text LIKE '%' || $1 || '%'`,
        [dupe],
      );
      expect(`${t}:${n}`).toBe(`${t}:0`);
    }
  });

  it('a screen still offering the merged card is told so', async () => {
    await expect(
      assertAssignable(h.db.manager, await congregation(), [dupe]),
    ).rejects.toMatchObject({ response: { code: 'CARD_MERGED' } });
  });

  it('the card’s history keeps the duplicate’s entries', async () => {
    const r = await h.as('admin').get(`/journal?personId=${kept}&limit=200`);
    expect(r.status).toBe(200);
    const ids = new Set(
      r.body.items.map((i: { entityId: string }) => i.entityId),
    );
    expect(ids.has(dupe)).toBe(true);
  });

  it('«Разъединить» puts every row back exactly as it was', async () => {
    const list = await h.as('admin').get(`/card-merge/of/${kept}`);
    expect(list.body[0].canUndo).toBe(true);
    const r = await h.as('admin').post(`/card-merge/${mergeId}/undo`);
    expect(r.status).toBe(201);
    expect(r.body.notReturned).toEqual({});
    expect(await snapshot()).toEqual(before);
    const me = await h.as('dvoinoy').get('/me/publisher');
    expect(me.body.publisher.id).toBe(dupe);
    // Once.
    const again = await h.as('admin').post(`/card-merge/${mergeId}/undo`);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('MERGE_NOT_UNDOABLE');
  });

  it('two different people are not merged: the birth dates differ', async () => {
    await h.sql(
      `UPDATE publishers SET birth_date = '1990-02-02' WHERE id = $1`,
      [dupe],
    );
    const r = await preview();
    expect(r.body.blockers).toContain('MERGE_BIRTH_DATES_DIFFER');
    const go = await h.as('admin').post('/card-merge', {
      keptId: kept,
      mergedId: dupe,
      fingerprint: r.body.fingerprint,
    });
    expect(go.status).toBe(400);
    expect(go.body.code).toBe('MERGE_BLOCKED');
    await h.sql(`UPDATE publishers SET birth_date = NULL WHERE id = $1`, [
      dupe,
    ]);
  });

  it('a sign-in moved by a merge is an administrator’s decision', async () => {
    const sec = await h.addPublisher({
      firstName: 'Секретарь',
      lastName: 'Тестовый',
      appointment: 'elder',
      baptismDate: '1990-01-01',
    });
    const secUser = await h.addUser({
      login: 'sekretar',
      role: 'elder',
      publisherId: sec,
    });
    await h.sql(
      `INSERT INTO responsibilities (congregation_id, type, user_id)
       VALUES ($1, 'secretary', $2)`,
      [await congregation(), secUser],
    );
    const p = await h
      .as('sekretar')
      .post('/card-merge/preview', { keptId: kept, mergedId: dupe });
    expect(p.status).toBe(201);
    const r = await h.as('sekretar').post('/card-merge', {
      keptId: kept,
      mergedId: dupe,
      fingerprint: p.body.fingerprint,
      choices: { 'report:2026-10': p.body.conflicts[0].options[0].id },
    });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MERGE_ACCOUNT_ADMIN_ONLY');
  });
});

describe('merging cards that each have a sign-in (real database)', () => {
  let h: Harness;
  let kept: string;
  let dupe: string;
  let keptUser: string;
  let dupeUser: string;
  let taskId: string;

  const c = async () =>
    (
      await h.sql<{ c: string }>(
        `SELECT congregation_id AS c FROM publishers WHERE id = $1`,
        [kept],
      )
    )[0].c;

  beforeAll(async () => {
    h = await startHarness();
    kept = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Два-Входа',
      gender: 'sister',
      appointment: 'publisher',
      baptismDate: '2001-01-01',
      memberSince: '2024-03-01',
    });
    dupe = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Два-Входа',
      gender: 'sister',
      appointment: 'publisher',
      memberSince: '2019-09-01',
    });
    keptUser = await h.addUser({
      login: 'anna.main',
      role: 'publisher',
      publisherId: kept,
    });
    dupeUser = await h.addUser({
      login: 'anna.second',
      role: 'publisher',
      publisherId: dupe,
    });
    const cong = await c();
    // The sign-in that will be closed holds a responsibility.
    await h.sql(
      `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, 'cleaning', $2)`,
      [cong, keptUser],
    );
    // Both are pioneers in overlapping months — one side stays.
    await h.sql(
      `INSERT INTO pioneer_spells (congregation_id, publisher_id, pioneer_type, start_month, end_month)
       VALUES ($1, $2, 'regular', '2025-09-01', NULL), ($1, $3, 'regular', '2026-01-01', '2026-06-01')`,
      [cong, kept, dupe],
    );
    // One task given to both: the same fact twice, joined.
    const t = await h.sql<{ id: string }>(
      `INSERT INTO elder_tasks (congregation_id, title, assignee_publisher_id) VALUES ($1, 'x', $2) RETURNING id`,
      [cong, dupe],
    );
    taskId = t[0].id;
    await h.sql(
      `INSERT INTO elder_task_assignees (task_id, publisher_id) VALUES ($1, $2), ($1, $3)`,
      [taskId, kept, dupe],
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  it('asks which sign-in stays, joins the shared task, asks about the spells', async () => {
    const p = await h
      .as('admin')
      .post('/card-merge/preview', { keptId: kept, mergedId: dupe });
    expect(p.status).toBe(201);
    expect(p.body.blockers).toEqual([]);
    expect(p.body.accounts).toBe('choose');
    expect(p.body.joined.elder_task_assignees).toBe(1);
    expect(p.body.conflicts.map((x: { key: string }) => x.key)).toEqual([
      'pioneer_spells',
    ]);
  });

  let mergeId: string;
  it('keeps the chosen sign-in; the other is closed, its duties come over', async () => {
    const p = await h.as('admin').post('/card-merge/preview', {
      keptId: kept,
      mergedId: dupe,
      keepUserId: dupeUser,
    });
    const r = await h.as('admin').post('/card-merge', {
      keptId: kept,
      mergedId: dupe,
      fingerprint: p.body.fingerprint,
      keepUserId: dupeUser,
      choices: { pioneer_spells: 'merged' },
    });
    expect(r.status).toBe(201);
    mergeId = r.body.mergeId;
    const card = (
      await h.sql<{ user_id: string; member_since: string | null }>(
        `SELECT user_id, to_char(member_since, 'YYYY-MM-DD') AS member_since FROM publishers WHERE id = $1`,
        [kept],
      )
    )[0];
    expect(card.user_id).toBe(dupeUser);
    expect(card.member_since).toBe('2019-09-01'); // the earlier of the two
    const closed = await h.sql<{ a: boolean }>(
      `SELECT is_active AS a FROM users WHERE id = $1`,
      [keptUser],
    );
    expect(closed[0].a).toBe(false);
    const resp = await h.sql<{ u: string }>(
      `SELECT user_id AS u FROM responsibilities WHERE type = 'cleaning'`,
    );
    expect(resp.map((x) => x.u)).toEqual([dupeUser]);
    const spells = await h.sql<{ s: string }>(
      `SELECT to_char(start_month, 'YYYY-MM') AS s FROM pioneer_spells WHERE publisher_id = $1`,
      [kept],
    );
    expect(spells.map((x) => x.s)).toEqual(['2026-01']); // the merged side's
    const assignees = await h.sql(
      `SELECT 1 FROM elder_task_assignees WHERE task_id = $1`,
      [taskId],
    );
    expect(assignees).toHaveLength(1);
    const single = await h.sql<{ a: string }>(
      `SELECT assignee_publisher_id AS a FROM elder_tasks WHERE id = $1`,
      [taskId],
    );
    expect(single[0].a).toBe(kept); // a formerly keyless link, moved too
  });

  it('undo reopens the closed sign-in and gives its duty back', async () => {
    const r = await h.as('admin').post(`/card-merge/${mergeId}/undo`);
    expect(r.status).toBe(201);
    expect(r.body.notReturned).toEqual({});
    const users = await h.sql<{ id: string; a: boolean }>(
      `SELECT id, is_active AS a FROM users WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[keptUser, dupeUser]],
    );
    expect(users.every((u) => u.a)).toBe(true);
    const cards = await h.sql<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM publishers WHERE id = ANY($1::uuid[])`,
      [[kept, dupe]],
    );
    expect(Object.fromEntries(cards.map((x) => [x.id, x.user_id]))).toEqual({
      [kept]: keptUser,
      [dupe]: dupeUser,
    });
    const resp = await h.sql<{ u: string }>(
      `SELECT user_id AS u FROM responsibilities WHERE type = 'cleaning'`,
    );
    expect(resp.map((x) => x.u)).toEqual([keptUser]);
    const spells = await h.sql(`SELECT 1 FROM pioneer_spells`);
    expect(spells).toHaveLength(2);
    const assignees = await h.sql(
      `SELECT 1 FROM elder_task_assignees WHERE task_id = $1`,
      [taskId],
    );
    expect(assignees).toHaveLength(2);
  });

  it('the sign-in one is using is not closed by one’s own merge', async () => {
    const admin = (
      await h.sql<{ id: string }>(
        `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
      )
    )[0].id;
    await h.sql(`UPDATE publishers SET user_id = NULL WHERE id = $1`, [dupe]);
    await h.sql(`UPDATE publishers SET user_id = $1 WHERE id = $2`, [
      admin,
      dupe,
    ]);
    const p = await h.as('admin').post('/card-merge/preview', {
      keptId: kept,
      mergedId: dupe,
      keepUserId: keptUser,
    });
    expect(p.body.blockers).toEqual(['OWN_DEACTIVATION']);
    await h.sql(`UPDATE publishers SET user_id = $1 WHERE id = $2`, [
      dupeUser,
      dupe,
    ]);
  });
});
