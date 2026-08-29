import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Memorial gets a programme of its own.
 *
 * Until now the Memorial was an event and nothing more: it took a meeting away
 * and left nothing in its place. But it IS a meeting — with a chairman, songs,
 * three prayers, a talk, brothers passing the emblems row by row, attendants
 * and someone at the parking — and a congregation writes all of that down and
 * sends it round.
 *
 * One table for the whole sheet, not three. A programme part, a row of the
 * hall and a place at the door differ only in which group they belong to;
 * every one of them is a label, a person and a note. Splitting them would mean
 * three tables, three services and three screens saying the same thing.
 *
 * Everything that varies between congregations is DATA, not schema: the zones
 * are named for the hall (which may be a rented room), several people stand at
 * one place, and the fixed parts are filled from a template the first time and
 * from last year's Memorial ever after. Nothing here needs a release when the
 * theme or the songs change.
 */
export class MemorialProgramme1875000000000 implements MigrationInterface {
  name = 'MemorialProgramme1875000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "memorial_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "special_event_id" uuid NOT NULL,
        "section" varchar(20) NOT NULL,
        "part_key" varchar(30),
        "label" varchar(255) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "publisher_id" uuid,
        "person_text" varchar(255),
        "song_number" integer,
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_memorial_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_memorial_items_congregation"
          FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
          ON DELETE RESTRICT,
        -- The programme belongs to the Memorial: delete the event and the
        -- sheet goes with it, because a sheet without its evening is nothing.
        CONSTRAINT "FK_memorial_items_event"
          FOREIGN KEY ("special_event_id") REFERENCES "special_events"("id")
          ON DELETE CASCADE,
        -- A publisher removed from the roster leaves the line standing, empty:
        -- last year's programme still says a prayer was said, and by whom is
        -- less important than that the line remains part of the record.
        CONSTRAINT "FK_memorial_items_publisher"
          FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id")
          ON DELETE SET NULL
      )
    `);
    // The theme and the draft flag belong to the EVENING, not to a line of it:
    // one theme, one moment of publication. `special_events` already carries
    // fields that only a circuit visit uses — the overseer's name, his wife,
    // the day the midweek meeting moves to — so this follows a road already
    // laid rather than opening a new one.
    //
    // `memorial_published_at` null means DRAFT. A Memorial is filled in over
    // months, and nobody should be told about a prayer while the sheet is half
    // empty; the notifications wait for the moment the elders say it is ready.
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN IF NOT EXISTS "memorial_theme" varchar(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN IF NOT EXISTS "memorial_theme_url" varchar(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN IF NOT EXISTS "memorial_published_at" timestamptz`,
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_memorial_items_event"
        ON "memorial_items" ("congregation_id", "special_event_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_memorial_items_deleted_at"
        ON "memorial_items" ("deleted_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN IF EXISTS "memorial_published_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN IF EXISTS "memorial_theme_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN IF EXISTS "memorial_theme"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_memorial_items_deleted_at"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_memorial_items_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "memorial_items"`);
  }
}
