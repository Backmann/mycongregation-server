import { MigrationInterface, QueryRunner } from 'typeorm';
/**
 * Per-user grant for viewing publishers' private data. Admins and elders see
 * it by role; this column lets an admin extend the same visibility to another
 * member (e.g. a ministerial servant) without changing their login role.
 */
export class AddUserPrivateDataAccess1791000000000 implements MigrationInterface {
  name = 'AddUserPrivateDataAccess1791000000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "can_view_private_data" boolean NOT NULL DEFAULT false`,
    );
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "can_view_private_data"`,
    );
  }
}
