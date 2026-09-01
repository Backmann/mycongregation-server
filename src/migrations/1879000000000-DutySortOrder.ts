import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Duties gain a place on the sheet that can be MOVED.
 *
 * Until now the order was worked out and not kept: by kind of duty, then by
 * slot. That is a fixed sequence nobody could change, and a congregation
 * meeting in a rented room — or holding the Memorial — wants its own.
 *
 * FILLED WITH THE ORDER PEOPLE ALREADY SEE, so that nothing moves on the day
 * this ships. The sequence below is the client's `DUTY_TYPE_ORDER`, not the
 * server's alphabetical `ORDER BY d.dutyType`: the screen sorted the rows
 * again after fetching them, and what the congregation looks at is the screen.
 *
 * Rows of one place share a value — «Стоянка» is three rows and they move
 * together — so the number is per PLACE, not per row.
 */
export class DutySortOrder1879000000000 implements MigrationInterface {
  name = 'DutySortOrder1879000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duties" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0`,
    );
    // One number per place, numbered in the order the screen shows them.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT
          congregation_id,
          week_start_date,
          event_type,
          duty_type,
          COALESCE(custom_label, '') AS label,
          ROW_NUMBER() OVER (
            PARTITION BY congregation_id, week_start_date, event_type
            ORDER BY
              CASE duty_type
                WHEN 'security'    THEN 0
                WHEN 'attendant'   THEN 1
                WHEN 'microphone'  THEN 2
                WHEN 'av'          THEN 3
                WHEN 'zoom'        THEN 4
                WHEN 'stage'       THEN 5
                WHEN 'ventilation' THEN 6
                WHEN 'custom'      THEN 7
                ELSE 8
              END,
              COALESCE(custom_label, ''),
              MIN(slot_index)
          ) AS pos
        FROM "duties"
        GROUP BY congregation_id, week_start_date, event_type, duty_type,
                 COALESCE(custom_label, '')
      )
      UPDATE "duties" d
         SET "sort_order" = r.pos
        FROM ranked r
       WHERE d.congregation_id = r.congregation_id
         AND d.week_start_date = r.week_start_date
         AND d.event_type = r.event_type
         AND d.duty_type = r.duty_type
         AND COALESCE(d.custom_label, '') = r.label
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duties" DROP COLUMN IF EXISTS "sort_order"`,
    );
  }
}
