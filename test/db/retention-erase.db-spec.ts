import { DataSource } from 'typeorm';
import { Harness, startHarness } from './harness';
import { RetentionService } from '../../src/retention/retention.service';
import { CoVisitTemplateService } from '../../src/special-events/co-visit-template.service';
import { SpecialEvent } from '../../src/entities/special-event.entity';

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
    // A visiting speaker and a journal entry deleted 40 days ago that nothing
    // points at any more.
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

  it('keeps what a living visit took away, and the visit gives it back', async () => {
    const old = `now() - interval '40 days'`;
    const visit = await one(
      `INSERT INTO special_events (congregation_id, title, date, type)
       VALUES ($1, 'Визит', current_date + 60, 'circuit_overseer_visit') RETURNING id`,
      [tenantId],
    );
    // A weekend part the visit hid 40 days ago, and its op in the visit.
    const hidden = await one(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, deleted_at)
       VALUES ($1, current_date + 60, 'weekend', 'watchtower_reader', ${old}) RETURNING id`,
      [tenantId],
    );
    await h.sql(
      `UPDATE special_events SET co_revert_data = $2::jsonb WHERE id = $1`,
      [visit, JSON.stringify([{ op: 'deleted', id: hidden }])],
    );
    // Entries the visit set aside, or its overseer's own, and one whose
    // programme line still exists.
    const setAside = await one(
      `INSERT INTO talk_exchange (congregation_id, direction, date, set_aside_by, deleted_at)
       VALUES ($1, 'incoming', current_date + 60, $2, ${old}) RETURNING id`,
      [tenantId, visit],
    );
    const overseers = await one(
      `INSERT INTO talk_exchange (congregation_id, direction, date, circuit_visit_id, deleted_at)
       VALUES ($1, 'incoming', current_date + 53, $2, ${old}) RETURNING id`,
      [tenantId, visit],
    );
    const lined = await one(
      `INSERT INTO talk_exchange (congregation_id, direction, date, deleted_at)
       VALUES ($1, 'incoming', current_date + 46, ${old}) RETURNING id`,
      [tenantId],
    );
    await one(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, talk_exchange_id, deleted_at)
       VALUES ($1, current_date + 46, 'weekend', 'public_talk', $2, now() - interval '5 days') RETURNING id`,
      [tenantId, lined],
    );
    // Cards still named by an entry, a part, or a card merged into them.
    const card = (merged: string | null = null) =>
      one(
        `INSERT INTO visiting_speakers (congregation_id, first_name, merged_into_id, deleted_at)
         VALUES ($1, 'Карточка', $2, ${merged ? 'NULL' : old}) RETURNING id`,
        [tenantId, merged],
      );
    const cardOfEntry = await card();
    await h.sql(
      `INSERT INTO talk_exchange (congregation_id, direction, date, visiting_speaker_id)
       VALUES ($1, 'incoming', current_date - 10, $2)`,
      [tenantId, cardOfEntry],
    );
    const cardOfPart = await card();
    await h.sql(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, visiting_speaker_id)
       VALUES ($1, current_date - 10, 'weekend', 'public_talk', $2)`,
      [tenantId, cardOfPart],
    );
    const cardMergedInto = await card();
    await card(cardMergedInto);
    // One-day absences (no end): one 40 days ago goes, yesterday's stays.
    const pub = await h.addPublisher({ firstName: 'Один', lastName: 'День' });
    const oneDay = (start: string) =>
      one(
        `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date)
         VALUES ($1, $2, ${start}, NULL) RETURNING id`,
        [tenantId, pub],
      );
    const dayLongAgo = await oneDay('current_date - 40');
    const dayYesterday = await oneDay('current_date - 1');
    // Another congregation's part deleted 40 days ago.
    const otherPart = await one(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, deleted_at)
       VALUES ($1, current_date - 20, 'weekend', 'reader', ${old}) RETURNING id`,
      [otherTenant],
    );

    const svc = h.app.get(RetentionService);
    const preview = await svc.preview(tenantId);
    await svc.applyDated(tenantId);

    for (const [table, id] of [
      ['assignments', hidden],
      ['talk_exchange', setAside],
      ['talk_exchange', overseers],
      ['talk_exchange', lined],
      ['visiting_speakers', cardOfEntry],
      ['visiting_speakers', cardOfPart],
      ['visiting_speakers', cardMergedInto],
      ['absences', dayYesterday],
      ['assignments', otherPart],
    ] as const)
      expect([table, id, await exists(table, id)]).toEqual([table, id, true]);
    expect(await exists('absences', dayLongAgo)).toBe(false);
    // The preview counted none of them, and says why.
    const row = (key: string) => preview.find((r) => r.key === key)!;
    expect(row('deleted:assignments').kept).toMatch(/визит/);
    expect(row('deleted:talk-exchange').kept).toBeTruthy();
    expect(row('deleted:visiting-speakers').kept).toBeTruthy();

    // The visit is taken away: the hidden part comes back to the week.
    const event = await h.app
      .get(DataSource)
      .getRepository(SpecialEvent)
      .findOneByOrFail({ id: visit });
    await h.app.get(CoVisitTemplateService).revert(event);
    const [back] = await h.sql<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM assignments WHERE id = $1`,
      [hidden],
    );
    expect(back).toEqual({ deleted_at: null });
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
