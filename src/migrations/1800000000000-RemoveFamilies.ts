import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveFamilies1800000000000 implements MigrationInterface {
  name = 'RemoveFamilies1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the publisher -> family link first, then the family-related columns,
    // then the table itself. IF EXISTS keeps this safe regardless of prior state.
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP CONSTRAINT IF EXISTS "FK_1c323eff2662e2bfaecc0ceb1f1"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_1c323eff2662e2bfaecc0ceb1f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN IF EXISTS "family_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN IF EXISTS "is_family_head"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "families"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort recreation of the structure (data is not restored).
    await queryRunner.query(
      `CREATE TABLE "families" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "head_publisher_id" uuid, "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_70414ac0c8f45664cf71324b9bb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62e86cb97d1269f10eca082cbe" ON "families" ("congregation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9a4435dc7d9fae1ea29933c8e" ON "families" ("head_publisher_id") `,
    );
    await queryRunner.query(`ALTER TABLE "publishers" ADD "family_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "is_family_head" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1c323eff2662e2bfaecc0ceb1f" ON "publishers" ("family_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "families" ADD CONSTRAINT "FK_62e86cb97d1269f10eca082cbe8" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD CONSTRAINT "FK_1c323eff2662e2bfaecc0ceb1f1" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
