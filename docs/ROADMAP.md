# mycongregation — Roadmap

**Project:** mycongregation — Congregation management for Jehovah's Witnesses
**Live:** https://mycongregation.org · https://api.mycongregation.org/api
**Repositories:** [server](https://github.com/Backmann/mycongregation-server) · [app](https://github.com/Backmann/mycongregation-app)
**Last updated:** 2026-05-16
**License:** AGPL v3

> ⚠️ Unofficial, community-built tool. Not affiliated with or endorsed by any religious organization.

---

## What's in production

### Backend (NestJS 11 + PostgreSQL 16 + TypeORM)

- **Authentication** — JWT (15m access / 30d refresh), bcrypt-12 password hashing, role-based guards (`admin` / `elder` / `ministerial_servant` / `publisher`), proactive client-side token refresh
- **Publishers** — full CRUD, soft-delete + restoration, capabilities matrix per appointment, status engine (`active` / `irregular` / `inactive`) with monthly cron recompute
- **Families** — household management with member relations, family-head flag
- **Service Groups** — overseer + assistant + member roster
- **Assignments** — midweek + weekend program parts, status (`draft` / `published` / `cancelled`), structural integrity guard (cannot delete parts, only unassign publisher)
- **Public Talks** — catalog of 190 talks, bulk import, speaker-history aware picker
- **Schedule Import** — MWB EPUB parser, idempotent, parses weeks/assignments with enriched per-part detail (Bible reading, Spiritual Gems, CBS chapters, Apply Yourself scenarios)
- **Service Reports** — self + on-behalf submission, edit window enforced (1st-10th of next month), regular + pioneer forms
- **Audit Log** — per-report edit history with field-level diffs
- **Activity Feed** — cursor-paginated combined feed (status changes, report events, overrides)
- **Push Notifications** — Expo Push API with token registration
- **Scheduled Jobs** — cron via BullMQ for status recompute

**Quality:** 100 tests across 6 suites · 4 migrations in production · test gate in CI

### Frontend (Expo SDK 54 — Web + Android single codebase)

- All backend modules surfaced in UI
- **5 tabs:** Schedule · Publishers (+ nested Families) · Service Groups · Reports · Profile
- **Schedule** — JW-authentic colored sub-sections (Treasures / Apply Yourself / Living as Christians) for midweek; locale-aware week navigator
- **i18n** — Russian, English, German (~485 keys); first-launch language picker; runtime switching
- **Authentication** — proactive JWT refresh prevents intermittent 401 UI flashes

### Infrastructure

- **Hosting:** Hetzner CX22 VPS · Docker Compose · Postgres 16 · Redis
- **API:** `api.mycongregation.org`
- **PWA:** `mycongregation.org`
- **CDN:** Cloudflare
- **CI/CD:** GitHub Actions — server has test gate, app has build+deploy
- **Mobile build:** EAS Build (Android APK)
- **Operations:** Daily DB backups · Sentry + Better Stack monitoring

---

## Architecture documents

Canonical references under `docs/architecture/`:

| Document | Subject | Status |
|---|---|---|
| [`service-reports.md`](architecture/service-reports.md) | Service Reports data model + workflows + permissions | ✅ **Implemented** |
| [`internationalization.md`](architecture/internationalization.md) | i18n strategy (UI / content / formatting) | 🟡 Client implemented; server pending |
| [`roles-and-permissions.md`](architecture/roles-and-permissions.md) | RBAC + appointments | 🟡 Partially implemented |
| [`data-protection.md`](architecture/data-protection.md) | Encryption at rest + defense-in-depth | ⏳ Design only |
| [`video-conferencing.md`](architecture/video-conferencing.md) | Self-hosted LiveKit for in-app meetings | ⏳ Design only |

---

## Roadmap

### 🟢 Near-term (current sprint, hours-days)

1. **Backend i18n (Phase K)** — Accept-Language middleware, `user.preferred_language` column (Migration #12), localized push notification bodies, server validation messages. Closes `internationalization.md`. *Estimate: ~2-3h.*
2. **Push receipt tracking** — track Expo push receipts, clean up invalid tokens after permanent failures. *Estimate: ~1-2h.*

### 🟡 Medium-term (next 1-2 months)

3. **Data protection L1+L2** — encryption at rest for sensitive fields (addresses, phones, pastoral notes) per `data-protection.md`. AES-256-GCM column transformers + per-tenant key wrapping. *Estimate: ~1-2 days.*
4. **Web Push for PWA** — Service Worker registration, VAPID keys, server-side dual push pipeline (Expo + Web Push). *Estimate: ~1 day.*
5. **Roles & permissions full implementation** — sub-roles (secretary, coordinator-of-elders, etc.), capability-scoped queries per `roles-and-permissions.md`. *Estimate: ~2-3 days.*
6. **App-side CI test gate** — the app repo currently deploys without tests. Add minimal Jest setup + critical-path tests + gate. *Estimate: ~half day.*

### 🔵 Long-term (next 3-12 months)

7. **Video conferencing** — self-hosted LiveKit per `video-conferencing.md`. 4 sub-phases across 5-6 weeks. Requires additional Hetzner VPS (~14-30 €/month).
8. **Production store submissions:**
   - Play Store (Android) — production track, store listing, screenshots, content rating
   - App Store (iOS, if pursuing) — Apple Developer account, app capabilities, review cycle

---

## Phase history

Rough chronological log of completed milestones.

| Date | Phase | Scope |
|---|---|---|
| Apr 2026 | A–D | Foundation: auth, publishers, families, service groups, assignments, public talks, MWB EPUB import |
| Apr 2026 | E | Service Reports submission + edit window + audit log |
| Apr 2026 | F | Publisher status engine + scheduled jobs (cron) |
| Apr 2026 | G | Push notifications + EAS Build configuration |
| Apr–May 2026 | H | Activity feed (server + mobile) |
| 2026-05 | launch | **mycongregation.org went live** |
| 2026-05-15 | I.1–I.6 | Client-side i18n (Russian / English / German, ~485 keys × 3 languages) |
| 2026-05-16 | J.1–J.7 | UX restructure: families nested under publishers · "List / By family" view toggle · JW-style colored midweek sub-sections (Treasures / Apply Yourself / Living as Christians) · structural integrity (unassign vs delete) · proactive JWT refresh · WeekNavigator locale-aware dates |

---

## Working agreements

- **No deletion of structural schedule parts.** Program parts come from MWB EPUB import (or "Create empty midweek/weekend" templates) and are permanent. Users can change or clear the assigned publisher — they cannot remove the slot itself.
- **`synchronize: false` in TypeORM.** All schema changes go through manual migrations under `src/migrations/`.
- **Conventional commits in English.** `feat: …`, `fix: …`, `refactor: …`, `chore: …`.
- **Client-side architecture:** Expo file-based routing; nested route hierarchy mirrors UX structure (e.g. `/publishers/families/*`).
- **No religious source material checked in.** EPUBs and MWB/WT content are imported at runtime by congregations themselves; not bundled with the app.

---

This roadmap is a living document. Update phase history as work ships and revise the architecture-doc status table accordingly.
