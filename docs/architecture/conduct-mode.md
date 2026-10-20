# Conduct Mode (meeting timing — midweek and weekend)

**Status:** Live in production (October 2026).
**Last updated:** 2026-10-19.
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

A screen that runs the midweek and the weekend meeting part by part
against the clock (the weekend since 18 Oct; route `?kind=weekend`):
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
| Chairman of that meeting | yes | yes | only on his own screen right after the meeting |
| Timekeeper of that meeting (duty «Ведущий времени») | yes | yes | only on his own screen right after the meeting |
| Admin | yes | yes | yes |
| **Midweek:** counsel brother (`adviser`), Life and Ministry overseer (`life_ministry_overseer`) | no | yes | yes |
| **Weekend:** body coordinator and assistant, Watchtower study conductor and assistants, counsel brother | no | yes | yes |
| **Every other elder** (18 Oct) | no | yes | no |
| Ministerial servant, publisher with no task in it | no | no | no |

Readers decided 16 Oct (midweek) and 18 Oct (weekend); one rule on the
server, `common/conduct-overseer.ts`, and its copy in the app,
`isConductOverseer` in `lib/conduct-live.ts`. Every elder may watch since
18 Oct (`isCongregationElder`: the account's role or the card's
appointment) — watching only, no taps, no result.

**If the result is visible only to admins**, the overseers of that meeting
are not assigned under «Обязанности».

## 3. One hand at a time (Live)

- The device whose taps count (the *controller*) sends every change to the
  server (`PUT /conduct-live`); every other device polls every 2 s, and at
  once when the app or page comes back on screen.
- **One device, not one account** (18 Oct). The row keeps
  `controller_device_id` (the app's own random id, `lib/device-id.ts`). The
  same brother's second device opens **watching** — «Время ведёте вы — на
  другом устройстве» — and takes the taps only with «Взять ведение». Rows
  and apps without a device id behave as before. Why: on 18 Oct the
  timekeeper ran the weekend meeting on his iPad, opened it on his phone,
  and the phone sent its half-hour-old run over the iPad's; every screen
  went back to the public talk.
- **A run kept on a device never goes up over a newer one** on the server
  (`keptRunIsNewer`: the later last tap wins); nothing is sent before that
  is decided.
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
- **No pause** (18 Oct): the meeting goes by the wall clock — start on
  time, then as it goes. A pause tapped by mistake held the countdown for
  twenty minutes. A run held by an older app still gets «Продолжить».
- **No warning about the chairman's device** (18 Oct): he opens the screen
  when he wants; a quiet «Председатель · смотрит» only while he looks.

Known limit: a timekeeper whose account is a publisher learns that he is
the timekeeper only from the server. With no signal at all he cannot start
the meeting on his device; the chairman can. The hall has Wi-Fi.

## 4. The chairman's screen at the lectern (18 Oct)

`components/ConductStage.tsx`, rules in `lib/conduct-stage.ts`. A dark
screen for the laptop or tablet by the lectern; only the chairman sees it.
It opens on a device that watches the timekeeper (not on the timekeeper's
own second device), after «Взять ведение» by the chairman, and in
«Проверить экран» (a quick run-through on this device, nothing saved).

- The part now, who has it, the countdown; amber one minute before the end
  on parts of five minutes or more, thirty seconds on shorter ones; one
  soft pulse on a change of colour, no blinking.
- During a counsel: no numbers.
- «Дальше» and «Потом», the end ≈ and how far behind or ahead — a late
  start counts (`endDriftSec`).
- Before the start: «Начало в 19:00 · через …», then «Начало задерживается».
- The number is sized to fit its column on one line; every other label is
  written out in full, never cut short (19 Oct).

### 4a. The stage screen account (20 Oct)

The laptop at the lectern does not sign in as the chairman (he changes every
week, and his account would stay open on a shared device). It has an account
of its own, role `stage`, made by an administrator in User management with a
name («Экран сцены · Зал Царства Hamm»), a login name, a password and 4–8
digits for its menu.

- **Server:** `auth/guards/jwt-auth.guard.ts` refuses a `stage` account every
  handler not marked `@StageAllowed()` (`common/stage.ts`) with
  `STAGE_SCREEN_ONLY`. The marked list is pinned in `common/stage.spec.ts`:
  me, the week's programme, the roster names, meeting settings, special
  events, the live meeting (read), and `POST auth/stage/unlock`.
- **Live:** it watches (`conduct-live.service.ts find`), never runs.
- **Menu:** the digits are checked by the server (5 tries a minute), never
  on the device. No card, no address, no notifications; its role cannot be
  changed and no person can be given it (`STAGE_ACCOUNT_FIXED`).

## 5. The weekend meeting (18–19 Oct)

`buildWeekendRunOrder` in `lib/run-order.ts`; who is shown, `runView` in
the conduct screen. Three songs: before the talk, before the study, after
it.

| Time | Part | Min | On the stage |
|---|---|---|---|
| 13:00 | Opening · song and prayer | 5 | chairman (and who prays) |
| 13:05 | Public talk | 30 | the speaker and his congregation |
| 13:35 | Thanks for the talk · announcements | 2 | chairman — he calls the study conductor |
| 13:37 | Song (the article's) | 3 | the study conductor announces it |
| 13:40 | Watchtower study | 60 | conductor and reader |
| 14:40 | Closing song N and prayer | 5 | conductor announces them and who prays |

The circuit overseer's week (told by `co_concluding_talk` in the
programme): the study 13:40–14:10 without a reader, his concluding talk
14:10–14:40, and **he** announces the closing song and the prayer. The
closing song's number comes from the closing prayer's title as the import
writes it («Песня 151 и молитва») or, in a visit week, from a second
weekend song — the later of the two by `partOrder`.

## 6. The home screen (18 Oct)

`components/ConductEntry.tsx`, `liveCardOf`.

- «На этой неделе вы — ведущий времени» — the timekeeper, until the day.
- «Сегодня вы председатель» — the chairman, on the meeting's day only,
  with who keeps time and a way to the stage screen.
- «Идёт встреча · Live» — everybody who may watch, while it runs.
- **A forgotten «Завершить»** (`runLeftHanging`): no tap for the part on
  screen's own minutes plus twenty (the running device sends `partMin`
  beside the run; without it, 80). Then the card is gone for those who
  watch, and the account that ran it gets «Встреча не завершена». On the
  conduct screen — on either of his devices — the run is finished at the
  last part's own end («Завершить: окончание в 14:45»), offered only on the
  last part; a run that stopped earlier can only be dropped, a result from
  it would be wrong. Before 18 Oct the card said «Идёт встреча» until
  midnight.
- The result card — the readers of that meeting, seven days.

## 7. After the meeting's day it is history (16 Oct)

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

## 8. The result

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
parts appears only from a counsel too short to count (under 3 s), and in
results from before 18 Oct from the **Пауза** button that is gone now. Such
time is shown after the part it followed.

The weekend result names who was on the stage as the run sheet does (the
chairman with the opening, the visiting speaker, the conductor with his
song) and says who reads it.

## 9. Why it is built the way it is

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

## 10. Quick diagnosis

| What you see | Why |
|---|---|
| Result visible only to admins | The overseers of that meeting are not assigned under «Обязанности». |
| An elder sees the meeting run but not its result | By design: every elder watches (18 Oct), only the overseers read. |
| «Время ведёте вы — на другом устройстве» | The same account runs it on another device; «Взять ведение» moves the taps here (section 3). |
| «Встреча не завершена» on the home screen | «Завершить» was not pressed; open the meeting and finish or drop it (section 6). |
| «Ход не обновлялся с HH:MM» on a watching screen | The run was left hanging — the meeting is most likely over. |
| Chairman sees no result a day later | By design: he sees it only on his own screen when the meeting ends. |
| Curve without pauses, with a note | Result saved before 16 Oct or by a device without the update. |
| Chairman's iPad opens watching, no buttons | A timekeeper is named for that meeting; use «Взять ведение» if he does not come. |
| «Ведущий не на связи с HH:MM» | The controller's device has not asked for 20 s (sleep, no Wi-Fi, app closed). |
| The meeting cannot be started | Its day has passed — it is history (section 7). |
| «Итог не сохранён: …» with a reason | The server refused (e.g. a result is already kept after the day) — not a network problem. |
| A change does not reach a phone | The phone has not restarted the app since the update, or the update was published under another runtime version (fingerprint) — check the CI `ota` job. |
