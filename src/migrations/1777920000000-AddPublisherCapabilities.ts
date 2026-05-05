import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPublisherCapabilities1777920000000
  implements MigrationInterface
{
  name = 'AddPublisherCapabilities1777920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD COLUMN "capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
    // GIN index for future queries like:
    //   WHERE capabilities @> '{"bible_reading": true}'
    await queryRunner.query(
      `CREATE INDEX "idx_publishers_capabilities" ON "publishers" USING gin ("capabilities")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_publishers_capabilities"`);
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "capabilities"`,
    );
  }
}
