import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A circuit visit knows its journal entries by id (Lionel, 25 October 2026).
 *
 * - `talk_exchange.circuit_visit_id`: the overseer's own entry «К нам» points
 *   at its visit. It used to be found again each time by the overseer's name
 *   — a name given later, corrected, or spelt another way lost it.
 * - `talk_exchange.set_aside_by`: the visit that set this guest aside. The
 *   guest's entry still leaves the live journal (one entry a week, and every
 *   count of visits reads only live ones), but it is no longer a removal
 *   like any other: the journal shows it under the overseer, it can be moved
 *   to another week, and it comes back by its id when the visit goes.
 *
 * Linked now: the overseer's live entry in the week of a visit still ahead,
 * where it carries the visit's name. Live data on 25 October: one visit
 * ahead, one entry in its week, no guest set aside (read-only, q15).
 */
export class VisitHoldsItsEntries1918000000000 implements MigrationInterface {
  name = 'VisitHoldsItsEntries1918000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" ADD COLUMN IF NOT EXISTS "circuit_visit_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" ADD COLUMN IF NOT EXISTS "set_aside_by" uuid`,
    );
    for (const col of ['circuit_visit_id', 'set_aside_by']) {
      await queryRunner.query(`
        DO $$ BEGIN
          ALTER TABLE "talk_exchange" ADD CONSTRAINT "FK_talk_exchange_${col}"
            FOREIGN KEY ("${col}") REFERENCES "special_events"("id") ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$
      `);
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_talk_exchange_${col}" ON "talk_exchange" ("${col}") WHERE "${col}" IS NOT NULL`,
      );
    }
    await queryRunner.query(`
      UPDATE talk_exchange t SET circuit_visit_id = e.id
        FROM special_events e
       WHERE e.congregation_id = t.congregation_id
         AND e.type = 'circuit_overseer_visit'
         AND e.deleted_at IS NULL
         AND date_trunc('week', e.date)::date + 6 >= current_date
         AND t.direction = 'incoming'
         AND t.deleted_at IS NULL
         AND t.publisher_id IS NULL
         AND t.date BETWEEN date_trunc('week', e.date)::date
                        AND date_trunc('week', e.date)::date + 6
         AND lower(regexp_replace(trim(coalesce(t.speaker_name, '')), '\\s+', ' ', 'g'))
           = lower(regexp_replace(trim(concat_ws(' ', e.co_first_name, e.co_last_name)), '\\s+', ' ', 'g'))
         AND trim(concat_ws(' ', e.co_first_name, e.co_last_name)) <> ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['circuit_visit_id', 'set_aside_by']) {
      await queryRunner.query(
        `ALTER TABLE "talk_exchange" DROP CONSTRAINT IF EXISTS "FK_talk_exchange_${col}"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_talk_exchange_${col}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "talk_exchange" DROP COLUMN IF EXISTS "${col}"`,
      );
    }
  }
}
