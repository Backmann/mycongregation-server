import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove the obsolete 'auxiliary_until_cancelled' value from the pioneer-type
 * enum. Auxiliary pioneering is tracked entirely via the auxiliary_pioneers
 * table (service periods), so the card-level type no longer needs it.
 *
 * Safe in every case: any publisher still carrying the old value is first moved
 * to 'none', then the enum is recreated without it.
 */
export class RemoveAuxiliaryPioneerType1842000000000 implements MigrationInterface {
  name = 'RemoveAuxiliaryPioneerType1842000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Move any rows still using the old value to 'none'.
    await queryRunner.query(
      `UPDATE "publishers" SET "pioneer_type" = 'none'
       WHERE "pioneer_type" = 'auxiliary_until_cancelled';`,
    );

    // 2. Recreate the enum without the obsolete value.
    await queryRunner.query(
      `ALTER TYPE "public"."publishers_pioneer_type_enum"
       RENAME TO "publishers_pioneer_type_enum_old";`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."publishers_pioneer_type_enum" AS ENUM
       ('none', 'regular', 'special', 'missionary');`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ALTER COLUMN "pioneer_type" DROP DEFAULT;`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ALTER COLUMN "pioneer_type"
       TYPE "public"."publishers_pioneer_type_enum"
       USING "pioneer_type"::text::"public"."publishers_pioneer_type_enum";`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ALTER COLUMN "pioneer_type" SET DEFAULT 'none';`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."publishers_pioneer_type_enum_old";`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add the value (data that was converted to 'none' is not restored).
    await queryRunner.query(
      `ALTER TYPE "public"."publishers_pioneer_type_enum"
       RENAME TO "publishers_pioneer_type_enum_old";`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."publishers_pioneer_type_enum" AS ENUM
       ('none', 'auxiliary_until_cancelled', 'regular', 'special', 'missionary');`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ALTER COLUMN "pioneer_type" DROP DEFAULT;`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ALTER COLUMN "pioneer_type"
       TYPE "public"."publishers_pioneer_type_enum"
       USING "pioneer_type"::text::"public"."publishers_pioneer_type_enum";`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ALTER COLUMN "pioneer_type" SET DEFAULT 'none';`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."publishers_pioneer_type_enum_old";`,
    );
  }
}
