import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A template slot says WHICH KIND of meeting it makes (13 October 2026).
 *
 * A meeting has three kinds — the congregation's own («общая»), the groups'
 * on their own («по группам»: no group named, not general) and one group's.
 * The template knew only two: a slot without a group was always taken for
 * the general one, so a congregation that meets by groups could not say so
 * in its template and every prepared month came out «Общая встреча».
 *
 * `is_general` holds the missing answer. Every slot without a group so far
 * was read as general, so it becomes exactly that: nothing anybody has
 * prepared changes. Apps that still send the old shape get the same reading.
 */
export class FieldServiceTemplateGeneral1899000000000 implements MigrationInterface {
  name = 'FieldServiceTemplateGeneral1899000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_template_slots" ADD COLUMN IF NOT EXISTS "is_general" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "field_service_template_slots" SET "is_general" = true WHERE "service_group_id" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_template_slots" DROP COLUMN IF EXISTS "is_general"`,
    );
  }
}
