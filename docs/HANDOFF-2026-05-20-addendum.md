# HANDOFF 2026-05-20 — ADDENDUM (capabilities rework)

Work done AFTER `6d4e3bd` (the main handoff). The publisher capability matrix
was restructured per congregation feedback. Commits: `3886347` (app rework),
`65b11ad` (app parts.ts remap), `ac84834` (server hospitality default), plus a
production backfill.

## Capability matrix — current shape (`lib/capabilities.ts`)

Sections and their capability keys (UI labels via i18n
`capabilities.categories.*` / `capabilities.items.*`, ru/en/de):

- **midweek** — unchanged keys: `midweek_chairman`, `midweek_opening_prayer`,
  `treasures_talk`, `spiritual_gems`, `bible_reading`,
  `congregation_study_conductor`, `congregation_study_reader`. (Only the RU
  labels for chairman / opening prayer / CBS conductor were reworded.)
- **weekend** — unchanged: `weekend_chairman`, `weekend_opening_prayer`,
  `public_talk_speaker`, `watchtower_conductor`, `watchtower_reader`.
- **field_service** — label now "ОТТАЧИВАЕМ НАВЫКИ СЛУЖЕНИЯ". NEW keys
  (replaced the old `demo_*` / `service_meeting_part`):
  `fs_starting_conversation`, `fs_following_up`, `fs_making_disciples`,
  `fs_explaining_beliefs`, `fs_talk` (brother-only).
- **duties** — label now "Обязанности". NEW keys (replaced
  attendant/microphone/stage/sound/video_presenter):
  `duty_security`, `duty_attendant`, `duty_zoom`, `duty_microphone`,
  `duty_audio`, `duty_video`, `duty_stage`, `duty_ventilation`.
  **These are the eligibility flags Feature A (Duties schedule) must build on.**
- **hospitality** — NEW section, single key `hospitality`.
- **cleaning** — REMOVED from capabilities. Cleaning moves to a role
  (cleaning_coordinator) + ServiceGroup rotation (Feature C); it is NOT a
  per-publisher capability.

`lib/parts.ts` was remapped to the new field_service keys: apply_yourself_1/2/3
→ fs_starting_conversation / fs_following_up / fs_making_disciples;
living_christians_1/2 → fs_talk. `fs_explaining_beliefs` has no auto-mapped
schedule part yet (fine).

## Other changes
- `CapabilitiesEditor` now has a per-section "select all" row (toggles all
  eligible, i.e. non-brother-only-for-sisters, capabilities at once).
  i18n key `capabilities.selectAll`.
- **Hospitality default for sisters:** `publishers.service.create` seeds
  `{ hospitality: true }` when `gender = sister` (explicit dto value wins).
  All 60 existing sisters were backfilled in production
  (`UPDATE publishers SET capabilities = capabilities || '{"hospitality":true}'`
  WHERE gender='sister'). Backup: `~/mycong-before-hospitality-2026-05-20-1054.sql.gz`.
- **Publisher list:** the screen now passes `limit: 200` (server default was 50,
  which truncated the ~90-person roster). Proper pagination still a future nicety
  (DTO max is 200).

## Data note
All 87 publishers have small/empty capabilities; renaming/removing keys carried
no data loss. Any stray legacy keys in jsonb are simply ignored by the UI.
Lionel is setting capabilities/statuses per publisher in the UI.

## Next session
Feature A (Обязанности / Duties schedule) — spec in `docs/BACKLOG.md`. Eligibility
is the `duty_*` capability set above; the coordinator will be gated by a NEW
`duties_coordinator` ResponsibilityType (Layer 2) to be added. ResponsibilityGuard
(already built) gets applied to the new endpoints.
