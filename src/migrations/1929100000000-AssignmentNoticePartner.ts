import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whom a person was told he works with on a part (9 November 2026), so that
 * a change of the pair is said as such. Old marks keep partner_known false:
 * what they were told is unknown, and no change is read from them.
 */
export class AssignmentNoticePartner1929100000000 implements MigrationInterface {
  name = 'AssignmentNoticePartner1929100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignment_notices" ADD COLUMN IF NOT EXISTS "partner_publisher_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignment_notices" ADD COLUMN IF NOT EXISTS "partner_known" boolean NOT NULL DEFAULT false`,
    );
    // A card link is a key (see card-links-keys): a merge of cards follows it
    // like every other link. A card deleted for good leaves the mark without
    // a partner — the assignment it belonged to loses him the same way.
    await queryRunner.query(`
      ALTER TABLE "assignment_notices"
        DROP CONSTRAINT IF EXISTS "FK_assignment_notices_partner",
        ADD CONSTRAINT "FK_assignment_notices_partner"
          FOREIGN KEY ("partner_publisher_id")
          REFERENCES "publishers"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignment_notices" DROP CONSTRAINT IF EXISTS "FK_assignment_notices_partner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignment_notices" DROP COLUMN IF EXISTS "partner_known"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignment_notices" DROP COLUMN IF EXISTS "partner_publisher_id"`,
    );
  }
}
