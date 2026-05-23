# HANDOFF 2026-05-23 — Group membership, Publishers label & filter

Covers work after Feature D, plus a docs catch-up (docs-update-3 had only
partially applied — ROADMAP was left at the B/C state and BACKLOG's Feature D
banner/graph/scope were not marked; docs-update-4 reconciles everything).

## Group leader rename  (app `faff574`-era)
Group leader labels renamed: overseer → "Ответственный за группу", assistant →
"Помощник группы" (i18n `serviceGroups.overseer` / `.assistant`, all three
languages). Label key unchanged, so the wording updates everywhere.

## Group membership  ✅ (server `069feb3`, app `dd9b1d4`)
Manage a group's roster from the group screen.
- **Server**: `PublishersService.setServiceGroupBulk` / `removeFromGroup`;
  `ServiceGroupsService.addPublishers` / `removePublisher`. A group's overseer
  and assistant are auto-added as members on create/update. Endpoints
  `POST /service-groups/:id/publishers` and
  `DELETE /service-groups/:id/publishers/:publisherId` (ADMIN/ELDER/MS).
  `AddGroupMembersDto`. Migration `1787000000000` backfills existing
  overseers/assistants into the group they lead. One group per publisher
  (`Publisher.serviceGroupId`), so adding moves them out of any previous group.
  Server now **359 tests / 27 suites / 12 migrations**.
- **App**: group detail screen — "+ Добавить участников" opens a multi-select of
  all publishers (each shows its current group, allowing reassignment); non-leader
  members have a remove ✕ (with confirm); overseer/assistant show a role badge and
  are counted. `serviceGroupsApi.addPublishers` / `removePublisher`.

## Publishers: group label + filter  ✅ (app `cfe6830` / `faff574`)
- Each publisher row shows its service group (`👥 Ahlen`) or `👥 Без группы` in
  amber, in both the list and by-family views. Group name resolved client-side
  from the groups list (no server change). Reuses `serviceGroups.noGroup`.
- New client-side filter sheet (over the loaded list of ≤200): group (incl.
  no-group) · role · pioneer · gender · status; active-filter count badge on the
  toolbar; reset. i18n `publishers.filter.*`. App now **701 i18n keys**.

## Design decisions
- Membership cardinality: strictly one group per publisher (confirmed).
- Leaders are members of the group they lead (count + roster include them).
- Add-members shows ALL publishers with current-group marker; reassignment
  (including of leaders) is allowed.
- Filtering is client-side because the list loads in one page (limit 200 ≥ 92
  publishers); the server already supports group/appointment/pioneer/isActive
  filters if the list ever outgrows that.

## Next / follow-ups
1. **Phase 2 — show a publisher's group in the program/schedule** (chosen next).
   Needs a recon of the schedule screen to decide placement.
2. **Native date/time pickers** for cart shifts (currently text inputs). Polish.
3. **Cart self-sign-up** + user↔publisher link (deferred, dedicated session).

## Remaining backlog (unchanged)
- **Off-site encrypted backups** (CRITICAL) — needs a Hetzner Storage Box.
- **EN/DE EPUB parser** (~0.5-1 day) — `detectSection` is RU-only.
- Service Group assistant display bug (quick win, unverified).
