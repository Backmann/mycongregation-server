# BACKLOG — Detailed Feature Specs

**Status:** Living document. Captures feature specs not yet folded into `ROADMAP.md`.
**Created:** 2026-05-19 (from a scoping conversation with Lionel).
**Owner:** @Backmann.

> This document holds the *detailed* specs for upcoming features. `ROADMAP.md`
> is the high-level phase view; this is the working spec for the Schedule
> section expansion + related modules. Once a feature ships, fold a summary
> into ROADMAP phase history and trim the spec here.

---

## Big picture: Schedule section expansion

The **Расписание (Schedule)** section currently surfaces only the meeting
program (midweek + weekend, MWB-imported). It needs four more areas plus a
new bottom-of-app section. Each area is editable by a *different* designated
brother (role-based editing — see "Role-based editing" below).

```
РАСПИСАНИЕ (Schedule)
├── 1. Программа встреч            ✅ in production (MWB EPUB)
├── 2. Обязанности (Duties)        ✅ shipped 2026-05-20
├── 3. График проповеднических     ✅ shipped 2026-05-21
│        встреч (Field Service
│        Meeting Schedule)
└── 4. Уборка (Cleaning)           ✅ shipped 2026-05-21

(separate bottom section)
└── 5. Тележки (Cart Witnessing)   ✅ shipped 2026-05-22
```

Role-based editing: weekday-schedule, weekend-schedule, duties, field-service,
cleaning, and cart-witnessing each have a coordinator who can edit *only*
their area. Implemented via the `Responsibility` table (Roles Phase 2, #12).

---

## Feature A — Обязанности (Meeting Duties)  ✅ SHIPPED 2026-05-20

> **Status: in production.** Server: `Duty` entity + migration, `DutiesService`
> (generate / assign / createCustom / remove), `DutiesController` gated by
> `ResponsibilityGuard` + `@RequireResponsibility(DUTIES_COORDINATOR)` — the
> **first live consumer of ResponsibilityGuard**. App: `DutiesSection` with a
> capability-filtered `PublisherSelector` per slot, custom-duty add, soft
> conflict warnings, read-only for non-coordinators. The microphone stepper was
> built then removed — extra mics are added as custom duties; generation seeds
> 2 capability-filtered microphone slots by default. **Deferred:** the swap
> ("transfer to another") button (Q-DUTY-swap).

Per-meeting assignment of practical duties.

### Predefined duty types
- Безопасность (Security)
- Распорядитель в зале (Hall attendant)
- Zoom (Zoom operator)
- Микрофоны (Microphones) — **two slots** (две ячейки для братьев)
- Аудио (Audio)
- Видео (Video)
- Сцена (Stage)
- Проветривание (Ventilation)

### Custom duties
- Empty fields to **add a custom duty + assign who performs it**.
- **Custom duties are one-week-only (ad-hoc)** — the schedule differs each
  week, so custom rows do not persist across weeks.

### Behavior
- **Frequency:** filled fresh each week, manually, by the duties coordinator.
- **Conflicts (soft):** one person → ideally one duty per meeting, but
  multiple is allowed *with a clear warning* "this brother/sister is already
  assigned to [X]". Warning, not a hard block.
- **Eligibility (KEY):** governed entirely by per-publisher capability flags
  set in the **Возвещатели (Publishers)** section. The duty assignment
  dropdown shows only publishers who hold the matching capability. This
  extends the existing "capabilities matrix per appointment" already in
  production.
- **Sisters:** the same duty capability flags exist for sisters in the
  Publishers section, but are **OFF by default** for sisters. An admin can
  enable any of them per-sister (e.g. enable "audio" → she appears in the
  audio dropdown).
- **Swap function:** desired ("transfer this duty to another person" button)
  but needs careful design — flagged for a focused design pass, not V1.

### Data model sketch
```
Publisher (extend existing capabilities):
  + canDutySecurity, canDutyAttendant, canDutyZoom, canDutyMicrophone,
    canDutyAudio, canDutyVideo, canDutyStage, canDutyVentilation
  (sisters default all false; admin toggles per publisher)

MeetingDuty:
  id, congregationId, meetingId (or weekId + meetingType),
  dutyType (enum incl. 'custom'), customLabel (nullable),
  assignedPublisherId (nullable until filled),
  slotIndex (for microphones ×2),
  createdBy, createdAt, updatedAt
```

### Effort estimate
~2–3 days (Publisher capability extension + migration, MeetingDuty entity +
migration, eligibility-filtered assignment API, Schedule UI section,
conflict-warning UX, notifications).

---

## Feature B — График проповеднических встреч (Field Service Meeting Schedule)  ✅ SHIPPED 2026-05-21

> **Status: in production** (server `834c9bf`, app `5301781`). Per-week,
> schedule-free entries: day, time, address, optional conductor (any publisher),
> topic, source link. Gated by `service_overseer`. Module
> `src/field-service-meetings/`; app `components/FieldServiceSection.tsx`.

Schedule of gatherings for field ministry. **Separate from cart witnessing.**

### Fields per entry
- День недели (day of week)
- Время (time)
- Адрес проведения встречи (meeting location / address)
- Кто проводит (conductor — a publisher)
- Тема или источник публикации (topic or publication source) — **optionally a
  jw.org link** so a brother can open the source directly

### Data model sketch
```
FieldServiceMeeting:
  id, congregationId, weekId (or date),
  dayOfWeek, time, address,
  conductorPublisherId (nullable),
  topic (text, nullable),
  sourceUrl (text, nullable — jw.org link),
  createdBy, createdAt, updatedAt
```

### Effort estimate
~1.5–2 days (entity + migration, CRUD API, Schedule UI section, link
handling, optional notifications).

---

## Feature C — Уборка зала Царства (Kingdom Hall Cleaning Schedule)  ✅ SHIPPED 2026-05-21

> **Status: in production** (server `daee388`, app `7a95b31`/`7ed5daf`). Three
> per-week slots: after-meeting (one group, both meetings), weekly ("Еженедельная
> уборка"), and a general-cleaning marker (whole congregation). Each group slot
> picks a service group (with an empty option); the group's overseer name is
> shown alongside. Gated by `cleaning_coordinator`. Module `src/cleaning/`;
> app `components/CleaningSection.tsx`. The round-robin "next in turn" hint is
> computed server-side but currently unused in the UI.

Weekly cleaning rotation assigned to existing Service Groups.

### Slots
- After-meeting cleaning — **weekday** (a group)
- After-meeting cleaning — **weekend** (a group)
- **Weekly invited cleaning** — a specific group invited (separate slot)

### Behavior
- Uses the existing `ServiceGroup` entity (overseer + assistant + roster
  already in production).
- Rotation: manual or round-robin over service groups (TBD — see open Qs).
- Notifications: TBD (whole group vs overseer).

### Data model sketch
```
CleaningAssignment:
  id, congregationId, weekId,
  slotType (enum: 'after_midweek' | 'after_weekend' | 'weekly_invited'),
  serviceGroupId,
  createdBy, createdAt, updatedAt
```

### Effort estimate
~1–1.5 days (entity + migration, assignment API, Schedule UI section,
optional rotation helper, notifications).

---

## Feature D — Служение с тележками (Cart Witnessing Schedule)  ✅ SHIPPED 2026-05-22

> **Status: in production** (server `86fc091`, app `ff6f293`). Date-based cart
> shifts (date, start/end time, location) staffed by 2-4 publishers, in a new
> bottom tab "Тележки". Coordinator-assigns (self-sign-up deferred). Hard cap 4;
> under-2 flagged incomplete. Gated by `public_witnessing`; a new per-publisher
> capability "public_witnessing" filters the picker. Server `src/cart-shifts/`;
> app `app/(app)/cart/`.

Separate bottom-of-app section. Public-witnessing cart shifts.

### Spec
- **All 7 days a week.**
- Time window **06:00 – 20:00**.
- **Variable shift duration** — some serve 1 hour, some 1.5h, some 2h.
- **2 to 4 publishers** per shift ("одно сотрудничество").
- **Location per shift** — cart witnessing sometimes happens in **different
  locations**, so each shift carries its own place.

### Behavior (to confirm — see open Qs)
- Shifts likely created by the cart-witnessing coordinator; publishers sign
  up (or are assigned). Hybrid likely: coordinator opens slots, publishers
  join, coordinator can adjust.
- Enforce min 2 / max 4 per shift; warn if a shift is under-filled.

### Data model sketch
```
CartShift:
  id, congregationId, date, startTime, endTime,
  location (text), minPublishers (default 2), maxPublishers (default 4),
  createdBy, createdAt, updatedAt

CartShiftParticipant:
  id, cartShiftId, publisherId, joinedAt
```

### Effort estimate
~3–4 days (two entities + migrations, slot management API, sign-up/assignment
flow, capacity + conflict handling, location handling, Cart section UI,
notifications/reminders).

---

## Parser — EN/DE workbook support (RU-only today)

The MWB EPUB parser (`src/mwb-import/mwb-parser.ts`) recognises sections **only
by Russian headings** (`detectSection` matches `ОТТАЧИВАЕМ`/`НАВЫКИ`,
`ХРИСТИАНСКАЯ`). Importing an EN/DE workbook silently fails to detect sections
→ parts misclassify and `mid_song` is not captured. Confirmed 2026-05-21 (an
English `mwb_E_202605` import produced no living_christians section). For
multi-language congregations, extend `detectSection` (and the song/prayer/CBS
keyword tests) to recognise EN + DE headings. **Effort: ~0.5–1 day.** Until
then, **import the Russian workbook only**.

### Shipped alongside Feature A (for the record)
- **publisher-activity module** (server `GET /publisher-activity` + app
  `publisherActivityApi`): the duty/program pickers show what each publisher
  already has *this meeting* + a tappable 4-week history, to avoid overloading
  one person.
- **Schedule JW-fidelity pass:** labels from imported titles, JW-style
  numbering (non-numbered chairman/prayers/readers shown as a muted "·"),
  prayer→song-only subtitle, CBS labels, meeting-header date/address fallback,
  and the **mid-meeting song** (`mid_song`) as an unnumbered row in
  "Христианская жизнь" (parser + app). Re-import preserves assignments.

---

## Role-based editing (Responsibilities)

Each area above is edited by a *different* designated brother. This is exactly
what `roles-and-permissions.md` Layer 2 (`Responsibility` table) is designed
for.

**Important observation (2026-05-19):** the **Profile** section *already* has a
roles area where you can pick a brother and allow him to open sections for
editing. So **partial Layer 2 scaffolding already exists** — Roles Phase 2
(#12) should *extend* what's there, not build from scratch. **First step next
session: read the existing Profile roles UI + any backing entity before
designing the `Responsibility` model.**

Canonical coordinator responsibilities (proposed):
- `weekday-schedule-coordinator`
- `weekend-schedule-coordinator`
- `duties-coordinator`
- `field-service-coordinator`
- `cleaning-coordinator`
- `cart-witnessing-coordinator`

---

## Known bug — Service Group assistants not displayed

**Reported 2026-05-19.** In the Groups section, overseers are assigned and
some groups have assigned assistants (помощники), but the assistants are **not
shown** in the UI. ROADMAP lists service groups as "overseer + assistant +
member roster", so the data model supports assistant — the gap is display
(and/or the API response DTO not returning it).

**Investigation (next session, ~15–30 min):**
- app — groups screen: does it render the assistant field?
- server — groups response DTO: does it include the assistant?

Good warmup task.

---

## Dependency graph

```
PREREQUISITES (do first)
├── #11 Phase 4C off-site backups        [unblocks Data Protection L1+L2]
├── #17 Etap 3 ESLint cleanup            [then add lint to CI]
└── #13 App Jest test suite              [SAFETY NET before any new feature]

FOUNDATION
└── #12 Roles Phase 2 (Responsibility)   [extend existing Profile roles UI]
        │  ResponsibilityGuard is BUILT and LIVE (first consumer: Feature A
        │  duties endpoints, type `duties_coordinator`). Remaining:
        │  PublisherApprovals (L3), conditional UI (L4), apply the guard to
        │  the other coordinators + Schedule endpoints.
        │  unblocks role-based editing for ALL areas below
        ▼
NEW FEATURES (sequential for a solo dev)
├── A. Обязанности (Duties)              ✅ DONE (2026-05-20)
├── B. Проповеднические встречи          ✅ DONE (2026-05-21)
├── C. Уборка (Cleaning)                 ✅ DONE (2026-05-21)
└── D. Тележки (Cart Witnessing)         ✅ DONE (2026-05-22)

QUICK WIN (anytime)
└── Service Group assistant display bug  ~15–30 min
```

Note: A's eligibility depends on extending Publisher capability flags — touch
the Publishers section first within Feature A.

---

## Open questions (to answer before building each)

### Duties (A)
- **Q-DUTY-swap:** swap mechanics — "transfer to another" button design.
  Needs careful thought (notify both parties? coordinator approval? history?).

### Cleaning (C)
- **Q-CLEAN-1:** same group for weekday + weekend in one week, or different?
- **Q-CLEAN-2:** "weekly invited" — in addition to after-meeting, or instead?
  Frequency?
- **Q-CLEAN-3:** rotation auto (round-robin over ServiceGroups) or manual?
- **Q-CLEAN-4:** notify whole group or just overseer?

### Cart Witnessing (D)
- **Q-CART-1:** shift times — fixed grid or fully variable per shift?
- **Q-CART-3:** sign-up by publisher vs assignment by coordinator vs hybrid?
- **Q-CART-4:** under-filled shift (<2) handling — block, warn, or allow?
- **Q-CART-5:** cancel/reschedule mechanics?
- **Q-CART-6:** equipment tracking (which cart / materials)?

### Resolved (for the record)
- Field Service Meetings ≠ Cart Witnessing (separate features). ✓
- Custom duties are one-week-only (ad-hoc). ✓
- Duty eligibility = per-publisher capability flags in Publishers section. ✓
- Sisters: same flags, OFF by default, admin can enable. ✓
- Feature A shipped 2026-05-20 **without** the swap button (Q-DUTY-swap still
  open, deferred to a focused design pass). ✓
- Cleaning (C) shipped 2026-05-21: 3 slots (after-meeting / weekly / general
  marker), manual group choice with empty option, overseer shown; rotation is
  a server hint only (Q-CLEAN-3 → manual). Notifications deferred (Q-CLEAN-4).
  Field Service (B) shipped 2026-05-21 as fully flexible per-week entries. ✓
- Cart Witnessing (D) shipped 2026-05-22: date-based shifts, 2-4 publishers
  (hard max 4, min 2 = warning), coordinator-assigns; new public_witnessing
  capability gates the picker. **All four Schedule features (A/B/C/D) are now in
  production.** ✓
- Group membership shipped 2026-05-23: one group per publisher; add/move/remove
  from the group screen; overseer + assistant are members and counted (backfill
  migration 1787). Publishers list shows each person's group + a client-side
  filter (group/role/pioneer/gender/status). ✓
- Publisher lifecycle shipped 2026-05-23: "mark as departed" (reason + date +
  destination note), departed drop from the count and assignment pickers and
  sink to the end of the list with a reason badge, plus a "congregation standing"
  filter and an admin-only permanent delete guarded by a history check. No
  Restore — a departure is not undone. Apply-Yourself parts now resolve their
  required ministry skill from the part title, not the position. ✓
- Follow-ups: Phase 2 (group shown in the program) done; native date/time pickers
  for cart shifts; cart self-sign-up + user↔publisher link; an admin-only "undo
  departure" to correct mis-marked records. ✓

---

## Estimated total new scope

```
Feature A  Duties              ✅ DONE (2026-05-20)
Feature B  Field Service       ✅ DONE (2026-05-21)
Feature C  Cleaning            ✅ DONE (2026-05-21)
Feature D  Cart Witnessing     ✅ DONE (2026-05-22)
#12        Roles Phase 2       ~3 days (extend existing)
Bug        Group assistants    ~15–30 min
────────────────────────────────────────
~11–14 focused working days for full schedule coverage,
on top of the existing P1 backlog (backups, tests, lint).
```
