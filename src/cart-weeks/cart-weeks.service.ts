import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { assertAssignable, isInactive } from '../common/inactive';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CartWeek } from '../entities/cart-week.entity';
import { CartSlot } from '../entities/cart-slot.entity';
import { CartRequest } from '../entities/cart-request.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { CartLocation } from '../entities/cart-location.entity';
import { Publisher } from '../entities/publisher.entity';
import { Absence } from '../entities/absence.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { Gender } from '../common/enums/gender.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { BuildCartWeekDto } from './dto/build-cart-week.dto';
import { CreateCartRequestDto } from './dto/create-cart-request.dto';
import { CreateCartAssignmentDto } from './dto/create-cart-assignment.dto';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CongregationClock } from '../common/congregation-clock.service';
import { SupportedLanguage } from '../common/i18n/supported-languages';
import { refusal } from '../common/errors/refusal';
import { CART_STR, ShiftLine, shiftLine, shiftLines } from './cart-strings';

function toMin(hhmm: string): number {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}
function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(
    min % 60,
  ).padStart(2, '0')}`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 1 = Monday … 7 = Sunday. */
function isoDow(iso: string): number {
  return ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** A real calendar day written as YYYY-MM-DD, and a Monday. */
export function isMondayISO(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === value &&
    d.getUTCDay() === 1
  );
}

/** Two shifts on one day that share any minute. */
export function overlaps(
  a: { date: string; startTime: string; endTime: string },
  b: { date: string; startTime: string; endTime: string },
): boolean {
  return (
    String(a.date).slice(0, 10) === String(b.date).slice(0, 10) &&
    toMin(a.startTime) < toMin(b.endTime) &&
    toMin(b.startTime) < toMin(a.endTime)
  );
}

/**
 * Who may stand at a cart (organisation of the congregation, «Проповедь в
 * общественных местах», п. 7): a BAPTIZED publisher the elders approved —
 * the switch «Стенд» on his card. A minor child may come with an approved
 * parent; it is not on the schedule.
 */
const BAPTIZED: ReadonlySet<string> = new Set([
  PublisherAppointment.PUBLISHER,
  PublisherAppointment.MINISTERIAL_SERVANT,
  PublisherAppointment.ELDER,
]);
export function approvalOf(
  p: Pick<Publisher, 'capabilities' | 'appointment'>,
): 'ok' | 'not_approved' | 'not_baptized' {
  if (!p.capabilities || p.capabilities['public_witnessing'] !== true) {
    return 'not_approved';
  }
  if (!BAPTIZED.has(String(p.appointment))) return 'not_baptized';
  return 'ok';
}

export interface GeneratedSlot {
  date: string;
  startTime: string;
  endTime: string;
  locationId: string;
}

/**
 * Pure slot generation: for each chosen day and location, emit full-step slots
 * within [startTime, endTime); any trailing remainder shorter than one step is
 * dropped. Exported for direct unit testing.
 */
export function generateCartSlots(
  weekStartDate: string,
  daysOfWeek: number[],
  locationIds: string[],
  startTime: string,
  endTime: string,
  stepMinutes: number,
): GeneratedSlot[] {
  const startMin = toMin(startTime);
  const endMin = toMin(endTime);
  const out: GeneratedSlot[] = [];
  const days = [...new Set(daysOfWeek)].sort((a, b) => a - b);
  for (const dow of days) {
    const date = addDays(weekStartDate, dow - 1);
    for (let t = startMin; t + stepMinutes <= endMin; t += stepMinutes) {
      for (const locationId of locationIds) {
        out.push({
          date,
          startTime: toHHMM(t),
          endTime: toHHMM(t + stepMinutes),
          locationId,
        });
      }
    }
  }
  return out;
}

export const CART_CAPACITY_MAX = 4;
export const CART_CAPACITY_MIN = 2;

export function computeSlotFlags(genders: (Gender | null)[]): {
  underMin: boolean;
  brotherSister: boolean;
} {
  const count = genders.length;
  const brothers = genders.filter((g) => g === Gender.BROTHER).length;
  const sisters = genders.filter((g) => g === Gender.SISTER).length;
  return {
    underMin: count === 1,
    brotherSister: count === 2 && brothers === 1 && sisters === 1,
  };
}

export interface PartnerHint {
  partnerId: string;
  name: string;
  count: number;
  lastDate: string;
}

export function computePairings(
  rows: { slotId: string; publisherId: string; date: string }[],
): Map<string, Map<string, { count: number; lastDate: string }>> {
  const bySlot = new Map<string, { pub: string; date: string }[]>();
  for (const r of rows) {
    const arr = bySlot.get(r.slotId) ?? [];
    arr.push({ pub: r.publisherId, date: r.date });
    bySlot.set(r.slotId, arr);
  }
  const out = new Map<
    string,
    Map<string, { count: number; lastDate: string }>
  >();
  const link = (a: string, b: string, date: string) => {
    const m =
      out.get(a) ?? new Map<string, { count: number; lastDate: string }>();
    const e = m.get(b) ?? { count: 0, lastDate: '' };
    e.count += 1;
    if (date > e.lastDate) e.lastDate = date;
    m.set(b, e);
    out.set(a, m);
  };
  for (const people of bySlot.values()) {
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        if (people[i].pub === people[j].pub) continue;
        link(people[i].pub, people[j].pub, people[i].date);
        link(people[j].pub, people[i].pub, people[j].date);
      }
    }
  }
  return out;
}

/**
 * Whether a wish is still a wish in the person's own eyes. Before the week is
 * published every wish is; after it, only one made AFTER publication — a
 * request for a free place. A wish that was not granted is not shown to its
 * author any more, and nothing is said to him about it (Lionel, 2 November
 * 2026: he sees that he is not on the list; telling him would only sting).
 */
export function isOpenWish(
  requestCreatedAt: Date,
  weekPublishedAt: Date | null,
  published: boolean,
): boolean {
  if (!published) return true;
  if (!weekPublishedAt) return false;
  return requestCreatedAt.getTime() > weekPublishedAt.getTime();
}

export interface CartAssignmentView {
  id: string;
  publisherId: string | null;
  name: string;
  gender: string | null;
  external: boolean;
  /** Away that day (an absence) — told to whoever arranges, only. */
  absent?: boolean;
}
export interface CartRequestView {
  publisherId: string;
  name: string;
  withWhomNote: string | null;
  /** Made after publication: a request for a free place, not a plan wish. */
  late: boolean;
  absent: boolean;
}
export interface SlotWarnings {
  underMin: boolean;
  brotherSister: boolean;
  secondShiftSameDay: boolean;
}
export interface CartSlotView {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  locationId: string;
  locationName: string;
  locationKind: string;
  /** Where the equipment is fetched from; null when nobody said. */
  equipmentAt: string | null;
  capacityMax: number;
  /** Called off, with the optional reason; null when it goes ahead. */
  cancelled: { reason: string | null } | null;
  /** Begun already (the congregation's own clock): nothing to sign up to. */
  started: boolean;
  myRequest: boolean;
  myAssignment?: boolean;
  assignedCount?: number;
  requestCount?: number;
  assignments?: CartAssignmentView[];
  requests?: CartRequestView[];
  warnings?: SlotWarnings;
}
export interface CartWeekView {
  id: string;
  weekStartDate: string;
  status: string;
  startTime: string;
  endTime: string;
  stepMinutes: number;
  /** May this reader arrange the week (build, distribute, publish)? */
  canManage: boolean;
  /** May this reader sign up at all (approved and baptized)? */
  canApply: boolean;
  slots: CartSlotView[];
}

const MANAGERS = [
  ResponsibilityType.PUBLIC_WITNESSING,
  ResponsibilityType.SERVICE_OVERSEER,
  ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
];

@Injectable()
export class CartWeeksService {
  private readonly logger = new Logger(CartWeeksService.name);

  constructor(
    @InjectRepository(CartWeek)
    private readonly weeksRepo: Repository<CartWeek>,
    @InjectRepository(CartSlot)
    private readonly slotsRepo: Repository<CartSlot>,
    @InjectRepository(CartRequest)
    private readonly requestsRepo: Repository<CartRequest>,
    @InjectRepository(CartAssignment)
    private readonly assignmentsRepo: Repository<CartAssignment>,
    @InjectRepository(CartLocation)
    private readonly locationsRepo: Repository<CartLocation>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    private readonly notifications: NotificationsService,
    private readonly clock: CongregationClock,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---------------------------------------------------------------- time --

  /** The congregation's own «now»: today and the minute of the day. */
  private async nowFor(
    congregationId: string,
  ): Promise<{ today: string; minute: number }> {
    const [today, minute] = await Promise.all([
      this.clock.todayFor(congregationId),
      this.clock.minutesOfDayFor(congregationId),
    ]);
    return { today, minute };
  }
  private static hasBegun(
    s: { date: string; startTime: string },
    now: { today: string; minute: number },
  ): boolean {
    const d = String(s.date).slice(0, 10);
    return (
      d < now.today || (d === now.today && toMin(s.startTime) <= now.minute)
    );
  }
  private static isOver(
    s: { date: string; endTime: string },
    now: { today: string; minute: number },
  ): boolean {
    const d = String(s.date).slice(0, 10);
    return d < now.today || (d === now.today && toMin(s.endTime) <= now.minute);
  }

  // --------------------------------------------------------------- build --

  async buildWeek(
    congregationId: string,
    userId: string,
    dto: BuildCartWeekDto,
  ): Promise<CartWeek> {
    if (!isMondayISO(dto.weekStartDate)) {
      throw new BadRequestException(
        refusal('WEEK_NOT_MONDAY', 'weekStartDate must be a Monday.'),
      );
    }
    const startMin = toMin(dto.startTime);
    const endMin = toMin(dto.endTime);
    if (endMin - startMin < dto.stepMinutes) {
      throw new BadRequestException(
        refusal('CART_WINDOW_TOO_SHORT', 'Window is smaller than one step'),
      );
    }
    const uniqueLocationIds = [...new Set(dto.locationIds)];
    const locations = await this.locationsRepo.find({
      where: { id: In(uniqueLocationIds), congregationId },
    });
    if (locations.length !== uniqueLocationIds.length) {
      throw new BadRequestException(
        refusal('CART_NO_SUCH_LOCATION', 'Unknown location'),
      );
    }
    const gen = generateCartSlots(
      dto.weekStartDate,
      dto.daysOfWeek,
      uniqueLocationIds,
      dto.startTime,
      dto.endTime,
      dto.stepMinutes,
    );
    const { week, added } = await this.addSlots(
      congregationId,
      userId,
      dto.weekStartDate,
      { startTime: dto.startTime, endTime: dto.endTime, step: dto.stepMinutes },
      gen,
    );
    await this.journalWeek(congregationId, week, 'CREATE', { added });
    return week;
  }

  /**
   * «Повторить прошлую неделю»: the same days, hours and places as a week
   * before — and nobody on them. Who stands is new every week: publishers
   * mark what they can, and whoever arranges puts the crews together
   * (Lionel, 2 November 2026). A place switched off since is left out.
   */
  async copyWeek(
    congregationId: string,
    userId: string,
    weekStartDate: string,
    fromWeekStartDate?: string,
  ): Promise<{ week: CartWeek; added: number }> {
    if (!isMondayISO(weekStartDate)) {
      throw new BadRequestException(
        refusal('WEEK_NOT_MONDAY', 'weekStartDate must be a Monday.'),
      );
    }
    if (fromWeekStartDate !== undefined && !isMondayISO(fromWeekStartDate)) {
      throw new BadRequestException(
        refusal('WEEK_NOT_MONDAY', 'fromWeekStartDate must be a Monday.'),
      );
    }
    // The nearest earlier week that has shifts, unless one was named.
    const source = await this.weeksRepo
      .createQueryBuilder('w')
      .where('w.congregation_id = :congregationId', { congregationId })
      .andWhere(
        fromWeekStartDate
          ? 'w.week_start_date = :from'
          : 'w.week_start_date < :target',
        { from: fromWeekStartDate, target: weekStartDate },
      )
      .andWhere('EXISTS (SELECT 1 FROM cart_slots s WHERE s.week_id = w.id)')
      .orderBy('w.week_start_date', 'DESC')
      .getOne();
    if (!source || source.weekStartDate === weekStartDate) {
      throw new BadRequestException(
        refusal('CART_NOTHING_TO_COPY', 'There is no earlier week to repeat'),
      );
    }
    const slots = await this.slotsRepo.find({
      where: { weekId: source.id, congregationId },
      relations: { location: true },
    });
    const gen: GeneratedSlot[] = slots
      .filter((s) => s.location?.isActive !== false)
      .map((s) => ({
        date: addDays(weekStartDate, isoDow(String(s.date)) - 1),
        startTime: String(s.startTime).slice(0, 5),
        endTime: String(s.endTime).slice(0, 5),
        locationId: s.locationId,
      }));
    const { week, added } = await this.addSlots(
      congregationId,
      userId,
      weekStartDate,
      {
        startTime: source.startTime,
        endTime: source.endTime,
        step: source.stepMinutes,
      },
      gen,
    );
    await this.journalWeek(congregationId, week, 'CREATE', {
      added,
      copiedFrom: source.weekStartDate,
    });
    return { week, added };
  }

  /**
   * Shifts are only ever ADDED to a week: a day or a place more. A week
   * already published takes them as well — they are simply free places.
   */
  private async addSlots(
    congregationId: string,
    userId: string,
    weekStartDate: string,
    window: { startTime: string; endTime: string; step: number },
    gen: GeneratedSlot[],
  ): Promise<{ week: CartWeek; added: number }> {
    return this.weeksRepo.manager.transaction(async (em) => {
      // Two people building the same week at once must not make two weeks or
      // the same shift twice.
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `cart-week:${congregationId}:${weekStartDate}`,
      ]);
      let week = await em.findOne(CartWeek, {
        where: { congregationId, weekStartDate },
      });
      if (!week) {
        week = await em.save(
          em.create(CartWeek, {
            congregationId,
            weekStartDate,
            status: 'draft',
            startTime: window.startTime,
            endTime: window.endTime,
            stepMinutes: window.step,
            createdById: userId,
          }),
        );
      }
      const existing = await em.find(CartSlot, { where: { weekId: week.id } });
      const seen = new Set(
        existing.map(
          (s) =>
            `${String(s.date).slice(0, 10)}|${s.locationId}|${String(s.startTime).slice(0, 5)}`,
        ),
      );
      const toCreate: GeneratedSlot[] = [];
      for (const g of gen) {
        const k = `${g.date}|${g.locationId}|${g.startTime}`;
        if (seen.has(k)) continue;
        seen.add(k);
        toCreate.push(g);
      }
      if (toCreate.length > 0) {
        const weekId = week.id;
        await em.save(
          toCreate.map((g) =>
            em.create(CartSlot, {
              congregationId,
              weekId,
              date: g.date,
              startTime: g.startTime,
              endTime: g.endTime,
              locationId: g.locationId,
            }),
          ),
        );
      }
      return { week, added: toCreate.length };
    });
  }

  /** A single shift that was planned by mistake — only while nobody is on it. */
  async deleteSlot(congregationId: string, slotId: string): Promise<void> {
    const slot = await this.slotsRepo.findOne({
      where: { id: slotId, congregationId },
      relations: { location: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    const people = await this.assignmentsRepo.count({ where: { slotId } });
    if (people > 0) {
      throw new ConflictException(
        refusal(
          'CART_SLOT_HAS_PEOPLE',
          'People stand in this shift; cancel it instead of deleting it',
        ),
      );
    }
    const detail = this.slotDetail(slot);
    await this.slotsRepo.remove(slot);
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'cart_slot',
      entityId: slotId,
      action: 'DELETE',
      detail,
    });
  }

  async openWeek(congregationId: string, id: string): Promise<CartWeek> {
    const week = await this.weeksRepo.findOne({
      where: { id, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    if (week.status !== 'draft') {
      throw new BadRequestException(
        refusal('CART_WEEK_NOT_DRAFT', 'Only a draft week can be opened'),
      );
    }
    week.status = 'collecting';
    const saved = await this.weeksRepo.save(week);
    await this.journalWeek(congregationId, saved, 'UPDATE', {
      status: 'collecting',
    });
    // Everybody who may sign up hears that he may (Lionel, 2 November 2026)
    // — the switch on his card, baptized, not inactive. Nobody else.
    const eligible = await this.publishersRepo.find({
      where: {
        congregationId,
        userId: Not(IsNull()),
        status: Not(PublisherStatus.INACTIVE),
      },
    });
    const userIds = eligible
      .filter((p) => p.isActive !== false && approvalOf(p) === 'ok')
      .map((p) => p.userId as string);
    await this.notify(
      congregationId,
      userIds,
      (l) => ({
        title: CART_STR[l].openTitle,
        body: CART_STR[l].openBody(week.weekStartDate),
      }),
      { type: 'cart_open', weekStart: week.weekStartDate },
      `cart-open:${week.id}`,
    );
    return saved;
  }

  async deleteWeek(congregationId: string, id: string): Promise<void> {
    const week = await this.weeksRepo.findOne({
      where: { id, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    // A published week with people still to stand is their plan: it is
    // changed by cancelling shifts — which tells them — not wiped silently.
    if (week.status === 'published') {
      const now = await this.nowFor(congregationId);
      const rows: { date: string; end_time: string }[] =
        await this.slotsRepo.query(
          `SELECT s.date::text AS date, s.end_time FROM cart_slots s
            WHERE s.week_id = $1 AND s.cancelled_at IS NULL
              AND EXISTS (SELECT 1 FROM cart_assignments a WHERE a.slot_id = s.id)`,
          [week.id],
        );
      if (
        rows.some(
          (r) =>
            !CartWeeksService.isOver(
              { date: r.date, endTime: r.end_time },
              now,
            ),
        )
      ) {
        throw new ConflictException(
          refusal(
            'CART_WEEK_HAS_PEOPLE',
            'People are still to stand in this week; cancel its shifts instead',
          ),
        );
      }
    }
    const detail = {
      date: week.weekStartDate,
      status: week.status,
    };
    const weekId = week.id;
    await this.weeksRepo.remove(week);
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'cart_week',
      entityId: weekId,
      action: 'DELETE',
      detail,
    });
  }

  // ---------------------------------------------------------------- read --

  private async isManager(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(MANAGERS),
      },
    });
    return held > 0;
  }

  private async myPublisher(
    congregationId: string,
    userId: string,
  ): Promise<Publisher | null> {
    return this.publishersRepo.findOne({ where: { congregationId, userId } });
  }

  async getWeek(
    congregationId: string,
    weekStart: string,
    user: AuthenticatedUser,
  ): Promise<CartWeekView | null> {
    if (!isMondayISO(weekStart)) {
      throw new BadRequestException(
        refusal('WEEK_NOT_MONDAY', 'weekStart must be a Monday.'),
      );
    }
    const week = await this.weeksRepo.findOne({
      where: { congregationId, weekStartDate: weekStart },
    });
    if (!week) return null;
    const manager = await this.isManager(user);
    const me = await this.myPublisher(congregationId, user.id);
    const myPid = me ? me.id : null;
    const canApply = !!me && approvalOf(me) === 'ok' && !isInactive(me);
    const published = week.status === 'published';
    const base = {
      id: week.id,
      weekStartDate: week.weekStartDate,
      status: week.status,
      startTime: week.startTime,
      endTime: week.endTime,
      stepMinutes: week.stepMinutes,
      canManage: manager,
      canApply,
    };
    // A draft is the arranger's own sketch: the others learn the week exists,
    // nothing of what is in it (it was served whole to anyone who asked).
    if (week.status === 'draft' && !manager) return { ...base, slots: [] };

    const slots = await this.slotsRepo.find({
      where: { weekId: week.id, congregationId },
      relations: { location: true },
      order: { date: 'ASC', startTime: 'ASC' },
    });
    const slotIds = slots.map((s) => s.id);
    const [requests, assignments, now] = await Promise.all([
      slotIds.length
        ? this.requestsRepo.find({ where: { slotId: In(slotIds) } })
        : Promise.resolve([] as CartRequest[]),
      slotIds.length
        ? this.assignmentsRepo.find({
            where: { slotId: In(slotIds) },
            order: { createdAt: 'ASC' },
          })
        : Promise.resolve([] as CartAssignment[]),
      this.nowFor(congregationId),
    ]);

    const pubIds = [
      ...new Set([
        ...requests.map((r) => r.publisherId),
        ...assignments
          .map((a) => a.publisherId)
          .filter((x): x is string => !!x),
      ]),
    ];
    const pubs = pubIds.length
      ? await this.publishersRepo.find({
          where: { id: In(pubIds), congregationId },
        })
      : [];
    const pubById = new Map(pubs.map((p) => [p.id, p]));
    const nameOf = (id: string): string => {
      const p = pubById.get(id);
      return p ? `${p.lastName} ${p.firstName}`.trim() : '';
    };
    const awayOn = manager
      ? await this.absencesFor(congregationId, pubIds, week.weekStartDate)
      : () => false;

    const reqBySlot = new Map<string, CartRequest[]>();
    for (const r of requests) {
      reqBySlot.set(r.slotId, [...(reqBySlot.get(r.slotId) ?? []), r]);
    }
    const asgBySlot = new Map<string, CartAssignment[]>();
    for (const a of assignments) {
      asgBySlot.set(a.slotId, [...(asgBySlot.get(a.slotId) ?? []), a]);
    }
    const slotDate = new Map(slots.map((s) => [s.id, String(s.date)]));
    const dayPub = new Map<string, number>();
    for (const a of assignments) {
      if (!a.publisherId) continue;
      const key = `${a.publisherId}|${slotDate.get(a.slotId)}`;
      dayPub.set(key, (dayPub.get(key) ?? 0) + 1);
    }

    return {
      ...base,
      slots: slots.map((s) => {
        const date = String(s.date).slice(0, 10);
        const asgs = asgBySlot.get(s.id) ?? [];
        const reqs = reqBySlot.get(s.id) ?? [];
        const genders: (Gender | null)[] = asgs.map((a) =>
          a.publisherId ? (pubById.get(a.publisherId)?.gender ?? null) : null,
        );
        const assignmentsView: CartAssignmentView[] = asgs.map((a) => ({
          id: a.id,
          publisherId: a.publisherId,
          name: a.publisherId ? nameOf(a.publisherId) : (a.externalName ?? ''),
          gender: a.publisherId
            ? (pubById.get(a.publisherId)?.gender ?? null)
            : null,
          external: !a.publisherId,
          ...(manager
            ? { absent: !!a.publisherId && awayOn(a.publisherId, date) }
            : {}),
        }));
        const mine = !!myPid && asgs.some((a) => a.publisherId === myPid);
        const myWish =
          !!myPid &&
          reqs.some(
            (r) =>
              r.publisherId === myPid &&
              isOpenWish(r.createdAt, week.publishedAt, published),
          );
        const view: CartSlotView = {
          id: s.id,
          date,
          startTime: String(s.startTime).slice(0, 5),
          endTime: String(s.endTime).slice(0, 5),
          locationId: s.locationId,
          locationName: s.location?.name ?? '',
          locationKind: s.location?.kind ?? 'cart',
          equipmentAt: s.location?.equipmentAt ?? null,
          capacityMax: CART_CAPACITY_MAX,
          cancelled: s.cancelledAt ? { reason: s.cancelReason } : null,
          started: CartWeeksService.hasBegun(s, now),
          myRequest: myWish && !mine,
        };
        if (manager) {
          const flags = computeSlotFlags(genders);
          view.assignedCount = asgs.length;
          view.requestCount = reqs.length;
          view.requests = reqs.map((r) => ({
            publisherId: r.publisherId,
            name: nameOf(r.publisherId),
            withWhomNote: r.withWhomNote,
            late:
              published && !!week.publishedAt && r.createdAt > week.publishedAt,
            absent: awayOn(r.publisherId, date),
          }));
          view.assignments = assignmentsView;
          view.myAssignment = mine;
          view.warnings = {
            underMin: flags.underMin,
            brotherSister: flags.brotherSister,
            secondShiftSameDay: asgs.some(
              (a) =>
                !!a.publisherId &&
                (dayPub.get(`${a.publisherId}|${s.date}`) ?? 0) > 1,
            ),
          };
        } else if (published) {
          view.assignedCount = asgs.length;
          view.assignments = assignmentsView;
          view.myAssignment = mine;
        }
        return view;
      }),
    };
  }

  /** «Is he away that day?» for the people of one week, in one query. */
  private async absencesFor(
    congregationId: string,
    publisherIds: string[],
    weekStart: string,
  ): Promise<(publisherId: string, date: string) => boolean> {
    if (publisherIds.length === 0) return () => false;
    const weekEnd = addDays(weekStart, 6);
    const rows = await this.slotsRepo.manager
      .getRepository(Absence)
      .createQueryBuilder('a')
      .where('a.congregation_id = :congregationId', { congregationId })
      .andWhere('a.publisher_id IN (:...ids)', { ids: publisherIds })
      .andWhere('a.start_date <= :weekEnd', { weekEnd })
      .andWhere('(a.end_date IS NULL OR a.end_date >= :weekStart)', {
        weekStart,
      })
      .getMany();
    return (pid, date) =>
      rows.some(
        (r) =>
          r.publisherId === pid &&
          String(r.startDate).slice(0, 10) <= date &&
          (!r.endDate || String(r.endDate).slice(0, 10) >= date),
      );
  }

  // ---------------------------------------------------------- distribute --

  async assignToSlot(
    congregationId: string,
    slotId: string,
    user: AuthenticatedUser,
    dto: CreateCartAssignmentDto,
  ): Promise<CartAssignment> {
    const hasPub = !!dto.publisherId;
    const hasExt = !!dto.externalName && dto.externalName.trim().length > 0;
    if (hasPub === hasExt) {
      throw new BadRequestException(
        refusal(
          'CART_WHO_ONE',
          'Provide exactly one of publisherId or externalName',
        ),
      );
    }
    await assertAssignable(this.slotsRepo.manager, congregationId, [
      dto.publisherId,
    ]);
    let pub: Publisher | null = null;
    if (hasPub) {
      pub = await this.publishersRepo.findOne({
        where: { id: dto.publisherId, congregationId },
      });
      if (!pub)
        throw new BadRequestException(
          refusal('NO_SUCH_PUBLISHER', 'Unknown publisher'),
        );
      const approval = approvalOf(pub);
      if (approval === 'not_approved') {
        throw new BadRequestException(
          refusal(
            'CART_NOT_APPROVED',
            'Public witnessing is not marked on this publisher’s card',
          ),
        );
      }
      if (approval === 'not_baptized') {
        throw new BadRequestException(
          refusal(
            'CART_NOT_BAPTIZED',
            'Only baptized publishers take part in public witnessing',
          ),
        );
      }
    }

    const { saved, slot, week } = await this.slotsRepo.manager.transaction(
      async (em) => {
        // The shift's row is held while it is counted and filled: two taps at
        // once put six people into a shift of four on the stand.
        const slot = await em.findOne(CartSlot, {
          where: { id: slotId, congregationId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!slot) throw new NotFoundException('Slot not found');
        const week = await em.findOne(CartWeek, { where: { id: slot.weekId } });
        if (!week || week.status === 'draft') {
          throw new BadRequestException(
            refusal('CART_WEEK_CLOSED', 'Week is not open for assignment'),
          );
        }
        if (slot.cancelledAt) {
          throw new BadRequestException(
            refusal('CART_SLOT_CANCELLED', 'This shift is cancelled'),
          );
        }
        const current = await em.count(CartAssignment, { where: { slotId } });
        if (current >= CART_CAPACITY_MAX) {
          throw new BadRequestException(
            refusal('CART_SLOT_FULL', 'Slot is full'),
          );
        }
        if (hasPub) {
          await this.assertFreeAt(em, congregationId, dto.publisherId!, slot);
        }
        const saved = await em.save(
          em.create(CartAssignment, {
            congregationId,
            slotId,
            publisherId: hasPub ? dto.publisherId! : null,
            externalName: hasPub ? null : dto.externalName!.trim(),
            createdById: user.id,
          }),
        );
        return { saved, slot, week };
      },
    );

    slot.location = (await this.locationsRepo.findOne({
      where: { id: slot.locationId },
    }))!;
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_assignment',
      entityId: saved.id,
      action: 'CREATE',
      subjectId: saved.publisherId,
      detail: {
        ...this.slotDetail(slot),
        ...(saved.publisherId ? {} : { guest: saved.externalName }),
      },
    });
    // In a published week the person learns at once; before publication the
    // whole plan reaches him in one message when it is published.
    if (
      week.status === 'published' &&
      pub?.userId &&
      !CartWeeksService.isOver(slot, await this.nowFor(congregationId))
    ) {
      const line = await this.lineFor(slot, pub.id);
      await this.notify(
        congregationId,
        [pub.userId],
        (l) => ({
          title: CART_STR[l].assignedTitle,
          body: shiftLine(line, l),
        }),
        { type: 'cart_assigned', weekStart: week.weekStartDate },
        `cart-assigned:${saved.id}`,
      );
    }
    return saved;
  }

  /**
   * The same person in two shifts that share an hour — two places at once.
   * Held per person, so two taps at once cannot both pass.
   */
  private async assertFreeAt(
    em: EntityManager,
    congregationId: string,
    publisherId: string,
    slot: CartSlot,
  ): Promise<void> {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `cart-person:${publisherId}`,
    ]);
    const already = await em.count(CartAssignment, {
      where: { slotId: slot.id, publisherId },
    });
    if (already > 0) {
      throw new BadRequestException(
        refusal('CART_ALREADY_ASSIGNED', 'Already assigned'),
      );
    }
    const sameDay: { start_time: string; end_time: string }[] = await em.query(
      `SELECT s.start_time, s.end_time
         FROM cart_assignments a JOIN cart_slots s ON s.id = a.slot_id
        WHERE a.congregation_id = $1 AND a.publisher_id = $2
          AND s.date = $3 AND s.cancelled_at IS NULL AND s.id <> $4`,
      [congregationId, publisherId, String(slot.date).slice(0, 10), slot.id],
    );
    if (
      sameDay.some((o) =>
        overlaps(slot, {
          date: slot.date,
          startTime: o.start_time,
          endTime: o.end_time,
        }),
      )
    ) {
      throw new BadRequestException(
        refusal(
          'CART_TIME_CLASH',
          'This person already stands somewhere else at this hour',
        ),
      );
    }
  }

  async removeAssignment(
    congregationId: string,
    slotId: string,
    assignmentId: string,
  ): Promise<void> {
    const asg = await this.assignmentsRepo.findOne({
      where: { id: assignmentId, slotId, congregationId },
    });
    if (!asg) throw new NotFoundException('Assignment not found');
    const slot = await this.slotsRepo.findOne({
      where: { id: slotId, congregationId },
      relations: { location: true, week: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    const line = asg.publisherId
      ? await this.lineFor(slot, asg.publisherId)
      : null;
    const pub = asg.publisherId
      ? await this.publishersRepo.findOne({
          where: { id: asg.publisherId, congregationId },
        })
      : null;
    await this.assignmentsRepo.remove(asg);
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_assignment',
      entityId: assignmentId,
      action: 'DELETE',
      subjectId: pub?.id ?? null,
      detail: {
        ...this.slotDetail(slot),
        ...(pub ? {} : { guest: asg.externalName }),
      },
    });
    if (
      slot.week?.status === 'published' &&
      pub?.userId &&
      line &&
      !slot.cancelledAt &&
      !CartWeeksService.isOver(slot, await this.nowFor(congregationId))
    ) {
      await this.notify(
        congregationId,
        [pub.userId],
        (l) => ({
          title: CART_STR[l].unassignedTitle,
          body: shiftLine({ ...line, with: [] }, l),
        }),
        { type: 'cart_unassigned', weekStart: slot.week.weekStartDate },
        `cart-unassigned:${assignmentId}`,
      );
    }
  }

  async publishWeek(congregationId: string, id: string): Promise<CartWeek> {
    const week = await this.weeksRepo.findOne({
      where: { id, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    if (week.status !== 'collecting') {
      throw new BadRequestException(
        refusal(
          'CART_WEEK_NOT_COLLECTING',
          'Week is not in the collecting state',
        ),
      );
    }
    week.status = 'published';
    week.publishedAt = new Date();
    const saved = await this.weeksRepo.save(week);
    await this.journalWeek(congregationId, saved, 'UPDATE', {
      status: 'published',
    });

    // Each person is told HIS shifts — the day, the hour, the place and who
    // stands with him. Whoever is not on the plan is told nothing (Lionel).
    const slots = await this.slotsRepo.find({
      where: { weekId: id, congregationId, cancelledAt: IsNull() },
      relations: { location: true },
      order: { date: 'ASC', startTime: 'ASC' },
    });
    const now = await this.nowFor(congregationId);
    const ahead = slots.filter((s) => !CartWeeksService.isOver(s, now));
    const lines = await this.linesByPerson(congregationId, ahead);
    for (const [userId, mine] of lines) {
      await this.notify(
        congregationId,
        [userId],
        (l) => ({
          title: CART_STR[l].publishedTitle(mine.length),
          body: shiftLines(mine, l),
        }),
        { type: 'cart_published', weekStart: week.weekStartDate },
        // A week is published once; a second press says nothing new.
        `cart-published:${id}`,
      );
    }
    return saved;
  }

  async recentPairings(
    congregationId: string,
    weeks = 8,
  ): Promise<Record<string, PartnerHint[]>> {
    // Measured back from the congregation's own today: the UTC date is still
    // yesterday until two in the morning of a German summer.
    const today = await this.clock.todayFor(congregationId);
    const back = addDays(today, -weeks * 7);
    const rows = await this.assignmentsRepo
      .createQueryBuilder('a')
      .innerJoin('cart_slots', 's', 's.id = a.slot_id')
      .innerJoin('cart_weeks', 'w', 'w.id = s.week_id')
      .select('a.slot_id', 'slotId')
      .addSelect('a.publisher_id', 'publisherId')
      .addSelect('s.date::text', 'date')
      .where('a.congregation_id = :congregationId', { congregationId })
      .andWhere('a.publisher_id IS NOT NULL')
      .andWhere("w.status = 'published'")
      .andWhere('s.cancelled_at IS NULL')
      .andWhere('s.date BETWEEN :back AND :today', { back, today })
      .getRawMany<{ slotId: string; publisherId: string; date: string }>();
    const map = computePairings(rows);
    const ids = new Set<string>();
    for (const [pub, partners] of map) {
      ids.add(pub);
      for (const partner of partners.keys()) ids.add(partner);
    }
    const pubs = ids.size
      ? await this.publishersRepo.find({
          where: { id: In([...ids]), congregationId },
        })
      : [];
    const nameById = new Map(
      pubs.map((p) => [p.id, `${p.lastName} ${p.firstName}`.trim()]),
    );
    const out: Record<string, PartnerHint[]> = {};
    for (const [pub, partners] of map) {
      out[pub] = [...partners.entries()]
        .map(([partnerId, v]) => ({
          partnerId,
          name: nameById.get(partnerId) ?? '',
          count: v.count,
          lastDate: v.lastDate,
        }))
        .sort((x, y) => (x.lastDate < y.lastDate ? 1 : -1));
    }
    return out;
  }

  // ---------------------------------------------------------------- sign up --

  async applyToSlot(
    congregationId: string,
    slotId: string,
    user: AuthenticatedUser,
    dto: CreateCartRequestDto,
  ): Promise<CartRequest> {
    const me = await this.myPublisher(congregationId, user.id);
    if (!me)
      throw new ForbiddenException(
        refusal('NO_OWN_CARD', 'No publisher profile'),
      );
    // Inactive: no sign-up (1 November 2026). The words send him to the
    // elders and name no standing — asked first, so that nothing else is
    // said to him instead.
    if (isInactive(me)) {
      throw new ForbiddenException(
        refusal(
          'SIGNUP_UNAVAILABLE',
          'Signing up is not available at the moment; please speak to the elders.',
        ),
      );
    }
    if (approvalOf(me) !== 'ok') {
      throw new ForbiddenException(
        refusal('CART_NOT_ELIGIBLE', 'Not eligible for cart witnessing'),
      );
    }
    const slot = await this.slotsRepo.findOne({
      where: { id: slotId, congregationId },
      relations: { week: true, location: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (!slot.week || slot.week.status === 'draft') {
      throw new BadRequestException(
        refusal('CART_WEEK_NO_REQUESTS', 'Week is not open for requests'),
      );
    }
    if (slot.cancelledAt) {
      throw new BadRequestException(
        refusal('CART_SLOT_CANCELLED', 'This shift is cancelled'),
      );
    }
    if (CartWeeksService.hasBegun(slot, await this.nowFor(congregationId))) {
      throw new BadRequestException(
        refusal('CART_SLOT_PAST', 'This shift has already begun'),
      );
    }
    const published = slot.week.status === 'published';
    if (published) {
      const people = await this.assignmentsRepo.find({ where: { slotId } });
      if (people.some((a) => a.publisherId === me.id)) {
        throw new BadRequestException(
          refusal('CART_ALREADY_ASSIGNED', 'Already assigned'),
        );
      }
      if (people.length >= CART_CAPACITY_MAX) {
        throw new BadRequestException(
          refusal('CART_SLOT_FULL', 'Slot is full'),
        );
      }
    }
    const note = dto.withWhomNote?.trim() || null;
    const existing = await this.requestsRepo.findOne({
      where: { slotId, publisherId: me.id },
    });
    // A wish from before publication that was not granted is a closed
    // matter; asking again for the free place is a new request and is told
    // to whoever arranges.
    if (
      existing &&
      isOpenWish(existing.createdAt, slot.week.publishedAt, published)
    ) {
      existing.withWhomNote = note;
      return this.requestsRepo.save(existing);
    }
    if (existing) await this.requestsRepo.remove(existing);
    const created = await this.requestsRepo.save(
      this.requestsRepo.create({
        congregationId,
        slotId,
        publisherId: me.id,
        withWhomNote: note,
      }),
    );
    if (published) {
      const who = `${me.lastName} ${me.firstName}`.trim();
      const line = await this.lineFor(slot, me.id);
      await this.notify(
        congregationId,
        await this.managerUserIds(congregationId),
        (l) => ({
          title: CART_STR[l].requestTitle,
          body: CART_STR[l].requestBody(shiftLine(line, l), who),
        }),
        { type: 'cart_dobor_request', weekStart: slot.week.weekStartDate },
        `cart-request:${created.id}`,
      );
    }
    return created;
  }

  async withdrawFromSlot(
    congregationId: string,
    slotId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const me = await this.myPublisher(congregationId, user.id);
    if (!me)
      throw new ForbiddenException(
        refusal('NO_OWN_CARD', 'No publisher profile'),
      );
    await this.requestsRepo.delete({
      slotId,
      publisherId: me.id,
      congregationId,
    });
  }

  /**
   * «Не смогу» — at any moment and for any reason, which stays his own
   * (Lionel, 2 November 2026: the reason is personal, it is not asked).
   * Whoever arranges hears that the place is free again; the others in the
   * shift hear they are one fewer — nobody should find himself alone at the
   * stand without knowing.
   */
  async cancelMyAssignment(
    congregationId: string,
    slotId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const me = await this.myPublisher(congregationId, user.id);
    if (!me)
      throw new ForbiddenException(
        refusal('NO_OWN_CARD', 'No publisher profile'),
      );
    const asg = await this.assignmentsRepo.findOne({
      where: { slotId, publisherId: me.id, congregationId },
    });
    if (!asg) throw new NotFoundException('No assignment to cancel');
    const slot = await this.slotsRepo.findOne({
      where: { id: slotId, congregationId },
      relations: { location: true, week: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (CartWeeksService.isOver(slot, await this.nowFor(congregationId))) {
      throw new BadRequestException(
        refusal('CART_SLOT_PAST', 'This shift is already over'),
      );
    }
    const line = await this.lineFor(slot, me.id);
    // `remove` clears the entity's id: keep it for the journal and the keys.
    const asgId = asg.id;
    await this.assignmentsRepo.remove(asg);
    // His wish for this shift goes with it: it would otherwise stand among
    // the applicants as if he still wanted the place he just gave back.
    await this.requestsRepo.delete({ slotId, publisherId: me.id });
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_assignment',
      entityId: asgId,
      action: 'DELETE',
      subjectId: me.id,
      detail: { ...this.slotDetail(slot), self: true },
    });
    if (slot.cancelledAt) return;
    const who = `${me.lastName} ${me.firstName}`.trim();
    const managers = await this.managerUserIds(congregationId);
    const partners = await this.userIdsOf(
      congregationId,
      (await this.assignmentsRepo.find({ where: { slotId } }))
        .map((a) => a.publisherId)
        .filter((x): x is string => !!x),
    );
    const bare = { ...line, with: [] };
    await this.notify(
      congregationId,
      managers.filter((u) => u !== user.id),
      (l) => ({
        title: CART_STR[l].cancelTitle,
        body: CART_STR[l].cancelBody(shiftLine(bare, l), who),
      }),
      { type: 'cart_cancel', weekStart: slot.week?.weekStartDate },
      `cart-cancel:${asgId}`,
    );
    await this.notify(
      congregationId,
      partners.filter((u) => u !== user.id && !managers.includes(u)),
      (l) => ({
        title: CART_STR[l].partnerCancelTitle,
        body: CART_STR[l].partnerCancelBody(shiftLine(bare, l), who),
      }),
      { type: 'cart_partner_cancel', weekStart: slot.week?.weekStartDate },
      `cart-partner-cancel:${asgId}`,
    );
  }

  // ------------------------------------------------- call off / put back --

  /**
   * Call shifts off — bad weather, an unsafe day in town — keeping every
   * crew as it was, so they can be put back (Lionel, 2 November 2026). The
   * reason is optional. The people on them are told, once each, with all of
   * their shifts in one message.
   */
  async cancelSlots(
    congregationId: string,
    weekId: string,
    user: AuthenticatedUser,
    slotIds: string[],
    reason?: string,
  ): Promise<{ changed: number }> {
    return this.setCancelled(
      congregationId,
      weekId,
      user,
      slotIds,
      true,
      reason,
    );
  }

  async restoreSlots(
    congregationId: string,
    weekId: string,
    user: AuthenticatedUser,
    slotIds: string[],
  ): Promise<{ changed: number }> {
    return this.setCancelled(congregationId, weekId, user, slotIds, false);
  }

  private async setCancelled(
    congregationId: string,
    weekId: string,
    user: AuthenticatedUser,
    slotIds: string[],
    cancel: boolean,
    reason?: string,
  ): Promise<{ changed: number }> {
    const week = await this.weeksRepo.findOne({
      where: { id: weekId, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    const ids = [...new Set(slotIds)];
    const slots = await this.slotsRepo.find({
      where: { id: In(ids), weekId, congregationId },
      relations: { location: true },
      order: { date: 'ASC', startTime: 'ASC' },
    });
    if (slots.length !== ids.length) {
      throw new NotFoundException('Slot not found');
    }
    const now = await this.nowFor(congregationId);
    if (slots.some((s) => CartWeeksService.isOver(s, now))) {
      throw new BadRequestException(
        refusal('CART_SLOT_PAST', 'A shift that is over cannot be changed'),
      );
    }
    const why = cancel ? reason?.trim() || null : null;
    const changing = slots.filter((s) => !!s.cancelledAt !== cancel);
    for (const s of changing) {
      s.cancelledAt = cancel ? new Date() : null;
      s.cancelReason = why;
      s.cancelledById = cancel ? user.id : null;
    }
    if (changing.length > 0) await this.slotsRepo.save(changing);
    for (const s of changing) {
      await this.auditLog.logFact({
        tenantId: congregationId,
        entityType: 'cart_slot',
        entityId: s.id,
        action: cancel ? 'DELETE' : 'RESTORE',
        detail: {
          ...this.slotDetail(s),
          ...(cancel ? { cancelled: true } : {}),
        },
      });
    }
    // Only a published plan is anybody's plan yet.
    if (week.status === 'published' && changing.length > 0) {
      const lines = await this.linesByPerson(congregationId, changing);
      const stamp = Date.now();
      for (const [userId, mine] of lines) {
        await this.notify(
          congregationId,
          [userId],
          (l) => ({
            title: cancel
              ? CART_STR[l].shiftCancelledTitle(mine.length)
              : CART_STR[l].shiftRestoredTitle(mine.length),
            body:
              shiftLines(mine, l) +
              (cancel && why ? `\n${CART_STR[l].reason(why)}` : ''),
          }),
          {
            type: cancel ? 'cart_shift_cancelled' : 'cart_shift_restored',
            weekStart: week.weekStartDate,
          },
          // Called off and put back may happen twice in a day; each is news.
          `cart-${cancel ? 'off' : 'on'}:${week.id}:${stamp}`,
        );
      }
    }
    return { changed: changing.length };
  }

  // ------------------------------------------------------------- helpers --

  /** The facts a journal line names a shift by. */
  private slotDetail(s: CartSlot): Record<string, string> {
    return {
      date: String(s.date).slice(0, 10),
      time: `${String(s.startTime).slice(0, 5)}–${String(s.endTime).slice(0, 5)}`,
      place: s.location?.name ?? '',
    };
  }

  private async journalWeek(
    congregationId: string,
    week: CartWeek,
    action: 'CREATE' | 'UPDATE',
    facts: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_week',
      entityId: week.id,
      action,
      detail: { date: week.weekStartDate, ...facts },
    });
  }

  /** A shift as one person sees it: with whom he stands. */
  private async lineFor(
    slot: CartSlot,
    publisherId: string,
  ): Promise<ShiftLine> {
    const location =
      slot.location ??
      (await this.locationsRepo.findOne({ where: { id: slot.locationId } }));
    const crew = await this.assignmentsRepo.find({
      where: { slotId: slot.id },
      order: { createdAt: 'ASC' },
    });
    const others = crew.filter((a) => a.publisherId !== publisherId);
    const pubs = await this.publishersRepo.find({
      where: {
        id: In(
          others.map((a) => a.publisherId).filter((x): x is string => !!x),
        ),
      },
    });
    const byId = new Map(pubs.map((p) => [p.id, p]));
    return {
      date: String(slot.date).slice(0, 10),
      startTime: String(slot.startTime),
      endTime: String(slot.endTime),
      place: location?.name ?? '',
      kind: location?.kind ?? 'cart',
      with: others.map((a) =>
        a.publisherId
          ? `${byId.get(a.publisherId)?.lastName ?? ''} ${byId.get(a.publisherId)?.firstName ?? ''}`.trim()
          : (a.externalName ?? ''),
      ),
    };
  }

  /** For each signed-in person on these shifts: his lines, in order. */
  private async linesByPerson(
    congregationId: string,
    slots: CartSlot[],
  ): Promise<Map<string, ShiftLine[]>> {
    const out = new Map<string, ShiftLine[]>();
    if (slots.length === 0) return out;
    const asgs = await this.assignmentsRepo.find({
      where: { slotId: In(slots.map((s) => s.id)) },
      order: { createdAt: 'ASC' },
    });
    const pubIds = [
      ...new Set(
        asgs.map((a) => a.publisherId).filter((x): x is string => !!x),
      ),
    ];
    const pubs = pubIds.length
      ? await this.publishersRepo.find({
          where: { id: In(pubIds), congregationId },
        })
      : [];
    const byId = new Map(pubs.map((p) => [p.id, p]));
    const name = (a: CartAssignment) =>
      a.publisherId
        ? `${byId.get(a.publisherId)?.lastName ?? ''} ${byId.get(a.publisherId)?.firstName ?? ''}`.trim()
        : (a.externalName ?? '');
    for (const s of slots) {
      const crew = asgs.filter((a) => a.slotId === s.id);
      for (const a of crew) {
        const userId = a.publisherId ? byId.get(a.publisherId)?.userId : null;
        if (!userId) continue;
        const line: ShiftLine = {
          date: String(s.date).slice(0, 10),
          startTime: String(s.startTime),
          endTime: String(s.endTime),
          place: s.location?.name ?? '',
          kind: s.location?.kind ?? 'cart',
          with: crew.filter((o) => o.id !== a.id).map(name),
        };
        out.set(userId, [...(out.get(userId) ?? []), line]);
      }
    }
    return out;
  }

  private async userIdsOf(
    congregationId: string,
    publisherIds: string[],
  ): Promise<string[]> {
    if (publisherIds.length === 0) return [];
    const pubs = await this.publishersRepo.find({
      where: { id: In(publisherIds), congregationId },
    });
    return [
      ...new Set(pubs.map((p) => p.userId).filter((x): x is string => !!x)),
    ];
  }

  private async managerUserIds(congregationId: string): Promise<string[]> {
    const rows = await this.responsibilitiesRepo.find({
      where: { congregationId, type: In(MANAGERS) },
    });
    return [...new Set(rows.map((r) => r.userId).filter(Boolean))];
  }

  private async notify(
    congregationId: string,
    userIds: string[],
    text: (lang: SupportedLanguage) => { title: string; body: string },
    data: Record<string, unknown>,
    key?: string,
  ): Promise<void> {
    if (userIds.length === 0) return;
    try {
      await this.notifications.notify({
        tenantId: congregationId,
        userIds,
        text,
        kind: String(data.type ?? 'cart'),
        data,
        key,
      });
    } catch (e) {
      this.logger.warn(`cart push failed: ${String(e)}`);
    }
  }
}
