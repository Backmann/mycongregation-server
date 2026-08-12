# mycongregation-server

[![Deploy](https://github.com/Backmann/mycongregation-server/actions/workflows/deploy.yml/badge.svg)](https://github.com/Backmann/mycongregation-server/actions/workflows/deploy.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

REST API behind [mycongregation](https://github.com/Backmann/mycongregation-app)
— a scheduling and coordination tool for communities that meet on a regular
timetable.

Production API: **https://api.mycongregation.org/api**

> ⚠️ Independent, community-built tool. Not affiliated with or endorsed by any
> organization.

## What it is for

A group that meets twice a week, keeps a rota, tracks who is away, and hands out
parts of a programme spends a surprising amount of effort on bookkeeping that
nobody enjoys and everybody double-checks. This API holds that bookkeeping so
the app can be a single, shared, current answer instead of a chain of messages
and spreadsheets.

Three ideas run through it:

**Nothing disappears quietly.** Removing something a person typed hides it
rather than erasing it, and writes what was removed to a change journal. Edits
are journalled with their before and after values, and an administrator can put
a change back the way it was — through the same rules an ordinary edit obeys, so
a revert cannot become a way around them.

**The past is settled.** Once a meeting has happened, its duties freeze; once a
reporting month closes, its figures do. Both are refused for everyone, and the
refusal is written down rather than silently ignored.

**One place decides each rule.** Which day a meeting falls on, whether a week
holds a meeting at all, who may edit which section — each of these lives in
exactly one place and is asked, never re-derived. Copies of a rule drift apart;
this has been the source of more defects here than any other single cause.

## What it does

- 👥 **People and groups** — records with roles, status, service groups, and
  soft-delete with restoration
- 📋 **Programme assignments** — parts of a recurring meeting, with per-section
  editing rights and a frozen past
- 🎤 **Talks and speakers** — a catalog, visiting and outgoing speaker
  scheduling, and history
- 🧹 **Duties and cleaning** — responsibilities and cleaning slots assigned to
  people or to groups, with reminders timed to the meeting that is actually
  held
- ✈️ **Absences** — who is away and when, consulted wherever somebody is being
  scheduled
- 📊 **Monthly reports** — collection, reminders, status derived from activity,
  and a closing rule that settles the month
- 🗓️ **Visits and events** — a visiting coordinator's schedule, conventions and
  assemblies that displace ordinary meetings
- 🎓 **Courses** — a multi-day event with its own rota of helpers, warnings for
  clashes, and a printable sheet
- 🔔 **Notifications** — push to phones and browsers, with per-category
  preferences and quiet hours
- 📓 **Change journal** — who changed what, when, and what it was before, with
  a supervised undo
- 🗄️ **Backups** — nightly encrypted dumps, verified weekly

## Security and privacy

- **Encryption at rest** — personal fields are encrypted at the column level
  with AES-256-GCM through a TypeORM transformer; tampered ciphertext fails
  closed rather than returning something plausible
- **Tenancy** — every query is scoped to the group it belongs to; there is no
  path from one group's data to another's
- **Access** — role and responsibility based, checked in the service and not
  only at the edge, so a second route to the same data cannot bypass it
- **Sessions** — short-lived access tokens with rotating refresh tokens and
  reuse detection; a refresh token used twice revokes its whole family
- **Passwords** — bcrypt-12, a length-first policy, and a rate limiter on the
  login route that answers the same way whatever went wrong
- **Refusals are logged** — every 4xx leaves a line with its path and caller,
  and never with a body, a query string or a header

## Tech stack

- [NestJS](https://nestjs.com/) + TypeScript (strict)
- PostgreSQL 16 + TypeORM, manual migrations (no auto-sync in production)
- Jest — 1000+ tests, run in CI before every deploy
- Docker Compose, nginx, Cloudflare
- Sentry for error monitoring

## Development

Requirements: Node.js 20+, PostgreSQL 16, npm

```bash
git clone https://github.com/Backmann/mycongregation-server.git
cd mycongregation-server
npm install
cp .env.example .env      # then fill in the secrets
npm run migration:run
npm run start:dev
```

The API is then at http://localhost:3000/api

```bash
npm test          # unit tests
npm run typecheck # strict type check, including specs
npm run lint
```

## License

Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
