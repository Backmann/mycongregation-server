import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
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
import { MemorialItem } from '../entities/memorial-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { mondayOf } from '../common/week';
import { memorialTakesKind } from '../common/week-rules';

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
  /**
   * The other person in a pair, by name.
   *
   * A brother told only «you have Оттачиваем навыки» cannot tell whether he
   * leads it or helps, still less with whom — and the pair is half the
   * assignment. The flag alone was not enough.
   */
  partnerName?: string;
  /** Field-service visit: he comes as the service overseer's assistant. */
  asOverseerAssistant?: boolean;
  /** Field-service visit: whose group is being visited. */
  groupName?: string;
  /**
   * This field-service meeting IS the service overseer's visit.
   *
   * Needed on its own: the overseer coming without an assistant had no way to
   * be told apart from an ordinary meeting he happens to conduct, and the two
   * read very differently to the man going.
   */
  serviceOverseerVisit?: boolean;
  /**
   * Field-service visit: the OTHER man of the pair, by name.
   *
   * The overseer is told whom he is taking; the assistant is told whom he is
   * going with. Neither should have to ask somebody else who else is coming.
   */
  visitWithName?: string;
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
    appointment: string | null;
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

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return fmtISO(d);
}

// A year ahead. Public talks in other congregations are arranged months in
// advance, and the home screen's «Дальше» zone is meant to answer "what is
// coming that I must prepare for" — an eight-week cut silently hid those.
// The volume is trivial: a few dozen rows per person per year.
const HORIZON_DAYS = 365;

@Injectable()
export class MeService {
  constructor(
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(ServiceGroup)
    private readonly serviceGroupsRepo: Repository<ServiceGroup>,
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
    @InjectRepository(MemorialItem)
    private readonly memorialItemsRepo: Repository<MemorialItem>,
    @InjectRepository(SpecialEvent)
    private readonly specialEventsRepo: Repository<SpecialEvent>,
    private readonly clock: CongregationClock,
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
        // Not private: every publisher already sees this in the roster. It is
        // here so a man can be told his own standing on his own screen without
        // fetching the whole roster to find himself in it.
        appointment: me.appointment ?? null,
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

    // Field names only — no old number, no new one. The journal has to answer
    // "who changed my phone and when", and it can do that without becoming a
    // permanent second copy of everyone's contact history.
    const changed = (['mobilePhone', 'email', 'address'] as const).filter(
      (f) => (before as Record<string, unknown>)[f] !== (me[f] ?? null),
    );

    await this.auditLogService.logFieldsChanged({
      tenantId,
      entityType: 'publisher',
      entityId: me.id,
      actorUserId: userId,
      subjectId: me.userId ?? null,
      fields: [...changed],
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
    // The Memorial is a third kind, and the drawer has only two tabs — so its
    // marks go on the kind it TOOK. Without this a brother could open the week
    // (the list now offers it) and find no sign that anything there was his.
    const memorialWeeks = new Map<string, SpecialEvent>();
    const memorialEvents = await this.specialEventsRepo.find({
      where: { congregationId: tenantId, type: 'memorial' },
    });
    for (const event of memorialEvents) {
      memorialWeeks.set(mondayOf(event.date), event);
    }
    const memorialMark = (week: string, what: 'parts' | 'duties'): void => {
      const event = memorialWeeks.get(week);
      if (!event) return;
      const m = mark(week);
      const kind = memorialTakesKind(event.date);
      if (what === 'duties') {
        if (kind === 'midweek') m.midweekDuties = true;
        else m.weekendDuties = true;
      } else {
        if (kind === 'midweek') m.midweekParts = true;
        else m.weekendParts = true;
      }
    };

    for (const r of duties) {
      const week = fmtISO(new Date(r.week));
      if (r.eventType === 'memorial') {
        memorialMark(week, 'duties');
        continue;
      }
      const m = mark(week);
      if (r.eventType === 'midweek') m.midweekDuties = true;
      if (r.eventType === 'weekend') m.weekendDuties = true;
    }

    // A programme line of a PUBLISHED Memorial — the same bar the personal
    // list uses, since an unfinished sheet is nobody's assignment yet.
    const publishedMemorials = memorialEvents.filter(
      (e) => !!e.memorialPublishedAt,
    );
    if (publishedMemorials.length > 0) {
      const lines = await this.memorialItemsRepo.find({
        where: {
          congregationId: tenantId,
          specialEventId: In(publishedMemorials.map((e) => e.id)),
          publisherId: pid,
        },
      });
      const eventById = new Map(publishedMemorials.map((e) => [e.id, e]));
      for (const line of lines) {
        const event = eventById.get(line.specialEventId);
        if (!event) continue;
        memorialMark(mondayOf(event.date), 'parts');
      }
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
      // The visit belongs to the assistant as much as to the man conducting:
      // he goes to that group, on that day, and until now nothing told him so.
      .andWhere(
        '(f.conductor_publisher_id = :pid OR f.service_overseer_publisher_id = :pid OR f.service_overseer_assistant_id = :pid)',
        { pid },
      )
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
    const today = await this.clock.todayFor(tenantId);
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
    // Names of the other halves of the pairs, fetched once for all of them.
    const partnerIds = new Set<string>();
    for (const a of meetings) {
      const other =
        a.assistantPublisherId === pid ? a.publisherId : a.assistantPublisherId;
      if (other) partnerIds.add(other);
    }
    const partners = partnerIds.size
      ? await this.publishersRepo.find({
          where: { congregationId: tenantId, id: In([...partnerIds]) },
        })
      : [];
    const partnerName = new Map(
      partners.map((p) => [p.id, `${p.lastName} ${p.firstName}`.trim()]),
    );

    for (const a of meetings) {
      const otherId =
        a.assistantPublisherId === pid ? a.publisherId : a.assistantPublisherId;
      items.push({
        kind: 'meeting',
        sortDate: a.weekStartDate,
        weekStartDate: a.weekStartDate,
        eventType: a.eventType,
        label: a.partTitle || a.partKey,
        partKey: a.partKey,
        partOrder: a.partOrder,
        asAssistant: a.assistantPublisherId === pid,
        partnerName: otherId ? partnerName.get(otherId) : undefined,
      });
    }

    // ---- The Memorial: the evening brings its own day ----
    //
    // Everything else on this list is dated from the week's settings, and the
    // Memorial is in neither of them: it is a third kind of meeting, held on
    // a day of its own, at an hour of its own, sometimes in a rented room.
    // The event knows all three, so it is asked once here and used twice
    // below — for its places, and for its programme.
    const memorials = await this.specialEventsRepo.find({
      where: {
        congregationId: tenantId,
        type: 'memorial',
        date: Between(weekFloor, horizon),
      },
    });
    const memorialByWeek = new Map<string, SpecialEvent>();
    for (const event of memorials) {
      memorialByWeek.set(mondayOf(event.date), event);
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
      // A place at the Memorial used to arrive with a week and nothing else,
      // so a brother on the parking saw «the week of 30 March» where everyone
      // else saw a day and an hour.
      const event =
        d.eventType === 'memorial'
          ? memorialByWeek.get(d.weekStartDate)
          : undefined;
      items.push({
        kind: 'duty',
        sortDate: event?.date ?? d.weekStartDate,
        weekStartDate: d.weekStartDate,
        date: event?.date,
        eventType: d.eventType,
        time: event?.time ?? undefined,
        location: event?.address ?? undefined,
        label: d.customLabel || d.dutyType,
        slotIndex: d.slotIndex,
      });
    }

    // ---- The Memorial programme ----
    //
    // It lives in `memorial_items`, not in `assignments`, so nothing above
    // reaches it: the brother saying the prayer for the bread had no line
    // anywhere on his own list. Only a PUBLISHED evening counts — an unfinished
    // sheet is the reason publishing exists at all, exactly as a draft
    // programme stays out of this list for the other two meetings.
    const publishedMemorials = memorials.filter((e) => !!e.memorialPublishedAt);
    if (publishedMemorials.length > 0) {
      const lines = await this.memorialItemsRepo.find({
        where: {
          congregationId: tenantId,
          specialEventId: In(publishedMemorials.map((e) => e.id)),
          publisherId: pid,
        },
        order: { sortOrder: 'ASC' },
      });
      const eventById = new Map(publishedMemorials.map((e) => [e.id, e]));
      for (const line of lines) {
        const event = eventById.get(line.specialEventId);
        if (!event) continue;
        items.push({
          kind: 'meeting',
          sortDate: event.date,
          weekStartDate: mondayOf(event.date),
          date: event.date,
          eventType: 'memorial',
          time: event.time ?? undefined,
          location: event.address ?? undefined,
          label: line.label,
          partKey: line.partKey ?? undefined,
          partOrder: line.sortOrder,
        });
      }
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
    // Group names and the other man of each pair, fetched once for all of the
    // visits rather than one query per row.
    const visitGroupIds = new Set<string>();
    const visitPeerIds = new Set<string>();
    for (const f of fieldMeetings) {
      if (f.serviceGroupId) visitGroupIds.add(f.serviceGroupId);
      if (!f.serviceOverseerVisit) continue;
      const peer =
        f.serviceOverseerAssistantId === pid
          ? f.serviceOverseerPublisherId
          : f.serviceOverseerAssistantId;
      if (peer) visitPeerIds.add(peer);
    }
    const visitGroups = visitGroupIds.size
      ? await this.serviceGroupsRepo.find({
          where: { congregationId: tenantId, id: In([...visitGroupIds]) },
        })
      : [];
    const groupNameById = new Map(visitGroups.map((g) => [g.id, g.name]));
    const visitPeers = visitPeerIds.size
      ? await this.publishersRepo.find({
          where: { congregationId: tenantId, id: In([...visitPeerIds]) },
        })
      : [];
    const peerNameById = new Map(
      visitPeers.map((p) => [p.id, `${p.lastName} ${p.firstName}`.trim()]),
    );

    for (const f of fieldMeetings) {
      const exact = addDaysISO(f.weekStartDate, (f.dayOfWeek ?? 1) - 1);
      if (exact < today) continue;
      const peerId = f.serviceOverseerVisit
        ? f.serviceOverseerAssistantId === pid
          ? f.serviceOverseerPublisherId
          : f.serviceOverseerAssistantId
        : null;
      items.push({
        kind: 'field_service',
        sortDate: exact,
        weekStartDate: f.weekStartDate,
        dayOfWeek: f.dayOfWeek,
        time: f.startTime,
        label: f.address,
        location: f.address,
        serviceOverseerVisit: !!f.serviceOverseerVisit,
        asOverseerAssistant:
          f.serviceOverseerVisit && f.serviceOverseerAssistantId === pid,
        groupName: f.serviceGroupId
          ? groupNameById.get(f.serviceGroupId)
          : undefined,
        visitWithName: peerId ? peerNameById.get(peerId) : undefined,
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
