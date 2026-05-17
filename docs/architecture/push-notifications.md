# Push notifications

**Status:** ✅ **Implemented** (Phases G + G.2, shipped May 2026)
**Last updated:** 2026-05-17

End-to-end push pipeline for status-change notifications, including ticket
persistence, receipt processing, and stale-token cleanup. Currently targets
Android and iOS clients via Expo Push API; PWA Web Push is the next phase
(see ROADMAP medium-term item 1).

---

## Data model

### `push_tokens`

One row per (user, device) pair. Created on app registration, deleted when:

- The user explicitly unregisters (e.g. logs out)
- Expo returns `DeviceNotRegistered` for any receipt referencing this token
  (the user uninstalled the app, revoked notification permission, etc.)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → users |
| `congregation_id` | UUID | denormalised for fast tenant-scoped queries |
| `role` | enum | `admin` / `elder` / `ministerial_servant` / `publisher` |
| `token` | varchar(255) | Expo `ExponentPushToken[…]` |
| `device_info` | jsonb | optional client metadata |

### `push_receipts`

One row per ticket returned by `sendPushNotificationsAsync`. Lifecycle:
`pending` → (`ok` | `error`). Used by the receipt-check cron to update
status and to drive stale-token cleanup.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `ticket_id` | varchar(255) | UNIQUE; the id Expo returns for successful tickets |
| `token` | varchar(255) | Expo push token at send time |
| `user_id` | UUID | for filtering / cleanup |
| `congregation_id` | UUID | for filtering / cleanup |
| `status` | varchar(20) | `pending` / `ok` / `error` |
| `error_code` | varchar(64) | e.g. `DeviceNotRegistered`, `MessageRateExceeded` |
| `sent_at` | timestamptz | when we sent the message |
| `checked_at` | timestamptz | when we last polled Expo for the receipt |
| `created_at` | timestamptz | row creation |

Indexes: `(status, sent_at)`, `(token)`, `(congregation_id)`.

**No FK to `push_tokens`** — receipts survive token deletion, so we can audit
`DeviceNotRegistered` events even after the cleanup that they triggered.

---

## Send flow

`PushNotificationsService.sendStatusChange(tenant, publisher, before, after, actorUserId?)`:

1. Fetch all `push_tokens` for the tenant. Excludes the actor if
   `actorUserId` is passed (so a user is not notified about their own
   action).
2. Look up `user.uiLanguage` for each recipient via a single `In(...)`
   query; group tokens by language.
3. Per language batch, build a localized title/body using
   `PUSH_STRINGS[lang]` and `translateStatus()` from
   `common/i18n/push-strings.ts`.
4. Call `sendBatch(tokens, title, body, data)` which:
   - filters out invalid Expo tokens (recorded as immediate
     `InvalidExpoPushToken` errors)
   - chunks valid tokens and calls `expo.sendPushNotificationsAsync(chunk)`
   - returns one `SendBatchResult` per input token in order:
     `{ token, ticketId, errorCode }`
5. For each successful ticket (`ticketId !== null`), insert a row into
   `push_receipts` with `status = 'pending'`. Immediate failures (no ticket
   id) are logged but not persisted — there is nothing to poll later.

---

## Receipt processing

`PushNotificationsService.checkReceipts()` is invoked by a cron every 30
minutes.

1. Fetch up to 1000 receipts where
   `status = 'pending' AND sent_at < now − 15 min`. (Expo requires waiting
   at least 15 minutes after send before polling.)
2. Chunk the ticket ids and call
   `expo.getPushNotificationReceiptsAsync(chunk)`.
3. For each ticket id in the chunk:
   - **Receipt missing** → leave as pending; will retry next run.
   - **`status = 'ok'`** → set `status = 'ok'`, `checked_at = now`.
   - **`status = 'error'`** → set `status = 'error'`, store
     `details.error` in `error_code`. If the error is
     `DeviceNotRegistered`, schedule the token for deletion at the end of
     the run.
4. Persist all updated receipts (single bulk `.save`).
5. Delete affected push tokens (single `IN (...)` delete).
6. Network errors from Expo are caught at the chunk level — the chunk is
   skipped, those receipts stay pending, the run continues with other
   chunks.

---

## Cleanup

`PushNotificationsService.cleanupOldReceipts()` deletes receipts older than
7 days regardless of status. Runs daily at 03:30 UTC.

Rationale: Expo retains receipt data for only ~24 hours, so any row that has
not transitioned out of `pending` after a week is effectively orphaned and
not useful to keep. 7 days gives enough headroom to investigate recent
delivery failures before discarding.

---

## Crons

All registered in `ScheduledJobsService` via NestJS `@Cron`:

| Name | Schedule | Method |
|---|---|---|
| `status-recompute-nightly` | 03:00 UTC daily | publishers' nightly status recompute |
| `push-receipt-check` | `*/30 * * * *` UTC | `checkReceipts()` |
| `push-receipt-cleanup` | 03:30 UTC daily | `cleanupOldReceipts()` |

NestJS Schedule prevents overlapping ticks per cron automatically. The
single-container deploy means no extra distributed lock is needed.

---

## Localization

Push notification bodies are rendered in the recipient's `uiLanguage`. The
canonical `PUSH_STRINGS` map and `translateStatus()` live in
`src/common/i18n/push-strings.ts` and cover the three supported languages:
Russian, English, German.

When a recipient has no `uiLanguage` set (legacy users), the system falls
back to `DEFAULT_LANGUAGE` from `common/i18n/supported-languages.ts`
(currently `ru`).

---

## Future

- **Phase M — Web Push** for PWA users: Service Worker + VAPID keys, dual
  send pipeline (Expo for native, Web Push for browser). Separate
  `web_push_subscriptions` table; the receipt model can stay similar in
  shape, but Web Push receipts work differently (synchronous 4xx/5xx from
  the push service, no separate poll phase). Likely a parallel
  `web_push_receipts` table or a discriminator column.
- **Per-user notification preferences** — e.g. opt out of status-change
  pushes while keeping schedule reminders. Would require a new
  `user_notification_prefs` table or jsonb on `users`.
- **Per-tenant rate limiting** — currently we rely on Expo's
  `MessageRateExceeded` surfacing through the receipt flow. A proactive
  token-bucket per tenant would catch runaway loops earlier.
