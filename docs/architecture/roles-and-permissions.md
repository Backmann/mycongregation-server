# Roles and Permissions Architecture

**Status:** Design (not yet fully implemented in code).
**Last updated:** 2026-05-13.
**Owner:** @Backmann.

## Goals

`mycongregation` manages access control for users with diverse roles in a
Jehovah's Witnesses congregation: administrators, elders (старейшины),
ministerial servants (помощники собрания), baptized publishers (возвещатели),
and unbaptized publishers. Different users have very different needs and
sensitivities.

This document defines the canonical permission model that all backend
authorization logic and frontend conditional rendering must follow.

## Guiding Principles

1. **Principle of Least Privilege.** By default, a logged-in user can do
   nothing beyond viewing their own data. Privileges are added explicitly.
2. **Defense in Depth.** Every protected action is enforced on the server
   (the source of truth) AND on the client (UX). The client never assumes
   its check is sufficient.
3. **Role is not Appointment.** `UserRole` (system login) and
   `PublisherAppointment` (theocratic appointment) are independent concepts.
4. **Multi-tenant by default.** Every entity carries `congregationId`. All
   queries are scoped automatically. A user cannot see data from another
   congregation.
5. **Sub-roles via flexible structures.** `UserRole` stays small. Specialized
   responsibilities live in a separate `Responsibility` table that grows
   without schema migrations.

## The 3-Layer Permission Model

Authorization decisions combine three independent layers:

- **Layer 1: Base Role.** Hard enum on `User.role`.
- **Layer 2: Responsibilities.** Department coordinator assignments stored
  in a `Responsibility` table.
- **Layer 3: Per-Person Approvals.** Assignment eligibility flags on the
  `Publisher` entity.

## Layer 1: Base Role (UserRole)

Stored on `User.role`. Granted at user creation or by an admin.

| Role | Description | Typical holder |
|------|-------------|----------------|
| `admin` | Full system access. | System owner (one per congregation). |
| `elder` | Pastoral authority. Can hold any responsibility. | Appointed elders. |
| `ministerial_servant` | Limited admin. Some responsibilities by approval. | Appointed MS. |
| `publisher` | Self-service only by default. | All other baptized members. |

Unbaptized publishers share the `publisher` role and are distinguished by
`Publisher.appointment = 'unbaptized_publisher'`.

## Layer 2: Responsibilities

Schema:

    class Responsibility {
      id: string
      congregationId: string
      type: ResponsibilityType
      userId: string
      assignedAt: Date
      assignedBy: string
      // UNIQUE(congregationId, type)
    }

Initial type enumeration:

| Type | Russian equivalent | Notes |
|------|--------------------|-------|
| `body_coordinator` | Координатор совета старейшин | Also weekend meeting in this congregation |
| `life_ministry_overseer` | Руководитель встречи «Жизнь и служение» | Midweek meeting program |
| `wt_study_conductor` | Руководитель изучения СБ | Weekend Watchtower Study |
| `wt_study_conductor_backup` | (Заместитель руководителя СБ) | Backup for absences |
| `public_talk_coordinator` | Ответственный за публичные речи | Invites speakers, manages exchanges |
| `adviser` | Брат, дающий советы | Private feedback. May rotate yearly. |
| `secretary` | Секретарь | S-21 records, transfers |
| `service_overseer` | Координатор полевого служения | Field ministry organization |
| `accounts_servant` | Счетовод | Congregation finances |
| `public_witnessing` | Публичное свидетельствование | Carts, displays |
| `cleaning_coordinator` | Координатор уборки | Kingdom Hall cleaning rotation |

The `service_committee` is a subset of elders (typically 3) handling
sensitive decisions: pioneer applications, wedding and funeral approvals.

## Layer 3: Per-Person Approvals

Stored on `Publisher` because eligibility tracks the person regardless of
whether they have a system login.

    interface PublisherApprovals {
      conductCbs: boolean
      conductWatchtower: boolean
      chairMidweekMeeting: boolean
      chairWeekendMeeting: boolean
      givePublicTalk: boolean
      giveSpecialTalk: boolean
      serveAsReader: boolean
      makePublicPrayer: boolean
      registerMarriage: boolean
      beAuxiliarySpeaker: boolean
    }

Approvals are granted by the body of elders through the admin UI. Each
grant or revocation is audit-logged.

## Permission Matrix

This is the authoritative reference. Server guards and UI conditional
rendering must match.

### Publishers (people directory)

| Action | admin | elder | MS | publisher | unbaptized |
|--------|:-----:|:-----:|:--:|:---------:|:----------:|
| View list (name and group only) | yes | yes | yes | yes | yes |
| View contact details, address | yes | yes | limited | self only | self only |
| Create new publisher | yes | yes | no | no | no |
| Change appointments, pioneer status | yes | yes | no | no | no |
| Self-edit own name, DOB, family | yes | yes | yes | yes | yes |
| Soft-delete (move, disfellowship, death) | yes | yes | no | no | no |
| View sensitive flags (removal reasons) | yes | yes | no | no | no |

### Assignments and Schedule

| Action | admin | life_ministry_overseer | body_coordinator | other elders | MS, publisher |
|--------|:-----:|:----------------------:|:----------------:|:------------:|:-------------:|
| View full schedule | yes | yes | yes | yes | yes |
| View own assignments | yes | yes | yes | yes | yes |
| Create or edit midweek assignment | yes | yes | no | no | no |
| Create or edit weekend assignment | yes | no | yes | no | no |
| Import midweek EPUB (MWB) | yes | yes | no | no | no |
| Import weekend EPUB (Watchtower) | yes | no | yes | no | no |
| Decline an assignment | yes | yes | yes | yes | yes |

### Users (system accounts)

| Action | admin | elder + secretary | other elders | MS, publisher |
|--------|:-----:|:-----------------:|:------------:|:-------------:|
| View user list | yes | yes | no | no |
| Invite new user | yes | yes | no | no |
| Change another user's role | yes | no | no | no |
| Deactivate account | yes | yes | no | no |
| Reset another user's password | yes | yes | no | no |
| Change own password | yes | yes | yes | yes |

### Departments (cleaning, public witnessing, etc.)

| Action | admin | matching coordinator | other elders |
|--------|:-----:|:--------------------:|:------------:|
| View department schedule | yes | yes | yes |
| Edit department schedule (own area only) | yes | yes | no |

## Enforcement Strategy

### Server-side (source of truth)

NestJS Guards combined with custom decorators:

    @Roles('admin', 'elder')
    @RequireResponsibility('life_ministry_overseer')
    @Post('schedule/import-midweek')
    async importMidweek() { ... }

`RolesGuard` reads `@Roles()` and rejects requests where the user's
`UserRole` is not listed. `ResponsibilityGuard` reads
`@RequireResponsibility()` and verifies the user holds the named
responsibility in their congregation. Both must pass.

`@Public()` (already in code) bypasses all guards for endpoints like
login, register, refresh.

All queries are filtered by `congregationId` from the JWT payload. There
is no global view-all mode.

### Client-side (UX only)

A `usePermissions` hook computes derived booleans from the auth context
and the user's responsibilities (loaded once on app boot):

    const { canEditMidweekSchedule, canManageUsers } = usePermissions();
    {canEditMidweekSchedule && <ImportButton />}

The server remains authoritative; the client check is purely for UX.

## Special Cases

- **Unbaptized publishers.** Eligible for Bible Reading (if male) and
  Apply Yourself to the Ministry. Not eligible for CBS, public prayer,
  or any kind of talk.
- **Self-service edits.** Any publisher can edit own first/last name,
  date of birth, date of baptism, and family composition. All such
  edits produce audit log entries.
- **MS with elder-level approvals** (S-38 §16). In congregations with
  few elders, an MS may be approved to conduct CBS or chair the Life
  and Ministry meeting via Layer 3 approvals.
- **Circuit Overseer.** Not a user in this system. Belongs to his
  circuit. His visit affects scheduling (see meeting-schedules.md),
  not authorization.

## Implementation Phases

| Phase | Scope | Estimated effort |
|-------|-------|------------------|
| 1 | `@Roles` guard for admin-only critical endpoints (import, user creation, role changes). | 45 min |
| 2 | `Responsibility` table + admin UI for assigning responsibilities. `@RequireResponsibility` guard. | 2 to 3 hours |
| 3 | `PublisherApprovals` fields + admin UI for granting. Use in assignment eligibility filters. | 1 to 2 hours |
| 4 | Client-side `usePermissions` hook + conditional rendering across screens. | 1 to 2 hours |
| 5 | Self-service publisher edit with audit log. | 1 hour |

Each phase is independently shippable. Phase 1 alone provides meaningful
production protection.

## Glossary

| Russian or JW term | English or system term |
|--------------------|------------------------|
| Старейшина | Elder (`UserRole.elder`) |
| Помощник собрания | Ministerial Servant (`UserRole.ministerial_servant`) |
| Возвещатель | Publisher (`UserRole.publisher`) |
| Некрещёный возвещатель | Unbaptized publisher (`Publisher.appointment`) |
| Совет старейшин | Body of elders |
| Координатор совета старейшин | Body Coordinator |
| Руководитель встречи «Жизнь и служение» | Life Ministry Overseer |
| Брат, дающий советы | Adviser |
| Изучение Библии в собрании (ИБС) | Congregation Bible Study (CBS) |
| Изучение «Сторожевой башни» | Watchtower Study |
| Служебный комитет | Service Committee |
| Районный старейшина | Circuit Overseer |
| Группа служения | Service Group |
