import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTalkExchange1810000000000 implements MigrationInterface {
  name = 'AddTalkExchange1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "talk_exchange" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "direction" character varying(16) NOT NULL,
        "date" date NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'confirmed',
        "public_talk_id" uuid,
        "visiting_speaker_id" uuid,
        "hospitality_publisher_id" uuid,
        "publisher_id" uuid,
        "host_congregation_id" uuid,
        "linked_absence_id" uuid,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_talk_exchange" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_talk_exchange_congregation" ON "talk_exchange" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_talk_exchange_cong_date" ON "talk_exchange" ("congregation_id", "date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_talk_exchange_public_talk" ON "talk_exchange" ("public_talk_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_talk_exchange_visiting_speaker" ON "talk_exchange" ("visiting_speaker_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_talk_exchange_publisher" ON "talk_exchange" ("publisher_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "talk_exchange"
        ADD CONSTRAINT "FK_talk_exchange_congregation"
        FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "talk_exchange"
        ADD CONSTRAINT "FK_talk_exchange_public_talk"
        FOREIGN KEY ("public_talk_id") REFERENCES "public_talks"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "talk_exchange"
        ADD CONSTRAINT "FK_talk_exchange_visiting_speaker"
        FOREIGN KEY ("visiting_speaker_id") REFERENCES "visiting_speakers"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "talk_exchange"
        ADD CONSTRAINT "FK_talk_exchange_hospitality_publisher"
        FOREIGN KEY ("hospitality_publisher_id") REFERENCES "publishers"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "talk_exchange"
        ADD CONSTRAINT "FK_talk_exchange_publisher"
        FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "talk_exchange"
        ADD CONSTRAINT "FK_talk_exchange_host_congregation"
        FOREIGN KEY ("host_congregation_id") REFERENCES "external_congregations"("id")
        ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "talk_exchange"`);
  }
}
