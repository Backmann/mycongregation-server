import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make publisher.status nullable so students (who don't submit reports) can
 * have no service status at all, rather than a misleading "inactive".
 */
export class MakePublisherStatusNullable1841000000000 implements MigrationInterface {
  name = 'MakePublisherStatusNullable1841000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" ALTER COLUMN "status" DROP NOT NULL;`,
    );
    // Clear status for existing students.
    await queryRunner.query(
      `UPDATE "publishers" SET "status" = NULL WHERE "appointment" = 'student';`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "publishers" SET "status" = 'inactive' WHERE "status" IS NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ALTER COLUMN "status" SET NOT NULL;`,
    );
  }
}
