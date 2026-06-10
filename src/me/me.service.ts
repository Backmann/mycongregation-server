import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { CartShiftParticipant } from '../entities/cart-shift-participant.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';

export type MyAssignmentKind =
  | 'meeting'
  | 'duty'
  | 'cleaning'
  | 'cart'
  | 'field_service';

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
  location?: string;
  asAssistant?: boolean;
}

export interface MyPublisherResponse {
  publisher: {
    id: string;
    displayName: string;
    firstName: string;
    lastName: string;
    pioneerType: string | null;
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
    @InjectRepository(CartShiftParticipant)
    private readonly cartPartsRepo: Repository<CartShiftParticipant>,
    @InjectRepository(FieldServiceMeeting)
    private readonly fieldRepo: Repository<FieldServiceMeeting>,
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
      .andWhere("a.status != 'cancelled'")
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
        });
      }
    }

    // ---- Cart shifts ----
    const cartParts = await this.cartPartsRepo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.shift', 's')
      .where('p.publisher_id = :pid', { pid })
      .andWhere('s.congregation_id = :tenantId', { tenantId })
      .andWhere('s.date BETWEEN :from AND :to', { from: today, to: horizon })
      .orderBy('s.date', 'ASC')
      .getMany();
    for (const p of cartParts) {
      items.push({
        kind: 'cart',
        sortDate: p.shift.date,
        date: p.shift.date,
        time: p.shift.startTime,
        endTime: p.shift.endTime,
        label: p.shift.location,
        location: p.shift.location,
      });
    }

    // ---- Field service meetings (as conductor) ----
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

    items.sort((x, y) => x.sortDate.localeCompare(y.sortDate));
    return { publisherId: pid, items };
  }
}
