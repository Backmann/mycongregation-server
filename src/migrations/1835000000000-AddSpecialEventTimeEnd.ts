import { MigrationInterface, QueryRunner } from 'typeorm';

/** Optional end time for special events ("from — to" ranges). */
export class AddSpecialEventTimeEnd1835000000000 implements MigrationInterface {
  name = 'AddSpecialEventTimeEnd1835000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events"
       ADD COLUMN IF NOT EXISTS "time_end" varchar(5)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN IF EXISTS "time_end"`,
    );
  }
}
