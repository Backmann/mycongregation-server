import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Merge the separate 'audio' and 'video' meeting duties into a single 'av'
 * (Аудио/Видео) duty — one brother handles audio and video during a meeting.
 *
 * Data migration (duty_type is a varchar, so no schema change). Column names
 * are snake_case (SnakeNamingStrategy): duty_type, congregation_id,
 * week_start_date, event_type, slot_index, publisher_id.
 *
 * The unique index (congregation_id, week_start_date, event_type, duty_type,
 * slot_index) means a meeting that has BOTH audio and video would collide once
 * both become 'av'. To preserve any assigned brother, for each colliding pair
 * we delete the row with NO publisher (or the audio row if both are assigned or
 * both empty), keeping the assigned one. Then both remaining types are renamed
 * to 'av'. Finally the duty_audio / duty_video publisher capabilities are
 * merged into duty_av (audio OR video -> av).
 */
export class MergeAudioVideoIntoAv1843000000000 implements MigrationInterface {
  name = 'MergeAudioVideoIntoAv1843000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- 1. Duty rows -------------------------------------------------------
    // (a) Colliding pairs where VIDEO has no publisher: drop video, keep audio.
    await queryRunner.query(`
      DELETE FROM "duties" d_video
      USING "duties" d_audio
      WHERE d_video."duty_type" = 'video'
        AND d_audio."duty_type" = 'audio'
        AND d_video."congregation_id" = d_audio."congregation_id"
        AND d_video."week_start_date" = d_audio."week_start_date"
        AND d_video."event_type" = d_audio."event_type"
        AND d_video."slot_index" = d_audio."slot_index"
        AND d_video."publisher_id" IS NULL;
    `);
    // (b) Remaining colliding pairs: video has a publisher (or audio empty) —
    //     drop audio, keep video.
    await queryRunner.query(`
      DELETE FROM "duties" d_audio
      USING "duties" d_video
      WHERE d_audio."duty_type" = 'audio'
        AND d_video."duty_type" = 'video'
        AND d_audio."congregation_id" = d_video."congregation_id"
        AND d_audio."week_start_date" = d_video."week_start_date"
        AND d_audio."event_type" = d_video."event_type"
        AND d_audio."slot_index" = d_video."slot_index";
    `);
    // (c) No collisions remain — rename both surviving types to 'av'.
    await queryRunner.query(
      `UPDATE "duties" SET "duty_type" = 'av' WHERE "duty_type" IN ('audio', 'video');`,
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
      `UPDATE "duties" SET "duty_type" = 'audio' WHERE "duty_type" = 'av';`,
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
