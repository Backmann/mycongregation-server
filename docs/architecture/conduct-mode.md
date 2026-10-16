# Conduct Mode (midweek meeting timing)

**Status:** Live in production (October 2026).
**Last updated:** 2026-10-16.
**Owner:** @Backmann.

This document records how conduct mode works and, above all, **why** it
behaves the way it does — so that "this works and that does not" can be
explained without re-reading the code. Every rule below was decided by
Lionel; the dates say when.

Code: app `app/(app)/schedule/conduct.tsx`, `lib/conduct-*.ts`,
`components/Conduct*.tsx`; server `src/conduct-live`, `src/conduct-runs`,
`src/common/conduct-overseer.ts`.

---

## 1. What it is

A screen that runs the midweek meeting part by part against the clock:
a countdown per part, the counsel after a student part, how far the meeting
has drifted from the programme, and when it will end. When the meeting
ends, a **result** is saved for seven days.

Variant A (15 Oct): a student part ends with **Закончено** — its clock
stops, the chairman's counsel counts **up**; **Следующая** (with the next
names on it) starts the next part. Nothing starts by itself.

A student is measured against the programme's own minutes (a 4-minute
reading shows 4:00); the fifth minute is the counsel, shown on its own line.

## 2. Who does what

| Who | Runs the meeting | Watches it live | Reads the result (7 days) |
|---|---|---|---|
| Chairman of that week | yes | yes | only on his own screen right after the meeting |
| Timekeeper of that week (duty «Ведущий времени») | yes | yes | only on his own screen right after the meeting |
| Admin | yes | yes | yes |
| Counsel brother (responsibility `adviser`) | no | yes | yes |
| Life and Ministry overseer (`life_ministry_overseer`) | no | yes | yes |
| Any other elder, ministerial servant, publisher | no | no | no |

Decided 16 Oct (it was "every appointed brother" on 15 Oct). One rule on
the server, `common/conduct-overseer.ts`, and its copy in the app,
`isConductOverseer` in `lib/conduct-live.ts`.

**If the result or Live is visible only to admins**, the counsel brother and
the Life and Ministry overseer are not assigned under «Обязанности».

## 3. One hand at a time (Live)

- The device whose taps count (the *controller*) sends every change to the
  server (`PUT /conduct-live`); every other device polls every 2 s.
- With a timekeeper named, the chairman's iPad opens **watching**.
  **Взять ведение** (chairman, timekeeper or admin) moves the taps; an
  `epoch` goes up, and writes carrying the old epoch are refused, so a phone
  that comes back online cannot overwrite the meeting with what it tapped in
  the dark. The device that lost control drops its own run.
- Times on the wire are **server time**; every answer carries `serverNow`
  and each device shifts by its own offset.
- A device silent for 20 s shows as «не на связи». A GET is the sign of
  life — the controller polls anyway.
- **No answer from the server at all** (no signal, older server): the
  screen runs on the device as before Live existed.
- **Practice** (Тренировка) is never sent anywhere.
- The live row lives a day and is deleted by the nightly job.

Known limit: a timekeeper whose account is a publisher learns that he is
the timekeeper only from the server. With no signal at all he cannot start
the meeting on his device; the chairman can. The hall has Wi-Fi.

## 4. After the meeting's day it is history (16 Oct)

On 16 Oct a run started on a phone the evening after the meeting (a
try-out, not in practice mode) sat in a counsel overnight; the next morning
it was sent as the live meeting and nearly saved as the result —
9:16:38 with 555 minutes of counsel — in place of Wednesday's real one. Only
the size limits refused it. Since then:

- The meeting counts as **over once its day has passed** (week rules: the
  settings in force and a circuit overseer's visit), not only its week.
- After the day the screen shows only the saved result: no start, no Live,
  no saving from the screen. A run left unfinished on a device is dropped;
  a finished one waiting to be sent stays (the hall may have had no signal).
- The server refuses Live writes after the day (`CONDUCT_MEETING_OVER`) and
  **never replaces a kept result after the day** (`CONDUCT_RESULT_KEPT`); a
  late *first* result is still accepted.
- A refusal is shown as a refusal with its reason, never as «нет связи».

## 5. The result

- Kept **seven days** from saving, then deleted (decided 15 Oct: no history,
  no statistics over months).
- Per part: programme seconds, actual seconds, counsel, and — from 16 Oct —
  `startSec`, when the part began (seconds from the meeting's start), plus
  `started_at` for the meeting.
- The detailed result (`components/ConductReport.tsx`, numbers in
  `lib/conduct-report.ts`): four numbers, the curve of how far behind the
  programme the meeting was, sections against the programme, parts in order
  or by deviation. No ratings of brothers; the opening, the closing and the
  song are grey — nobody's assignment.
- **The pauses are placed** (decided 16 Oct): with every part's start known
  the curve ends exactly on the meeting's total over the programme. Without
  it the curve and the top number disagreed — two answers to one question.

### Why some results show the pauses and some do not

Results saved **before 16 Oct**, or by an app that has not yet received the
update, carry no start times. They are shown with the curve **without
pauses** and a note saying so. Nothing is wrong with them; the data was
never recorded. From the first meeting run with the update the pauses are
placed.

### Where "pauses" come from

The app ends one part and starts the next in a single tap, so time between
parts appears only from the **Пауза** button and from a counsel too short to
count (under 3 s). Such time is shown after the part it followed.

## 6. Why it is built the way it is

- **No new native modules.** Updates reach the phones over the air only as
  long as the app's runtime version (Expo fingerprint) does not change. A new
  native library — an SVG/chart library, for example — would need a new APK
  for everyone. That is why the curve is drawn with plain views (thin rotated
  bars), not with an SVG library. `app/package.json` and `app/.gitignore`
  are guarded by CI for the same reason.
- **The device keeps its own run** (`lib/conduct-run-record.ts`, versioned):
  an iPad that reloads mid-meeting must not lose the count. Every shape ever
  written is still read; a run follows a programme change by part key, not
  by position.
- **A finished result is resent from any screen** when the signal returns
  (`lib/conduct-resend.ts`); a refusal from the server clears it.
- **The keep-awake** on Android comes with Expo itself, so it arrived over
  the air without a new APK.

## 7. Quick diagnosis

| What you see | Why |
|---|---|
| Result / Live visible only to admins | Counsel brother and Life and Ministry overseer not assigned under «Обязанности». |
| A brother sees «Итог встречи видят админы…» | He is not one of those three — by design (16 Oct). |
| Chairman sees no result a day later | By design: he sees it only on his own screen when the meeting ends. |
| Curve without pauses, with a note | Result saved before 16 Oct or by a device without the update. |
| Chairman's iPad opens watching, no buttons | A timekeeper is named for that week; use «Взять ведение» if he does not come. |
| «Ведущий не на связи с HH:MM» | The controller's device has not asked for 20 s (sleep, no Wi-Fi, app closed). |
| The meeting cannot be started | Its day has passed — it is history (section 4). |
| «Итог не сохранён: …» with a reason | The server refused (e.g. a result is already kept after the day) — not a network problem. |
| A change does not reach a phone | The phone has not restarted the app since the update, or the update was published under another runtime version (fingerprint) — check the CI `ota` job. |
