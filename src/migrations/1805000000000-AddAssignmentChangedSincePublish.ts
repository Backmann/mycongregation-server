import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssignmentChangedSincePublish1805000000000 implements MigrationInterface {
  name = 'AddAssignmentChangedSincePublish1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "changed_since_publish" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP COLUMN IF EXISTS "changed_since_publish"`,
    );
  }
}
