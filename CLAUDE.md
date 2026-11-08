# CLAUDE.md — mycongregation-server

NestJS + TypeORM + PostgreSQL API. Public repository: neutral language
(participants, groups, meetings, programme parts, schedules); no organisation
names, no personal data, no secrets.

## Never

- Never rewrite published history.
- Never add a role check without its guard: `@Roles` does nothing unless the
  controller has `@UseGuards(RolesGuard)` (`src/common/roles-need-guard.spec.ts`).
- Never use production data or keys for testing.

## The gate (run all of it before a pull request)

`npx prettier --check <changed files> && npm run typecheck && rm -rf dist && npm run build && npx jest`

- `typecheck` is mandatory: build and jest do not type-check spec files.
- ESLint on specs is noisy and is not part of the gate; prettier is.
- The gate never boots the app: a missing module import passes everything and
  kills production. CI has a `boot` job and a `db` job (whole app against a
  throwaway database) — keep them green, and when adding a module check the
  `imports: [...]` array itself.

## Rules of the code

- Past schedule items freeze at 00:00 the day after the meeting's own day
  (following a moved day); enforced on the server, no admin exception.
- "Today" is the congregation's own time zone, never UTC.
- Every migration must run on a copy of real-shaped data: old rows in old shapes
  exist. Think about readers of an old field before renaming it — list them all
  in one search first.
- Trace the whole path before fixing: database → API response → client type →
  renderer → which window of time is loaded.

## Delivery

- Branch `claude/<topic>`, pull request, conventional commits in English.
- Merging to `main` deploys (after `test`, `boot`, `db`); a backup is taken
  before each deploy (`scripts/pre-deploy-backup.sh`).
- The server deploys before the app; a change the app depends on ships first.
- Feature specs: `docs/ROADMAP.md`, `docs/BACKLOG.md`.
