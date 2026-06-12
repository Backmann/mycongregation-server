-- Fix the weekend song layout for weeks imported before the parser change.
--
-- Old layout put the pre-study song on the opening prayer. New layout: opening
-- prayer has no song (chosen manually), the article's first song goes to a new
-- "weekend_song" row before the study, the concluding song stays on the closing
-- prayer. This script migrates any weekend whose opening prayer still carries a
-- "Песня N" title. It is idempotent — re-running it changes nothing.
--
-- Run against the production database, e.g.:
--   docker compose -f /root/mycongregation/docker-compose.yml exec -T postgres \
--     psql -U <db_user> -d <db_name> < fix-current-weekend.sql
-- (adjust the service name / user / db to your compose file)

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      congregation_id,
      week_start_date,
      substring(part_title FROM 'Песня\s+\d+') AS song
    FROM assignments
    WHERE event_type = 'weekend'
      AND part_key = 'weekend_opening_prayer'
      AND deleted_at IS NULL
      AND part_title ~ 'Песня\s+\d+'
  LOOP
    RAISE NOTICE 'Fixing weekend % (song -> %)', r.week_start_date, r.song;

    -- 1) Clear the song from the opening prayer (keep the prayer + its assignee).
    UPDATE assignments
       SET part_title = NULL
     WHERE congregation_id = r.congregation_id
       AND week_start_date = r.week_start_date
       AND event_type = 'weekend'
       AND part_key = 'weekend_opening_prayer';

    -- 2) Create the pre-study song row (order 4) if it does not exist yet.
    INSERT INTO assignments
      (congregation_id, week_start_date, event_type, part_key,
       part_order, part_title, part_duration_min, status)
    SELECT
      r.congregation_id, r.week_start_date, 'weekend', 'weekend_song',
      4, r.song, NULL, 'draft'
    WHERE NOT EXISTS (
      SELECT 1 FROM assignments
       WHERE congregation_id = r.congregation_id
         AND week_start_date = r.week_start_date
         AND event_type = 'weekend'
         AND part_key = 'weekend_song'
    );

    -- 3) Renumber the study block so the new song sits before the conductor.
    UPDATE assignments SET part_order = 5
     WHERE congregation_id = r.congregation_id AND week_start_date = r.week_start_date
       AND event_type = 'weekend' AND part_key = 'watchtower_conductor';
    UPDATE assignments SET part_order = 6
     WHERE congregation_id = r.congregation_id AND week_start_date = r.week_start_date
       AND event_type = 'weekend' AND part_key = 'watchtower_reader';
    UPDATE assignments SET part_order = 7
     WHERE congregation_id = r.congregation_id AND week_start_date = r.week_start_date
       AND event_type = 'weekend' AND part_key = 'weekend_closing_prayer';
  END LOOP;
END $$;

-- Verify the result (latest weekend):
SELECT week_start_date, part_order, part_key, part_title
FROM assignments
WHERE event_type = 'weekend' AND deleted_at IS NULL
ORDER BY week_start_date DESC, part_order ASC
LIMIT 14;
