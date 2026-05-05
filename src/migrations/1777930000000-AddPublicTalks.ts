import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPublicTalks1777930000000 implements MigrationInterface {
  name = 'AddPublicTalks1777930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Global catalog of public talks (S-34). NOT per-congregation.
    await queryRunner.query(`
      CREATE TABLE "public_talks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "number" integer NOT NULL,
        "title" character varying(500) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_public_talks" PRIMARY KEY ("id"),
        CONSTRAINT "uq_public_talks_number" UNIQUE ("number")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_public_talks_active" ON "public_talks" ("is_active")`,
    );

    // Extend assignments to reference catalog + invited speaker info
    await queryRunner.query(`
      ALTER TABLE "assignments"
        ADD COLUMN "public_talk_id" uuid,
        ADD COLUMN "speaker_name" character varying(255),
        ADD COLUMN "speaker_congregation" character varying(255)
    `);

    await queryRunner.query(`
      ALTER TABLE "assignments"
        ADD CONSTRAINT "fk_assignments_public_talk"
        FOREIGN KEY ("public_talk_id")
        REFERENCES "public_talks"("id")
        ON DELETE SET NULL
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_assignments_public_talk" ON "assignments" ("public_talk_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_assignments_public_talk"`);
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP CONSTRAINT "fk_assignments_public_talk"`,
    );
    await queryRunner.query(`
      ALTER TABLE "assignments"
        DROP COLUMN "public_talk_id",
        DROP COLUMN "speaker_name",
        DROP COLUMN "speaker_congregation"
    `);
    await queryRunner.query(`DROP INDEX "idx_public_talks_active"`);
    await queryRunner.query(`DROP TABLE "public_talks"`);
  }
}
