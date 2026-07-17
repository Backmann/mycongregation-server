import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Merge the separate 'audio' and 'video' meeting duties into a single 'av'
 * (Аудио/Видео) duty — one brother handles audio and video during a meeting.
 *
 * Data migration (dutyType is a varchar, so no schema change):
 *   1. Duty rows: rename 'video' -> 'av' and 'audio' -> 'av'. The unique index
 *      (congregationId, weekStartDate, eventType, dutyType, slotIndex) means a
 *      meeting that had BOTH would collide, so we first delete the 'audio' row
 *      where an 'av'/'video' row already exists for the same meeting, keeping a
 *      single av (preferring the one that had a publisher assigned).
 *   2. Publisher capabilities (jsonb): anyone who had duty_audio OR duty_video
 *      gets duty_av; the old keys are removed.
 */
export class MergeAudioVideoIntoAv1843000000000 implements MigrationInterface {
  name = 'MergeAudioVideoIntoAv1843000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- 1. Duty rows -------------------------------------------------------
    // If a meeting has both audio and video, keep the one with a publisher (or
    // the video row if neither/both have one) and drop the other, so renaming
    // to 'av' won't violate the unique constraint.
    await queryRunner.query(`
      DELETE FROM "duties" d_audio
      USING "duties" d_video
      WHERE d_audio."dutyType" = 'audio'
        AND d_video."dutyType" = 'video'
        AND d_audio."congregationId" = d_video."congregationId"
        AND d_audio."weekStartDate" = d_video."weekStartDate"
        AND d_audio."eventType" = d_video."eventType"
        AND d_audio."slotIndex" = d_video."slotIndex"
        AND (
          d_video."publisherId" IS NOT NULL
          OR d_audio."publisherId" IS NULL
        );
    `);
    // Any audio row that still collides with a remaining video row (video had
    // no publisher but audio did — video already deleted above) is fine. Now
    // rename video -> av first, then audio -> av (audio survivors are unique).
    await queryRunner.query(
      `UPDATE "duties" SET "dutyType" = 'av' WHERE "dutyType" = 'video';`,
    );
    // Delete any audio row that would now collide with the av (former video).
    await queryRunner.query(`
      DELETE FROM "duties" d_audio
      USING "duties" d_av
      WHERE d_audio."dutyType" = 'audio'
        AND d_av."dutyType" = 'av'
        AND d_audio."congregationId" = d_av."congregationId"
        AND d_audio."weekStartDate" = d_av."weekStartDate"
        AND d_audio."eventType" = d_av."eventType"
        AND d_audio."slotIndex" = d_av."slotIndex";
    `);
    await queryRunner.query(
      `UPDATE "duties" SET "dutyType" = 'av' WHERE "dutyType" = 'audio';`,
    );

    // --- 2. Publisher capabilities -----------------------------------------
    // duty_audio OR duty_video (true) -> duty_av; strip the old keys.
    await queryRunner.query(`
      UPDATE "publishers"
      SET "capabilities" =
        ("capabilities" - 'duty_audio' - 'duty_video')
        || jsonb_build_object('duty_av', true)
      WHERE ("capabilities" ->> 'duty_audio') = 'true'
         OR ("capabilities" ->> 'duty_video') = 'true';
    `);
    // For publishers that had the keys set to false (not eligible), just drop
    // the old keys without granting duty_av.
    await queryRunner.query(`
      UPDATE "publishers"
      SET "capabilities" = ("capabilities" - 'duty_audio' - 'duty_video')
      WHERE ("capabilities" ? 'duty_audio') OR ("capabilities" ? 'duty_video');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort reversal: av -> audio (video is not recoverable), duty_av ->
    // duty_audio. This does not restore separate audio/video rows.
    await queryRunner.query(
      `UPDATE "duties" SET "dutyType" = 'audio' WHERE "dutyType" = 'av';`,
    );
    await queryRunner.query(`
      UPDATE "publishers"
      SET "capabilities" =
        ("capabilities" - 'duty_av')
        || jsonb_build_object('duty_audio', true)
      WHERE ("capabilities" ->> 'duty_av') = 'true';
    `);
  }
}
