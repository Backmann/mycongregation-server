# mycongregation — Roadmap

**Project:** mycongregation — Congregation management for Jehovah's Witnesses
**Live:** https://mycongregation.org · https://api.mycongregation.org/api
**Repositories:** [server](https://github.com/Backmann/mycongregation-server) · [app](https://github.com/Backmann/mycongregation-app)
**Last updated:** 2026-05-23
**License:** AGPL v3

> ⚠️ Unofficial, community-built tool. Not affiliated with or endorsed by any religious organization.

---

## What's in production

### Backend (NestJS 11 + PostgreSQL 16 + TypeORM)

- **Authentication** — JWT (15m access / 30d refresh), bcrypt-12 password hashing, role-based guards (`admin` / `elder` / `ministerial_servant` / `publisher`), proactive client-side token refresh
- **Publishers** — full CRUD; departure tracking (moved / died / removed, with an event date + destination note) that drops them from the active count and assignment pickers and sorts them to the end of the list with a reason badge; admin-only permanent delete guarded by a history check; capabilities matrix per appointment; status engine (`active` / `irregular` / `inactive`) with monthly cron recompute
- **Families** — household management with member relations, family-head flag
- **Service Groups** — overseer + assistant + managed member roster (add/move/remove members from the group screen; leaders auto-added as members and counted)
- **Assignments** — midweek + weekend program parts, status (`draft` / `published` / `cancelled`), structural integrity guard (cannot delete parts, only unassign publisher)
- **Public Talks** — catalog of 190 talks, bulk import, speaker-history aware picker
- **Schedule Import** — MWB EPUB parser, idempotent, parses weeks/assignments with enriched per-part detail (Bible reading, Spiritual Gems, CBS chapters, Apply Yourself scenarios, mid-meeting song). **Russian headings only today** (EN/DE in backlog)
- **Meeting Duties** — per-week practical duties (security, attendant, Zoom, microphones, audio, video, stage, ventilation + custom), capability-filtered assignment, soft conflict warnings, gated by `ResponsibilityGuard` (`duties_coordinator`) — first live use of the responsibility layer
- **Publisher Activity** — `GET /publisher-activity`: per-publisher rollup of recent parts + duties (configurable weeks), surfaced in the duty/program pickers to avoid overloading one person
- **Field Service Meetings** — per-week, flexible field-ministry meeting entries (day, time, address, conductor, topic, source link); gated by `service_overseer`
- **Cleaning** — per-week Kingdom Hall cleaning: after-meeting + weekly group slots (service groups, overseer shown) + a general-cleaning marker; gated by `cleaning_coordinator`
- **Cart Witnessing** — date-based public-witnessing cart shifts (2-4 publishers, hard cap 4) in a dedicated "Carts" tab; gated by `public_witnessing` with a per-publisher capability filtering the picker
- **Service Reports** — self + on-behalf submission, edit window enforced (1st-10th of next month), regular + pioneer forms
- **Audit Log** — per-report edit history with field-level diffs
- **Activity Feed** — cursor-paginated combined feed (status changes, report events, overrides)
- **Push Notifications** — Dual-channel delivery: Expo Push (native iOS/Android) + Web Push (PWA browsers); ticket persistence + receipt-checking cron for Expo; HTTP-code-based stale-subscription cleanup for both channels; per-language localized message bodies (see [`push-notifications.md`](architecture/push-notifications.md))
- **Scheduled Jobs** — NestJS `@Cron`: nightly status recompute (03:00 UTC), push receipt check (every 30 min), receipt cleanup (03:30 UTC daily). BullMQ powers the email-send queue.

**Quality:** 359 tests across 27 suites · 12 migrations in production · test gate in CI

### Frontend (Expo SDK 54 — Web + Android single codebase)

- All backend modules surfaced in UI
- **5 tabs:** Schedule · Publishers (+ nested Families) · Service Groups · Reports · Profile
- **Schedule** — JW-authentic colored sub-sections (Treasures / Apply Yourself / Living as Christians) for midweek; locale-aware week navigator
- **i18n** — Russian, English, German (721 keys); first-launch language picker; runtime switching
- **Authentication** — proactive JWT refresh prevents intermittent 401 UI flashes
- **Web Push (PWA)** — Service Worker–based notifications for browser users, opt-in toggle in Profile with iOS Safari standalone-mode hint

### Infrastructure

- **Hosting:** Hetzner CX22 VPS · Docker Compose · Postgres 16 · Redis
- **API:** `api.mycongregation.org`
- **PWA:** `mycongregation.org`
- **CDN:** Cloudflare
- **CI/CD:** GitHub Actions — server has test gate + auto-deploy, app has lint gate + auto-deploy (both deploy on push to main)
- **Mobile build:** EAS Build (Android APK)
- **Operations:** Daily DB backups · Sentry + Better Stack monitoring

---

## Architecture documents

Canonical references under `docs/architecture/`:

| Document | Subject | Status |
|---|---|---|
| [`service-reports.md`](architecture/service-reports.md) | Service Reports data model + workflows + permissions | ✅ **Implemented** |
| [`internationalization.md`](architecture/internationalization.md) | i18n strategy (UI / content / formatting) | ✅ **Implemented** (client + server) |
| [`push-notifications.md`](architecture/push-notifications.md) | Push pipeline + receipt tracking + cleanup | ✅ **Implemented** |
| [`roles-and-permissions.md`](architecture/roles-and-permissions.md) | RBAC + appointments | 🟡 Partial — `ResponsibilityGuard` live (first consumer: duties) |
| [`data-protection.md`](architecture/data-protection.md) | Encryption at rest + defense-in-depth | ⏳ Design only |
| [`video-conferencing.md`](architecture/video-conferencing.md) | Self-hosted LiveKit for in-app meetings | ⏳ Design only |

---

## Roadmap

### 🟢 Near-term (current sprint, hours-days)

*Phase K (backend i18n), Phase G.2 (push receipt pipeline), and Phase M (Web Push for PWA) all shipped 2026-05-17. App-side CI workflow + production bug fixes shipped 2026-05-18 — see phase history. Pick next from medium-term.*

### 🟡 Medium-term (next 1-2 months)

1. **App-side Jest test suite** — CI workflow now runs lint as a gate (shipped 2026-05-18); next layer is adding Jest setup + critical-path tests so the lint gate expands into a real test gate. *Estimate: ~half day.*
2. **Data protection L1+L2** — encryption at rest for sensitive fields (addresses, phones, pastoral notes) per `data-protection.md`. AES-256-GCM column transformers + per-tenant key wrapping. *Estimate: ~1-2 days.*
3. **Roles & permissions full implementation** — sub-roles (secretary, coordinator-of-elders, etc.), capability-scoped queries per `roles-and-permissions.md`. `ResponsibilityGuard` is already live (Feature A); remaining: PublisherApprovals (L3), conditional UI (L4), apply the guard to the other coordinators + Schedule. *Estimate: ~2-3 days.*
4. **EN/DE EPUB parser** — `detectSection` + keyword tests are Russian-only; extend to English/German headings so non-RU congregations can import. *Estimate: ~0.5-1 day.*
5. **Schedule expansion (Features B/C/D)** — Field Service Meeting, Cleaning rotation, Cart Witnessing; specs in `docs/BACKLOG.md`, each gated by its own coordinator responsibility. *Estimate: ~6-8 days total.*

### 🔵 Long-term (next 3-12 months)

5. **Video conferencing** — self-hosted LiveKit per `video-conferencing.md`. 4 sub-phases across 5-6 weeks. Requires additional Hetzner VPS (~14-30 €/month).
6. **Production store submissions:**
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
| 2026-05-17 | K | Backend i18n: `users.ui_language` column, BootstrapDto language inheritance, `PATCH /auth/me` for client→server sync, per-language localized push notification bodies |
| 2026-05-17 | G.2 | Push receipt pipeline: `push_receipts` table + entity, ticket persistence in sendStatusChange, receipt-check cron (every 30 min), DeviceNotRegistered token cleanup, daily receipt purge (7d retention), 7 dedicated tests |
| 2026-05-17 | M | Web Push for PWA: `web_push_subscriptions` table, subscribe/unsubscribe endpoints, dual-channel send in `sendStatusChange` (Expo + Web Push in one call), Service Worker, `lib/web-push.ts` client API, Profile toggle, iOS Safari standalone hint, 14 dedicated tests |
| 2026-05-18 | M | Phase M end-to-end **production-verified** — nightly StatusRecompute cron fires `sendStatusChange` → WNS + FCM both accept push (`last_used_at` updates on both subscriptions) |
| 2026-05-18 | hardening | App-side CI workflow (lint gate + auto-deploy mirroring server pattern); `lib/api.ts` now throws in production when `EXPO_PUBLIC_API_URL` is unset (was silently falling back to localhost — bit us during today's deploy); DTO `@Transform` on 4 date fields (birthDate / baptismDate / ministryStartDate / pioneerSince) fixes `must be a valid ISO 8601 date string` when fields are empty strings or null |
| 2026-05-19 | capabilities | Capability matrix rework: `field_service` (`fs_*`) + `duties` (`duty_*`) keys, `hospitality` section (sisters default true, 60 backfilled), cleaning moved to a role; CapabilitiesEditor "select all"; publisher list `limit: 200` |
| 2026-05-20 | Feature A | **Обязанности (Duties)** shipped: `Duty` entity + migration, `DutiesService` + `DutiesController` gated by `ResponsibilityGuard`/`duties_coordinator` (first live consumer); app `DutiesSection` (capability-filtered picker, custom duties, soft conflict warnings, read-only for non-coordinators) |
| 2026-05-20 | publisher-activity | New `publisher-activity` module (`GET /publisher-activity`) + app `publisherActivityApi`; "this meeting" + 4-week history shown inside the duty/program pickers |
| 2026-05-20 | schedule fidelity | JW-style numbering (muted "·" for chairman/prayers/readers), labels from imported titles, prayer→song-only subtitle, CBS labels, meeting-header date/address fallback when no settings version is effective yet |
| 2026-05-21 | mid_song | Parser captures the mid-meeting song (`mid_song`, standalone `<h3>` inside Living-as-Christians) instead of skipping it; app renders it unnumbered. Re-import preserves assignments (creates missing + refreshes empty templates only). **Surfaced: parser is RU-headings-only → EN/DE backlog item** |
| 2026-05-21 | ADM | Gentle 2-admin recommendation: info banner + soft confirmation when assigning a 3rd+ admin (no server enforcement) |
| 2026-05-21 | Feature B | **Field Service Meetings** shipped: `FieldServiceMeeting` entity + migration + CRUD gated by `service_overseer`; app section with flexible per-week entries (day/time/address/conductor/topic/link) |
| 2026-05-21 | Feature C | **Cleaning** shipped: `CleaningAssignment` (after_meeting / thorough / general slots) gated by `cleaning_coordinator`; app section assigns service groups (overseer shown), general-cleaning marker. Schedule screen now stacks program · duties · field-service · cleaning |
| 2026-05-22 | Feature D | **Cart Witnessing** shipped: `CartShift` + `CartShiftParticipant` (max 4, migration 1786) gated by `public_witnessing`; new "Carts" tab, date-grouped shifts, participant chips, new public_witnessing capability. **All Schedule features (A/B/C/D) complete** |
| 2026-05-23 | group roles | Group leader labels renamed to "Ответственный за группу" / "Помощник группы" |
| 2026-05-23 | group membership | Add/move/remove members from the group screen; overseer + assistant auto-added as members (migration 1787 backfill), counted in the total; `addPublishers`/`removePublisher` endpoints (ADMIN/ELDER/MS) |
| 2026-05-23 | publishers list | Each publisher shows its service group (amber "Без группы"); client-side filter sheet (group/role/pioneer/gender/status) |
| 2026-05-23 | program groups | Phase 2: each assigned publisher's service group shown under their name in the program |
| 2026-05-23 | departure tracking | "Mark as departed" (reason + date + destination); departed sink to the end of the list with a reason badge, a "congregation standing" filter, excluded from the count; Restore removed |
| 2026-05-23 | permanent delete | Admin-only `DELETE /publishers/:id`, blocked when the publisher has history (reports / assignments / duties / field-service) |
| 2026-05-23 | apply-yourself skill | Picker derives the ministry skill (and required capability) from the part title instead of its position; picker shows the capability name, not the raw key |

---

## Working agreements

- **No deletion of structural schedule parts.** Program parts come from MWB EPUB import (or "Create empty midweek/weekend" templates) and are permanent. Users can change or clear the assigned publisher — they cannot remove the slot itself.
- **`synchronize: false` in TypeORM.** All schema changes go through manual migrations under `src/migrations/`.
- **Conventional commits in English.** `feat: …`, `fix: …`, `refactor: …`, `chore: …`.
- **Client-side architecture:** Expo file-based routing; nested route hierarchy mirrors UX structure (e.g. `/publishers/families/*`).
- **No religious source material checked in.** EPUBs and MWB/WT content are imported at runtime by congregations themselves; not bundled with the app.

---

This roadmap is a living document. Update phase history as work ships and revise the architecture-doc status table accordingly.
