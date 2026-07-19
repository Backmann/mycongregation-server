import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Publishers keep their own contacts up to date, and the congregation checks
 * once a service year (from 1 September) that they are still current. Two
 * columns record that check: when it happened and who signed it off — the
 * publisher themselves, or the secretary for someone without an account.
 *
 * Column names are snake_case (SnakeNamingStrategy).
 */
export class AddContactsConfirmation1844000000000 implements MigrationInterface {
  name = 'AddContactsConfirmation1844000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD COLUMN IF NOT EXISTS "contacts_confirmed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD COLUMN IF NOT EXISTS "contacts_confirmed_by_user_id" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN IF EXISTS "contacts_confirmed_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN IF EXISTS "contacts_confirmed_at"`,
    );
  }
}
