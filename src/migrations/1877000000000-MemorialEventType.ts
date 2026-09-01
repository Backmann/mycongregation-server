import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Memorial becomes a third kind of meeting.
 *
 * Only ONE table needs touching. Duties and attendance keep the kind as a
 * plain varchar, so they accept the new value without a migration at all;
 * assignments use a real Postgres enum and must be told.
 *
 * `ADD VALUE IF NOT EXISTS` cannot run inside a transaction on older Postgres,
 * but TypeORM's migrations are transactional. The type is therefore rebuilt
 * the long way: a new type, the column cast across, the old type dropped. It
 * is a handful of rows in a small table and costs nothing.
 */
export class MemorialEventType1877000000000 implements MigrationInterface {
  name = 'MemorialEventType1877000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "assignments_event_type_enum" RENAME TO "assignments_event_type_enum_old"
    `);
    await queryRunner.query(`
      CREATE TYPE "assignments_event_type_enum" AS ENUM
        ('midweek', 'weekend', 'memorial', 'cleaning', 'av_duty', 'public_witnessing')
    `);
    await queryRunner.query(`
      ALTER TABLE "assignments"
        ALTER COLUMN "event_type" TYPE "assignments_event_type_enum"
        USING "event_type"::text::"assignments_event_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "assignments_event_type_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Anything already recorded against the Memorial would have nowhere to go,
    // so it is removed rather than silently mangled into another meeting.
    await queryRunner.query(
      `DELETE FROM "assignments" WHERE "event_type" = 'memorial'`,
    );
    await queryRunner.query(`
      ALTER TYPE "assignments_event_type_enum" RENAME TO "assignments_event_type_enum_new"
    `);
    await queryRunner.query(`
      CREATE TYPE "assignments_event_type_enum" AS ENUM
        ('midweek', 'weekend', 'cleaning', 'av_duty', 'public_witnessing')
    `);
    await queryRunner.query(`
      ALTER TABLE "assignments"
        ALTER COLUMN "event_type" TYPE "assignments_event_type_enum"
        USING "event_type"::text::"assignments_event_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "assignments_event_type_enum_new"`);
  }
}
