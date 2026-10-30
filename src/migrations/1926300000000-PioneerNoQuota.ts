import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A regular pioneer the elders allow to serve without the hours requirement
 * (instructions, point 9; Lionel, 30 October 2026). The decision belongs to
 * the spell it was made in: a new appointment needs a new decision. It frees
 * the whole service year it falls in; taken back, the year it is taken back
 * in stays free and the requirement returns with the next.
 */
export class PioneerNoQuota1926300000000 implements MigrationInterface {
  name = 'PioneerNoQuota1926300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pioneer_spells" ADD COLUMN IF NOT EXISTS "no_quota_decided_on" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "pioneer_spells" ADD COLUMN IF NOT EXISTS "no_quota_ended_on" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "pioneer_spells" DROP CONSTRAINT IF EXISTS "ck_pioneer_spells_no_quota"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pioneer_spells" ADD CONSTRAINT "ck_pioneer_spells_no_quota" CHECK (
        ("no_quota_decided_on" IS NULL AND "no_quota_ended_on" IS NULL)
        OR ("pioneer_type" = 'regular' AND "no_quota_decided_on" IS NOT NULL
            AND ("no_quota_ended_on" IS NULL OR "no_quota_ended_on" >= "no_quota_decided_on"))
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pioneer_spells" DROP CONSTRAINT IF EXISTS "ck_pioneer_spells_no_quota"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pioneer_spells" DROP COLUMN IF EXISTS "no_quota_ended_on"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pioneer_spells" DROP COLUMN IF EXISTS "no_quota_decided_on"`,
    );
  }
}
