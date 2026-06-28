import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCoVisitItems1822000000000 implements MigrationInterface {
  name = 'CreateCoVisitItems1822000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "co_visit_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "special_event_id" uuid NOT NULL, "kind" character varying(40) NOT NULL, "for_wife" boolean NOT NULL DEFAULT false, "item_date" date NOT NULL, "start_time" character varying(5), "place_kind" character varying(20), "cart_location_id" uuid, "place_text" character varying(255), "assignee_publisher_id" uuid, "assignee_text" character varying(255), "note" text, "sort_order" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_co_visit_items" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_co_visit_items_event" ON "co_visit_items" ("congregation_id", "special_event_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "co_visit_items" ADD CONSTRAINT "FK_co_visit_items_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "co_visit_items" ADD CONSTRAINT "FK_co_visit_items_event" FOREIGN KEY ("special_event_id") REFERENCES "special_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "co_visit_items" ADD CONSTRAINT "FK_co_visit_items_cart_location" FOREIGN KEY ("cart_location_id") REFERENCES "cart_locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "co_visit_items" ADD CONSTRAINT "FK_co_visit_items_assignee" FOREIGN KEY ("assignee_publisher_id") REFERENCES "publishers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "co_visit_items"`);
  }
}
