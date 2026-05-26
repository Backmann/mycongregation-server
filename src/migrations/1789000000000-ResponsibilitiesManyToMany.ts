import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Allow several people to hold the same responsibility (many-to-many):
 * replace UNIQUE(congregation_id, type) with UNIQUE(congregation_id, type,
 * user_id). Existing rows (at most one holder per type) remain valid.
 */
export class ResponsibilitiesManyToMany1789000000000 implements MigrationInterface {
  name = 'ResponsibilitiesManyToMany1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "responsibilities" DROP CONSTRAINT IF EXISTS "uq_responsibilities_cong_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "responsibilities" ADD CONSTRAINT "uq_responsibilities_cong_type_user" UNIQUE ("congregation_id", "type", "user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "responsibilities" DROP CONSTRAINT IF EXISTS "uq_responsibilities_cong_type_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "responsibilities" ADD CONSTRAINT "uq_responsibilities_cong_type" UNIQUE ("congregation_id", "type")`,
    );
  }
}
