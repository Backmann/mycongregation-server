import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Что ушло в филиал — годовой отчёт (S-10) и месячная сводка (S-1), как они
 * были отправлены.
 *
 * Цифры за закрытый период считались заново при каждом открытии и сдвигались
 * от всего, что вносили потом: поздний отчёт за август, выбытие, внесённое
 * через месяц. Строка здесь хранит отправленные цифры, кто за каждой из них
 * стоял (только id карточек) и назначение каждого на тот момент.
 */
export class ReportSnapshots1888000000000 implements MigrationInterface {
  name = 'ReportSnapshots1888000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "report_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "kind" varchar(10) NOT NULL,
        "period" varchar(7) NOT NULL,
        "confirmed" boolean NOT NULL DEFAULT true,
        "sent_on" date,
        "figures" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "members" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "appointments" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "saved_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_report_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "uq_report_snapshots_cong_kind_period"
          UNIQUE ("congregation_id", "kind", "period"),
        CONSTRAINT "fk_report_snapshots_congregation"
          FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "fk_report_snapshots_saved_by"
          FOREIGN KEY ("saved_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_report_snapshots_congregation"
        ON "report_snapshots" ("congregation_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "report_snapshots"`);
  }
}
