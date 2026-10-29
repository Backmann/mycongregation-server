import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The auxiliary pioneer's hour goal is HIS (Lionel, 29 October 2026): in
 * March, April, the month of the Memorial, a month touched by the circuit
 * overseer's visit, or a month of a campaign that allows it, he may take 15
 * hours instead of 30 — a choice, not something the calendar decides for him.
 *
 * `reduced_months` lists the months of a period in which he took 15. The
 * goal used to be computed for everybody alike, so every period is filled
 * here with what it was SHOWN until today: each month of it that qualified —
 * a fixed period over its whole length, an open one up to the current month
 * (its later months keep 30 until somebody chooses). History does not move.
 *
 * `aux_reduced_hours` marks a campaign as one of those months' reasons.
 */
export class AuxPioneerNorms1924000000000 implements MigrationInterface {
  name = 'AuxPioneerNorms1924000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auxiliary_pioneers" ADD COLUMN IF NOT EXISTS "reduced_months" text[] NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN IF NOT EXISTS "aux_reduced_hours" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`
      UPDATE "auxiliary_pioneers" a
         SET "reduced_months" = COALESCE((
           SELECT array_agg(to_char(m, 'YYYY-MM') ORDER BY m)
             FROM generate_series(
                    a."start_month"::timestamp,
                    (CASE WHEN a."until_cancelled" OR a."end_month" IS NULL
                          THEN GREATEST(date_trunc('month', now())::date, a."start_month")
                          ELSE a."end_month" END)::timestamp,
                    interval '1 month') AS m
            WHERE EXTRACT(MONTH FROM m) IN (3, 4)
               OR EXISTS (
                    SELECT 1 FROM "special_events" e
                     WHERE e."congregation_id" = a."congregation_id"
                       AND e."deleted_at" IS NULL
                       AND e."type" IN ('memorial', 'circuit_overseer_visit')
                       AND date_trunc('month', e."date") <= m
                       AND date_trunc('month', COALESCE(e."end_date", e."date")) >= m)
         ), '{}')
       WHERE a."reduced_months" = '{}'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN IF EXISTS "aux_reduced_hours"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auxiliary_pioneers" DROP COLUMN IF EXISTS "reduced_months"`,
    );
  }
}
