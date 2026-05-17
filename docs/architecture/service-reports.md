# Service Reports Architecture

**Status:** ✅ Implemented (Phases A2.3–H, shipped May 2026).
**Last updated:** 2026-05-16.
**Owner:** @Backmann.

## Goals

`mycongregation` tracks monthly ministry activity for every publisher in
a congregation. The Service Reports subsystem enables:

- Self-submission of monthly reports by individual publishers
- Submission on-behalf by the secretary for publishers without a login
- Automatic calculation of publisher status (active, irregular, inactive)
- Pioneer hour tracking with quota awareness
- Annual reviews surfaced as dashboard prompts
- Easy export of aggregated data for branch reporting (manually copied
  into JW Hub by the secretary)

This document is the canonical reference for all data shapes, workflows,
and permission rules in this subsystem.

## Guiding Principles

1. **Two distinct report shapes.** Regular publishers and pioneers fill
   different forms. The system selects the form based on the publisher's
   pioneer status at the report month.
2. **Self-submission first, secretary on behalf as fallback.** Publishers
   own their reports. The secretary submits on behalf only when a publisher
   has no login or cannot do it themselves.
3. **Edits route by role and timing.** A publisher may self-edit their
   own report during the **self-edit window** — the 1st through 10th
   of the month following the report month (inclusive). After the
   window closes, only the secretary may edit. Every edit (self or
   secretary) stamps `lastEditedAt` and `lastEditedBy`; secretary
   edits additionally write a full `AuditLog` entry with before/after
   diff (Phase C).
4. **Status is derived, not stored authoritatively.** A daily background
   job computes and caches each publisher's status (active, irregular,
   inactive) from their reporting pattern. The secretary may override the
   auto-computed value with a manual flag.
5. **Inactive does not lock the form.** Even publishers inactive for years
   can submit again at any time — the act of submitting starts their
   reactivation path automatically.
6. **JW service year is the aggregation unit.** Annual totals run from
   September 1 to August 31 — not January to December.

## Domain Model

### Two report shapes

The form a publisher sees depends on their pioneer status as of the
report month.

**Regular publisher / unbaptized publisher form:**

| Field | Type | Note |
|-------|------|------|
| servedThisMonth | boolean | Did you preach at least once this month? |
| bibleStudies | integer | Number of progressive Bible studies conducted |
| notes | string | Optional free text |

There is no required hours field — whether the publisher served or not
is captured as a boolean.

**Pioneer form (regular, auxiliary, special, or missionary):**

| Field | Type | Note |
|-------|------|------|
| hours | integer | Specific hours preached this month (required) |
| bibleStudies | integer | Number of progressive Bible studies conducted |
| notes | string | Optional free text. For Phase A, pioneers describe theocratic-assignment hours here. Phase D will add a structured `hourCredits` field. |

The system selects the form by checking pioneer status at the END of
the report month. If pioneer status changed mid-month (e.g. auxiliary
enrollment started April 15), April's report uses pioneer form.

### Publisher.status lifecycle

Every publisher carries a derived `status` field in one of three values:

| Status | Russian | Condition |
|--------|---------|-----------|
| `active` | Активный | Has reported positive activity in last 6 consecutive months |
| `irregular` | Нерегулярный | Some positive reports in last 6 months, with gaps |
| `inactive` | Неактивный | No positive report for 6 or more consecutive months |

"Positive report" means either:
- Regular publisher with `servedThisMonth = true`, OR
- Pioneer with `hours > 0`

The status is recomputed nightly by a background job (see Background Jobs
section). After the first deployment, every existing publisher defaults
to `active`; reporting patterns over the next 6 months produce accurate
statuses.

A secretary may manually override the auto-computed value. Override sets
`status` AND `statusManuallyOverridden = true`. The nightly job skips
publishers with `statusManuallyOverridden = true`; only a secretary can
clear the override.

### AuxiliaryPioneerEnrollment

Auxiliary pioneer service is enrolled in chunks. A publisher may have
multiple enrollment records across their lifetime.

Schema:

    class AuxiliaryPioneerEnrollment {
      id: string                       // UUID
      congregationId: string           // multi-tenant
      publisherId: string              // who is enrolling
      hourQuota: 15 | 30               // monthly target
      startMonth: string               // ISO YYYY-MM, e.g. "2026-04"
      endMonth: string | null          // null = open-ended (until cancelled)
      status: 'active' | 'completed' | 'cancelled'
      approvedBy: string               // User id (service committee member)
      approvedAt: Date
      cancelledBy: string | null
      cancelledAt: Date | null
      cancellationReason: string | null
    }

Common patterns:

- "April only" — single enrollment, startMonth = endMonth = "2026-04"
- "March through May" — single enrollment, startMonth = "2026-03", endMonth = "2026-05"
- "Until cancelled" — single enrollment, endMonth = null, status = 'active'
- "April and September" (non-contiguous) — two separate enrollments

Query to check if publisher X is an auxiliary pioneer for month Y:

    SELECT * FROM auxiliary_pioneer_enrollment
    WHERE publisherId = X
      AND status = 'active'
      AND startMonth <= Y
      AND (endMonth IS NULL OR endMonth >= Y)

### ServiceReport entity

The core record. One per publisher per month.

    class ServiceReport {
      id: string                       // UUID
      congregationId: string           // multi-tenant scope
      publisherId: string              // who served
      reportMonth: string              // ISO YYYY-MM, e.g. "2026-05"
      
      // Form fields
      servedThisMonth: boolean | null  // regular publisher form only
      hours: number | null             // pioneer form only (required for pioneers)
      bibleStudies: number             // both forms
      notes: string | null             // both forms
      
      // Submission metadata
      submittedAt: Date
      submittedBy: string              // User id of who clicked submit
      submittedOnBehalfOf: string | null  // publisher id if secretary submitted
                                          // on someone else's behalf
      
      // Edit metadata
      lastEditedAt: Date | null
      lastEditedBy: string | null      // User id (must be secretary or admin)
      
      // UNIQUE(congregationId, publisherId, reportMonth)
    }

Only ONE report per publisher per month. A second submission for the same
month is rejected with a clear error — corrections go through the
secretary's edit flow.

## Privacy and Permissions

Server-side guards enforce these rules; client-side rendering reflects them.

| Action | self | group overseer | secretary | other elders | admin | other MS / publishers |
|--------|:----:|:--------------:|:---------:|:------------:|:-----:|:---------------------:|
| Submit own report | yes | yes | yes | yes | yes | yes |
| View own historical reports | yes | yes | yes | yes | yes | yes |
| Submit on behalf of another publisher | no | no | yes | no | yes | no |
| Edit own report (within self-edit window) | yes | yes | yes | yes | yes | n/a |
| Edit any report (outside window or someone else's) | no | no | yes | no | yes | no |
| View own service group's reports | yes | yes | yes | yes | yes | no |
| View all congregation reports | no | no | yes | yes | yes | no |
| Manually override publisher status | no | no | yes | no | yes | no |
| Approve auxiliary pioneer enrollment | no | no | yes | yes | yes | no |

Service group overseer is identified by `ServiceGroup.overseerId = User.id`.
A group overseer who is also an elder sees all reports (as elder).

## Workflows

### Submit own report (self-service)

1. Publisher opens `/service-reports/new` or clicks a dashboard banner.
2. System detects the publisher's pioneer status for the report month.
3. The correct form renders (regular vs pioneer shape).
4. Publisher fills the form and clicks submit.
5. `ServiceReport` row is created with `submittedBy = self`, `submittedOnBehalfOf = null`.

If a report for the same publisher and month already exists:

- **Within the self-edit window** (today is the 1st-10th of the month
  following `reportMonth`): the form shows current values pre-filled
  and editable. Submitting issues PATCH to update the existing report;
  `lastEditedAt` and `lastEditedBy` are stamped. The `reportMonth`
  field is locked.
- **After the self-edit window**: the form shows existing data
  read-only plus a notice: "Contact secretary to edit."

### Self-edit own report (within window)

The self-edit window is open from the 1st to the 10th (inclusive) of
the month following the report month. For example, an April 2026
report (`reportMonth = "2026-04"`) can be self-edited from May 1
through May 10 2026; on May 11 the window closes.

Window check (server-side):

    const reportDate = new Date(report.reportMonth + '-01');
    const windowEnd = new Date(
      reportDate.getFullYear(),
      reportDate.getMonth() + 1,
      11,                                   // 11th of next month
    );                                      // half-open: < windowEnd
    const isInWindow = new Date() < windowEnd;

GET endpoints that return a report include a derived boolean
`canEdit`:

    canEdit = isSecretaryOrAdmin
           || (isOwnReport && isInWindow)

The mobile/web client uses `canEdit` to show or hide the edit
button. The PATCH endpoint re-verifies the same logic server-side;
the boolean in the response is a hint, not authority.

Duplicate prevention: when a publisher opens the create form, the
month picker greys out months that already have a report. To correct
an existing month, the publisher uses the edit flow (if within window)
or contacts the secretary.

### Submit on behalf (secretary)

1. Secretary opens `/admin/service-reports/new`.
2. Picks publisher from a list filtered to own congregation.
3. Picks report month.
4. Form renders with the shape matching that publisher's pioneer status
   for that month.
5. Submits — row is created with `submittedBy = secretary's User.id`,
   `submittedOnBehalfOf = the publisher's id`.

### Edit any report (secretary)

Used for edits OUTSIDE the self-edit window, or for reports submitted
by someone other than the secretary themselves.

1. Secretary opens any existing report.
2. Editable form with current values pre-filled.
3. Saves changes.
4. `lastEditedAt` and `lastEditedBy` updated. `AuditLog` entry created
   with full before/after diff (Phase C).

### Annual reviews (system-prompted)

On March 1 (regular pioneer mid-year review), a dashboard banner appears
for users with `secretary` or `service_overseer` responsibility:

> 14 общих пионеров требует обзора (среднее за год ниже 50ч/мес)

Clicking the banner opens a filtered list. Same flow runs September 1
(end of service year), checking full 600-hour annual norm completion.

## UX Patterns

### Gentle hints for pioneers behind on hours

Pioneer dashboards show a progress bar of cumulative service-year hours
vs target (600 for regular, hourQuota × months for auxiliary).

| Visual state | Trigger | Tone |
|--------------|---------|------|
| Green progress bar | At or ahead of pace | encouraging |
| Amber progress bar | Behind pace but within recovery | informational, no alarm |
| Red progress bar | Significantly behind (deficit > 1 month) | direct, helpful, no shame |

Wording: "На этот момент ты сделал 320 часов из 350 запланированных."
Never: "You are missing X hours!"

Pioneers with `pioneerType = 'regular' AND pioneerNoQuota = true` (50+
years, 15+ years service) see no progress bar — they have no target.

### Dashboard banners

For secretary and service overseer:

- March 1: "Annual pioneer review due — N pioneers need attention"
- September 1: "Service year end — pioneer compliance review due"
- Monthly: "N reports missing for last month (DD days remaining)"

For individual publishers and pioneers:

- First days of new month: "You have not yet submitted your [Month] report"

## Background Jobs

### Daily status computation

A NestJS scheduled job runs daily at 03:00 server time:

    @Cron('0 3 * * *')
    async recomputePublisherStatuses() {
      // For every publisher where statusManuallyOverridden = false:
      //   Compute status from last 6 months of reports
      //   Update Publisher.status if changed
    }

Cost is O(publishers × 6 months) — negligible for typical congregation
size (50-200 publishers).

### Reminder notifications

MVP uses in-app dashboard banner only. Real push or email notifications
are deferred until email/push infrastructure exists (post Phase E).

### Service year boundary

Service year runs September 1 to August 31. Aggregations and pioneer
quotas use this period, not calendar year. A service year is identified
in code by the calendar year of its ENDING month — for example, service
year `2026` runs September 1 2025 through August 31 2026.

## i18n Notes

This subsystem must work in Russian (`ru`), English (`en`), and German
(`de`) UI. Source-language program content (loaded from EPUB) is NOT
translated.

UI strings use the per-component `STR` dictionary pattern from `30sec.org`:

    const STR = {
      ru: { title: 'Месячный отчёт', save: 'Сохранить' },
      en: { title: 'Monthly report', save: 'Save' },
      de: { title: 'Monatsbericht', save: 'Speichern' },
    };

Status terms translate per UI language:

| code | ru | en | de |
|------|----|----|------|
| `active` | Активный | Active | Aktiv |
| `irregular` | Нерегулярный | Irregular | Unregelmäßig |
| `inactive` | Неактивный | Inactive | Inaktiv |

Pioneer terms:

| ru | en | de |
|------|------|------|
| Подсобный пионер | Auxiliary pioneer | Hilfspionier |
| Общий пионер | Regular pioneer | Allgemeiner Pionier |
| Специальный пионер | Special pioneer | Sonderpionier |
| Миссионер | Missionary | Missionar |

Date formatting uses `Intl.DateTimeFormat` with the user's UI locale.

## Implementation Phases

| Phase | Scope | Estimated effort |
|-------|-------|------------------|
| **A** | `ServiceReport` entity + migration. Self-submission for both regular and pioneer shapes. Self-edit within the 10-day window. Own history view with `canEdit` indicator. Duplicate-month prevention in the form. | 3-4 hours |
| **B** | Service group overseer view (own group's reports). Group aggregate on dashboard. | 1-1.5 hours |
| **C** | Secretary and service overseer views (all reports + filters). On-behalf submission. Edit flow for reports outside the self-edit window or submitted by others, with full `AuditLog` (before/after diff). Manual status override. | 2-3 hours |
| **D** | `AuxiliaryPioneerEnrollment` entity. Enrollment workflow (apply, approve, cancel). Hour-quota integration. Structured `hourCredits` field. | 3-4 hours |
| **E** | Pioneer cycle dashboard. March 1 and September 1 review banners. Service Year aggregations. Branch report export (CSV/PDF). | 2-3 hours |

Each phase is independently shippable. Phase A alone gives every publisher
the ability to submit monthly reports — a complete vertical slice.

## Open Questions

- **Q-OQ1.** Should pioneer enrollment approval be single-user (current
  draft) or multi-user service-committee consensus? Phase D refinement.
- **Q-OQ2.** How to handle "Special Circumstances" (per S-205 §8) where
  a regular pioneer is excused from the hour quota due to approved
  theocratic service? Phase D refinement.
- **Q-OQ3.** Annual review banners — should they be dismissible? By whom?
- **Q-OQ4.** Phase E reminders — push notifications, email, or both?
  Depends on whether email infrastructure is built first.
