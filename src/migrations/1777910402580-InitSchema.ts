import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1777910402580 implements MigrationInterface {
  name = 'InitSchema1777910402580';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "congregations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "country" character varying(2) NOT NULL, "language" character varying(5) NOT NULL, "timezone" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f8d59734333e7f735ba8d6bff90" PRIMARY KEY ("id")); COMMENT ON COLUMN "congregations"."country" IS 'ISO 3166-1 alpha-2 country code'; COMMENT ON COLUMN "congregations"."language" IS 'IETF BCP 47 language tag (ru, de, en-US)'; COMMENT ON COLUMN "congregations"."timezone" IS 'IANA timezone (Europe/Berlin)'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'elder', 'ministerial_servant', 'publisher')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'publisher', "is_active" boolean NOT NULL DEFAULT true, "last_login_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cb5653e0842d8e5f3d3759df70" ON "users" ("congregation_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_cb5653e0842d8e5f3d3759df70c" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_cb5653e0842d8e5f3d3759df70c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cb5653e0842d8e5f3d3759df70"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(`DROP TABLE "congregations"`);
  }
}
