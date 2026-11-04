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
import { CartDay } from '../entities/cart-day.entity';
import { CartRequest } from '../entities/cart-request.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { CartCancellation } from '../entities/cart-cancellation.entity';
import { CartRequestPartner } from '../entities/cart-request-partner.entity';
import { CartLocation } from '../entities/cart-location.entity';
import { CartSettings } from '../entities/cart-settings.entity';
import { Publisher } from '../entities/publisher.entity';
import { Absence } from '../entities/absence.entity';
import { AuxiliaryPioneer } from '../entities/auxiliary-pioneer.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { Gender } from '../common/enums/gender.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { isActivePermanentPioneer } from '../common/pioneer-status';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CongregationClock } from '../common/congregation-clock.service';
import { SupportedLanguage } from '../common/i18n/supported-languages';
import { refusal } from '../common/errors/refusal';
import {
  CART_STR,
  CartWords,
  ShiftLine,
  shiftLine,
  shiftLines,
} from './cart-strings';
import {
  CAPACITY_MAX,
  LONG_DAY_MINUTES,
  Span,
  aloneSpans,
  coverage,
  halfHours,
  isHalfHour,
  merge,
  minus,
  minutes,
  overfull,
  overlaps,
  spanProblem,
  toHHMM,
  toMin,
} from './cart-time';
import { PersonStanding, suggest } from './cart-fairness';

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 1 = Monday … 7 = Sunday. */
function isoDow(iso: string): number {
  return ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}
const hhmm = (t: string) => String(t).slice(0, 5);
const dateOf = (d: string | Date) => String(d).slice(0, 10);

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
export function isDateISO(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Who may stand at a cart (organisation of the congregation, «Проповедь в
 * общественных местах», п. 7): a BAPTIZED publisher the elders approved —
 * the switch «Стенд» on his card. A minor child may come with an approved
 * parent; it is not on the plan.
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

/**
 * Whether a wish is still a wish in the person's own eyes. Before the week is
 * published every wish is; after it, only one made AFTER publication — a
 * request for free time. A wish that was not granted is not shown to its
 * author any more, and nothing is said to him (Lionel, 2 November 2026: he
 * sees he is not on the list; telling him would only sting).
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

/**
 * A day becomes archive a week after it (Lionel, 2 November 2026): until then
 * whoever arranges may still put right who really stood; after it the day
 * is what is shown to the circuit overseer, and nobody changes it.
 */
export const CORRECTION_DAYS = 7;

/** A message about something within this many minutes goes out at once. */
const URGENT_WITHIN_MIN = 12 * 60;

export interface CartPersonSpan {
  id: string;
  publisherId: string | null;
  name: string;
  external: boolean;
  startTime: string;
  endTime: string;
  gender?: string | null;
  absent?: boolean;
}
export interface CartWishView {
  id: string;
  publisherId: string;
  name: string;
  startTime: string;
  endTime: string;
  /** Only whoever arranges reads the «с кем». */
  withWhomNote?: string | null;
  /** …and whom he chose from the list. */
  withPublishers?: { id: string; name: string }[];
  /** Made after publication: a request for free time. */
  late?: boolean;
  absent?: boolean;
}
export interface CartDayView {
  id: string;
  date: string;
  locationId: string;
  locationName: string;
  locationKind: string;
  equipmentAt: string | null;
  startTime: string;
  endTime: string;
  cancellations: {
    id: string;
    startTime: string;
    endTime: string;
    reason: string | null;
  }[];
  /** The day is over (the congregation's own clock). */
  over: boolean;
  /** Archive: a week has passed; nobody changes it any more. */
  locked: boolean;
  /** My open wishes for this day. */
  myRequests: {
    id: string;
    startTime: string;
    endTime: string;
    withWhomNote: string | null;
    withPublishers: { id: string; name: string }[];
  }[];
  /** My places on the plan (once it is mine to see). */
  mine: { id: string; startTime: string; endTime: string }[];
  /** Who wishes for this day, while sign-up is open — as in the poll. */
  wishes?: CartWishView[];
  /** Who stands: everybody after publication, whoever arranges always. */
  plan?: CartPersonSpan[];
  warnings?: {
    alone: Span[];
    brotherSister: Span[];
    longDay: { name: string; minutes: number }[];
  };
}
export interface CartWeekView {
  id: string;
  weekStartDate: string;
  status: string;
  signupUntil: string | null;
  canManage: boolean;
  canApply: boolean;
  memo: string | null;
  days: CartDayView[];
}

const MANAGERS = [
  ResponsibilityType.PUBLIC_WITNESSING,
  ResponsibilityType.SERVICE_OVERSEER,
  ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
];

type Now = { today: string; minute: number };

@Injectable()
export class CartWeeksService {
  private readonly logger = new Logger(CartWeeksService.name);

  constructor(
    @InjectRepository(CartWeek)
    private readonly weeksRepo: Repository<CartWeek>,
    @InjectRepository(CartDay)
    private readonly daysRepo: Repository<CartDay>,
    @InjectRepository(CartRequest)
    private readonly requestsRepo: Repository<CartRequest>,
    @InjectRepository(CartAssignment)
    private readonly assignmentsRepo: Repository<CartAssignment>,
    @InjectRepository(CartCancellation)
    private readonly cancelRepo: Repository<CartCancellation>,
    @InjectRepository(CartRequestPartner)
    private readonly partnersRepo: Repository<CartRequestPartner>,
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

  // ================================================================ time ===

  async nowFor(congregationId: string): Promise<Now> {
    const [today, minute] = await Promise.all([
      this.clock.todayFor(congregationId),
      this.clock.minutesOfDayFor(congregationId),
    ]);
    return { today, minute };
  }
  /** Minutes from now to a time on a date (negative: already past). */
  static minutesUntil(date: string, time: string, now: Now): number {
    const days =
      (Date.parse(`${dateOf(date)}T00:00:00Z`) -
        Date.parse(`${now.today}T00:00:00Z`)) /
      86400000;
    return days * 1440 + toMin(time) - now.minute;
  }
  static hasBegun(date: string, time: string, now: Now): boolean {
    return CartWeeksService.minutesUntil(date, time, now) <= 0;
  }
  static isLocked(date: string, now: Now): boolean {
    return dateOf(date) < addDays(now.today, -CORRECTION_DAYS);
  }
  private assertOpenForChange(day: CartDay, now: Now): void {
    if (CartWeeksService.isLocked(day.date, now)) {
      throw new ConflictException(
        refusal(
          'CART_DAY_LOCKED',
          'This day is in the archive and is no longer changed',
        ),
      );
    }
  }

  // =============================================================== build ===

  /**
   * Days are only ever ADDED to a week: a place on a date with its hours. A
   * week already published takes them too — they are simply free time.
   */
  async buildWeek(
    congregationId: string,
    userId: string,
    dto: {
      weekStartDate: string;
      startTime: string;
      endTime: string;
      daysOfWeek: number[];
      locationIds: string[];
    },
  ): Promise<CartWeek & { added: number; skippedPast: number }> {
    if (!isMondayISO(dto.weekStartDate)) {
      throw new BadRequestException(
        refusal('WEEK_NOT_MONDAY', 'weekStartDate must be a Monday.'),
      );
    }
    this.assertWindow(dto);
    const locIds = [...new Set(dto.locationIds)];
    const locations = await this.locationsRepo.find({
      where: { id: In(locIds), congregationId },
    });
    if (locations.length !== locIds.length) {
      throw new BadRequestException(
        refusal('CART_NO_SUCH_LOCATION', 'Unknown location'),
      );
    }
    const gen = [...new Set(dto.daysOfWeek)].sort().flatMap((dow) =>
      locIds.map((locationId) => ({
        date: addDays(dto.weekStartDate, dow - 1),
        locationId,
        startTime: dto.startTime,
        endTime: dto.endTime,
      })),
    );
    const { week, added, skippedPast } = await this.addDays(
      congregationId,
      userId,
      dto.weekStartDate,
      gen,
    );
    await this.journalWeek(congregationId, week, 'CREATE', { added });
    return Object.assign(week, { added, skippedPast });
  }

  private assertWindow(s: { startTime: string; endTime: string }): void {
    if (
      !isHalfHour(s.startTime) ||
      !isHalfHour(s.endTime) ||
      toMin(s.endTime) - toMin(s.startTime) < 60
    ) {
      throw new BadRequestException(
        refusal(
          'CART_WINDOW_TOO_SHORT',
          'The hours of a day are on the half-hour and at least an hour long',
        ),
      );
    }
  }

  /**
   * «Повторить прошлую неделю»: the same days, places and hours as a week
   * before — and nobody on them. Who stands is new every week: publishers
   * mark when they can, and whoever arranges puts the plan together (Lionel,
   * 2 November 2026). A place switched off since is left out.
   */
  async copyWeek(
    congregationId: string,
    userId: string,
    weekStartDate: string,
    fromWeekStartDate?: string,
  ): Promise<{ week: CartWeek; added: number; skippedPast: number }> {
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
    const source = await this.copySourceOf(
      congregationId,
      weekStartDate,
      fromWeekStartDate,
    );
    if (!source || source.weekStartDate === weekStartDate) {
      throw new BadRequestException(
        refusal('CART_NOTHING_TO_COPY', 'There is no earlier week to repeat'),
      );
    }
    const days = await this.daysRepo.find({
      where: { weekId: source.id, congregationId },
      relations: { location: true },
    });
    const gen = days
      .filter((d) => d.location?.isActive !== false)
      .map((d) => ({
        date: addDays(weekStartDate, isoDow(dateOf(d.date)) - 1),
        locationId: d.locationId,
        startTime: hhmm(d.startTime),
        endTime: hhmm(d.endTime),
      }));
    const out = await this.addDays(congregationId, userId, weekStartDate, gen);
    await this.journalWeek(congregationId, out.week, 'CREATE', {
      added: out.added,
      copiedFrom: source.weekStartDate,
    });
    return out;
  }

  /** The week «Повторить» copies: the latest earlier one that has days. */
  private copySourceOf(
    congregationId: string,
    weekStartDate: string,
    fromWeekStartDate?: string,
  ): Promise<CartWeek | null> {
    return this.weeksRepo
      .createQueryBuilder('w')
      .where('w.congregation_id = :congregationId', { congregationId })
      .andWhere(
        fromWeekStartDate
          ? 'w.week_start_date = :from'
          : 'w.week_start_date < :target',
        { from: fromWeekStartDate, target: weekStartDate },
      )
      .andWhere('EXISTS (SELECT 1 FROM cart_days d WHERE d.week_id = w.id)')
      .orderBy('w.week_start_date', 'DESC')
      .getOne();
  }

  /**
   * What «Повторить» would bring, said on the button before it is pressed
   * (2 November 2026): which week, and its days — or nothing, and then the
   * button is not offered at all.
   */
  async copySource(
    congregationId: string,
    weekStartDate: string,
  ): Promise<{
    weekStartDate: string;
    days: {
      weekday: number;
      locationName: string;
      startTime: string;
      endTime: string;
    }[];
  } | null> {
    if (!isMondayISO(weekStartDate)) {
      throw new BadRequestException(
        refusal('WEEK_NOT_MONDAY', 'weekStartDate must be a Monday.'),
      );
    }
    const source = await this.copySourceOf(congregationId, weekStartDate);
    if (!source) return null;
    const days = await this.daysRepo.find({
      where: { weekId: source.id, congregationId },
      relations: { location: true },
      order: { date: 'ASC', startTime: 'ASC' },
    });
    const live = days.filter((d) => d.location?.isActive !== false);
    if (live.length === 0) return null;
    return {
      weekStartDate: source.weekStartDate,
      days: live.map((d) => ({
        weekday: isoDow(dateOf(d.date)),
        locationName: d.location?.name ?? '',
        startTime: hhmm(d.startTime),
        endTime: hhmm(d.endTime),
      })),
    };
  }

  private async addDays(
    congregationId: string,
    userId: string,
    weekStartDate: string,
    gen: {
      date: string;
      locationId: string;
      startTime: string;
      endTime: string;
    }[],
  ): Promise<{ week: CartWeek; added: number; skippedPast: number }> {
    // A day already over is not planned (2 November 2026: on a Monday
    // evening «this week» used to get that Monday too). Today's day stays
    // while its hours have not ended.
    const now = await this.nowFor(congregationId);
    const ahead = gen.filter(
      (g) => !CartWeeksService.hasBegun(g.date, g.endTime, now),
    );
    const skippedPast = gen.length - ahead.length;
    if (gen.length > 0 && ahead.length === 0) {
      throw new BadRequestException(
        refusal('CART_DAYS_PAST', 'Every day chosen is already over'),
      );
    }
    return this.weeksRepo.manager.transaction(async (em) => {
      // Two people building the same week at once must not make two weeks or
      // the same day twice.
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `cart-week:${congregationId}:${weekStartDate}`,
      ]);
      let week = await em.findOne(CartWeek, {
        where: { congregationId, weekStartDate },
      });
      if (!week) {
        const first = ahead[0];
        week = await em.save(
          em.create(CartWeek, {
            congregationId,
            weekStartDate,
            status: 'draft',
            startTime: first?.startTime ?? '09:00',
            endTime: first?.endTime ?? '17:00',
            stepMinutes: 60,
            createdById: userId,
          }),
        );
      }
      const existing = await em.find(CartDay, { where: { weekId: week.id } });
      const seen = new Set(
        existing.map((d) => `${dateOf(d.date)}|${d.locationId}`),
      );
      let added = 0;
      for (const g of ahead) {
        const k = `${g.date}|${g.locationId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        await em.save(
          em.create(CartDay, { congregationId, weekId: week.id, ...g }),
        );
        added += 1;
      }
      return { week, added, skippedPast };
    });
  }

  /** A day's hours changed — never so that someone's time falls outside. */
  async updateDay(
    congregationId: string,
    dayId: string,
    dto: { startTime: string; endTime: string },
  ): Promise<CartDay> {
    this.assertWindow(dto);
    const day = await this.dayOr404(congregationId, dayId);
    this.assertOpenForChange(day, await this.nowFor(congregationId));
    const inside = (s: Span) =>
      toMin(s.startTime) >= toMin(dto.startTime) &&
      toMin(s.endTime) <= toMin(dto.endTime);
    const [asgs, reqs] = await Promise.all([
      this.assignmentsRepo.find({ where: { dayId } }),
      this.requestsRepo.find({ where: { dayId } }),
    ]);
    if (![...asgs, ...reqs].every(inside)) {
      throw new ConflictException(
        refusal(
          'CART_DAY_HAS_PEOPLE',
          'Somebody stands or asked for time outside the new hours',
        ),
      );
    }
    day.startTime = dto.startTime;
    day.endTime = dto.endTime;
    return this.daysRepo.save(day);
  }

  /** A day planned by mistake — only while nobody is on the plan for it. */
  async deleteDay(congregationId: string, dayId: string): Promise<void> {
    const day = await this.dayOr404(congregationId, dayId, true);
    const people = await this.assignmentsRepo.count({ where: { dayId } });
    if (people > 0) {
      throw new ConflictException(
        refusal(
          'CART_DAY_HAS_PEOPLE',
          'People stand on this day; call it off instead of deleting it',
        ),
      );
    }
    const detail = this.dayDetail(day);
    await this.daysRepo.remove(day);
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_day',
      entityId: dayId,
      action: 'DELETE',
      detail,
    });
  }

  async openWeek(
    congregationId: string,
    id: string,
    signupUntil?: string,
  ): Promise<CartWeek> {
    const week = await this.weeksRepo.findOne({
      where: { id, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    if (week.status !== 'draft') {
      throw new BadRequestException(
        refusal('CART_WEEK_NOT_DRAFT', 'Only a draft week can be opened'),
      );
    }
    if (signupUntil !== undefined && !isDateISO(signupUntil)) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'signupUntil must be a date'),
      );
    }
    // Sign-up opens onto days still ahead (2 November 2026): an empty week,
    // or one already over, would tell everybody «sign up» with nowhere to go.
    const now = await this.nowFor(congregationId);
    const days = await this.daysRepo.find({
      where: { weekId: week.id, congregationId },
    });
    const ahead = days.filter(
      (d) => !CartWeeksService.hasBegun(d.date, hhmm(d.endTime), now),
    );
    if (ahead.length === 0) {
      throw new BadRequestException(
        refusal('CART_WEEK_EMPTY', 'No day ahead in this week to sign up for'),
      );
    }
    // The last day for signing up: from today to the last day of the week
    // that is planned — not in the past, not after the stand has stood.
    if (signupUntil !== undefined) {
      const last = days
        .map((d) => dateOf(d.date))
        .sort()
        .pop()!;
      if (signupUntil < now.today || signupUntil > last) {
        throw new BadRequestException(
          refusal(
            'CART_BAD_DEADLINE',
            'The last day for signing up lies between today and the last day planned',
            { from: now.today, to: last },
          ),
        );
      }
    }
    week.status = 'collecting';
    week.signupUntil = signupUntil ?? null;
    const saved = await this.weeksRepo.save(week);
    await this.journalWeek(congregationId, saved, 'UPDATE', {
      status: 'collecting',
    });
    // Everybody who may sign up hears that he may (Lionel, 2 November 2026)
    // — the switch on his card, baptized, not inactive. Nobody else.
    const userIds = await this.eligibleUserIds(congregationId);
    await this.notify(
      congregationId,
      userIds,
      (w) => ({
        title: w.openTitle,
        body: w.openBody(week.weekStartDate, week.signupUntil),
      }),
      { type: 'cart_open', weekStart: week.weekStartDate },
      `cart-open:${week.id}`,
    );
    return saved;
  }

  /** Who may stand at all: the cards behind «с кем» and the list to pick from. */
  private async standersOf(congregationId: string): Promise<Publisher[]> {
    const people = await this.publishersRepo.find({
      where: { congregationId, status: Not(PublisherStatus.INACTIVE) },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
    return people.filter(
      (p) => p.isActive !== false && approvalOf(p) === 'ok' && !isInactive(p),
    );
  }

  /**
   * «С кем хотели бы» to pick from (2 November 2026, Lionel: everybody the
   * stand is open to — names only, so a brother of another group can be
   * chosen). For whoever may sign up or arranges; nobody else.
   */
  async partnerList(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<{ id: string; name: string }[]> {
    const me = await this.myPublisher(congregationId, user.id);
    const mayApply = !!me && approvalOf(me) === 'ok' && !isInactive(me);
    if (!mayApply && !(await this.isManager(user))) {
      throw new ForbiddenException(
        refusal('CART_NOT_ELIGIBLE', 'Not eligible for cart witnessing'),
      );
    }
    return (await this.standersOf(congregationId))
      .filter((p) => p.id !== me?.id)
      .map((p) => ({ id: p.id, name: `${p.lastName} ${p.firstName}`.trim() }));
  }

  /** The chosen cards, checked: one or two, not himself, the stand open to them. */
  private async partnersFor(
    congregationId: string,
    myId: string,
    ids: string[] | undefined,
  ): Promise<string[]> {
    const want = [...new Set(ids ?? [])].filter((x) => x !== myId);
    if (want.length === 0) return [];
    const ok = new Set(
      (await this.standersOf(congregationId)).map((p) => p.id),
    );
    if (want.length > 2 || want.some((x) => !ok.has(x))) {
      throw new BadRequestException(
        refusal(
          'CART_PARTNER_UNKNOWN',
          'Choose up to two people the stand is open to',
        ),
      );
    }
    return want;
  }

  async eligibleUserIds(congregationId: string): Promise<string[]> {
    const people = await this.publishersRepo.find({
      where: {
        congregationId,
        userId: Not(IsNull()),
        status: Not(PublisherStatus.INACTIVE),
      },
    });
    return people
      .filter((p) => p.isActive !== false && approvalOf(p) === 'ok')
      .map((p) => p.userId as string);
  }

  async deleteWeek(congregationId: string, id: string): Promise<void> {
    const week = await this.weeksRepo.findOne({
      where: { id, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    // A published week with people on it is their plan, or — once its days
    // are over — the archive the circuit overseer is shown. Neither is wiped:
    // a plan is changed by calling days off, which tells the people.
    if (week.status === 'published') {
      const people = await this.assignmentsRepo
        .createQueryBuilder('a')
        .innerJoin('cart_days', 'd', 'd.id = a.day_id')
        .where('d.week_id = :id', { id })
        .getCount();
      if (people > 0) {
        throw new ConflictException(
          refusal(
            'CART_WEEK_HAS_PEOPLE',
            'People stood or are to stand in this week; it is kept',
          ),
        );
      }
    }
    const detail = { date: week.weekStartDate, status: week.status };
    const weekId = week.id;
    await this.weeksRepo.remove(week);
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_week',
      entityId: weekId,
      action: 'DELETE',
      detail,
    });
  }

  // ================================================================ read ===

  async isManager(user: AuthenticatedUser): Promise<boolean> {
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
    const myPid = me?.id ?? null;
    const canApply = !!me && approvalOf(me) === 'ok' && !isInactive(me);
    const settings = await this.daysRepo.manager.findOne(CartSettings, {
      where: { congregationId },
    });
    const base = {
      id: week.id,
      weekStartDate: week.weekStartDate,
      status: week.status,
      signupUntil: week.signupUntil,
      canManage: manager,
      canApply,
      memo: settings?.memo ?? null,
    };
    // A draft is the arranger's own sketch: the others learn the week exists,
    // nothing of what is in it.
    if (week.status === 'draft' && !manager) return { ...base, days: [] };

    const published = week.status === 'published';
    const collecting = week.status === 'collecting';
    const days = await this.daysRepo.find({
      where: { weekId: week.id, congregationId },
      relations: { location: true },
      order: { date: 'ASC', startTime: 'ASC' },
    });
    const dayIds = days.map((d) => d.id);
    const [requests, assignments, cancellations, now] = await Promise.all([
      dayIds.length
        ? this.requestsRepo.find({
            where: { dayId: In(dayIds) },
            order: { startTime: 'ASC', createdAt: 'ASC' },
          })
        : Promise.resolve([] as CartRequest[]),
      dayIds.length
        ? this.assignmentsRepo.find({
            where: { dayId: In(dayIds) },
            order: { startTime: 'ASC', createdAt: 'ASC' },
          })
        : Promise.resolve([] as CartAssignment[]),
      dayIds.length
        ? this.cancelRepo.find({
            where: { dayId: In(dayIds) },
            order: { startTime: 'ASC' },
          })
        : Promise.resolve([] as CartCancellation[]),
      this.nowFor(congregationId),
    ]);
    const partnerRows = requests.length
      ? await this.partnersRepo.find({
          where: { requestId: In(requests.map((r) => r.id)) },
        })
      : [];
    const partnersOf = new Map<string, string[]>();
    for (const r of partnerRows) {
      partnersOf.set(r.requestId, [
        ...(partnersOf.get(r.requestId) ?? []),
        r.publisherId,
      ]);
    }
    const pubIds = [
      ...new Set([
        ...requests.map((r) => r.publisherId),
        ...assignments
          .map((a) => a.publisherId)
          .filter((x): x is string => !!x),
      ]),
    ];
    const partnerIds = [
      ...new Set(partnerRows.map((r) => r.publisherId)),
    ].filter((x) => !pubIds.includes(x));
    const pubs =
      pubIds.length + partnerIds.length
        ? await this.publishersRepo.find({
            where: { id: In([...pubIds, ...partnerIds]), congregationId },
          })
        : [];
    const pubById = new Map(pubs.map((p) => [p.id, p]));
    const partnersView = (requestId: string) =>
      (partnersOf.get(requestId) ?? [])
        .filter((id) => pubById.has(id))
        .map((id) => ({ id, name: nameOf(id) }));
    const nameOf = (id: string) => {
      const p = pubById.get(id);
      return p ? `${p.lastName} ${p.firstName}`.trim() : '';
    };
    const awayOn = manager
      ? await this.absencesFor(congregationId, pubIds, week.weekStartDate)
      : () => false;
    // Minutes per person and date, across all places — for «много за день».
    const perDay = new Map<string, Span[]>();
    for (const a of assignments) {
      if (!a.publisherId) continue;
      const d = days.find((x) => x.id === a.dayId);
      if (!d) continue;
      const k = `${a.publisherId}|${dateOf(d.date)}`;
      perDay.set(k, [...(perDay.get(k) ?? []), a]);
    }

    return {
      ...base,
      days: days.map((d) => {
        const date = dateOf(d.date);
        const asgs = assignments.filter((a) => a.dayId === d.id);
        const reqs = requests.filter((r) => r.dayId === d.id);
        const offs = cancellations.filter((c) => c.dayId === d.id);
        const planView: CartPersonSpan[] = asgs.map((a) => ({
          id: a.id,
          publisherId: a.publisherId,
          name: a.publisherId ? nameOf(a.publisherId) : (a.externalName ?? ''),
          external: !a.publisherId,
          startTime: hhmm(a.startTime),
          endTime: hhmm(a.endTime),
          gender: a.publisherId
            ? (pubById.get(a.publisherId)?.gender ?? null)
            : null,
          ...(manager
            ? { absent: !!a.publisherId && awayOn(a.publisherId, date) }
            : {}),
        }));
        const mineVisible = published || manager;
        const view: CartDayView = {
          id: d.id,
          date,
          locationId: d.locationId,
          locationName: d.location?.name ?? '',
          locationKind: d.location?.kind ?? 'cart',
          equipmentAt: d.location?.equipmentAt ?? null,
          startTime: hhmm(d.startTime),
          endTime: hhmm(d.endTime),
          cancellations: offs.map((c) => ({
            id: c.id,
            startTime: hhmm(c.startTime),
            endTime: hhmm(c.endTime),
            reason: c.reason,
          })),
          over: CartWeeksService.hasBegun(date, hhmm(d.endTime), now),
          locked: CartWeeksService.isLocked(date, now),
          myRequests: reqs
            .filter(
              (r) =>
                !!myPid &&
                r.publisherId === myPid &&
                isOpenWish(r.createdAt, week.publishedAt, published),
            )
            .map((r) => ({
              id: r.id,
              startTime: hhmm(r.startTime),
              endTime: hhmm(r.endTime),
              withWhomNote: r.withWhomNote,
              withPublishers: partnersView(r.id),
            })),
          mine: mineVisible
            ? asgs
                .filter((a) => !!myPid && a.publisherId === myPid)
                .map((a) => ({
                  id: a.id,
                  startTime: hhmm(a.startTime),
                  endTime: hhmm(a.endTime),
                }))
            : [],
        };
        if (manager) {
          view.plan = planView;
          view.wishes = reqs.map((r) => ({
            id: r.id,
            publisherId: r.publisherId,
            name: nameOf(r.publisherId),
            startTime: hhmm(r.startTime),
            endTime: hhmm(r.endTime),
            withWhomNote: r.withWhomNote,
            withPublishers: partnersView(r.id),
            late:
              published && !!week.publishedAt && r.createdAt > week.publishedAt,
            absent: awayOn(r.publisherId, date),
          }));
          const standing = asgs.map((a) => ({
            ...a,
            spans: minus(a, offs),
          }));
          const live = standing.flatMap((a) => a.spans);
          const pairs: Span[] = [];
          for (const t of halfHours(d)) {
            const here = standing.filter((a) =>
              a.spans.some(
                (s) => toMin(s.startTime) <= t && t < toMin(s.endTime),
              ),
            );
            if (here.length !== 2 || here.some((a) => !a.publisherId)) continue;
            const g = here.map((a) => pubById.get(a.publisherId!)?.gender);
            if (g.includes(Gender.BROTHER) && g.includes(Gender.SISTER)) {
              pairs.push({ startTime: toHHMM(t), endTime: toHHMM(t + 30) });
            }
          }
          view.warnings = {
            alone: aloneSpans(d, live),
            brotherSister: merge(pairs),
            longDay: [
              ...new Set(
                asgs.map((a) => a.publisherId).filter((x): x is string => !!x),
              ),
            ]
              .map((pid) => ({
                name: nameOf(pid),
                minutes: merge(perDay.get(`${pid}|${date}`) ?? []).reduce(
                  (n, s) => n + minutes(s),
                  0,
                ),
              }))
              .filter((x) => x.minutes > LONG_DAY_MINUTES),
          };
        } else if (published) {
          view.plan = planView.map(({ gender, ...rest }) => {
            void gender;
            return rest;
          });
        } else if (collecting) {
          // While sign-up is open everyone sees who marked which time, as in
          // the poll they are used to — and arranges himself with whom to
          // stand. The «с кем» stays with whoever arranges.
          view.wishes = reqs.map((r) => ({
            id: r.id,
            publisherId: r.publisherId,
            name: nameOf(r.publisherId),
            startTime: hhmm(r.startTime),
            endTime: hhmm(r.endTime),
          }));
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
    const rows = await this.daysRepo.manager
      .getRepository(Absence)
      .createQueryBuilder('a')
      .where('a.congregation_id = :congregationId', { congregationId })
      .andWhere('a.publisher_id IN (:...ids)', { ids: publisherIds })
      .andWhere('a.start_date <= :weekEnd', { weekEnd })
      // No end date means ONE day (absence.entity.ts), not open-ended.
      .andWhere('COALESCE(a.end_date, a.start_date) >= :weekStart', {
        weekStart,
      })
      .getMany();
    return (pid, date) =>
      rows.some(
        (r) =>
          r.publisherId === pid &&
          dateOf(r.startDate) <= date &&
          dateOf(r.endDate ?? r.startDate) >= date,
      );
  }

  // ============================================================= sign up ===

  async request(
    congregationId: string,
    dayId: string,
    user: AuthenticatedUser,
    dto: {
      startTime: string;
      endTime: string;
      withWhomNote?: string;
      withPublisherIds?: string[];
    },
  ): Promise<CartRequest> {
    const me = await this.myPublisher(congregationId, user.id);
    if (!me)
      throw new ForbiddenException(
        refusal('NO_OWN_CARD', 'No publisher profile'),
      );
    // Inactive: no sign-up (1 November 2026); asked first, so that nothing
    // else is said to him instead. The words name no standing.
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
    const day = await this.dayOr404(congregationId, dayId, true);
    if (!day.week || day.week.status === 'draft') {
      throw new BadRequestException(
        refusal('CART_WEEK_NO_REQUESTS', 'Week is not open for requests'),
      );
    }
    this.assertSpan(dto, day);
    const partners = await this.partnersFor(
      congregationId,
      me.id,
      dto.withPublisherIds,
    );
    const now = await this.nowFor(congregationId);
    if (CartWeeksService.hasBegun(day.date, dto.startTime, now)) {
      throw new BadRequestException(
        refusal('CART_SLOT_PAST', 'This time has already begun'),
      );
    }
    const offs = await this.cancelRepo.find({ where: { dayId } });
    if (offs.some((o) => overlaps(o, dto))) {
      throw new BadRequestException(
        refusal('CART_SLOT_CANCELLED', 'Witnessing is called off at this time'),
      );
    }
    const published = day.week.status === 'published';
    const mineReq = await this.requestsRepo.find({
      where: { dayId, publisherId: me.id },
    });
    if (
      mineReq.some(
        (r) =>
          isOpenWish(r.createdAt, day.week.publishedAt, published) &&
          overlaps(r, dto),
      )
    ) {
      throw new BadRequestException(
        refusal('CART_ALREADY_REQUESTED', 'You already asked for this time'),
      );
    }
    if (published) {
      const people = await this.assignmentsRepo.find({ where: { dayId } });
      if (people.some((a) => a.publisherId === me.id && overlaps(a, dto))) {
        throw new BadRequestException(
          refusal('CART_ALREADY_ASSIGNED', 'You stand at this time already'),
        );
      }
      const live = people.flatMap((a) => minus(a, offs));
      const c = coverage(day, live);
      if (halfHours(dto).every((t) => (c.get(t) ?? 0) >= CAPACITY_MAX)) {
        throw new BadRequestException(
          refusal('CART_SLOT_FULL', 'This time is full'),
        );
      }
    }
    // A wish from before publication that was not granted is a closed
    // matter; it goes, and the new one is told to whoever arranges.
    const closed = mineReq.filter(
      (r) =>
        !isOpenWish(r.createdAt, day.week.publishedAt, published) &&
        overlaps(r, dto),
    );
    if (closed.length) await this.requestsRepo.remove(closed);
    const created = await this.requestsRepo.save(
      this.requestsRepo.create({
        congregationId,
        dayId,
        publisherId: me.id,
        startTime: dto.startTime,
        endTime: dto.endTime,
        withWhomNote: dto.withWhomNote?.trim() || null,
      }),
    );
    if (partners.length) {
      await this.partnersRepo.save(
        partners.map((publisherId) =>
          this.partnersRepo.create({ requestId: created.id, publisherId }),
        ),
      );
    }
    if (published) {
      const who = `${me.lastName} ${me.firstName}`.trim();
      const line = this.bareLine(day, dto);
      await this.notify(
        congregationId,
        await this.managerUserIds(congregationId),
        (w, l) => ({
          title: w.requestTitle,
          body: w.requestBody(shiftLine(line, l), who),
        }),
        { type: 'cart_dobor_request', weekStart: day.week.weekStartDate },
        `cart-request:${created.id}`,
        { urgent: this.isSoon(day.date, dto.startTime, now) },
      );
    }
    return created;
  }

  async withdrawRequest(
    congregationId: string,
    requestId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const me = await this.myPublisher(congregationId, user.id);
    if (!me)
      throw new ForbiddenException(
        refusal('NO_OWN_CARD', 'No publisher profile'),
      );
    await this.requestsRepo.delete({
      id: requestId,
      publisherId: me.id,
      congregationId,
    });
  }

  private assertSpan(span: Span, day: Span): void {
    const p = spanProblem(span, day);
    if (p) {
      throw new BadRequestException(
        refusal(
          'CART_BAD_SPAN',
          'A time at the stand is an hour or more, on the half-hour, within the day',
          { problem: p },
        ),
      );
    }
  }

  // ================================================================ plan ===

  async assign(
    congregationId: string,
    dayId: string,
    user: AuthenticatedUser,
    dto: {
      publisherId?: string;
      externalName?: string;
      startTime: string;
      endTime: string;
    },
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
    await assertAssignable(this.daysRepo.manager, congregationId, [
      dto.publisherId,
    ]);
    const pub = hasPub
      ? await this.approvedOr400(congregationId, dto.publisherId!)
      : null;
    const now = await this.nowFor(congregationId);

    const { saved, day } = await this.daysRepo.manager.transaction(
      async (em) => {
        const day = await this.lockDay(em, congregationId, dayId);
        this.assertOpenForChange(day, now);
        this.assertSpan(dto, day);
        await this.assertFree(
          em,
          congregationId,
          day,
          dto,
          pub?.id ?? null,
          null,
        );
        const saved = await em.save(
          em.create(CartAssignment, {
            congregationId,
            dayId,
            publisherId: pub?.id ?? null,
            externalName: pub ? null : dto.externalName!.trim(),
            startTime: dto.startTime,
            endTime: dto.endTime,
            createdById: user.id,
          }),
        );
        return { saved, day };
      },
    );

    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_assignment',
      entityId: saved.id,
      action: 'CREATE',
      subjectId: saved.publisherId,
      detail: {
        ...this.dayDetail(day, saved),
        ...(saved.publisherId ? {} : { guest: saved.externalName }),
      },
    });
    await this.tellChange(congregationId, day, now, {
      added: saved,
      name: pub
        ? `${pub.lastName} ${pub.firstName}`.trim()
        : (saved.externalName ?? ''),
    });
    return saved;
  }

  async updateAssignment(
    congregationId: string,
    id: string,
    dto: { startTime: string; endTime: string },
  ): Promise<CartAssignment> {
    const now = await this.nowFor(congregationId);
    const { saved, day, before } = await this.daysRepo.manager.transaction(
      async (em) => {
        const asg = await em.findOne(CartAssignment, {
          where: { id, congregationId },
        });
        if (!asg) throw new NotFoundException('Assignment not found');
        const day = await this.lockDay(em, congregationId, asg.dayId);
        this.assertOpenForChange(day, now);
        this.assertSpan(dto, day);
        await this.assertFree(
          em,
          congregationId,
          day,
          dto,
          asg.publisherId,
          asg.id,
        );
        const before = {
          startTime: hhmm(asg.startTime),
          endTime: hhmm(asg.endTime),
        };
        asg.startTime = dto.startTime;
        asg.endTime = dto.endTime;
        return { saved: await em.save(asg), day, before };
      },
    );
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_assignment',
      entityId: saved.id,
      action: 'UPDATE',
      subjectId: saved.publisherId,
      detail: {
        ...this.dayDetail(day, saved),
        was: `${before.startTime}–${before.endTime}`,
      },
    });
    await this.tellChange(congregationId, day, now, { changed: saved, before });
    return saved;
  }

  async removeAssignment(congregationId: string, id: string): Promise<void> {
    const asg = await this.assignmentsRepo.findOne({
      where: { id, congregationId },
    });
    if (!asg) throw new NotFoundException('Assignment not found');
    const day = await this.dayOr404(congregationId, asg.dayId, true);
    const now = await this.nowFor(congregationId);
    this.assertOpenForChange(day, now);
    const gone = { ...asg };
    await this.assignmentsRepo.remove(asg);
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_assignment',
      entityId: gone.id,
      action: 'DELETE',
      subjectId: gone.publisherId,
      detail: {
        ...this.dayDetail(day, gone),
        ...(gone.publisherId ? {} : { guest: gone.externalName }),
      },
    });
    await this.tellChange(congregationId, day, now, { removed: gone });
  }

  /**
   * The same person in two places that share a half-hour, or a place that
   * would hold more than four at some half-hour — under the day's row lock
   * and the person's own lock, so that taps at the same moment cannot both
   * pass (seen on the stand: six in a shift of four).
   */
  private async assertFree(
    em: EntityManager,
    congregationId: string,
    day: CartDay,
    span: Span,
    publisherId: string | null,
    exceptId: string | null,
  ): Promise<void> {
    const offs = await em.find(CartCancellation, { where: { dayId: day.id } });
    if (offs.some((o) => overlaps(o, span))) {
      throw new BadRequestException(
        refusal('CART_SLOT_CANCELLED', 'Witnessing is called off at this time'),
      );
    }
    const here = (
      await em.find(CartAssignment, { where: { dayId: day.id } })
    ).filter((a) => a.id !== exceptId);
    if (overfull(day, here, span) !== null) {
      throw new BadRequestException(
        refusal('CART_SLOT_FULL', 'More than four at this time'),
      );
    }
    if (!publisherId) return;
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `cart-person:${publisherId}`,
    ]);
    const sameDate: { start_time: string; end_time: string }[] = await em.query(
      `SELECT a.start_time, a.end_time
         FROM cart_assignments a JOIN cart_days d ON d.id = a.day_id
        WHERE a.congregation_id = $1 AND a.publisher_id = $2 AND d.date = $3
          AND ($4::uuid IS NULL OR a.id <> $4::uuid)`,
      [congregationId, publisherId, dateOf(day.date), exceptId],
    );
    if (
      sameDate.some((o) =>
        overlaps(span, { startTime: o.start_time, endTime: o.end_time }),
      )
    ) {
      throw new BadRequestException(
        refusal('CART_TIME_CLASH', 'This person already stands at this time'),
      );
    }
  }

  private async approvedOr400(
    congregationId: string,
    publisherId: string,
  ): Promise<Publisher> {
    const pub = await this.publishersRepo.findOne({
      where: { id: publisherId, congregationId },
    });
    if (!pub)
      throw new BadRequestException(
        refusal('NO_SUCH_PUBLISHER', 'Unknown publisher'),
      );
    const a = approvalOf(pub);
    if (a === 'not_approved') {
      throw new BadRequestException(
        refusal(
          'CART_NOT_APPROVED',
          'Public witnessing is not marked on this card',
        ),
      );
    }
    if (a === 'not_baptized') {
      throw new BadRequestException(
        refusal('CART_NOT_BAPTIZED', 'Only baptized publishers take part'),
      );
    }
    return pub;
  }

  /**
   * «Не смогу» — at any moment and for any reason, which stays his own
   * (Lionel, 2 November 2026: the reason is personal, it is not asked).
   * Whoever arranges hears the place is free; those standing at that time
   * hear they are one fewer; those who asked for that time and were not put
   * on hear that a place is free.
   */
  async cancelMine(
    congregationId: string,
    assignmentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const me = await this.myPublisher(congregationId, user.id);
    if (!me)
      throw new ForbiddenException(
        refusal('NO_OWN_CARD', 'No publisher profile'),
      );
    const asg = await this.assignmentsRepo.findOne({
      where: { id: assignmentId, publisherId: me.id, congregationId },
    });
    if (!asg) throw new NotFoundException('No assignment to cancel');
    const day = await this.dayOr404(congregationId, asg.dayId, true);
    const now = await this.nowFor(congregationId);
    if (CartWeeksService.hasBegun(day.date, hhmm(asg.endTime), now)) {
      throw new BadRequestException(
        refusal('CART_SLOT_PAST', 'This time is already over'),
      );
    }
    const gone = { ...asg };
    await this.assignmentsRepo.remove(asg);
    // His wish for that time goes too: it would otherwise stand among the
    // applicants as if he still wanted what he just gave back.
    const myReqs = await this.requestsRepo.find({
      where: { dayId: day.id, publisherId: me.id },
    });
    const stale = myReqs.filter((r) => overlaps(r, gone));
    if (stale.length) await this.requestsRepo.remove(stale);
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_assignment',
      entityId: gone.id,
      action: 'DELETE',
      subjectId: me.id,
      detail: { ...this.dayDetail(day, gone), self: true },
    });
    if (day.week?.status !== 'published') return;
    const offs = await this.cancelRepo.find({ where: { dayId: day.id } });
    if (minus(gone, offs).length === 0) return;

    const who = `${me.lastName} ${me.firstName}`.trim();
    const urgent = this.isSoon(day.date, gone.startTime, now);
    const line = this.bareLine(day, gone);
    const managers = await this.managerUserIds(congregationId);
    const rest = await this.assignmentsRepo.find({ where: { dayId: day.id } });
    const partners = await this.userIdsOf(
      congregationId,
      rest.filter((a) => overlaps(a, gone)).map((a) => a.publisherId),
    );
    const key = `cart-cancel:${gone.id}`;
    await this.notify(
      congregationId,
      managers.filter((u) => u !== user.id),
      (w, l) => ({
        title: w.cancelTitle,
        body: w.cancelBody(shiftLine(line, l), who),
      }),
      { type: 'cart_cancel', weekStart: day.week.weekStartDate },
      key,
      { urgent },
    );
    await this.notify(
      congregationId,
      partners.filter((u) => u !== user.id && !managers.includes(u)),
      (w, l) => ({
        title: w.partnerCancelTitle,
        body: w.partnerCancelBody(shiftLine(line, l), who),
      }),
      { type: 'cart_partner_cancel', weekStart: day.week.weekStartDate },
      `${key}:p`,
      { urgent, personal: true },
    );
    // Those who asked for that time and are not on it: a place is free.
    const reqs = await this.requestsRepo.find({ where: { dayId: day.id } });
    const hopeful = reqs.filter(
      (r) =>
        r.publisherId !== me.id &&
        overlaps(r, gone) &&
        !rest.some((a) => a.publisherId === r.publisherId && overlaps(a, r)),
    );
    const hopefulUsers = await this.userIdsOf(
      congregationId,
      hopeful.map((r) => r.publisherId),
    );
    await this.notify(
      congregationId,
      hopefulUsers.filter((u) => u !== user.id),
      (w, l) => ({ title: w.freeTitle, body: w.freeBody(shiftLine(line, l)) }),
      { type: 'cart_place_free', weekStart: day.week.weekStartDate },
      `${key}:f`,
      { urgent },
    );
  }

  // =========================================================== call off ===

  /**
   * A day, or part of it, called off — bad weather, an unsafe day in town —
   * keeping the plan underneath, so it can be put back (Lionel, 2 November
   * 2026). Everyone it touches is told once, at once if it is near.
   */
  async cancelDay(
    congregationId: string,
    dayId: string,
    user: AuthenticatedUser,
    dto: { startTime?: string; endTime?: string; reason?: string },
  ): Promise<CartCancellation> {
    const day = await this.dayOr404(congregationId, dayId, true);
    const now = await this.nowFor(congregationId);
    this.assertOpenForChange(day, now);
    const span = {
      startTime: dto.startTime ?? hhmm(day.startTime),
      endTime: dto.endTime ?? hhmm(day.endTime),
    };
    const p = spanProblem(span, day);
    if (p === 'NOT_HALF_HOUR' || p === 'OUTSIDE_DAY')
      this.assertSpan(span, day);
    if (CartWeeksService.hasBegun(day.date, span.endTime, now)) {
      throw new BadRequestException(
        refusal('CART_SLOT_PAST', 'This time is already over'),
      );
    }
    const saved = await this.cancelRepo.save(
      this.cancelRepo.create({
        congregationId,
        dayId,
        startTime: span.startTime,
        endTime: span.endTime,
        reason: dto.reason?.trim() || null,
        createdById: user.id,
      }),
    );
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_day',
      entityId: dayId,
      action: 'DELETE',
      detail: { ...this.dayDetail(day, span), cancelled: true },
    });
    await this.tellCalledOff(
      congregationId,
      day,
      span,
      now,
      true,
      saved.reason,
      saved.id,
    );
    return saved;
  }

  async restoreDay(
    congregationId: string,
    cancellationId: string,
  ): Promise<void> {
    const c = await this.cancelRepo.findOne({
      where: { id: cancellationId, congregationId },
    });
    if (!c) throw new NotFoundException('Nothing called off');
    const day = await this.dayOr404(congregationId, c.dayId, true);
    const now = await this.nowFor(congregationId);
    this.assertOpenForChange(day, now);
    const span = { startTime: hhmm(c.startTime), endTime: hhmm(c.endTime) };
    await this.cancelRepo.remove(c);
    await this.auditLog.logFact({
      tenantId: congregationId,
      entityType: 'cart_day',
      entityId: day.id,
      action: 'RESTORE',
      detail: this.dayDetail(day, span),
    });
    await this.tellCalledOff(
      congregationId,
      day,
      span,
      now,
      false,
      null,
      cancellationId,
    );
  }

  private async tellCalledOff(
    congregationId: string,
    day: CartDay,
    span: Span,
    now: Now,
    off: boolean,
    reason: string | null,
    keyId: string,
  ): Promise<void> {
    if (day.week?.status !== 'published') return;
    const asgs = (
      await this.assignmentsRepo.find({ where: { dayId: day.id } })
    ).filter((a) => overlaps(a, span));
    const lines = await this.linesFor(congregationId, day, asgs, now, false);
    for (const [userId, mine] of lines) {
      const urgent = mine.some((l) => this.isSoon(day.date, l.startTime, now));
      await this.notify(
        congregationId,
        [userId],
        (w, l) => ({
          title: off ? w.offTitle : w.onTitle,
          body:
            shiftLines(mine, l) +
            (off && reason ? `\n${w.reason(reason)}` : ''),
        }),
        {
          type: off ? 'cart_shift_cancelled' : 'cart_shift_restored',
          weekStart: day.week.weekStartDate,
        },
        `cart-${off ? 'off' : 'on'}:${keyId}`,
        { urgent, personal: true },
      );
    }
  }

  // ============================================================= publish ===

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

    // Each one is told HIS time — day, hours, place, who stands with him.
    // Whoever is not on the plan is told nothing (Lionel).
    const days = await this.daysRepo.find({
      where: { weekId: id, congregationId },
      relations: { location: true },
      order: { date: 'ASC', startTime: 'ASC' },
    });
    const now = await this.nowFor(congregationId);
    const byUser = new Map<string, ShiftLine[]>();
    for (const day of days) {
      const asgs = await this.assignmentsRepo.find({
        where: { dayId: day.id },
      });
      const lines = await this.linesFor(congregationId, day, asgs, now, true);
      for (const [u, l] of lines)
        byUser.set(u, [...(byUser.get(u) ?? []), ...l]);
    }
    for (const [userId, mine] of byUser) {
      await this.notify(
        congregationId,
        [userId],
        (w, l) => ({
          title: w.publishedTitle(mine.length),
          body: shiftLines(mine, l),
        }),
        { type: 'cart_published', weekStart: week.weekStartDate },
        `cart-published:${id}`,
        { personal: true },
      );
    }
    return saved;
  }

  // ============================================================ suggest ===

  /**
   * «Предложить состав»: lays the open wishes onto the plan by the order of
   * fairness (cart-fairness.ts). It only ADDS; whoever arranges changes what
   * he likes after. Said in the journal as one step.
   */
  async suggestWeek(
    congregationId: string,
    weekId: string,
    user: AuthenticatedUser,
  ): Promise<{ added: number }> {
    const week = await this.weeksRepo.findOne({
      where: { id: weekId, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    if (week.status === 'draft') {
      throw new BadRequestException(
        refusal('CART_WEEK_CLOSED', 'Week is not open for assignment'),
      );
    }
    const now = await this.nowFor(congregationId);
    const days = (
      await this.daysRepo.find({ where: { weekId, congregationId } })
    ).filter((d) => !CartWeeksService.hasBegun(d.date, hhmm(d.startTime), now));
    if (days.length === 0) return { added: 0 };
    const dayIds = days.map((d) => d.id);
    const [reqs, asgs, offs] = await Promise.all([
      this.requestsRepo.find({ where: { dayId: In(dayIds) } }),
      this.assignmentsRepo
        .createQueryBuilder('a')
        .innerJoinAndSelect('a.day', 'd')
        .where('a.congregation_id = :congregationId', { congregationId })
        .andWhere('d.date BETWEEN :a AND :b', {
          a: week.weekStartDate,
          b: addDays(week.weekStartDate, 6),
        })
        .getMany(),
      this.cancelRepo.find({ where: { dayId: In(dayIds) } }),
    ]);
    const pubIds = [...new Set(reqs.map((r) => r.publisherId))];
    // «С кем»: an equal tie goes to standing beside whom one asked for.
    const partnersOf = new Map<string, string[]>();
    if (reqs.length) {
      for (const r of await this.partnersRepo.find({
        where: { requestId: In(reqs.map((x) => x.id)) },
      })) {
        partnersOf.set(r.requestId, [
          ...(partnersOf.get(r.requestId) ?? []),
          r.publisherId,
        ]);
      }
    }
    const pubs = pubIds.length
      ? await this.publishersRepo.find({
          where: { id: In(pubIds), congregationId },
        })
      : [];
    const ok = new Set(
      pubs
        .filter((p) => approvalOf(p) === 'ok' && !isInactive(p))
        .map((p) => p.id),
    );
    const away = await this.absencesFor(
      congregationId,
      pubIds,
      week.weekStartDate,
    );
    const dateById = new Map(days.map((d) => [d.id, dateOf(d.date)]));
    const standing = await this.standingOf(
      congregationId,
      week.weekStartDate,
      pubIds,
    );
    const added = suggest(
      days.map((d) => ({
        id: d.id,
        date: dateOf(d.date),
        startTime: hhmm(d.startTime),
        endTime: hhmm(d.endTime),
        off: offs.filter((o) => o.dayId === d.id),
      })),
      reqs
        .filter(
          (r) =>
            ok.has(r.publisherId) &&
            !away(r.publisherId, dateById.get(r.dayId)!),
        )
        // Already on the plan for that time: nothing to add.
        .filter(
          (r) =>
            !asgs.some(
              (a) =>
                a.publisherId === r.publisherId &&
                a.dayId === r.dayId &&
                overlaps(a, r),
            ),
        )
        .map((r) => ({
          id: r.id,
          publisherId: r.publisherId,
          dayId: r.dayId,
          date: dateById.get(r.dayId)!,
          startTime: hhmm(r.startTime),
          endTime: hhmm(r.endTime),
          createdAt: r.createdAt.getTime(),
          with: partnersOf.get(r.id) ?? [],
        })),
      asgs.map((a) => ({
        dayId: a.dayId,
        publisherId: a.publisherId,
        date: dateOf(a.day.date),
        startTime: hhmm(a.startTime),
        endTime: hhmm(a.endTime),
      })),
      standing,
      reqs.map((r) => ({
        dayId: r.dayId,
        publisherId: r.publisherId,
        with: partnersOf.get(r.id) ?? [],
      })),
    );
    let n = 0;
    for (const p of added) {
      try {
        await this.assign(congregationId, p.dayId, user, {
          publisherId: p.publisherId!,
          startTime: p.startTime,
          endTime: p.endTime,
        });
        n += 1;
      } catch (e) {
        // Somebody changed the plan meanwhile; that place is simply skipped.
        this.logger.warn(`suggest skipped a place: ${String(e)}`);
      }
    }
    return { added: n };
  }

  /**
   * What whoever arranges sees beside each name, and what the proposal goes
   * by: pioneer or not, days at the stand in eight weeks and the last one,
   * and how many weeks running he asked and was not put on.
   */
  async standingOf(
    congregationId: string,
    weekStart: string,
    publisherIds: string[],
  ): Promise<Map<string, PersonStanding>> {
    const out = new Map<string, PersonStanding>();
    if (publisherIds.length === 0) return out;
    const from = addDays(weekStart, -56);
    const month = weekStart.slice(0, 7);
    const [pubs, aux, rows] = await Promise.all([
      this.publishersRepo.find({
        where: { id: In(publisherIds), congregationId },
      }),
      this.daysRepo.manager.getRepository(AuxiliaryPioneer).find({
        where: { congregationId, publisherId: In(publisherIds) },
      }),
      this.daysRepo.manager.query(
        `SELECT w.week_start_date::text AS week, x.publisher_id, x.kind, max(d.date)::text AS last
           FROM (SELECT day_id, publisher_id, 'a' AS kind FROM cart_assignments WHERE publisher_id IS NOT NULL
                 UNION ALL SELECT day_id, publisher_id, 'r' FROM cart_requests) x
           JOIN cart_days d ON d.id = x.day_id
           JOIN cart_weeks w ON w.id = d.week_id
          WHERE d.congregation_id = $1 AND w.status = 'published'
            AND d.date >= $2 AND d.date < $3 AND x.publisher_id = ANY($4::uuid[])
          GROUP BY 1, 2, 3`,
        [congregationId, from, weekStart, publisherIds],
      ) as Promise<
        { week: string; publisher_id: string; kind: string; last: string }[]
      >,
    ]);
    const auxThisMonth = (pid: string) =>
      aux.some((a) => {
        const s = String(a.startMonth).slice(0, 7);
        const e = a.endMonth
          ? String(a.endMonth).slice(0, 7)
          : a.untilCancelled
            ? '9999-12'
            : s;
        return a.publisherId === pid && s <= month && month <= e;
      });
    for (const p of pubs) {
      const mine = rows.filter((r) => r.publisher_id === p.id);
      const served = mine.filter((r) => r.kind === 'a');
      const weeks = [...new Set(mine.map((r) => r.week))].sort().reverse();
      let missed = 0;
      for (const w of weeks) {
        if (served.some((r) => r.week === w)) break;
        missed += 1;
      }
      const dayRows: { n: number }[] = await this.daysRepo.manager.query(
        `SELECT count(DISTINCT d.date)::int AS n
           FROM cart_assignments a JOIN cart_days d ON d.id = a.day_id
           JOIN cart_weeks w ON w.id = d.week_id
          WHERE a.publisher_id = $1 AND w.status = 'published' AND d.date >= $2 AND d.date < $3`,
        [p.id, from, weekStart],
      );
      out.set(p.id, {
        publisherId: p.id,
        pioneer:
          isActivePermanentPioneer(p.pioneerType, p.pioneerSince, weekStart) ||
          auxThisMonth(p.id),
        missedWeeks: missed,
        recentDays: dayRows[0]?.n ?? 0,
        lastDate:
          served
            .map((r) => r.last)
            .sort()
            .pop() ?? null,
      });
    }
    return out;
  }

  async weekById(congregationId: string, id: string): Promise<CartWeek> {
    const week = await this.weeksRepo.findOne({
      where: { id, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    return week;
  }

  /** Everyone who asked for time in this week. */
  async askingIn(congregationId: string, weekId: string): Promise<string[]> {
    const rows: { publisher_id: string }[] = await this.daysRepo.manager.query(
      `SELECT DISTINCT r.publisher_id FROM cart_requests r
         JOIN cart_days d ON d.id = r.day_id
        WHERE d.week_id = $1 AND d.congregation_id = $2`,
      [weekId, congregationId],
    );
    return rows.map((r) => r.publisher_id);
  }

  // ============================================================ archive ===

  /**
   * The archive: what was really served — the last plan of each day after
   * all changes, the called-off parts taken out. No «не смогу», no swaps:
   * only who stood, where and when (Lionel, 2 November 2026). By default
   * from the end of the circuit overseer's last visit.
   */
  async archive(
    congregationId: string,
    from?: string,
    to?: string,
  ): Promise<{
    from: string;
    to: string;
    days: {
      date: string;
      place: string;
      kind: string;
      people: { name: string; startTime: string; endTime: string }[];
      minutes: number;
    }[];
    totals: {
      days: number;
      minutes: number;
      people: number;
      byPlace: { place: string; days: number; minutes: number }[];
      calledOff: {
        date: string;
        place: string;
        startTime: string;
        endTime: string;
        reason: string | null;
      }[];
    };
  }> {
    const now = await this.nowFor(congregationId);
    if ((from && !isDateISO(from)) || (to && !isDateISO(to))) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'from and to are dates'),
      );
    }
    const start =
      from ??
      (await this.lastVisitEnd(congregationId)) ??
      addDays(now.today, -183);
    const end = to ?? now.today;
    const days = await this.daysRepo
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.week', 'w')
      .leftJoinAndSelect('d.location', 'l')
      .where('d.congregation_id = :congregationId', { congregationId })
      .andWhere("w.status = 'published'")
      .andWhere('d.date BETWEEN :start AND :end', { start, end })
      .orderBy('d.date', 'ASC')
      .addOrderBy('d.start_time', 'ASC')
      .getMany();
    const over = days.filter((d) =>
      CartWeeksService.hasBegun(d.date, hhmm(d.endTime), now),
    );
    const ids = over.map((d) => d.id);
    const [asgs, offs] = await Promise.all([
      ids.length
        ? this.assignmentsRepo.find({ where: { dayId: In(ids) } })
        : [],
      ids.length ? this.cancelRepo.find({ where: { dayId: In(ids) } }) : [],
    ]);
    const pubIds = [
      ...new Set(
        asgs.map((a) => a.publisherId).filter((x): x is string => !!x),
      ),
    ];
    const pubs = pubIds.length
      ? await this.publishersRepo.find({
          where: { id: In(pubIds) },
          withDeleted: true,
        })
      : [];
    const nameOf = new Map(
      pubs.map((p) => [p.id, `${p.lastName} ${p.firstName}`.trim()]),
    );
    const outDays: Awaited<ReturnType<CartWeeksService['archive']>>['days'] =
      [];
    const people = new Set<string>();
    const byPlace = new Map<string, { days: number; minutes: number }>();
    for (const d of over) {
      const dOffs = offs.filter((o) => o.dayId === d.id);
      const list = asgs
        .filter((a) => a.dayId === d.id)
        .flatMap((a) =>
          minus(a, dOffs).map((s) => ({
            name: a.publisherId
              ? (nameOf.get(a.publisherId) ?? '')
              : (a.externalName ?? ''),
            key: a.publisherId ?? `guest:${a.externalName}`,
            ...s,
          })),
        )
        .sort((x, y) => toMin(x.startTime) - toMin(y.startTime));
      if (list.length === 0) continue;
      list.forEach((p) => people.add(p.key));
      const mins = list.reduce((n, s) => n + minutes(s), 0);
      const place = d.location?.name ?? '';
      outDays.push({
        date: dateOf(d.date),
        place,
        kind: d.location?.kind ?? 'cart',
        people: list.map(({ name, startTime, endTime }) => ({
          name,
          startTime,
          endTime,
        })),
        minutes: mins,
      });
      const bp = byPlace.get(place) ?? { days: 0, minutes: 0 };
      bp.days += 1;
      bp.minutes += mins;
      byPlace.set(place, bp);
    }
    return {
      from: start,
      to: end,
      days: outDays,
      totals: {
        days: new Set(outDays.map((d) => d.date)).size,
        minutes: outDays.reduce((n, d) => n + d.minutes, 0),
        people: people.size,
        byPlace: [...byPlace.entries()].map(([place, v]) => ({ place, ...v })),
        calledOff: offs.map((o) => {
          const d = over.find((x) => x.id === o.dayId)!;
          return {
            date: dateOf(d.date),
            place: d.location?.name ?? '',
            startTime: hhmm(o.startTime),
            endTime: hhmm(o.endTime),
            reason: o.reason,
          };
        }),
      },
    };
  }

  /** The last day of the circuit overseer's last visit that is over. */
  private async lastVisitEnd(congregationId: string): Promise<string | null> {
    const today = await this.clock.todayFor(congregationId);
    const rows: { d: string | null }[] = await this.daysRepo.manager.query(
      `SELECT max(coalesce(end_date, date))::text AS d FROM special_events
        WHERE congregation_id = $1 AND type = 'circuit_overseer_visit'
          AND deleted_at IS NULL AND coalesce(end_date, date) < $2`,
      [congregationId, today],
    );
    return rows[0]?.d ? addDays(rows[0].d, 1) : null;
  }

  // ================================================================ memo ===

  async setMemo(congregationId: string, memo: string | null): Promise<void> {
    await this.daysRepo.manager.getRepository(CartSettings).save({
      congregationId,
      memo: memo?.trim() || null,
    });
  }

  // ============================================================ pairings ===

  async recentPairings(
    congregationId: string,
    weeks = 8,
  ): Promise<
    Record<
      string,
      { partnerId: string; name: string; count: number; lastDate: string }[]
    >
  > {
    const today = await this.clock.todayFor(congregationId);
    const back = addDays(today, -weeks * 7);
    const rows = await this.assignmentsRepo
      .createQueryBuilder('a')
      .innerJoin('cart_days', 'd', 'd.id = a.day_id')
      .innerJoin('cart_weeks', 'w', 'w.id = d.week_id')
      .select('a.day_id', 'dayId')
      .addSelect('a.publisher_id', 'publisherId')
      .addSelect('a.start_time', 'startTime')
      .addSelect('a.end_time', 'endTime')
      .addSelect('d.date::text', 'date')
      .where('a.congregation_id = :congregationId', { congregationId })
      .andWhere('a.publisher_id IS NOT NULL')
      .andWhere("w.status = 'published'")
      .andWhere('d.date BETWEEN :back AND :today', { back, today })
      .getRawMany<{
        dayId: string;
        publisherId: string;
        startTime: string;
        endTime: string;
        date: string;
      }>();
    const pairs = new Map<
      string,
      Map<string, { count: number; lastDate: string }>
    >();
    const link = (a: string, b: string, date: string) => {
      const m = pairs.get(a) ?? new Map();
      const e = m.get(b) ?? { count: 0, lastDate: '' };
      e.count += 1;
      if (date > e.lastDate) e.lastDate = date;
      m.set(b, e);
      pairs.set(a, m);
    };
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const x = rows[i];
        const y = rows[j];
        if (
          x.dayId !== y.dayId ||
          x.publisherId === y.publisherId ||
          !overlaps(x, y)
        )
          continue;
        link(x.publisherId, y.publisherId, x.date);
        link(y.publisherId, x.publisherId, y.date);
      }
    }
    const ids = [
      ...new Set([
        ...pairs.keys(),
        ...[...pairs.values()].flatMap((m) => [...m.keys()]),
      ]),
    ];
    const pubs = ids.length
      ? await this.publishersRepo.find({
          where: { id: In(ids), congregationId },
        })
      : [];
    const nameById = new Map(
      pubs.map((p) => [p.id, `${p.lastName} ${p.firstName}`.trim()]),
    );
    const out: Record<
      string,
      { partnerId: string; name: string; count: number; lastDate: string }[]
    > = {};
    for (const [pub, m] of pairs) {
      out[pub] = [...m.entries()]
        .map(([partnerId, v]) => ({
          partnerId,
          name: nameById.get(partnerId) ?? '',
          ...v,
        }))
        .sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
    }
    return out;
  }

  // ============================================================= helpers ===

  private async dayOr404(
    congregationId: string,
    dayId: string,
    withRelations = false,
  ): Promise<CartDay> {
    const day = await this.daysRepo.findOne({
      where: { id: dayId, congregationId },
      ...(withRelations ? { relations: { week: true, location: true } } : {}),
    });
    if (!day) throw new NotFoundException('Day not found');
    return day;
  }

  /** The day's row held for the rest of the transaction, with its week. */
  private async lockDay(
    em: EntityManager,
    congregationId: string,
    dayId: string,
  ): Promise<CartDay> {
    const day = await em.findOne(CartDay, {
      where: { id: dayId, congregationId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!day) throw new NotFoundException('Day not found');
    day.week = (await em.findOne(CartWeek, { where: { id: day.weekId } }))!;
    day.location = (await em.findOne(CartLocation, {
      where: { id: day.locationId },
    }))!;
    if (!day.week || day.week.status === 'draft') {
      throw new BadRequestException(
        refusal('CART_WEEK_CLOSED', 'Week is not open for assignment'),
      );
    }
    return day;
  }

  private dayDetail(day: CartDay, span?: Span): Record<string, string> {
    const s = span ?? day;
    return {
      date: dateOf(day.date),
      time: `${hhmm(s.startTime)}–${hhmm(s.endTime)}`,
      place: day.location?.name ?? '',
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

  private bareLine(day: CartDay, span: Span): ShiftLine {
    return {
      date: dateOf(day.date),
      startTime: hhmm(span.startTime),
      endTime: hhmm(span.endTime),
      place: day.location?.name ?? '',
      kind: day.location?.kind ?? 'cart',
    };
  }

  private isSoon(date: string, time: string, now: Now): boolean {
    const m = CartWeeksService.minutesUntil(date, hhmm(time), now);
    return m <= URGENT_WITHIN_MIN;
  }

  /**
   * For every signed-in person among these places on the plan: his own
   * time that day (joined where it touches, the called-off parts taken
   * out), and who stands at the same time. Only what is still ahead.
   */
  private async linesFor(
    congregationId: string,
    day: CartDay,
    asgs: CartAssignment[],
    now: Now,
    withoutCancelled: boolean,
  ): Promise<Map<string, ShiftLine[]>> {
    const out = new Map<string, ShiftLine[]>();
    if (asgs.length === 0) return out;
    const all = await this.assignmentsRepo.find({ where: { dayId: day.id } });
    const offs = withoutCancelled
      ? await this.cancelRepo.find({ where: { dayId: day.id } })
      : [];
    const ids = [
      ...new Set(all.map((a) => a.publisherId).filter((x): x is string => !!x)),
    ];
    const pubs = ids.length
      ? await this.publishersRepo.find({
          where: { id: In(ids), congregationId },
        })
      : [];
    const byId = new Map(pubs.map((p) => [p.id, p]));
    const nameOf = (a: CartAssignment) =>
      a.publisherId
        ? `${byId.get(a.publisherId)?.lastName ?? ''} ${byId.get(a.publisherId)?.firstName ?? ''}`.trim()
        : (a.externalName ?? '');
    const people = [
      ...new Set(
        asgs.map((a) => a.publisherId).filter((x): x is string => !!x),
      ),
    ];
    for (const pid of people) {
      const userId = byId.get(pid)?.userId;
      if (!userId) continue;
      const own = merge(
        asgs
          .filter((a) => a.publisherId === pid)
          .flatMap((a) => minus(a, offs)),
      ).filter((s) => !CartWeeksService.hasBegun(day.date, s.endTime, now));
      for (const s of own) {
        out.set(userId, [
          ...(out.get(userId) ?? []),
          {
            ...this.bareLine(day, s),
            with: all
              .filter((o) => o.publisherId !== pid && overlaps(o, s))
              .map((o) => ({
                name: nameOf(o),
                startTime: hhmm(o.startTime),
                endTime: hhmm(o.endTime),
              })),
          },
        ]);
      }
    }
    return out;
  }

  /**
   * After the plan of a published day changed: the person it concerns, and
   * the others at that time («состав поменялся»), each in one message — at
   * once if it is near.
   */
  private async tellChange(
    congregationId: string,
    day: CartDay,
    now: Now,
    what:
      | { added: CartAssignment; name: string }
      | { changed: CartAssignment; before: Span }
      | { removed: CartAssignment },
  ): Promise<void> {
    if (day.week?.status !== 'published') return;
    const subject =
      'added' in what
        ? what.added
        : 'changed' in what
          ? what.changed
          : what.removed;
    const affected: Span[] =
      'changed' in what ? [what.before, what.changed] : [subject];
    if (
      affected.every((s) => CartWeeksService.hasBegun(day.date, s.endTime, now))
    )
      return;
    const urgent = affected.some((s) =>
      this.isSoon(day.date, s.startTime, now),
    );
    const all = await this.assignmentsRepo.find({ where: { dayId: day.id } });
    const lines = await this.linesFor(
      congregationId,
      day,
      all.filter((a) => a.publisherId === subject.publisherId),
      now,
      true,
    );
    const [subjectUser] = subject.publisherId
      ? await this.userIdsOf(congregationId, [subject.publisherId])
      : [];
    const kind =
      'added' in what
        ? 'cart_assigned'
        : 'changed' in what
          ? 'cart_changed'
          : 'cart_unassigned';
    if (subjectUser) {
      const mine =
        'removed' in what
          ? [{ ...this.bareLine(day, subject), with: [] }]
          : (lines.get(subjectUser) ?? []);
      if (mine.length > 0) {
        await this.notify(
          congregationId,
          [subjectUser],
          (w, l) => ({
            title:
              'added' in what
                ? w.assignedTitle
                : 'changed' in what
                  ? w.changedTitle
                  : w.unassignedTitle,
            body: shiftLines(mine, l),
          }),
          { type: kind, weekStart: day.week.weekStartDate },
          `${kind}:${subject.id}:${hhmm(subject.startTime)}-${hhmm(subject.endTime)}:${Date.now()}`,
          { urgent, personal: true },
        );
      }
    }
    // The others at that time: who they stand with now.
    const others = all.filter(
      (a) =>
        a.publisherId &&
        a.publisherId !== subject.publisherId &&
        affected.some((s) => overlaps(a, s)),
    );
    const theirs = await this.linesFor(congregationId, day, others, now, true);
    for (const [userId, mine] of theirs) {
      if (userId === subjectUser || mine.length === 0) continue;
      await this.notify(
        congregationId,
        [userId],
        (w, l) => ({ title: w.crewTitle, body: shiftLines(mine, l) }),
        { type: 'cart_crew_changed', weekStart: day.week.weekStartDate },
        `cart-crew:${userId}:${subject.id}:${Date.now()}`,
        { urgent, personal: true },
      );
    }
  }

  private async userIdsOf(
    congregationId: string,
    publisherIds: (string | null)[],
  ): Promise<string[]> {
    const ids = [...new Set(publisherIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return [];
    const pubs = await this.publishersRepo.find({
      where: { id: In(ids), congregationId },
    });
    return [
      ...new Set(pubs.map((p) => p.userId).filter((x): x is string => !!x)),
    ];
  }

  async managerUserIds(congregationId: string): Promise<string[]> {
    const rows = await this.responsibilitiesRepo.find({
      where: { congregationId, type: In(MANAGERS) },
    });
    return [...new Set(rows.map((r) => r.userId).filter(Boolean))];
  }

  async notify(
    congregationId: string,
    userIds: string[],
    text: (
      w: CartWords,
      lang: SupportedLanguage,
    ) => { title: string; body: string },
    data: Record<string, unknown>,
    key?: string,
    opts: { urgent?: boolean; personal?: boolean } = {},
  ): Promise<void> {
    if (userIds.length === 0) return;
    try {
      await this.notifications.notify({
        tenantId: congregationId,
        userIds,
        text: (l) => text(CART_STR[l], l),
        kind: String(data.type),
        data,
        key,
        // Something within twelve hours goes out at once, even at night: a
        // partner who cannot come at eight must not be learnt of at eight.
        urgent: opts.urgent === true,
        // One's own time at the stand is an assignment: whoever has no
        // device with the app gets it as a letter.
        emailFallback: opts.personal === true,
      });
    } catch (e) {
      this.logger.warn(`cart notification failed: ${String(e)}`);
    }
  }
}

export { addDays as cartAddDays };
