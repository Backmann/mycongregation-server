import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The field-service template learns to say what the overseer says
 * (October 2026): «every Saturday», «the last one», WHOSE meeting it is
 * (a group's or everybody's), where a group meets (its own place, unless
 * another is written), and WHO conducts — the group's overseer, a brother
 * in turn from the circle, or nobody yet.
 *
 * Until now a slot was one ordinal, a weekday, a time and an address: the
 * month came out as empty meetings for the overseer to fill by hand.
 *
 * `ordinal` STAYS, filled from the first of `ordinals`: an app that knows
 * only the old shape goes on reading something sensible. Every existing
 * slot keeps exactly its behaviour — one ordinal, no group, nobody picked.
 *
 * `field_service_settings` holds what the generator must know about the
 * congregation's calendar and, for the automatic preparation to come, when
 * and how to prepare a month on its own. One row per congregation, made on
 * first read.
 */
export class FieldServiceTemplateRules1897000000000 implements MigrationInterface {
  name = 'FieldServiceTemplateRules1897000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_template_slots"
         ADD COLUMN IF NOT EXISTS "ordinals" smallint[] NOT NULL DEFAULT '{}',
         ADD COLUMN IF NOT EXISTS "last_only" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "service_group_id" uuid NULL,
         ADD COLUMN IF NOT EXISTS "conductor_rule" character varying(20) NOT NULL DEFAULT 'none'`,
    );
    await queryRunner.query(
      `UPDATE "field_service_template_slots" SET "ordinals" = ARRAY["ordinal"]::smallint[] WHERE "ordinals" = '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_template_slots" ALTER COLUMN "address" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_template_slots"
         ADD CONSTRAINT "fk_fsts_service_group"
         FOREIGN KEY ("service_group_id") REFERENCES "service_groups"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "field_service_settings" (
        "congregation_id" uuid PRIMARY KEY REFERENCES "congregations"("id") ON DELETE CASCADE,
        "skip_assemblies" boolean NOT NULL DEFAULT true,
        "co_visit_from_schedule" boolean NOT NULL DEFAULT true,
        "auto_prepare" boolean NOT NULL DEFAULT false,
        "prepare_lead" character varying(5) NOT NULL DEFAULT '1m',
        "auto_pick_conductors" boolean NOT NULL DEFAULT true,
        "unpublished_policy" character varying(20) NOT NULL DEFAULT 'publish_7d',
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "field_service_settings"`);
    await queryRunner.query(
      `ALTER TABLE "field_service_template_slots" DROP CONSTRAINT IF EXISTS "fk_fsts_service_group"`,
    );
    await queryRunner.query(
      `UPDATE "field_service_template_slots" SET "address" = '' WHERE "address" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_template_slots" ALTER COLUMN "address" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_template_slots"
         DROP COLUMN IF EXISTS "ordinals",
         DROP COLUMN IF EXISTS "last_only",
         DROP COLUMN IF EXISTS "service_group_id",
         DROP COLUMN IF EXISTS "conductor_rule"`,
    );
  }
}
