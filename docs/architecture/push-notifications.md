# Push notifications

**Status:** ✅ **Implemented** (Phases G + G.2 + M, shipped May 2026)
**Last updated:** 2026-05-17

End-to-end dual-channel push pipeline for status-change notifications.
Native Android/iOS clients are reached via Expo Push API (with 2-phase
ticket/receipt flow + stale-token cleanup). PWA browser clients are reached
via Web Push protocol (synchronous send + HTTP-code-based cleanup).
A single call to `PushNotificationsService.sendStatusChange` fans out to
both channels with shared localization.

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

`PushNotificationsService.sendStatusChange(tenant, publisher, before, after, excludeUserId?)`
orchestrates delivery to both channels in one pass:

1. Fetch all `push_tokens` (Expo native) **and** `web_push_subscriptions`
   (PWA browsers) for the tenant in parallel. Excludes the actor if
   `excludeUserId` is passed.
2. Short-circuit if both lists are empty.
3. Look up `user.uiLanguage` for the union of unique recipient user ids via
   a single `In(...)` query; build a shared `langByUserId` map.
4. Group both `push_tokens` and `web_push_subscriptions` by language.
5. **Expo branch** (per language): build localized title/body via
   `PUSH_STRINGS[lang]` + `translateStatus()`, call `sendBatch(...)`
   which filters invalid tokens, chunks, and calls
   `expo.sendPushNotificationsAsync`. For each `status: 'ok'` ticket,
   insert a row in `push_receipts` (`status='pending'`) for the
   receipt-check cron to follow up. Immediate failures (no ticket id) are
   logged but not persisted.
6. **Web Push branch** (per language): same localized payload, fanned out
   to subscriptions via `Promise.all(langSubs.map(s =>
   WebPushService.sendToSubscription(s, payload)))`. The push service
   responds synchronously with an HTTP code that drives inline cleanup —
   no separate poll phase needed.

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

## Web Push response handling

Unlike Expo, Web Push is single-phase: the HTTP response from the push
service tells us the outcome immediately, so there is no separate poll
step. `WebPushService.sendToSubscription` reacts inline:

| HTTP code | `errorCode` returned | Action |
|---|---|---|
| 201 Created | `null` (ok) | Update `last_used_at`, clear `last_failed_at` |
| 410 Gone / 404 Not Found | `SubscriptionGone` | Delete the row (parallel to Expo's `DeviceNotRegistered`) |
| 413 Payload Too Large | `MessageTooBig` | Log + record `last_failed_at` |
| 429 Too Many Requests | `MessageRateExceeded` | Log + record `last_failed_at` |
| 5xx | `PushServiceError` | Log + record `last_failed_at` |
| other | `SendError` | Log + record `last_failed_at` |

The client-side Service Worker (`public/service-worker.js` in the app repo)
listens for `push` events, renders the payload as a system notification,
and routes click events back into the PWA (focusing the existing tab if open,
otherwise opening a new one to the relevant route).

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

- **Per-user notification preferences** — e.g. opt out of status-change
  pushes while keeping schedule reminders. Would require a new
  `user_notification_prefs` table or jsonb on `users`.
- **Per-tenant rate limiting** — currently we rely on Expo's
  `MessageRateExceeded` and Web Push's 429 surfacing through normal flow.
  A proactive token-bucket per tenant would catch runaway loops earlier.
- **Receipt aggregation / metrics** — push success/failure dashboards for
  ops visibility. Now that both channels persist receipt-like state
  (`push_receipts` for Expo; `last_used_at` / `last_failed_at` on web subs),
  building a per-tenant delivery health view is feasible.
