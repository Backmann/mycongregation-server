import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Time data for running a meeting (R-76, R-77; 22 November 2026).
 *
 * - songs.duration_sec: each song's length, filled from the official list of
 *   meeting recordings (publication sjjm, MP3; taken 22.11.2026: 164 songs,
 *   1:32–5:01, median 2:31). An admin may correct one; a song without it is
 *   counted by the median.
 * - conduct_averages: per congregation and kind of meeting, the last twelve
 *   meetings' numbers for the forecast — the prayer after the closing song,
 *   the lead-in of the middle song, the walk up to the stage, the counsel —
 *   numbers only: no names, no results (those still go on the 4th day).
 */
export class ConductTimeData1939000000000 implements MigrationInterface {
  name = 'ConductTimeData1939000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "duration_sec" integer NULL`,
    );
    await queryRunner.query(
      `UPDATE "songs" s SET "duration_sec" = d.sec FROM (VALUES (1,138), (2,176), (3,197), (4,226), (5,152), (6,139), (7,200), (8,144), (9,134), (10,109), (11,160), (12,131), (13,107), (14,120), (15,142), (16,139), (17,134), (18,157), (19,201), (20,177), (21,135), (22,160), (23,212), (24,164), (25,160), (26,260), (27,138), (28,141), (29,151), (30,158), (31,166), (32,215), (33,179), (34,177), (35,160), (36,139), (37,124), (38,170), (39,131), (40,135), (41,118), (42,165), (43,140), (44,153), (45,133), (46,167), (47,123), (48,157), (49,110), (50,119), (51,145), (52,157), (53,159), (54,154), (55,181), (56,185), (57,163), (58,179), (59,120), (60,152), (61,141), (62,160), (63,183), (64,99), (65,128), (66,159), (67,126), (68,114), (69,127), (70,121), (71,179), (72,118), (73,140), (74,149), (75,236), (76,182), (77,160), (78,161), (79,176), (80,116), (81,166), (82,126), (83,140), (84,173), (85,130), (86,121), (87,123), (88,133), (89,158), (90,176), (91,174), (92,162), (93,96), (94,128), (95,134), (96,171), (97,189), (98,114), (99,135), (100,130), (101,117), (102,157), (103,170), (104,124), (105,175), (106,124), (107,177), (108,217), (109,110), (110,133), (111,141), (112,137), (113,151), (114,135), (115,136), (116,104), (117,130), (118,134), (119,134), (120,126), (121,136), (122,182), (123,130), (124,139), (125,168), (126,128), (127,126), (128,134), (129,212), (130,156), (131,104), (132,128), (133,92), (134,151), (135,144), (136,171), (137,163), (138,171), (139,203), (140,157), (141,143), (142,107), (143,146), (144,129), (145,185), (146,223), (147,140), (148,232), (149,142), (150,141), (151,231), (152,191), (153,258), (154,235), (155,255), (156,266), (157,215), (158,250), (159,301), (160,276), (161,262), (162,252), (163,232), (164,250)) AS d(num, sec) WHERE s."number" = d.num AND s."duration_sec" IS NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conduct_averages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL REFERENCES "congregations"("id") ON DELETE CASCADE,
        "event_type" varchar(16) NOT NULL,
        "measure" varchar(20) NOT NULL,
        "values" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conduct_averages" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_conduct_averages" UNIQUE ("congregation_id", "event_type", "measure")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "conduct_averages"`);
    await queryRunner.query(
      `ALTER TABLE "songs" DROP COLUMN IF EXISTS "duration_sec"`,
    );
  }
}
