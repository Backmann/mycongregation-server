# HANDOFF 2026-05-24 — Section-scoped schedule permissions

Closes the "who can edit what" question before the closed test. Everything
below is in production. Authoritative design: `architecture/roles-and-permissions.md`.

## The two-layer model (recap)
- **Layer 1 — Role** (on the User login): `admin` / `elder` / `ministerial_servant`
  / `publisher`. Coarse account tier; admin = full access.
- **Layer 2 — Responsibility** (`responsibilities` table): links a **`userId`
  (login!)** to a `ResponsibilityType`, one holder per (congregation, type).
  Assigned by an admin via `POST /responsibilities`.

A login is NOT a publisher. `Publisher` is the person-card used for program
assignments; `User` is the login. A responsibility hangs off the login
(`userId`), so to let a brother edit, he needs a login + the right
responsibility (or admin). No User↔Publisher link is needed for permissions.

## Server: section-scoped program authorization
Before: `assignments` writes were gated by `@Roles(ADMIN, ELDER)` — any elder
edited the whole program, no midweek/weekend split.

Now: `src/common/guards/assignment-section.guard.ts` (`AssignmentSectionGuard`),
wired on every `assignments` write (`POST` / `POST bulk` / `PATCH :id` /
`DELETE :id` / `POST :id/restore`):
- admin → allow.
- otherwise the user must hold the responsibility that owns the assignment's
  section (event type). The section is read from the request body on
  create/bulk and from the stored record on `:id` routes.
- mapping (`EVENT_TYPE_RESPONSIBILITY`): `midweek → life_ministry_overseer`,
  `weekend → body_coordinator`, `cleaning → cleaning_coordinator`,
  `av_duty → duties_coordinator`, `public_witnessing → public_witnessing`.
- a `:id` record not in the caller's congregation → 404.

No migration (the enum + `responsibilities` table already existed). 8 unit tests
added (367 total / 28 suites). The server is the source of truth.

## App: mirror the permissions in the UI
`lib/permissions.ts` already exposed `canEditMidweekSchedule` /
`canEditWeekendSchedule` (admin OR holds the responsibility) — it was just not
applied to the program. Now:
- `AssignmentForm` has a `readOnly` mode: body wrapped in `pointerEvents="none"`
  + dimmed, submit/cancel hidden.
- `schedule/[id].tsx` derives `canEdit` from the part's `eventType` (midweek →
  `canEditMidweekSchedule`, weekend → `canEditWeekendSchedule`, else admin),
  shows a "read-only" banner and hides the unassign/restore actions when the
  user can't edit that section.
- `schedule/index.tsx` gates the "create empty week" buttons by the matching
  section flag.

These are UI affordances only — the server still enforces every write.

## Access / user model (no open registration)
- The whole `UsersController` is `@Roles(ADMIN)`. There is **no public
  registration**. `POST /auth/bootstrap` is the only public account-creating
  route and it refuses once any user exists (`count() > 0 → 409`) — already
  spent, permanently locked. Public auth routes are only `login` / `refresh`.
- Accounts are **admin-provisioned**: admin enters email + an initial password
  (≥8, communicated out-of-band) + role. The user logs in and changes their own
  password (self-service "Пароль" action; cannot change own role / deactivate
  self). Max 2 admins; cannot deactivate the last admin.

## Operational flow — grant a brother edit access
1. Profile → "Управление пользователями" → "Добавить пользователя": his email +
   a temporary password + role `publisher` (role doesn't matter for section
   editing — the responsibility grants it).
2. Hand him the credentials privately; he logs in and changes the password.
3. Profile → "Обязанности" → e.g. "Руководитель встречи «Жизнь и служение»" →
   "Назначить" → pick his login.
4. He can now edit midweek only; weekend shows read-only and the server 403s a
   weekend write.

## Follow-ups
- Email invite flow (SMTP + invite tokens) as a nicer alternative to
  admin-set passwords — optional, post-test.
- Finer weekend split if ever needed (public talk → `public_talk_coordinator`,
  WT study → `wt_study_conductor`); today the whole weekend is `body_coordinator`.
- Apply the responsibility layer to the remaining coordinators per
  `roles-and-permissions.md`.
