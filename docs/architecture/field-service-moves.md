# Moving a field-service meeting

**Status:** In review (October 2026).
**Last updated:** 2026-10-16.
**Owner:** @Backmann.

Why moving a meeting behaves the way it does. Decided by Lionel on 16 Oct 2026.

Code: server `src/field-service-meetings` (`assertDayFree`, `assertNoConflicts`,
`movedFromDate`), `field-service-planner.service.ts` (`dayTaken`); app
`components/FieldServiceMeetingSheet.tsx`, `lib/field-moves.ts`.

## 1. What the server refuses

| Case | Answer | Can it be saved anyway? |
|---|---|---|
| The day is an assembly/convention day or a circuit overseer's visit (per the settings in force) | 409 `FS_DAY_TAKEN` `{kind, title}` | No. The visit's own outings are planned by the visit. |
| The same day and time with the same audience (general / that group / "by groups") | 409 `FS_CONFLICT` `{conflicts:[{kind:'duplicate'}]}` | Yes, with `confirmConflicts: true` («Всё равно сохранить»). |
| The same conductor already leads a meeting that day | 409 `FS_CONFLICT` `{kind:'conductor_busy'}` | Yes, with `confirmConflicts: true`. |

Cancelled meetings never count as a conflict. On edit the checks run only when
the date (day check) or date/time/audience/conductor (conflicts) changed, so an
old meeting can still get a note edited.

## 2. The trace of a move

- When a **published** meeting changes its date, the server stores
  `moved_from_date` (the old date). Moving it back to that date clears it; a
  second move records the date it last stood on (that is the one announced
  most recently). A draft moves without a trace — nobody has seen it yet.
- The app shows «Перенесена с сб 24 окт.» on the new day and, on the old day, a
  crossed-out **stand-in** «Перенесена на сб 31 окт.» — month list, Programme,
  Home. Both disappear once the old day has passed.
- The stand-in is the same meeting with `movedTo` set and `cancelledAt: 'moved'`
  (app only, never sent to the server). Every count of meetings that *hold*
  already leaves out cancelled ones, so it leaves out the stand-in too.
  Pressing it opens the real meeting.

## 3. Automation

«Подготовить месяц» (and the monthly job) prepares a month only when it holds
no planned meetings. A cancelled meeting, or one moved in from another month,
does not count as planned — before 16 Oct either one made the job skip the
whole month. A meeting moved within its month still counts.

A published meeting moved into a month still in draft stays published; the
sheet says so.

## 4. The sheet

- Calendar dots: blue — a meeting there; red — assembly/convention or visit
  (refused); amber — the hall is busy. A legend sits under the calendar.
- The move calendar has no «Сегодня/Завтра» presets.
- The title shows the new date as soon as it is chosen.
- On a wide screen (≥ 900 px, iPad) the sheet is a centred dialog.
- A cancelled meeting already on the chosen day is mentioned (not refused).
- «Удалить» is a button only for drafts; an announced meeting gets a quiet
  link — it should be cancelled, not deleted, so that people see it.

## 5. Quick diagnosis

| What you see | Why |
|---|---|
| «В этот день конгресс/визит» and no way to save | `FS_DAY_TAKEN` — the calendar rules of the settings. |
| Amber «Всё равно сохранить» | A duplicate or a busy conductor; saving confirms it. |
| No «перенесена с» on a moved meeting | It was a draft when moved (nobody saw the old date), or the old day has passed, or it was moved before 16 Oct. |
| «Подготовить месяц» did nothing | The month already holds a planned meeting of its own. |
