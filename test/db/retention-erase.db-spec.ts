import { Harness, startHarness } from './harness';
import { RetentionService } from '../../src/retention/retention.service';

/**
 * Removal by the retention rules (R-20, 28 November 2026): the switched-on
 * rules take what is past its time — for good — and nothing else: not what is
 * still within its time, not a rule left counting, not another congregation.
 */
describe('retention: the switched-on rules remove (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let otherTenant: string;

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    [{ id: otherTenant }] = await h.sql<{ id: string }>(
      `INSERT INTO congregations (name, country, language, timezone) SELECT 'Другое собрание', country, language, timezone FROM congregations LIMIT 1 RETURNING id`,
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  const one = async (sql: string, args: unknown[]) =>
    (await h.sql<{ id: string }>(sql, args))[0].id;
  const exists = async (table: string, id: string) =>
    (await h.sql(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).length === 1;

  it('erases what is past its time, keeps the rest, and says how many', async () => {
    const pub = await h.addPublisher({
      firstName: 'Стирание',
      lastName: 'Тест',
    });
    const absence = (end: string, deleted: string | null, cong = tenantId) =>
      one(
        `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date, deleted_at)
         VALUES ($1, $2, current_date - 90, ${end}, ${deleted ?? 'NULL'}) RETURNING id`,
        [cong, pub],
      );
    const endedLongAgo = await absence('current_date - 40', null);
    const endedYesterday = await absence('current_date - 1', null);
    const deletedLongAgo = await absence(
      'current_date - 1',
      `now() - interval '40 days'`,
    );

    // A visit deleted 40 days ago, with its own item and an absence made for it.
    const visit = await one(
      `INSERT INTO special_events (congregation_id, title, date, type, deleted_at)
       VALUES ($1, 'Визит', current_date + 30, 'circuit_overseer_visit', now() - interval '40 days') RETURNING id`,
      [tenantId],
    );
    const visitItem = await one(
      `INSERT INTO co_visit_items (congregation_id, special_event_id, kind, item_date)
       VALUES ($1, $2, 'field', current_date + 30) RETURNING id`,
      [tenantId, visit],
    );
    const absenceForVisit = await one(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date, special_event_id)
       VALUES ($1, $2, current_date + 29, current_date + 31, $3) RETURNING id`,
      [tenantId, pub, visit],
    );
    // A visiting speaker deleted 40 days ago, named on a past programme part.
    const speaker = await one(
      `INSERT INTO visiting_speakers (congregation_id, first_name, deleted_at)
       VALUES ($1, 'Гость', now() - interval '40 days') RETURNING id`,
      [tenantId],
    );
    const exchange = await one(
      `INSERT INTO talk_exchange (congregation_id, direction, date, deleted_at)
       VALUES ($1, 'incoming', current_date - 20, now() - interval '40 days') RETURNING id`,
      [tenantId],
    );
    const part = await one(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key,
                                speaker_name, visiting_speaker_id, talk_exchange_id)
       VALUES ($1, current_date - 20, 'weekend', 'public_talk', 'Гость Г.', $2, $3) RETURNING id`,
      [tenantId, speaker, exchange],
    );
    const partDeleted = await one(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, deleted_at)
       VALUES ($1, current_date - 20, 'weekend', 'reader', now() - interval '40 days') RETURNING id`,
      [tenantId],
    );
    const partDeletedRecently = await one(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, deleted_at)
       VALUES ($1, current_date - 20, 'weekend', 'chairman', now() - interval '10 days') RETURNING id`,
      [tenantId],
    );
    // A rule left counting: an external congregation deleted 40 days ago stays.
    const externalKept = await one(
      `INSERT INTO external_congregations (congregation_id, name, deleted_at)
       VALUES ($1, 'Соседнее', now() - interval '40 days') RETURNING id`,
      [tenantId],
    );
    // Another congregation's absence past its time — not this one's to remove.
    const pubOther = await h.addPublisher({
      firstName: 'Чужой',
      lastName: 'Тест',
    });
    await h.sql(`UPDATE publishers SET congregation_id = $1 WHERE id = $2`, [
      otherTenant,
      pubOther,
    ]);
    const otherOld = await one(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date)
       VALUES ($1, $2, current_date - 90, current_date - 40) RETURNING id`,
      [otherTenant, pubOther],
    );

    const done = await h.app.get(RetentionService).applyDated(tenantId);

    // Gone: past their time.
    for (const [table, id] of [
      ['absences', endedLongAgo],
      ['absences', deletedLongAgo],
      ['special_events', visit],
      ['visiting_speakers', speaker],
      ['talk_exchange', exchange],
      ['assignments', partDeleted],
    ] as const)
      expect([table, await exists(table, id)]).toEqual([table, false]);
    // Gone with the visit: what was its own.
    expect(await exists('co_visit_items', visitItem)).toBe(false);
    expect(await exists('absences', absenceForVisit)).toBe(false);
    // Kept: within its time, a rule still counting, another congregation.
    for (const [table, id] of [
      ['absences', endedYesterday],
      ['assignments', partDeletedRecently],
      ['external_congregations', externalKept],
      ['absences', otherOld],
    ] as const)
      expect([table, await exists(table, id)]).toEqual([table, true]);
    // The past part keeps the speaker's name; only the links went.
    const [kept] = await h.sql<{
      speaker_name: string;
      visiting_speaker_id: string | null;
      talk_exchange_id: string | null;
    }>(
      `SELECT speaker_name, visiting_speaker_id, talk_exchange_id FROM assignments WHERE id = $1`,
      [part],
    );
    expect(kept).toEqual({
      speaker_name: 'Гость Г.',
      visiting_speaker_id: null,
      talk_exchange_id: null,
    });
    expect(done).toMatchObject({
      absences: 1,
      'deleted:absences': 1,
      'deleted:special-events': 1,
      'deleted:visiting-speakers': 1,
      'deleted:talk-exchange': 1,
      'deleted:assignments': 1,
    });
    expect(done['deleted:external-congregations']).toBeUndefined();
  });

  it('the preview says which rules remove', async () => {
    const rows = (await h.as('admin').get('/retention/preview')).body as {
      key: string;
      on?: boolean;
    }[];
    const on = rows.filter((r) => r.on).map((r) => r.key);
    expect(on).toEqual(
      expect.arrayContaining([
        'absences',
        'deleted:assignments',
        'deleted:absences',
        'deleted:special-events',
        'deleted:talk-exchange',
        'deleted:visiting-speakers',
      ]),
    );
    expect(on).not.toContain('deleted:publishers');
    expect(on).not.toContain('deleted:users');
    expect(on).not.toContain('assignments');
  });
});
