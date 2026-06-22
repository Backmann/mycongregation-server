import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVisitingSpeakersAndRepertoire1809000000000 implements MigrationInterface {
  name = 'AddVisitingSpeakersAndRepertoire1809000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "visiting_speakers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "first_name" text NOT NULL,
        "last_name" text,
        "external_congregation_id" uuid,
        "phone" text,
        "note" text,
        "talk_numbers" integer array NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_visiting_speakers" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_visiting_speakers_congregation" ON "visiting_speakers" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_visiting_speakers_cong_last" ON "visiting_speakers" ("congregation_id", "last_name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_visiting_speakers_external_cong" ON "visiting_speakers" ("external_congregation_id")`,
    );
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers"
        ADD CONSTRAINT "FK_visiting_speakers_congregation"
        FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers"
        ADD CONSTRAINT "FK_visiting_speakers_external_congregation"
        FOREIGN KEY ("external_congregation_id") REFERENCES "external_congregations"("id")
        ON DELETE SET NULL
    `);

    // Repertoire for our own publishers (outgoing speakers).
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD COLUMN IF NOT EXISTS "public_talk_numbers" integer array NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN IF EXISTS "public_talk_numbers"`,
    );
    await queryRunner.query(`DROP TABLE "visiting_speakers"`);
  }
}
