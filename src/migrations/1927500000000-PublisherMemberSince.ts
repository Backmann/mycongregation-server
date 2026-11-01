import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * In our congregation since (1 November 2026). Counting for the standing,
 * the S-1 and the annual report begins no earlier than this month.
 *
 * Cards made from 1 November 2026 were already counted from the month they
 * were made (a stop-gap rule of that morning); they get that month here, so
 * nothing about them moves. Every older card stays empty: «here for as long
 * as our records go», exactly as it was counted before.
 */
export class PublisherMemberSince1927500000000 implements MigrationInterface {
  name = 'PublisherMemberSince1927500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD COLUMN IF NOT EXISTS "member_since" date`,
    );
    await queryRunner.query(
      `UPDATE "publishers"
          SET "member_since" = date_trunc('month', "created_at")::date
        WHERE "created_at" >= '2026-11-01' AND "member_since" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN IF EXISTS "member_since"`,
    );
  }
}
