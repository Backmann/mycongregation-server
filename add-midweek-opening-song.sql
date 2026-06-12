-- Add the opening-song row (order 2) to midweek meetings that don't have it
-- yet, shifting the rest of the program down by one. Idempotent: a midweek that
-- already has a midweek_opening_song row is skipped.
--
-- Run from /root/mycongregation:
--   docker compose exec -T postgres \
--     psql -U mycongregation_user -d mycongregation_db < add-midweek-opening-song.sql

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT a.congregation_id, a.week_start_date
    FROM assignments a
    WHERE a.event_type = 'midweek'
      AND a.deleted_at IS NULL
      AND a.part_key = 'midweek_chairman'
      AND NOT EXISTS (
        SELECT 1 FROM assignments s
        WHERE s.congregation_id = a.congregation_id
          AND s.week_start_date = a.week_start_date
          AND s.event_type = 'midweek'
          AND s.part_key = 'midweek_opening_song'
      )
  LOOP
    RAISE NOTICE 'Adding opening-song row to midweek %', r.week_start_date;

    UPDATE assignments
       SET part_order = part_order + 1
     WHERE congregation_id = r.congregation_id
       AND week_start_date = r.week_start_date
       AND event_type = 'midweek'
       AND part_order >= 2;

    INSERT INTO assignments
      (congregation_id, week_start_date, event_type, part_key,
       part_order, part_title, part_duration_min, status)
    VALUES
      (r.congregation_id, r.week_start_date, 'midweek', 'midweek_opening_song',
       2, NULL, NULL, 'draft');
  END LOOP;
END $$;

-- Verify (latest midweek): chairman 1, opening song 2, opening prayer 3, then
-- treasures / apply-yourself / mid_song / living-as-christians / cbs / closing.
SELECT week_start_date, part_order, part_key, part_title
FROM assignments
WHERE event_type = 'midweek' AND deleted_at IS NULL
ORDER BY week_start_date DESC, part_order ASC
LIMIT 20;
