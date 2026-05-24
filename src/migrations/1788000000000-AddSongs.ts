import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSongs1788000000000 implements MigrationInterface {
  name = 'AddSongs1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Global catalog of meeting songs ("Sing Out Joyfully"). NOT per-congregation.
    await queryRunner.query(`
      CREATE TABLE "songs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "number" integer NOT NULL,
        "title" character varying(300) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_songs" PRIMARY KEY ("id"),
        CONSTRAINT "uq_songs_number" UNIQUE ("number")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_songs_active" ON "songs" ("is_active")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_songs_active"`);
    await queryRunner.query(`DROP TABLE "songs"`);
  }
}
