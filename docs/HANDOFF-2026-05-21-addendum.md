# HANDOFF 2026-05-21 — ADDENDUM (ADM cap, Feature B, Feature C)

Work done after `HANDOFF-2026-05-21.md` (same session). All in production.

## ADM — gentle 2-admin recommendation  ✅ (app `24d7062`)
Soft, non-blocking. On `profile/admin-users`, when ≥2 active admins, an info
banner shows; assigning a 3rd+ admin (create or change-role) prompts a
confirmation that can be dismissed or confirmed. No server enforcement. i18n
`admin.users.adminLimit.*` (ru/en/de). Reused the existing
`countActiveAdminsInCongregation` concept client-side (the user list already
carries role + isActive).

## Feature B — Проповеднические встречи (Field Service Meetings)  ✅
Server `834c9bf`, app `5301781`.
- **Server** `src/field-service-meetings/`: `FieldServiceMeeting` entity +
  migration `1784000000000` (per-week: weekStartDate, dayOfWeek 1-7, startTime
  "HH:MM", address, conductorPublisherId SET NULL, topic, sourceUrl). Service
  list/create/update/remove (tenant-scoped). Controller GET open; POST/PATCH/
  DELETE gated by `ResponsibilityGuard` + **`service_overseer`** (existing type,
  no new one). 6 tests.
- **App**: `fieldServiceApi` + types; `components/FieldServiceSection.tsx` —
  week's entries (day · time, address, conductor, topic, tappable source link)
  with an add/edit form modal (day picker, time, address, conductor
  PublisherSelector, topic, link); edit gated by `canEditFieldServiceMeetings`.
  i18n `fieldService.*`.
- Intentionally schedule-free / maximally flexible (no fixed recurring days).

## Feature C — Уборка (Cleaning)  ✅
Server `daee388`, app `7a95b31` + revision `7ed5daf`.
- **Server** `src/cleaning/`: `CleaningAssignment` entity + migration
  `1785000000000` (one row per congregation+week+slotType; UNIQUE). Slots:
  `after_meeting` (one group, both meetings), `thorough` (weekly), `general`
  (whole-congregation marker, serviceGroupId null). Service getWeek (returns
  assignments + a round-robin hint `suggestedAfterMeetingGroupId`), setSlot
  (upsert; general forces null group), clearSlot (idempotent delete).
  Controller GET open; PUT/DELETE gated by **`cleaning_coordinator`**. 8 tests.
- **App**: `cleaningApi` + types; `components/CleaningSection.tsx` — three
  slots; after_meeting + thorough each pick a service group (empty option
  clears); general is a Switch. Edit gated by `canEditCleaning`.
  i18n `cleaning.*`.
- **Revision `7ed5daf`** (per congregation feedback): "thorough" relabelled to
  **"Еженедельная уборка"** (weekly); the group's **overseer name** is shown
  next to the group name (resolved from `group.overseer` or `publishersById`);
  the **"next in turn" button was removed** (the server hint is still computed
  but unused — could be deleted later or revived).

## State
- Server: 346 tests / 26 suites; latest `daee388`. 10 migrations.
- App: lint + i18n (656 keys) green; latest `7ed5daf`.
- The Schedule screen now stacks: program · duties · field-service · cleaning,
  all under the week navigator, each gated by its own responsibility.

## Next (unchanged priorities)
1. **Off-site encrypted backups** (CRITICAL) — needs a Hetzner Storage Box.
2. **EN/DE EPUB parser** (~0.5-1 day) — `detectSection` is RU-only.
3. **Feature D — Cart Witnessing** (`public_witnessing`) — the last Schedule
   area; spec in BACKLOG.md.
4. Roles L3/L4; apply `ResponsibilityGuard` to Schedule program endpoints.
5. Quick win: Service Group assistant display bug (unverified).
