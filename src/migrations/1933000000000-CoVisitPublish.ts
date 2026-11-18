import { MigrationInterface, QueryRunner } from 'typeorm';
import { linesByPerson } from '../co-visit-items/co-visit-notice';

/**
 * The visit schedule is published once, then speaks for itself
 * (18 November 2026, Lionel's choice «C»).
 *
 * - `co_published_at`: null while the planner is still filling the week;
 *   nobody sees a draft — not on Home, not in the calendar, not in a push.
 * - `co_noticed_at`: when the people of the visit were last told what is
 *   theirs; an edit after it is said ten minutes after the last one.
 * - `co_visit_items.updated_at`: when an item was last edited.
 * - `co_visit_told`: per person, the lines he was told — what a later word
 *   compares with to say «изменено» or «вы больше не назначены».
 *
 * A visit that already has items is published by this migration, so that
 * nothing anybody sees today disappears from his Home. Nobody is told
 * anything by it: its people are written down as already told — with the
 * very lines the notices compare with, so that the first edit after the
 * deploy says only what that edit changed (review, 18 November 2026).
 */
export class CoVisitPublish1933000000000 implements MigrationInterface {
  name = 'CoVisitPublish1933000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "special_events"
        ADD COLUMN IF NOT EXISTS "co_published_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "co_noticed_at" TIMESTAMP WITH TIME ZONE
    `);
    // An edit has a moment: what «ten minutes after the last edit» counts from.
    await queryRunner.query(`
      ALTER TABLE "co_visit_items"
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "co_visit_told" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "special_event_id" uuid NOT NULL,
        "publisher_id" uuid NOT NULL,
        "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "told_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_co_visit_told" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_co_visit_told_person" UNIQUE ("special_event_id", "publisher_id"),
        CONSTRAINT "FK_co_visit_told_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_co_visit_told_event" FOREIGN KEY ("special_event_id")
          REFERENCES "special_events"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_co_visit_told_publisher" FOREIGN KEY ("publisher_id")
          REFERENCES "publishers"("id") ON DELETE CASCADE
      )
    `);
    // Visits with items stay visible: published now, their people told.
    await queryRunner.query(`
      UPDATE "special_events" e
         SET "co_published_at" = now(), "co_noticed_at" = now()
       WHERE e."type" = 'circuit_overseer_visit'
         AND e."co_published_at" IS NULL
         AND EXISTS (SELECT 1 FROM "co_visit_items" i
                      WHERE i."special_event_id" = e."id" AND i."deleted_at" IS NULL)
    `);
    const rows: {
      id: string;
      congregation_id: string;
      special_event_id: string;
      kind: string;
      for_wife: boolean;
      with_wife: boolean;
      item_date: string;
      start_time: string | null;
      place_kind: string | null;
      place_text: string | null;
      cart_location_name: string | null;
      assignee_publisher_id: string | null;
      note: string | null;
    }[] = await queryRunner.query(`
      SELECT i.id, i.congregation_id, i.special_event_id, i.kind, i.for_wife,
             i.with_wife, i.item_date::text AS item_date, i.start_time::text AS start_time,
             i.place_kind, i.place_text, l.name AS cart_location_name,
             i.assignee_publisher_id, i.note
        FROM "co_visit_items" i
        JOIN "special_events" e ON e.id = i.special_event_id
        LEFT JOIN "cart_locations" l ON l.id = i.cart_location_id
       WHERE e."co_published_at" IS NOT NULL AND i."deleted_at" IS NULL
         AND i."assignee_publisher_id" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "co_visit_told" t
                          WHERE t.special_event_id = i.special_event_id)
    `);
    const byEvent = new Map<string, typeof rows>();
    for (const r of rows)
      byEvent.set(r.special_event_id, [
        ...(byEvent.get(r.special_event_id) ?? []),
        r,
      ]);
    for (const [eventId, items] of byEvent) {
      const lines = linesByPerson(
        items.map((r) => ({
          id: r.id,
          kind: r.kind,
          forWife: r.for_wife,
          withWife: r.with_wife,
          itemDate: r.item_date,
          startTime: r.start_time,
          placeKind: r.place_kind,
          placeText: r.place_text,
          cartLocationName: r.cart_location_name,
          assigneePublisherId: r.assignee_publisher_id,
          note: r.note,
        })),
      );
      for (const [publisherId, l] of lines)
        await queryRunner.query(
          `INSERT INTO "co_visit_told" (congregation_id, special_event_id, publisher_id, lines)
           VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`,
          [items[0].congregation_id, eventId, publisherId, JSON.stringify(l)],
        );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "co_visit_told"`);
    await queryRunner.query(
      `ALTER TABLE "co_visit_items" DROP COLUMN IF EXISTS "updated_at"`,
    );
    await queryRunner.query(`
      ALTER TABLE "special_events"
        DROP COLUMN IF EXISTS "co_noticed_at",
        DROP COLUMN IF EXISTS "co_published_at"
    `);
  }
}
