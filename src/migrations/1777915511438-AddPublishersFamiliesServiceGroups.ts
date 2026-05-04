import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPublishersFamiliesServiceGroups1777915511438 implements MigrationInterface {
    name = 'AddPublishersFamiliesServiceGroups1777915511438'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "service_groups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "overseer_publisher_id" uuid, "assistant_publisher_id" uuid, "meeting_location" text, "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c541600efebc3f4fefd3d082ef3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_62576102282da1664ec7072be1" ON "service_groups" ("congregation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_24c0c48a4f58d775f4777be388" ON "service_groups" ("overseer_publisher_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_fb3eca7d3fd9bf9412ca0d85f8" ON "service_groups" ("assistant_publisher_id") `);
        await queryRunner.query(`CREATE TABLE "families" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "head_publisher_id" uuid, "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_70414ac0c8f45664cf71324b9bb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_62e86cb97d1269f10eca082cbe" ON "families" ("congregation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_a9a4435dc7d9fae1ea29933c8e" ON "families" ("head_publisher_id") `);
        await queryRunner.query(`CREATE TYPE "public"."publishers_gender_enum" AS ENUM('brother', 'sister')`);
        await queryRunner.query(`CREATE TYPE "public"."publishers_appointment_enum" AS ENUM('elder', 'ministerial_servant', 'publisher', 'unbaptized_publisher', 'none')`);
        await queryRunner.query(`CREATE TYPE "public"."publishers_pioneer_type_enum" AS ENUM('none', 'auxiliary_until_cancelled', 'regular', 'special', 'missionary')`);
        await queryRunner.query(`CREATE TYPE "public"."publishers_removal_reason_enum" AS ENUM('moved', 'disfellowshipped', 'died', 'other')`);
        await queryRunner.query(`CREATE TABLE "publishers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "user_id" uuid, "family_id" uuid, "service_group_id" uuid, "first_name" character varying(100) NOT NULL, "middle_name" character varying(100), "last_name" character varying(100) NOT NULL, "display_name" character varying(255) NOT NULL, "gender" "public"."publishers_gender_enum" NOT NULL, "birth_date" date, "mobile_phone" character varying(32), "email" character varying(255), "address" text, "is_active" boolean NOT NULL DEFAULT true, "is_regular" boolean NOT NULL DEFAULT true, "is_family_head" boolean NOT NULL DEFAULT false, "is_elderly_or_infirm" boolean NOT NULL DEFAULT false, "is_child" boolean NOT NULL DEFAULT false, "is_deaf" boolean NOT NULL DEFAULT false, "is_blind" boolean NOT NULL DEFAULT false, "is_prisoner" boolean NOT NULL DEFAULT false, "appointment" "public"."publishers_appointment_enum" NOT NULL DEFAULT 'publisher', "baptism_date" date, "ministry_start_date" date, "pioneer_type" "public"."publishers_pioneer_type_enum" NOT NULL DEFAULT 'none', "pioneer_since" date, "is_anointed" boolean NOT NULL DEFAULT false, "has_kingdom_hall_key" boolean NOT NULL DEFAULT false, "printed_watchtower" boolean NOT NULL DEFAULT false, "printed_workbook" boolean NOT NULL DEFAULT false, "sends_report_directly" boolean NOT NULL DEFAULT false, "spiritual_notes" text, "notes" text, "removal_reason" "public"."publishers_removal_reason_enum", "removed_at" TIMESTAMP WITH TIME ZONE, "removed_note" text, "restored_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_40c3defdcca3616fd21ede9063d" UNIQUE ("user_id"), CONSTRAINT "PK_9d73f23749dca512efc3ccbea6a" PRIMARY KEY ("id")); COMMENT ON COLUMN "publishers"."ministry_start_date" IS 'For unbaptized publishers'`);
        await queryRunner.query(`CREATE INDEX "IDX_022658ed9d063307aab18f993a" ON "publishers" ("congregation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_1c323eff2662e2bfaecc0ceb1f" ON "publishers" ("family_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_476996479b2a21d5f70c6b13ac" ON "publishers" ("service_group_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_1d34de8ae0ebdc6e72229e34c8" ON "publishers" ("last_name", "first_name") `);
        await queryRunner.query(`ALTER TABLE "service_groups" ADD CONSTRAINT "FK_62576102282da1664ec7072be19" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "families" ADD CONSTRAINT "FK_62e86cb97d1269f10eca082cbe8" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "publishers" ADD CONSTRAINT "FK_022658ed9d063307aab18f993a4" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "publishers" ADD CONSTRAINT "FK_40c3defdcca3616fd21ede9063d" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "publishers" ADD CONSTRAINT "FK_1c323eff2662e2bfaecc0ceb1f1" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "publishers" ADD CONSTRAINT "FK_476996479b2a21d5f70c6b13ac8" FOREIGN KEY ("service_group_id") REFERENCES "service_groups"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "publishers" DROP CONSTRAINT "FK_476996479b2a21d5f70c6b13ac8"`);
        await queryRunner.query(`ALTER TABLE "publishers" DROP CONSTRAINT "FK_1c323eff2662e2bfaecc0ceb1f1"`);
        await queryRunner.query(`ALTER TABLE "publishers" DROP CONSTRAINT "FK_40c3defdcca3616fd21ede9063d"`);
        await queryRunner.query(`ALTER TABLE "publishers" DROP CONSTRAINT "FK_022658ed9d063307aab18f993a4"`);
        await queryRunner.query(`ALTER TABLE "families" DROP CONSTRAINT "FK_62e86cb97d1269f10eca082cbe8"`);
        await queryRunner.query(`ALTER TABLE "service_groups" DROP CONSTRAINT "FK_62576102282da1664ec7072be19"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1d34de8ae0ebdc6e72229e34c8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_476996479b2a21d5f70c6b13ac"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1c323eff2662e2bfaecc0ceb1f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_022658ed9d063307aab18f993a"`);
        await queryRunner.query(`DROP TABLE "publishers"`);
        await queryRunner.query(`DROP TYPE "public"."publishers_removal_reason_enum"`);
        await queryRunner.query(`DROP TYPE "public"."publishers_pioneer_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."publishers_appointment_enum"`);
        await queryRunner.query(`DROP TYPE "public"."publishers_gender_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a9a4435dc7d9fae1ea29933c8e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_62e86cb97d1269f10eca082cbe"`);
        await queryRunner.query(`DROP TABLE "families"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fb3eca7d3fd9bf9412ca0d85f8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_24c0c48a4f58d775f4777be388"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_62576102282da1664ec7072be1"`);
        await queryRunner.query(`DROP TABLE "service_groups"`);
    }

}
