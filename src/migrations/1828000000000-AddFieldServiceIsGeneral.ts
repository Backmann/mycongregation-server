import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Combined field-service meeting" flag — a meeting that gathers the whole
 * congregation (still has a conductor). Off by default.
 */
export class AddFieldServiceIsGeneral1828000000000 implements MigrationInterface {
  name = 'AddFieldServiceIsGeneral1828000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" ADD COLUMN "is_general" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP COLUMN "is_general"`,
    );
  }
}
