-- Revert the midweek opening-song row: put the song back onto the opening
-- prayer (so it shows as a subtitle with the assigned person, like the closing
-- prayer), delete the dedicated song row, and shift the program back up by one.
-- Idempotent: once there are no midweek_opening_song rows left, it is a no-op.
--
-- Run from /root/mycongregation:
--   docker compose exec -T postgres \
--     psql -U mycongregation_user -d mycongregation_db < revert-midweek-opening-song.sql

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      s.congregation_id,
      s.week_start_date,
      substring(s.part_title FROM 'Песн[яи]?\s*№?\s*(\d+)') AS num
    FROM assignments s
    WHERE s.event_type = 'midweek'
      AND s.deleted_at IS NULL
      AND s.part_key = 'midweek_opening_song'
  LOOP
    RAISE NOTICE 'Midweek %: restoring song % onto the prayer', r.week_start_date, COALESCE(r.num, '(none)');

    -- Put the song back onto the opening prayer (if the song row had one).
    IF r.num IS NOT NULL THEN
      UPDATE assignments
         SET part_title = 'Песня ' || r.num || ' и молитва'
       WHERE congregation_id = r.congregation_id
         AND week_start_date = r.week_start_date
         AND event_type = 'midweek'
         AND part_key = 'midweek_opening_prayer';
    END IF;

    -- Remove the dedicated opening-song row.
    DELETE FROM assignments
     WHERE congregation_id = r.congregation_id
       AND week_start_date = r.week_start_date
       AND event_type = 'midweek'
       AND part_key = 'midweek_opening_song';

    -- Close the gap: everything from order 3 up moves back down by one.
    UPDATE assignments
       SET part_order = part_order - 1
     WHERE congregation_id = r.congregation_id
       AND week_start_date = r.week_start_date
       AND event_type = 'midweek'
       AND part_order >= 3;
  END LOOP;
END $$;

-- Verify (latest midweek): chairman 1, opening prayer 2 (carries "Песня N"),
-- treasures 3, ...
SELECT week_start_date, part_order, part_key, part_title
FROM assignments
WHERE event_type = 'midweek' AND deleted_at IS NULL
ORDER BY week_start_date DESC, part_order ASC
LIMIT 10;
