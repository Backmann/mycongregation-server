# HANDOFF 2026-05-23 — Departure tracking, permanent delete, skill-by-title

Second session of 2026-05-23 (after the groups work in
`HANDOFF-2026-05-23-groups.md`). Everything below is in production.

## Phase 2 — group shown in the program  (app `771106a`)
Each assigned publisher's service group is shown under their name in the midweek
and weekend program (small muted line; nothing for invited speakers / the
assistant / publishers with no group). Group names resolved client-side; no
server change. "Your group for the current user" is still deferred (needs a
user↔publisher link).

## Publisher departure lifecycle
The codebase already had a removal lifecycle (`RemovalReason` enum
moved/disfellowshipped/died/other, `removedAt`, `removedNote`, a `remove()`
service method + `POST :id/remove` / `:id/restore`, and `includeRemoved` on the
list). It was surfaced and reshaped to the requested UX:

- **Server** (`d36e90d`): `RemovePublisherDto` gained an optional `date`;
  `remove()` stores it in `removedAt` (the real-world event date) instead of
  always "now". No migration.
- **Dialog** (app `08a81d6`): the red button opens a modal (web + native) — pick
  a reason (died / moved / removed / other), enter the event date (required for
  died/moved/removed) and a note (labelled "Moved to" for a transfer). The
  `disfellowshipped` label is shown as "Удалён"/"Removed"/"Entfernt" (current
  wording; DB value unchanged).
- **List** (app `bcb4129`): departed are always loaded, sorted to the end, greyed,
  with a reason-specific badge; a "congregation standing" filter (current /
  departed) was added; the old show-removed toggle was removed.
- **Refinement** (app `ad08b23`): the list count reflects current (non-departed)
  members with a "· N departed" note; the **Restore** button/mutation/style were
  removed — a departure isn't undone (least of all death); the record stays as
  read-only history.

## Permanent delete  (server `af00168`, app `dd786a5`)
- **Server**: `DELETE /publishers/:id` (admin only) hard-deletes a row, but only
  when it has **no history** — no service reports (RESTRICT FK anyway),
  assignments, duties or field-service conductor roles; otherwise it throws
  `publisher_has_history`. Cart participation cascades. For mistaken/duplicate
  records.
- **App**: relabelled the red button to "Mark as departed" with a hint line;
  added an **admin-only "Delete permanently"** button (active + departed records)
  with explicit confirmation and a friendly message when the server blocks it.
  `publishersApi.purge` added.

## Apply-Yourself skill by title  (app `18a7d5a`, `cc413e2`)
Apply-Yourself parts are imported numbered by position (`apply_yourself_N`), and
`lib/parts.ts` hard-mapped position → capability (1=starting, 2=following-up,
3=making-disciples, 4=none) — so the picker filtered by the wrong skill whenever
a week's parts weren't in canonical order, never used "Explaining Your Beliefs",
and left the 4th part unfiltered. Fix (app-side, no re-import): new
`skillCapabilityFromTitle()` in `lib/parts.ts` detects the skill from the part
title (RU headings) and `AssignmentForm` uses it for `apply_yourself_*`, falling
back to the positional default. The picker (`PublisherSelector`) now shows the
capability **name** (`capabilities.items.*`) instead of the raw key.

## Decisions
- One removal flow = "departure" (reason-based soft-delete). No separate delete
  except the admin history-guarded purge.
- A departure is not reversible in the UI (no Restore). Correcting a mistaken
  mark currently needs a clean record (purge) or DB; an admin "undo departure"
  is a possible follow-up.
- Departed publishers are excluded from counts and pickers (soft-deleted, so
  pickers that don't pass `includeRemoved` skip them) but kept for history.

## Follow-ups
- Admin-only "undo departure" to correct mis-marked records.
- Native date/time pickers for cart shifts; cart self-sign-up + user↔publisher
  link; "your group" for the logged-in user in the program.
- EN/DE skill detection + EPUB parser (RU-only today).
- **Off-site encrypted backups (CRITICAL)** — still needs a Hetzner Storage Box.
