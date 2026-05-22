# HANDOFF 2026-05-22 — Feature D (Cart Witnessing) + Schedule epic complete

## Feature D — Служение с тележками (Cart Witnessing)  ✅
Server `86fc091`, app `ff6f293`. The last of the four Schedule features.

### Server `src/cart-shifts/`
- `CartShift` (date, startTime/endTime "HH:MM", location) + `CartShiftParticipant`
  (unique per shift+publisher, cascade FKs). Migration `1786000000000`.
- Service: list (optional `from`/`to` date range, ordered by date/time),
  create/update/remove shift, add/remove participant. **Hard cap of 4**
  (`CART_MAX_PARTICIPANTS`); add is idempotent. Min 2 is NOT enforced server-side
  (UI warning only).
- Controller `/cart-shifts`: GET open to the congregation; create/update/delete
  + participant add/remove gated by `ResponsibilityGuard` + `public_witnessing`.
- 9 service tests → server now **355 tests / 27 suites / 11 migrations**.

### App `app/(app)/cart/`
- New bottom tab **"Тележки"** between Service Groups and Reports
  (`app/(app)/_layout.tsx`). Stack layout + single `index.tsx` screen.
- Screen: shifts grouped by date; each card shows time, location and participant
  chips with an N/4 badge (green at 2-4, amber + "Нужно минимум 2" under 2).
- Coordinator (`public_witnessing`/admin) creates/edits/deletes shifts (inline
  modal: date `YYYY-MM-DD`, start/end `HH:MM`, location) and adds/removes
  participants. Add uses `PublisherSelector` with
  `requiredCapability="public_witnessing"`; the 5th add is blocked ("Максимум 4").
- `cartShiftsApi` + types in `lib/api.ts`. i18n `cart.*` + `tabs.cart` (ru/en/de)
  → app at **678 i18n keys**.

### New capability
- `lib/capabilities.ts`: new category **"public_witnessing"** (after hospitality,
  single key, mirrors hospitality). i18n `capabilities.categories/items.public_witnessing`.
- Capabilities are app-side jsonb on the publisher — no server change.
- **Bulk-enabled for all 90 publishers** via SQL on 2026-05-22:
  `UPDATE publishers SET capabilities = COALESCE(capabilities,'{}'::jsonb) || jsonb_build_object('public_witnessing', true);`
  (Per-publisher toggle remains available in the Publishers UI.)

## Milestone
**The Schedule epic is fully shipped: A (Duties) · B (Field Service Meetings) ·
C (Cleaning) · D (Cart Witnessing), all in production with per-feature
ResponsibilityGuard gating.**

## Deferred / follow-ups (for a later session)
1. **Cart self-sign-up** — let publishers sign themselves into shifts. Needs a
   `user ↔ publisher` link and a publisher-facing shift list. Lionel wants to
   first settle the duties/user-management model, so this is a dedicated session.
2. **Native date/time pickers** for the cart shift form (currently text inputs
   `YYYY-MM-DD` / `HH:MM`). Polish.
3. The cleaning `suggestedAfterMeetingGroupId` server hint is still computed but
   unused in the UI (could be removed or revived).

## Remaining backlog (unchanged priorities)
1. **Off-site encrypted backups** (CRITICAL) — needs a Hetzner Storage Box.
2. **EN/DE EPUB parser** (~0.5-1 day) — `detectSection` is RU-only.
3. Roles L3/L4; apply `ResponsibilityGuard` to Schedule program endpoints.
4. Quick win: Service Group assistant display bug (unverified).
