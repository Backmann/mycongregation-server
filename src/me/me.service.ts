import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
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

export interface MyPublisherResponse {
  publisher: {
    id: string;
    displayName: string;
    firstName: string;
    lastName: string;
    pioneerType: string | null;
    serviceGroupId: string | null;
  } | null;
}

export interface MyAssignmentsResponse {
  publisherId: string | null;
  items: MyAssignmentItem[];
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
      },
    };
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
