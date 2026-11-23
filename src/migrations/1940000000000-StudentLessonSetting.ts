import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A student part's lesson and setting (23 November 2026).
 *
 * Filled from the titles already stored — the same rules as
 * src/mwb-import/student-part.ts, copied here so the migration stays as it
 * ran. On the live programme 142 of 175 student parts kept their lesson in
 * the title; the 30 cut at 120 characters get it when their workbook is
 * loaded again. Held to the same answers as student-part.ts by
 * student-part.spec.ts, which runs this migration on a fake database. Old rows in old shapes are fine: a title without a lesson or
 * a setting gives null, and nothing else is touched.
 */
const lessonOf = (text: string): string | null => {
  const all = [...text.matchAll(/\(((?:lmd|th)\s[^()]{1,60}?)\)/gu)];
  const last = all.at(-1)?.[1]?.replace(/\s+/g, ' ').trim();
  return last || null;
};
const settingOf = (text: string): string | null => {
  const capsAt = (t: string) =>
    /^\s*([A-ZА-ЯЁÄÖÜ][A-ZА-ЯЁÄÖÜ ,-]{2,60})\./u.exec(t)?.[1] ?? null;
  const caps =
    capsAt(text) ??
    (text.includes(': ') ? capsAt(text.slice(text.indexOf(': ') + 2)) : null);
  if (!caps) return null;
  if (/ДОМАМ/u.test(caps)) return 'house';
  if (/НЕФОРМАЛЬН/u.test(caps)) return 'informal';
  if (/ОБЩЕСТВЕНН/u.test(caps)) return 'public';
  return null;
};

export class StudentLessonSetting1940000000000 implements MigrationInterface {
  name = 'StudentLessonSetting1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "lesson" varchar(80) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "setting" varchar(16) NULL`,
    );
    const rows: { id: string; part_title: string }[] = await queryRunner.query(
      `SELECT "id", "part_title" FROM "assignments"
       WHERE "part_title" IS NOT NULL
         AND "lesson" IS NULL AND "setting" IS NULL
         AND ("part_key" = 'bible_reading' OR "part_key" ~ '^apply_yourself_[0-9]+$')`,
    );
    for (const r of rows) {
      const lesson = lessonOf(r.part_title);
      const setting = settingOf(r.part_title);
      if (lesson === null && setting === null) continue;
      await queryRunner.query(
        `UPDATE "assignments" SET "lesson" = $1, "setting" = $2 WHERE "id" = $3`,
        [lesson, setting, r.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP COLUMN IF EXISTS "setting"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP COLUMN IF EXISTS "lesson"`,
    );
  }
}
