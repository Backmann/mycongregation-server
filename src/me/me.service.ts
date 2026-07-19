import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { CoVisitItem } from '../entities/co-visit-item.entity';

export type MyAssignmentKind =
  | 'meeting'
  | 'duty'
  | 'cleaning'
  | 'cart'
  | 'field_service'
  | 'outgoing_talk'
  | 'co_lunch';

export interface MyAssignmentItem {
  kind: MyAssignmentKind;
  /** Best-known calendar date (exact for cart/field service; Monday otherwise). */
  sortDate: string;
  weekStartDate?: string;
  dayOfWeek?: number;
  date?: string;
  eventType?: string;
  time?: string;
  endTime?: string;
  label: string;
  /** Cleaning: hall-plan window numbers for the weekly thorough slot. */
  windows?: number[];
  /** Cleaning: ISO datetime the group agreed to do the thorough cleaning. */
  thoroughPlannedAt?: string;
  /** Duty slot number (microphones are numbered 1..n on screen). */
  slotIndex?: number;
  /** Part key for meeting items (lets the client tailor display). */
  partKey?: string;
  /** Program order of the part within the meeting (for sorting). */
  partOrder?: number;
  location?: string;
  /** Outgoing public talk: link to the host hall on a map. */
  mapUrl?: string;
  /** Outgoing public talk: host congregation name. */
  congregationName?: string;
  asAssistant?: boolean;
  /** CO-visit lunch: organizer note shown as a task instruction. */
  note?: string;
}

/** The fields a publisher may change in their own card. */
export interface MyContactsInput {
  mobilePhone?: string | null;
  email?: string | null;
  address?: string | null;
}

export interface MyPublisherResponse {
  publisher: {
    id: string;
    displayName: string;
    firstName: string;
    lastName: string;
    pioneerType: string | null;
    serviceGroupId: string | null;
    /** Own contacts — the publisher keeps these up to date themselves. */
    mobilePhone: string | null;
    email: string | null;
    address: string | null;
    /** Yearly check: when the contacts were last confirmed, and by whom. */
    contactsConfirmedAt: string | null;
    contactsConfirmedByUserId: string | null;
    /** Congregation name of whoever last confirmed — "checked by" needs a who. */
    contactsConfirmedByName: string | null;
  } | null;
}

export interface MyAssignmentsResponse {
  publisherId: string | null;
  items: MyAssignmentItem[];
}

/**
 * What the signed-in publisher has on a given week, used by the schedule's week
 * drawer to mark weeks at a glance. Meeting parts and duties are per meeting;
 * cleaning belongs to the whole week (their service group is on duty).
 */
export interface MyWeekMarks {
  weekStartDate: string;
  midweekParts: boolean;
  midweekDuties: boolean;
  weekendParts: boolean;
  weekendDuties: boolean;
  cleaning: boolean;
  fieldService: boolean;
}

/** Today's date (YYYY-MM-DD) in the congregation's timezone. */
function berlinToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
  }).format(new Date());
}

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday of the ISO week containing the given date. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fmtISO(d);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return fmtISO(d);
}

const HORIZON_DAYS = 56; // 8 weeks ahead

@Injectable()
export class MeService {
  constructor(
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    private readonly auditLogService: AuditLogService,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(Duty)
    private readonly dutiesRepo: Repository<Duty>,
    @InjectRepository(CleaningAssignment)
    private readonly cleaningRepo: Repository<CleaningAssignment>,
    @InjectRepository(FieldServiceMeeting)
    private readonly fieldRepo: Repository<FieldServiceMeeting>,
    @InjectRepository(CartAssignment)
    private readonly cartAssignmentsRepo: Repository<CartAssignment>,
    @InjectRepository(TalkExchange)
    private readonly talkExchangeRepo: Repository<TalkExchange>,
    @InjectRepository(ExternalCongregation)
    private readonly externalCongregationsRepo: Repository<ExternalCongregation>,
    @InjectRepository(PublicTalk)
    private readonly publicTalksRepo: Repository<PublicTalk>,
    @InjectRepository(CoVisitItem)
    private readonly coVisitItemsRepo: Repository<CoVisitItem>,
  ) {}

  /**
   * Light identity of the publisher linked to the signed-in user.
   * Deliberately returns only non-sensitive fields; private/encrypted
   * publisher data stays behind the publishers module guards.
   */
  async myPublisher(
    tenantId: string,
    userId: string,
  ): Promise<MyPublisherResponse> {
    const me = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId },
    });
    if (!me) return { publisher: null };
    return {
      publisher: {
        id: me.id,
        displayName: me.displayName,
        firstName: me.firstName,
        lastName: me.lastName,
        pioneerType: me.pioneerType ?? null,
        serviceGroupId: me.serviceGroupId ?? null,
        // Own contacts: the publisher edits these themselves.
        mobilePhone: me.mobilePhone ?? null,
        email: me.email ?? null,
        address: me.address ?? null,
        contactsConfirmedAt: me.contactsConfirmedAt
          ? me.contactsConfirmedAt.toISOString()
          : null,
        contactsConfirmedByUserId: me.contactsConfirmedByUserId ?? null,
        contactsConfirmedByName: await this.resolveActorName(
          tenantId,
          me.contactsConfirmedByUserId,
        ),
      },
    };
  }

  /**
   * A publisher changing their own contacts. Only phone, e-mail and address —
   * the name identifies them across schedules, reports and printed sheets, so
   * it stays with the administrators. Saving also counts as confirming the
   * contacts are current, and the change is written to the audit log, which is
   * what makes "changed by whom and when" visible afterwards.
   */
  /**
   * Turn the user id kept with the contact check into the name the congregation
   * knows, so the card can say who vouched for the data — themselves, or the
   * secretary. Falls back to null when that account has no publisher card.
   */
  private async resolveActorName(
    tenantId: string,
    userId: string | null | undefined,
  ): Promise<string | null> {
    if (!userId) return null;
    const actor = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId },
      select: { id: true, displayName: true },
    });
    return actor?.displayName ?? null;
  }

  async updateMyContacts(
    tenantId: string,
    userId: string,
    dto: MyContactsInput,
  ): Promise<MyPublisherResponse> {
    const me = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId },
    });
    if (!me) throw new NotFoundException('No publisher card for this account');

    const before = {
      mobilePhone: me.mobilePhone ?? null,
      email: me.email ?? null,
      address: me.address ?? null,
    };
    if (dto.mobilePhone !== undefined) me.mobilePhone = dto.mobilePhone || null;
    if (dto.email !== undefined) me.email = dto.email || null;
    if (dto.address !== undefined) me.address = dto.address || null;
    me.contactsConfirmedAt = new Date();
    me.contactsConfirmedByUserId = userId;
    await this.publishersRepo.save(me);

    await this.auditLogService.logUpdate({
      tenantId,
      entityType: 'publisher',
      entityId: me.id,
      actorUserId: userId,
      before,
      after: {
        mobilePhone: me.mobilePhone ?? null,
        email: me.email ?? null,
        address: me.address ?? null,
      },
      fields: ['mobilePhone', 'email', 'address'],
    });

    return this.myPublisher(tenantId, userId);
  }

  /** "My contacts are still correct" — stamps the yearly check without edits. */
  async confirmMyContacts(
    tenantId: string,
    userId: string,
  ): Promise<MyPublisherResponse> {
    const me = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId },
    });
    if (!me) throw new NotFoundException('No publisher card for this account');
    me.contactsConfirmedAt = new Date();
    me.contactsConfirmedByUserId = userId;
    await this.publishersRepo.save(me);
    return this.myPublisher(tenantId, userId);
  }

  /**
   * Weeks where the signed-in publisher has something on: a meeting part (own
   * or as assistant), a duty, their service group's cleaning, or a field
   * service meeting they conduct. Covers every
   * week, not just the 8-week horizon of myAssignments, because the week drawer
   * lists the whole published range.
   */
  async myWeeks(tenantId: string, userId: string): Promise<MyWeekMarks[]> {
    const me = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId },
    });
    if (!me) return [];
    const pid = me.id;
    const groupId = me.serviceGroupId ?? null;

    const byWeek = new Map<string, MyWeekMarks>();
    const mark = (week: string): MyWeekMarks => {
      let m = byWeek.get(week);
      if (!m) {
        m = {
          weekStartDate: week,
          midweekParts: false,
          midweekDuties: false,
          weekendParts: false,
          weekendDuties: false,
          cleaning: false,
          fieldService: false,
        };
        byWeek.set(week, m);
      }
      return m;
    };

    const parts = await this.assignmentsRepo
      .createQueryBuilder('a')
      .select('a.week_start_date', 'week')
      .addSelect('a.event_type', 'eventType')
      .where('a.congregation_id = :tenantId', { tenantId })
      .andWhere("a.status = 'published'")
      .andWhere('(a.publisher_id = :pid OR a.assistant_publisher_id = :pid)', {
        pid,
      })
      .groupBy('a.week_start_date')
      .addGroupBy('a.event_type')
      .getRawMany<{ week: string; eventType: string }>();
    for (const r of parts) {
      const m = mark(fmtISO(new Date(r.week)));
      if (r.eventType === 'midweek') m.midweekParts = true;
      if (r.eventType === 'weekend') m.weekendParts = true;
    }

    const duties = await this.dutiesRepo
      .createQueryBuilder('d')
      .select('d.week_start_date', 'week')
      .addSelect('d.event_type', 'eventType')
      .where('d.congregation_id = :tenantId', { tenantId })
      .andWhere('d.publisher_id = :pid', { pid })
      .groupBy('d.week_start_date')
      .addGroupBy('d.event_type')
      .getRawMany<{ week: string; eventType: string }>();
    for (const r of duties) {
      const m = mark(fmtISO(new Date(r.week)));
      if (r.eventType === 'midweek') m.midweekDuties = true;
      if (r.eventType === 'weekend') m.weekendDuties = true;
    }

    if (groupId) {
      const cleaning = await this.cleaningRepo
        .createQueryBuilder('c')
        .select('c.week_start_date', 'week')
        .where('c.congregation_id = :tenantId', { tenantId })
        .andWhere('c.service_group_id = :groupId', { groupId })
        .groupBy('c.week_start_date')
        .getRawMany<{ week: string }>();
      for (const r of cleaning) {
        mark(fmtISO(new Date(r.week))).cleaning = true;
      }
    }

    const field = await this.fieldRepo
      .createQueryBuilder('f')
      .select('f.week_start_date', 'week')
      .where('f.congregation_id = :tenantId', { tenantId })
      .andWhere('f.conductor_publisher_id = :pid', { pid })
      .groupBy('f.week_start_date')
      .getRawMany<{ week: string }>();
    for (const r of field) {
      mark(fmtISO(new Date(r.week))).fieldService = true;
    }

    return [...byWeek.values()].sort((a, b) =>
      a.weekStartDate < b.weekStartDate ? 1 : -1,
    );
  }

  async myAssignments(
    tenantId: string,
    userId: string,
  ): Promise<MyAssignmentsResponse> {
    const me = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId },
    });
    if (!me) {
      return { publisherId: null, items: [] };
    }
    const pid = me.id;
    const today = berlinToday();
    const weekFloor = mondayOf(today);
    const horizon = addDaysISO(today, HORIZON_DAYS);

    const items: MyAssignmentItem[] = [];

    // ---- Meeting assignments (incl. assistant parts) ----
    const meetings = await this.assignmentsRepo
      .createQueryBuilder('a')
      .where('a.congregation_id = :tenantId', { tenantId })
      .andWhere('a.week_start_date BETWEEN :ws AND :we', {
        ws: weekFloor,
        we: horizon,
      })
      .andWhere("a.status = 'published'")
      .andWhere('(a.publisher_id = :pid OR a.assistant_publisher_id = :pid)', {
        pid,
      })
      .orderBy('a.week_start_date', 'ASC')
      .getMany();
    for (const a of meetings) {
      items.push({
        kind: 'meeting',
        sortDate: a.weekStartDate,
        weekStartDate: a.weekStartDate,
        eventType: a.eventType,
        label: a.partTitle || a.partKey,
        partKey: a.partKey,
        partOrder: a.partOrder,
        asAssistant: a.assistantPublisherId === pid,
      });
    }

    // ---- Meeting duties ----
    const duties = await this.dutiesRepo
      .createQueryBuilder('d')
      .where('d.congregation_id = :tenantId', { tenantId })
      .andWhere('d.week_start_date BETWEEN :ws AND :we', {
        ws: weekFloor,
        we: horizon,
      })
      .andWhere('d.publisher_id = :pid', { pid })
      .orderBy('d.week_start_date', 'ASC')
      .getMany();
    for (const d of duties) {
      items.push({
        kind: 'duty',
        sortDate: d.weekStartDate,
        weekStartDate: d.weekStartDate,
        eventType: d.eventType,
        label: d.customLabel || d.dutyType,
        slotIndex: d.slotIndex,
      });
    }

    // ---- Cleaning (assigned to my service group) ----
    if (me.serviceGroupId) {
      const cleanings = await this.cleaningRepo
        .createQueryBuilder('c')
        .where('c.congregation_id = :tenantId', { tenantId })
        .andWhere('c.week_start_date BETWEEN :ws AND :we', {
          ws: weekFloor,
          we: horizon,
        })
        .andWhere('c.service_group_id = :gid', { gid: me.serviceGroupId })
        .orderBy('c.week_start_date', 'ASC')
        .getMany();
      for (const c of cleanings) {
        items.push({
          kind: 'cleaning',
          sortDate: c.weekStartDate,
          weekStartDate: c.weekStartDate,
          label: c.slotType,
          ...(c.slotType === 'thorough' && c.windows?.length
            ? { windows: c.windows }
            : {}),
          ...(c.slotType === 'thorough' && c.thoroughPlannedAt
            ? { thoroughPlannedAt: c.thoroughPlannedAt.toISOString() }
            : {}),
        });
      }
    }

    // ---- General (annual) cleaning: whole congregation ----
    const generalCleanings = await this.cleaningRepo
      .createQueryBuilder('c')
      .where('c.congregation_id = :tenantId', { tenantId })
      .andWhere("c.slot_type = 'general'")
      .andWhere('c.week_start_date BETWEEN :ws AND :we', {
        ws: weekFloor,
        we: horizon,
      })
      .orderBy('c.week_start_date', 'ASC')
      .getMany();
    for (const c of generalCleanings) {
      items.push({
        kind: 'cleaning',
        sortDate: c.weekStartDate,
        weekStartDate: c.weekStartDate,
        label: c.slotType,
        ...(c.thoroughPlannedAt
          ? { thoroughPlannedAt: c.thoroughPlannedAt.toISOString() }
          : {}),
      });
    }

    // ---- Field service meetings (as conductor) ----
    // ---- Public witnessing (cart) assignments ----
    const cartAssignments = await this.cartAssignmentsRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.slot', 's')
      .innerJoinAndSelect('s.week', 'w')
      .leftJoinAndSelect('s.location', 'loc')
      .where('a.publisher_id = :pid', { pid })
      .andWhere('a.congregation_id = :tenantId', { tenantId })
      .andWhere("w.status = 'published'")
      .andWhere('s.date BETWEEN :today AND :horizon', { today, horizon })
      .orderBy('s.date', 'ASC')
      .getMany();
    for (const a of cartAssignments) {
      items.push({
        kind: 'cart',
        sortDate: a.slot.date,
        date: a.slot.date,
        time: a.slot.startTime,
        endTime: a.slot.endTime,
        label: a.slot.location?.name ?? '',
        location: a.slot.location?.name ?? '',
      });
    }

    const fieldMeetings = await this.fieldRepo
      .createQueryBuilder('f')
      .where('f.congregation_id = :tenantId', { tenantId })
      .andWhere('f.week_start_date BETWEEN :ws AND :we', {
        ws: weekFloor,
        we: horizon,
      })
      .andWhere('f.conductor_publisher_id = :pid', { pid })
      .orderBy('f.week_start_date', 'ASC')
      .getMany();
    for (const f of fieldMeetings) {
      const exact = addDaysISO(f.weekStartDate, (f.dayOfWeek ?? 1) - 1);
      if (exact < today) continue;
      items.push({
        kind: 'field_service',
        sortDate: exact,
        weekStartDate: f.weekStartDate,
        dayOfWeek: f.dayOfWeek,
        time: f.startTime,
        label: f.address,
        location: f.address,
      });
    }

    // ---- Outgoing public talks (our brother speaks at another congregation) ----
    const outgoing = await this.talkExchangeRepo
      .createQueryBuilder('te')
      .where('te.congregation_id = :tenantId', { tenantId })
      .andWhere("te.direction = 'outgoing'")
      .andWhere('te.publisher_id = :pid', { pid })
      .andWhere('te.date BETWEEN :today AND :horizon', { today, horizon })
      .orderBy('te.date', 'ASC')
      .getMany();
    for (const e of outgoing) {
      const host = e.hostCongregationId
        ? await this.externalCongregationsRepo.findOne({
            where: { id: e.hostCongregationId, congregationId: tenantId },
          })
        : null;
      const talk = e.publicTalkId
        ? await this.publicTalksRepo.findOne({ where: { id: e.publicTalkId } })
        : null;
      items.push({
        kind: 'outgoing_talk',
        sortDate: e.date,
        date: e.date,
        time: host?.meetingTime ?? undefined,
        label: talk ? `№${talk.number}. ${talk.title}` : (host?.name ?? ''),
        location: host?.address ?? undefined,
        mapUrl: host?.mapUrl ?? undefined,
        congregationName: host?.name ?? undefined,
      });
    }

    // ---- CO-visit lunches the publisher organizes (note = instruction) ----
    const coLunches = await this.coVisitItemsRepo
      .createQueryBuilder('c')
      .where('c.congregation_id = :tenantId', { tenantId })
      .andWhere("c.kind IN ('lunch', 'lunch_box')")
      .andWhere('c.assignee_publisher_id = :pid', { pid })
      .andWhere('c.item_date BETWEEN :today AND :horizon', { today, horizon })
      .orderBy('c.item_date', 'ASC')
      .getMany();
    for (const c of coLunches) {
      if (c.itemDate < today) continue;
      items.push({
        kind: 'co_lunch',
        sortDate: c.itemDate,
        date: c.itemDate,
        time: c.startTime ?? undefined,
        label: c.kind,
        note: c.note ?? undefined,
      });
    }

    items.sort((x, y) => x.sortDate.localeCompare(y.sortDate));
    return { publisherId: pid, items };
  }
}
