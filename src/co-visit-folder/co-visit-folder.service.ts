import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { CoVisitFolder } from '../entities/co-visit-folder.entity';
import {
  CoVisitFolderMark,
  type FolderMarkState,
} from '../entities/co-visit-folder-mark.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Congregation } from '../entities/congregation.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { RemovalReason } from '../common/enums/removal-reason.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { refusal } from '../common/errors/refusal';
import { CongregationClock } from '../common/congregation-clock.service';
import {
  DEFAULT_CONGREGATION_TIMEZONE,
  todayIn,
} from '../common/congregation-clock';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import {
  ServiceReportsService,
  type S21DataResponse,
} from '../service-reports/service-reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  FOLDER_ITEMS,
  QUESTION_COUNT,
  addDays,
  answerAllowed,
  daysUntil,
  dueOn,
  eraseOn,
  gapsRemindOn,
  isReady,
  s62DueOn,
  s62RemindOn,
  type FolderItemDef,
  type FolderRole,
} from './folder-rules';
import { folderText, type FolderNews } from './folder-messages';

const VISIT = 'circuit_overseer_visit';

const ROLE_OF: Record<string, FolderRole> = {
  [ResponsibilityType.BODY_COORDINATOR]: 'coordinator',
  [ResponsibilityType.SECRETARY]: 'secretary',
  [ResponsibilityType.SERVICE_OVERSEER]: 'service_overseer',
};

/** Who sees what (decision 6, 17 November 2026). */
export interface FolderAccess {
  /** The coordinator, the secretary, the service overseer: everything. */
  full: boolean;
  /** Which of the three the caller is — none for another elder. */
  roles: FolderRole[];
}

export interface FolderItemView {
  key: string;
  section: 1 | 2 | 3;
  role: FolderRole;
  source: 'pdf' | 'manual';
  states: readonly FolderMarkState[];
  extra: boolean;
  state: FolderMarkState | null;
  markedAt: string | null;
  markedBy: string | null;
  /** A saved file no longer matches the data. */
  changed: boolean;
  ready: boolean;
  /** Fingerprint of the data now — sent back with «saved». */
  stamp: string | null;
  /** A number the line shows, by item (see facts in the service). */
  facts: Record<string, number | string | null>;
  /** 2.1 only: one line per service group. */
  groups?: Array<{
    key: string;
    groupId: string | null;
    name: string | null;
    people: number;
    state: FolderMarkState | null;
    markedAt: string | null;
    markedBy: string | null;
    changed: boolean;
    ready: boolean;
    stamp: string | null;
  }>;
}

/** md5 of rows, ignoring the columns that change without changing a file. */
function rowsStamp(from: string, drop: string[] = []): string {
  const minus = drop.length
    ? ` - ARRAY[${drop.map((d) => `'${d}'`).join(',')}]::text[]`
    : '';
  return `SELECT md5(coalesce(string_agg((to_jsonb(t)${minus})::text, '|' ORDER BY (to_jsonb(t)${minus})::text), '')) AS s FROM ${from}`;
}

@Injectable()
export class CoVisitFolderService {
  private readonly logger = new Logger(CoVisitFolderService.name);

  constructor(
    @InjectRepository(CoVisitFolder)
    private readonly folders: Repository<CoVisitFolder>,
    @InjectRepository(CoVisitFolderMark)
    private readonly marks: Repository<CoVisitFolderMark>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(ServiceGroup)
    private readonly groups: Repository<ServiceGroup>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly clock: CongregationClock,
    private readonly reports: ServiceReportsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // ---- who ---------------------------------------------------------------

  async accessOf(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<FolderAccess | null> {
    const held = await this.responsibilities.find({
      where: {
        congregationId: tenantId,
        userId: user.id,
        type: In(Object.keys(ROLE_OF) as ResponsibilityType[]),
      },
      select: { type: true },
    });
    const roles = [...new Set(held.map((r) => ROLE_OF[r.type]))];
    if (roles.length > 0) return { full: true, roles };
    // Another elder sees section 1 only — the coordinator's part, which
    // concerns the whole body (pastoral calls, lodging, meals).
    if (user.role === UserRole.ELDER) return { full: false, roles: [] };
    const card = await this.publishers.findOne({
      where: { congregationId: tenantId, userId: user.id },
      select: { id: true, appointment: true },
    });
    if (card?.appointment === PublisherAppointment.ELDER) {
      return { full: false, roles: [] };
    }
    return null;
  }

  private async assertAccess(
    tenantId: string,
    user: AuthenticatedUser,
    full = false,
  ): Promise<FolderAccess> {
    const access = await this.accessOf(tenantId, user);
    if (!access || (full && !access.full)) {
      throw new ForbiddenException(
        refusal(
          'FOLDER_NO_ACCESS',
          'The folder for the circuit overseer is for the coordinator of the body of elders, the secretary and the service overseer.',
        ),
      );
    }
    return access;
  }

  private async visit(
    tenantId: string,
    eventId: string,
  ): Promise<SpecialEvent> {
    const event = await this.events.findOne({
      where: { id: eventId, congregationId: tenantId },
    });
    if (!event || event.type !== VISIT) {
      throw new NotFoundException(
        refusal(
          'FOLDER_NOT_A_VISIT',
          'No circuit overseer visit with this id.',
        ),
      );
    }
    return event;
  }

  private async folderOf(
    tenantId: string,
    eventId: string,
  ): Promise<CoVisitFolder> {
    const found = await this.folders.findOne({
      where: { congregationId: tenantId, specialEventId: eventId },
    });
    if (found) return found;
    try {
      return await this.folders.save(
        this.folders.create({
          congregationId: tenantId,
          specialEventId: eventId,
          answers: null,
          filesDeleted: {},
        }),
      );
    } catch {
      // Two first taps at once: the other one made it.
      return this.folders.findOneOrFail({
        where: { congregationId: tenantId, specialEventId: eventId },
      });
    }
  }

  private async namesOf(
    tenantId: string,
    userIds: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const cards = await this.publishers.find({
      where: { congregationId: tenantId, userId: In(ids) },
      select: { userId: true, firstName: true, lastName: true },
      withDeleted: true,
    });
    for (const c of cards) {
      if (c.userId) out.set(c.userId, `${c.lastName} ${c.firstName}`.trim());
    }
    return out;
  }

  // ---- what the items rest on -------------------------------------------

  /** The two service years the folder shows: the visit's and the one before. */
  private yearsOf(event: SpecialEvent): { years: number[]; from: string } {
    const start = String(event.date).slice(0, 10);
    const [y, m] = start.split('-').map(Number);
    const sy = m >= 9 ? y + 1 : y;
    return { years: [sy - 1, sy], from: `${sy - 2}-09-01` };
  }

  private visitDays(event: SpecialEvent): string[] {
    const start = String(event.date).slice(0, 10);
    const end = event.endDate ? String(event.endDate).slice(0, 10) : start;
    const out: string[] = [];
    for (let d = start; d <= end && out.length < 14; d = addDays(d, 1)) {
      out.push(d);
    }
    return out;
  }

  /** The members a group's S-21 file holds: here today, not students. */
  private async groupMembers(
    tenantId: string,
    groupId: string | null,
  ): Promise<Publisher[]> {
    return this.publishers
      .find({
        where: {
          congregationId: tenantId,
          serviceGroupId: groupId === null ? IsNull() : groupId,
          removedAt: IsNull(),
        },
        order: { lastName: 'ASC', firstName: 'ASC' },
      })
      .then((rows) =>
        rows.filter((p) => p.appointment !== PublisherAppointment.STUDENT),
      );
  }

  private async groupsOf(
    tenantId: string,
  ): Promise<
    Array<{ id: string | null; name: string | null; people: number }>
  > {
    const groups = await this.groups.find({
      where: { congregationId: tenantId },
      order: { name: 'ASC' },
    });
    const out: Array<{
      id: string | null;
      name: string | null;
      people: number;
    }> = [];
    for (const g of groups) {
      out.push({
        id: g.id,
        name: g.name,
        people: (await this.groupMembers(tenantId, g.id)).length,
      });
    }
    const none = (await this.groupMembers(tenantId, null)).length;
    if (none > 0) out.push({ id: null, name: null, people: none });
    return out;
  }

  private async stamp(sql: string, params: unknown[]): Promise<string> {
    const rows: Array<{ s: string | null }> = await this.marks.query(
      sql,
      params,
    );
    return rows.map((r) => r.s ?? '').join(':');
  }

  /**
   * The fingerprint of each item's data. A file saved with one fingerprint
   * and the data now giving another is «изменилось — сохранить заново».
   * Columns that change without changing the file (links, reading marks,
   * timestamps) are left out.
   */
  private async stamps(
    tenantId: string,
    event: SpecialEvent,
    keys: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const e = event.id;
    const { from } = this.yearsOf(event);
    const days = this.visitDays(event);
    const first = days[0];
    const last = days[days.length - 1];
    const ts = ['created_at', 'updated_at', 'deleted_at'];
    const coItems = (kinds: string[]) =>
      this.stamp(
        rowsStamp(
          `co_visit_items t WHERE t.special_event_id = $1 AND t.deleted_at IS NULL AND t.kind = ANY($2)`,
          ts,
        ),
        [e, kinds],
      );
    for (const key of keys) {
      let s: string | null = null;
      if (key === '1.3') s = await coItems(['pastoral']);
      else if (key === '1.5') s = await coItems(['lunch', 'lunch_box']);
      else if (key === '3.4') s = await coItems(['field_service']);
      else if (key === '1.4') {
        s = await this.stamp(
          `SELECT md5(row(e.co_accommodation_address, e.co_accommodation_publisher_id,
                  p.first_name, p.last_name, p.mobile_phone, p.email, p.address)::text) AS s
             FROM special_events e
             LEFT JOIN publishers p ON p.id = e.co_accommodation_publisher_id
            WHERE e.id = $1`,
          [e],
        );
      } else if (key.startsWith('2.1:')) {
        const g = key.slice(4);
        const groupCond =
          g === 'none'
            ? 'p.service_group_id IS NULL'
            : 'p.service_group_id = $2::uuid';
        const params: unknown[] = [tenantId];
        if (g !== 'none') params.push(g);
        params.push(from);
        const n = params.length;
        const members = `SELECT p.id FROM publishers p WHERE p.congregation_id = $1
          AND p.deleted_at IS NULL AND p.removed_at IS NULL
          AND p.appointment <> 'student' AND ${groupCond}`;
        s = [
          await this.stamp(
            rowsStamp(
              `(SELECT p.id, p.first_name, p.last_name, p.display_name, p.gender,
                       p.birth_date, p.baptism_date, p.spiritual_status, p.appointment
                  FROM publishers p WHERE p.id IN (${members})) t`,
            ),
            params.slice(0, n - 1),
          ),
          await this.stamp(
            rowsStamp(
              `service_reports t WHERE t.publisher_id IN (${members}) AND t.report_month >= $${n}`,
              ts,
            ),
            params,
          ),
          await this.stamp(
            rowsStamp(
              `pioneer_spells t WHERE t.publisher_id IN (${members})`,
              ts,
            ),
            params.slice(0, n - 1),
          ),
          await this.stamp(
            rowsStamp(
              `auxiliary_pioneers t WHERE t.publisher_id IN (${members})`,
              ts,
            ),
            params.slice(0, n - 1),
          ),
        ].join('');
      } else if (key === '2.2') {
        s = await this.stamp(
          rowsStamp(
            `meeting_attendance t WHERE t.congregation_id = $1 AND t.date >= $2`,
            [...ts, 'recorded_by'],
          ),
          [tenantId, from],
        );
      } else if (key === '2.5') {
        s = await this.stamp(
          rowsStamp(
            `(SELECT p.id, p.first_name, p.last_name, p.mobile_phone, p.email,
                     p.address, p.service_group_id
                FROM publishers p WHERE p.congregation_id = $1
                 AND p.deleted_at IS NULL AND p.removed_at IS NULL) t`,
          ),
          [tenantId],
        );
      } else if (key === '3.1' || key === '3.5') {
        s = await this.stamp(
          rowsStamp(`territory_assignments t WHERE t.congregation_id = $1`, [
            ...ts,
            'link_hash',
            'link_created_at',
            'paper_wanted_at',
          ]),
          [tenantId],
        );
        // The list of long-unworked territories moves with the calendar too.
        if (key === '3.5')
          s += `|${(await this.clock.todayFor(tenantId)).slice(0, 7)}`;
      } else if (key === '3.3') {
        s = [
          await coItems(['field_service']),
          await this.stamp(
            rowsStamp(
              `(SELECT d.date, d.location_id, d.start_time, d.end_time,
                       a.publisher_id, a.external_name, a.start_time AS a_start, a.end_time AS a_end
                  FROM cart_days d LEFT JOIN cart_assignments a ON a.day_id = d.id
                 WHERE d.congregation_id = $1 AND d.date BETWEEN $2 AND $3) t`,
            ),
            [tenantId, first, last],
          ),
        ].join('');
      } else if (key === '3.6') {
        s = await this.stamp(
          rowsStamp(`territory_shapes t WHERE t.congregation_id = $1`, ts),
          [tenantId],
        );
      }
      // One md5 stays as it is; anything joined or appended is folded to
      // one fixed-length hex string — the only shape a mark accepts.
      if (s !== null) out.set(key, /^[0-9a-f]{32}$/.test(s) ? s : hash40(s));
    }
    return out;
  }

  // ---- the folder --------------------------------------------------------

  async get(tenantId: string, user: AuthenticatedUser, eventId: string) {
    const access = await this.assertAccess(tenantId, user);
    const event = await this.visit(tenantId, eventId);
    const today = await this.clock.todayFor(tenantId);
    const start = String(event.date).slice(0, 10);
    const end = event.endDate ? String(event.endDate).slice(0, 10) : start;
    const folder = await this.folders.findOne({
      where: { congregationId: tenantId, specialEventId: eventId },
    });
    const marks = await this.marks.find({
      where: { congregationId: tenantId, specialEventId: eventId },
    });
    const byKey = new Map(marks.map((m) => [m.itemKey, m]));
    const defs = FOLDER_ITEMS.filter((d) => access.full || d.section === 1);
    const groups = access.full ? await this.groupsOf(tenantId) : [];
    const groupKey = (id: string | null) => `2.1:${id ?? 'none'}`;
    const stampKeys = [
      ...defs
        .filter((d) => d.source === 'pdf' && d.key !== '2.1')
        .map((d) => d.key),
      ...groups.map((g) => groupKey(g.id)),
    ];
    const now = await this.stamps(tenantId, event, stampKeys);
    const names = await this.namesOf(tenantId, [
      ...marks.map((m) => m.markedByUserId),
      folder?.s62SentByUserId,
      folder?.s62CheckedByUserId,
      folder?.handedOverByUserId,
      ...Object.values(folder?.answers ?? {}).map((a) => a.byUserId),
      ...Object.keys(folder?.filesDeleted ?? {}),
    ]);
    const facts = await this.factsOf(tenantId, event);

    const lineOf = (key: string) => {
      const m = byKey.get(key);
      const stamp = now.get(key) ?? null;
      const changed =
        m?.state === 'saved' && !!m.stamp && !!stamp && m.stamp !== stamp;
      return {
        state: m?.state ?? null,
        markedAt: m ? m.markedAt.toISOString() : null,
        markedBy: m?.markedByUserId
          ? (names.get(m.markedByUserId) ?? null)
          : null,
        changed,
        ready: isReady(m?.state, changed),
        stamp,
      };
    };

    const items: FolderItemView[] = defs.map((d: FolderItemDef) => {
      if (d.key === '2.1') {
        const own = byKey.get('2.1');
        const lines = groups.map((g) => ({
          key: groupKey(g.id),
          groupId: g.id,
          name: g.name,
          people: g.people,
          ...lineOf(groupKey(g.id)),
        }));
        // «Не относится» on the whole item stands for every group.
        const na = own?.state === 'na';
        const ready = na || (lines.length > 0 && lines.every((l) => l.ready));
        return {
          key: d.key,
          section: d.section,
          role: d.role,
          source: d.source,
          states: d.states,
          extra: !!d.extra,
          state: na ? 'na' : lines.some((l) => l.state) ? 'saved' : null,
          markedAt: own ? own.markedAt.toISOString() : null,
          markedBy: own?.markedByUserId
            ? (names.get(own.markedByUserId) ?? null)
            : null,
          changed: lines.some((l) => l.changed),
          ready,
          stamp: null,
          facts: {
            groups: lines.length,
            saved: lines.filter((l) => l.ready).length,
            again: lines.filter((l) => l.changed).length,
          },
          groups: lines,
        };
      }
      return {
        key: d.key,
        section: d.section,
        role: d.role,
        source: d.source,
        states: d.states,
        extra: !!d.extra,
        ...lineOf(d.key),
        facts:
          (facts as Record<string, Record<string, number | string | null>>)[
            d.key
          ] ?? {},
      };
    });

    const byRole = (
      ['coordinator', 'secretary', 'service_overseer'] as FolderRole[]
    )
      .filter((r) => access.full || r === 'coordinator')
      .map((r) => {
        const own = items.filter((i) => i.role === r);
        return {
          role: r,
          ready: own.filter((i) => i.ready).length,
          total: own.length,
        };
      });

    const due = dueOn(start);
    const answers = folder?.answers ?? {};
    const answered = Object.keys(answers).length;
    const savedBy = new Set(
      marks
        .filter((m) => m.state === 'saved' && m.markedByUserId)
        .map((m) => m.markedByUserId as string),
    );

    return {
      visit: {
        id: event.id,
        date: start,
        endDate: end,
        overseer:
          [event.coFirstName, event.coLastName].filter(Boolean).join(' ') ||
          null,
      },
      today,
      access: { full: access.full, roles: access.roles },
      dueOn: due,
      daysLeft: daysUntil(today, due),
      s62: {
        dueOn: s62DueOn(start),
        sentAt: folder?.s62SentAt?.toISOString() ?? null,
        sentBy: folder?.s62SentByUserId
          ? (names.get(folder.s62SentByUserId) ?? null)
          : null,
        checkedAt: folder?.s62CheckedAt?.toISOString() ?? null,
        checkedBy: folder?.s62CheckedByUserId
          ? (names.get(folder.s62CheckedByUserId) ?? null)
          : null,
      },
      items,
      byRole,
      ready: items.filter((i) => i.ready).length,
      total: items.length,
      ...(access.full
        ? {
            page2: {
              total: QUESTION_COUNT,
              answered,
              erasedAt: folder?.answersErasedAt?.toISOString() ?? null,
              eraseOn: eraseOn(start, end),
              answers: Object.fromEntries(
                Object.entries(answers).map(([q, a]) => [
                  q,
                  {
                    answer: a.answer,
                    by: names.get(a.byUserId) ?? null,
                    at: a.at,
                  },
                ]),
              ),
              hints: await this.hints(tenantId, event, folder),
            },
            checks: await this.checks(tenantId, event),
            handedOver: folder?.handedOverAt
              ? {
                  at: folder.handedOverAt.toISOString(),
                  by: folder.handedOverByUserId
                    ? (names.get(folder.handedOverByUserId) ?? null)
                    : null,
                }
              : null,
            // Everyone who saved a file is asked to remove it again.
            deletions: [...savedBy].map((uid) => ({
              userId: uid,
              name: names.get(uid) ?? null,
              me: uid === user.id,
              deletedAt: folder?.filesDeleted?.[uid] ?? null,
            })),
          }
        : {}),
    };
  }

  /** The small numbers the lines show. */
  private async factsOf(tenantId: string, event: SpecialEvent) {
    const rows: Array<{
      kind: string;
      for_wife: boolean;
      with_wife: boolean;
      item_date: string;
      has_partner: boolean;
    }> = await this.marks.query(
      `SELECT kind, for_wife, with_wife, item_date::text AS item_date,
                (assignee_publisher_id IS NOT NULL OR coalesce(assignee_text, '') <> '') AS has_partner
           FROM co_visit_items
          WHERE congregation_id = $1 AND special_event_id = $2 AND deleted_at IS NULL`,
      [tenantId, event.id],
    );
    const days = this.visitDays(event);
    const lunchDays = new Set(
      rows
        .filter((r) => r.kind === 'lunch' || r.kind === 'lunch_box')
        .map((r) => r.item_date),
    );
    const contacts = await this.publishers.count({
      where: { congregationId: tenantId, removedAt: IsNull() },
    });
    return {
      '1.3': { count: rows.filter((r) => r.kind === 'pastoral').length },
      '1.4': {
        host:
          event.coAccommodationPublisherId || event.coAccommodationAddress
            ? 1
            : 0,
      },
      '1.5': {
        count: days.filter((d) => lunchDays.has(d)).length,
        of: days.length,
      },
      '2.5': { count: contacts },
      '3.4': {
        count: rows.filter((r) => r.kind === 'field_service' && !r.for_wife)
          .length,
      },
    };
  }

  /**
   * What is still open in the visit's own schedule: days without a lunch,
   * outings without a partner (the overseer going out with his wife needs
   * none — the withWife mark).
   */
  private async checks(tenantId: string, event: SpecialEvent) {
    const rows: Array<{
      kind: string;
      for_wife: boolean;
      with_wife: boolean;
      item_date: string;
      has_partner: boolean;
    }> = await this.marks.query(
      `SELECT kind, for_wife, with_wife, item_date::text AS item_date,
                (assignee_publisher_id IS NOT NULL OR coalesce(assignee_text, '') <> '') AS has_partner
           FROM co_visit_items
          WHERE congregation_id = $1 AND special_event_id = $2 AND deleted_at IS NULL`,
      [tenantId, event.id],
    );
    const days = this.visitDays(event);
    const lunch = new Set(
      rows
        .filter((r) => r.kind === 'lunch' || r.kind === 'lunch_box')
        .map((r) => r.item_date),
    );
    return {
      lunchMissing: days.filter((d) => !lunch.has(d)),
      outingsWithoutPartner: rows
        .filter(
          (r) => r.kind === 'field_service' && !r.with_wife && !r.has_partner,
        )
        .map((r) => r.item_date)
        .sort(),
    };
  }

  /**
   * Page 2 hints — the app's data since the previous visit, never an answer
   * (decision 5). Only what the app really holds: the moves, the deaths and
   * the disfellowshippings as recorded on the cards, regular pioneering that
   * ended, contacts confirmed this service year. A name change or a
   * disassociation the app does not record, and says so.
   */
  private async hints(
    tenantId: string,
    event: SpecialEvent,
    folder: CoVisitFolder | null,
  ) {
    const start = String(event.date).slice(0, 10);
    const previous = await this.events.findOne({
      where: {
        congregationId: tenantId,
        type: VISIT,
        date: LessThan(start),
      },
      order: { date: 'DESC' },
    });
    let since: string | null = null;
    if (previous) {
      const prevFolder = await this.folders.findOne({
        where: { congregationId: tenantId, specialEventId: previous.id },
      });
      since = prevFolder?.handedOverAt
        ? prevFolder.handedOverAt.toISOString().slice(0, 10)
        : String(previous.endDate ?? previous.date).slice(0, 10);
    }
    void folder;
    const from = since ?? this.yearsOf(event).from;
    const left: Array<{
      id: string;
      first_name: string;
      last_name: string;
      removal_reason: string;
      pioneer: boolean;
    }> = await this.marks.query(
      `SELECT p.id, p.first_name, p.last_name, p.removal_reason::text AS removal_reason,
                EXISTS (SELECT 1 FROM pioneer_spells s WHERE s.publisher_id = p.id
                         AND s.pioneer_type = 'regular'
                         AND (s.end_month IS NULL OR s.end_month >= date_trunc('month', p.removed_at)::date)) AS pioneer
           FROM publishers p
          WHERE p.congregation_id = $1 AND p.removed_at IS NOT NULL
            AND p.removed_at::date > $2::date
          ORDER BY p.last_name, p.first_name`,
      [tenantId, from],
    );
    const ended: Array<{ first_name: string; last_name: string }> =
      await this.marks.query(
        `SELECT p.first_name, p.last_name
         FROM pioneer_spells s JOIN publishers p ON p.id = s.publisher_id
        WHERE s.congregation_id = $1 AND s.pioneer_type = 'regular'
          AND s.end_month IS NOT NULL AND s.end_month >= date_trunc('month', $2::date)::date
          AND p.removed_at IS NULL
        ORDER BY p.last_name, p.first_name`,
        [tenantId, from],
      );
    const nameOf = (r: { first_name: string; last_name: string }) =>
      `${r.last_name} ${r.first_name}`.trim();
    const by = (reason: RemovalReason) =>
      left.filter((r) => r.removal_reason === reason).map(nameOf);
    const today = await this.clock.todayFor(tenantId);
    const [ty, tm] = today.split('-').map(Number);
    const syStart = `${tm >= 9 ? ty : ty - 1}-09-01`;
    const contact: Array<{ total: string; confirmed: string }> =
      await this.marks.query(
        `SELECT count(*) AS total,
              count(*) FILTER (WHERE contacts_confirmed_at >= $2::date) AS confirmed
         FROM publishers
        WHERE congregation_id = $1 AND deleted_at IS NULL AND removed_at IS NULL`,
        [tenantId, syStart],
      );
    return {
      since: from,
      sinceVisit: !!since,
      4: {
        pioneerEnded: ended.map(nameOf),
        pioneerMoved: left
          .filter((r) => r.pioneer && r.removal_reason === RemovalReason.MOVED)
          .map(nameOf),
      },
      5: { disfellowshipped: by(RemovalReason.DISFELLOWSHIPPED) },
      6: { died: by(RemovalReason.DIED) },
      9: { moved: by(RemovalReason.MOVED) },
      12: {
        serviceYear: Number(syStart.slice(0, 4)) + 1,
        confirmed: Number(contact[0]?.confirmed ?? 0),
        total: Number(contact[0]?.total ?? 0),
      },
    };
  }

  // ---- marking -----------------------------------------------------------

  async mark(
    tenantId: string,
    user: AuthenticatedUser,
    eventId: string,
    key: string,
    state: FolderMarkState | null,
    stamp: string | null,
  ) {
    await this.assertAccess(tenantId, user, true);
    const event = await this.visit(tenantId, eventId);
    const base = key.startsWith('2.1:') ? '2.1' : key;
    const def = FOLDER_ITEMS.find((d) => d.key === base);
    const groupOk =
      !key.startsWith('2.1:') ||
      key === '2.1:none' ||
      /^2\.1:[0-9a-f-]{36}$/i.test(key);
    if (
      !def ||
      !groupOk ||
      (state !== null && !def.states.includes(state)) ||
      (key.startsWith('2.1:') && state !== null && state !== 'saved')
    ) {
      throw new BadRequestException(
        refusal('FOLDER_MARK_INVALID', 'This mark does not fit this item.', {
          key,
          state,
        }),
      );
    }
    if (state === null) {
      await this.marks.delete({
        congregationId: tenantId,
        specialEventId: event.id,
        itemKey: key,
      });
      return { ok: true };
    }
    // The stamp the file was made from — the server's own when none came.
    const current =
      (await this.stamps(tenantId, event, [key])).get(key) ?? null;
    const kept = state === 'saved' ? (stamp ?? current) : null;
    const existing = await this.marks.findOne({
      where: {
        congregationId: tenantId,
        specialEventId: event.id,
        itemKey: key,
      },
    });
    await this.marks.save({
      ...(existing ?? {}),
      congregationId: tenantId,
      specialEventId: event.id,
      itemKey: key,
      state,
      stamp: kept,
      markedByUserId: user.id,
    });
    await this.folderOf(tenantId, event.id);
    return { ok: true, changed: !!kept && !!current && kept !== current };
  }

  async setS62(
    tenantId: string,
    user: AuthenticatedUser,
    eventId: string,
    what: 'sent' | 'checked',
    on: boolean,
  ) {
    await this.assertAccess(tenantId, user, true);
    const event = await this.visit(tenantId, eventId);
    const f = await this.folderOf(tenantId, event.id);
    if (what === 'sent') {
      f.s62SentAt = on ? new Date() : null;
      f.s62SentByUserId = on ? user.id : null;
    } else {
      f.s62CheckedAt = on ? new Date() : null;
      f.s62CheckedByUserId = on ? user.id : null;
    }
    await this.folders.save(f);
    return { ok: true };
  }

  async answer(
    tenantId: string,
    user: AuthenticatedUser,
    eventId: string,
    q: number,
    answer: 'yes' | 'no' | 'na' | null,
  ) {
    await this.assertAccess(tenantId, user, true);
    const event = await this.visit(tenantId, eventId);
    if (answer !== null && !answerAllowed(q, answer)) {
      throw new BadRequestException(
        refusal(
          'FOLDER_ANSWER_INVALID',
          'This answer does not fit this question.',
          { q },
        ),
      );
    }
    const f = await this.folderOf(tenantId, event.id);
    if (f.answersErasedAt) {
      throw new ConflictException(
        refusal(
          'FOLDER_ANSWERS_ERASED',
          'The visit is over and the answers have been erased.',
        ),
      );
    }
    const next = { ...(f.answers ?? {}) };
    if (answer === null) delete next[String(q)];
    else
      next[String(q)] = {
        answer,
        byUserId: user.id,
        at: new Date().toISOString(),
      };
    f.answers = next;
    await this.folders.save(f);
    return { ok: true, answered: Object.keys(next).length };
  }

  /**
   * «Передано». The coordinator makes sure every question of page 2 has an
   * answer (form S-61), so the folder cannot be handed over before.
   */
  async handOver(
    tenantId: string,
    user: AuthenticatedUser,
    eventId: string,
    on: boolean,
  ) {
    await this.assertAccess(tenantId, user, true);
    const event = await this.visit(tenantId, eventId);
    const f = await this.folderOf(tenantId, event.id);
    if (on) {
      const answered = f.answersErasedAt
        ? QUESTION_COUNT
        : Object.keys(f.answers ?? {}).length;
      if (answered < QUESTION_COUNT) {
        throw new ConflictException(
          refusal(
            'FOLDER_PAGE2_INCOMPLETE',
            'Every question of page 2 needs an answer first.',
            {
              answered,
              total: QUESTION_COUNT,
            },
          ),
        );
      }
      if (f.handedOverAt) return { ok: true };
      f.handedOverAt = new Date();
      f.handedOverByUserId = user.id;
      await this.folders.save(f);
      await this.tellToDelete(tenantId, event);
    } else {
      f.handedOverAt = null;
      f.handedOverByUserId = null;
      await this.folders.save(f);
    }
    return { ok: true };
  }

  async filesDeleted(
    tenantId: string,
    user: AuthenticatedUser,
    eventId: string,
  ) {
    await this.assertAccess(tenantId, user, true);
    const event = await this.visit(tenantId, eventId);
    const f = await this.folderOf(tenantId, event.id);
    f.filesDeleted = {
      ...(f.filesDeleted ?? {}),
      [user.id]: await this.clock.todayFor(tenantId),
    };
    await this.folders.save(f);
    return { ok: true };
  }

  // ---- the data only the folder hands out --------------------------------

  /**
   * One service group's S-21 for both years (decision of 17 November 2026):
   * everyone in the group today, inactive too; the moved and removed not.
   */
  async s21Group(
    tenantId: string,
    user: AuthenticatedUser,
    eventId: string,
    group: string,
  ): Promise<{
    stamp: string | null;
    years: number[];
    cards: S21DataResponse[][];
  }> {
    await this.assertAccess(tenantId, user, true);
    const event = await this.visit(tenantId, eventId);
    const groupId = group === 'none' ? null : group;
    if (groupId !== null) {
      const exists = await this.groups.count({
        where: { id: groupId, congregationId: tenantId },
      });
      if (!exists)
        throw new NotFoundException(refusal('NO_SUCH_GROUP', 'No such group.'));
    }
    const { years } = this.yearsOf(event);
    const key = `2.1:${group}`;
    const stamp = (await this.stamps(tenantId, event, [key])).get(key) ?? null;
    const members = await this.groupMembers(tenantId, groupId);
    const cards: S21DataResponse[][] = [];
    for (const p of members) {
      const one: S21DataResponse[] = [];
      for (const y of years)
        one.push(await this.reports.getS21Data(tenantId, user, p.id, y));
      cards.push(one);
    }
    return { stamp, years, cards };
  }

  /**
   * 2.5 — the contact details of every publisher, for the file only: no
   * screen shows this list (decision 6).
   */
  async contacts(tenantId: string, user: AuthenticatedUser, eventId: string) {
    await this.assertAccess(tenantId, user, true);
    const event = await this.visit(tenantId, eventId);
    const stamp =
      (await this.stamps(tenantId, event, ['2.5'])).get('2.5') ?? null;
    const rows = await this.publishers.find({
      where: { congregationId: tenantId, removedAt: IsNull() },
      relations: { serviceGroup: true },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
    return {
      stamp,
      people: rows.map((p) => ({
        lastName: p.lastName,
        firstName: p.firstName,
        group: p.serviceGroup?.name ?? null,
        mobilePhone: p.mobilePhone,
        email: p.email,
        address: p.address,
      })),
    };
  }

  // ---- the day's round ---------------------------------------------------

  private async holders(tenantId: string): Promise<Map<FolderRole, string[]>> {
    const rows = await this.responsibilities.find({
      where: {
        congregationId: tenantId,
        type: In(Object.keys(ROLE_OF) as ResponsibilityType[]),
      },
      select: { type: true, userId: true },
    });
    const out = new Map<FolderRole, string[]>();
    for (const r of rows) {
      const role = ROLE_OF[r.type];
      out.set(role, [...(out.get(role) ?? []), r.userId]);
    }
    return out;
  }

  private async send(
    tenantId: string,
    event: SpecialEvent,
    news: FolderNews,
    userIds: string[],
    notReady = 0,
  ) {
    if (!this.notifications || userIds.length === 0) return;
    const start = String(event.date).slice(0, 10);
    const facts = { due: dueOn(start), s62Due: s62DueOn(start), notReady };
    await this.notifications.notify({
      tenantId,
      userIds,
      text: (lang) => folderText(news, facts, lang),
      kind: 'co_visit_folder',
      key: `co-visit-folder:${event.id}:${news}`,
      data: { type: 'co_visit_folder', eventId: event.id },
    });
  }

  private async tellToDelete(tenantId: string, event: SpecialEvent) {
    const saved = await this.marks.find({
      where: {
        congregationId: tenantId,
        specialEventId: event.id,
        state: 'saved',
      },
      select: { markedByUserId: true },
    });
    const ids = [
      ...new Set(
        saved.map((m) => m.markedByUserId).filter((x): x is string => !!x),
      ),
    ];
    await this.send(tenantId, event, 'deleteFiles', ids);
  }

  /**
   * Each morning, for each visit ahead: the S-62 a month before its date, to
   * the secretary and the coordinator, unless already sent; a week before
   * the Tuesday, «not ready: N» to whoever's items are open. The day after
   * the visit, page 2 is erased.
   */
  async daily(now: Date = new Date()): Promise<number> {
    const congs = await this.congregations.find({
      select: { id: true, timezone: true },
    });
    let n = 0;
    for (const c of congs) {
      const today = todayIn(now, c.timezone || DEFAULT_CONGREGATION_TIMEZONE);
      const visits = await this.events.find({
        where: { congregationId: c.id, type: VISIT },
      });
      for (const v of visits) {
        const start = String(v.date).slice(0, 10);
        const end = v.endDate ? String(v.endDate).slice(0, 10) : start;
        try {
          if (today >= eraseOn(start, end)) {
            const f = await this.folders.findOne({
              where: { congregationId: c.id, specialEventId: v.id },
            });
            if (f && f.answers && !f.answersErasedAt) {
              f.answers = null;
              f.answersErasedAt = new Date();
              await this.folders.save(f);
              n += 1;
            }
            continue;
          }
          if (today > dueOn(start)) continue;
          const f = await this.folders.findOne({
            where: { congregationId: c.id, specialEventId: v.id },
          });
          const who = await this.holders(c.id);
          if (
            today >= s62RemindOn(start) &&
            today <= s62DueOn(start) &&
            !f?.s62SentAt
          ) {
            await this.send(c.id, v, 's62', [
              ...(who.get('secretary') ?? []),
              ...(who.get('coordinator') ?? []),
            ]);
            n += 1;
          }
          if (today >= gapsRemindOn(start) && !f?.handedOverAt) {
            const open = await this.openByRole(c.id, v);
            const users = (Object.keys(open) as FolderRole[])
              .filter((r) => open[r] > 0)
              .flatMap((r) => who.get(r) ?? []);
            const total = Object.values(open).reduce((a, b) => a + b, 0);
            if (total > 0) {
              await this.send(c.id, v, 'gaps', users, total);
              n += 1;
            }
          }
        } catch (err) {
          this.logger.warn(`folder ${v.id}: ${(err as Error).message}`);
        }
      }
    }
    return n;
  }

  /** How many items of each role are not ready — for the reminder. */
  private async openByRole(tenantId: string, event: SpecialEvent) {
    const marks = await this.marks.find({
      where: { congregationId: tenantId, specialEventId: event.id },
    });
    const byKey = new Map(marks.map((m) => [m.itemKey, m]));
    const groups = await this.groupsOf(tenantId);
    const keys = [
      ...FOLDER_ITEMS.filter((d) => d.source === 'pdf' && d.key !== '2.1').map(
        (d) => d.key,
      ),
      ...groups.map((g) => `2.1:${g.id ?? 'none'}`),
    ];
    const now = await this.stamps(tenantId, event, keys);
    const ready = (key: string) => {
      const m = byKey.get(key);
      const s = now.get(key);
      return isReady(
        m?.state,
        m?.state === 'saved' && !!m.stamp && !!s && m.stamp !== s,
      );
    };
    const open: Record<FolderRole, number> = {
      coordinator: 0,
      secretary: 0,
      service_overseer: 0,
    };
    for (const d of FOLDER_ITEMS) {
      const ok =
        d.key === '2.1'
          ? byKey.get('2.1')?.state === 'na' ||
            (groups.length > 0 &&
              groups.every((g) => ready(`2.1:${g.id ?? 'none'}`)))
          : ready(d.key);
      if (!ok) open[d.role] += 1;
    }
    return open;
  }
}

function hash40(s: string): string {
  // Several fingerprints joined are folded to one of a fixed length.
  return createHash('sha1').update(s).digest('hex');
}
