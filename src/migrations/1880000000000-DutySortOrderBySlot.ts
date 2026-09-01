import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repairs the order the previous migration got wrong.
 *
 * 1879 filled `sort_order` by kind of duty, then by LABEL, then by slot. For
 * an ordinary meeting that is right — the kinds differ and the label never
 * decided anything. But every duty of the Memorial is `custom`, so the label
 * was left to decide, and the sheet came out alphabetical: Zoom, Аппаратура,
 * Гардероб, Главный зал… instead of the order the congregation had entered.
 *
 * The screen never looked at the label. It sorted by kind and then by SLOT,
 * and the slot is written in creation order — so the original sequence was
 * never lost, only overruled. This puts the label back where it belongs: last,
 * as a tie-break, behind the slot.
 *
 * Safe to run over an order somebody has since arranged by hand? It is run
 * ONCE, immediately after 1879 and before any arrows exist to move anything
 * with, so there is no hand-made order to overwrite. That is why it ships now
 * rather than with the arrows.
 */
export class DutySortOrderBySlot1880000000000 implements MigrationInterface {
  name = 'DutySortOrderBySlot1880000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
              MIN(slot_index),
              COALESCE(custom_label, '')
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

  public async down(): Promise<void> {
    // Nothing: this only repairs what 1879 wrote, and going back would mean
    // restoring an order that was wrong.
  }
}
