import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { In, IsNull, Not, Repository } from 'typeorm';
import { SpecialEvent } from '../entities/special-event.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { CreateSpecialEventDto } from './dto/create-special-event.dto';
import { UpdateSpecialEventDto } from './dto/update-special-event.dto';
import { QuerySpecialEventsDto } from './dto/query-special-events.dto';
import { UpdateAccommodationDto } from './dto/update-accommodation.dto';
import {
  CIRCUIT_OVERSEER_VISIT_TYPE,
  CoVisitTemplateService,
} from './co-visit-template.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { mondayOf } from '../common/week';
import { UserRole } from '../common/enums/user-role.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { EventNotificationsService } from './event-notifications.service';
import { TalkExchangeService } from '../talk-exchange/talk-exchange.service';
import { signatureOf } from './event-messages';
import { settleMeeting } from './meeting-mode';
import { assertEventShape, serviceYearOf } from './event-shape';

/** The fields the journal records for an event — the ones a reader can follow. */
const JOURNAL_FIELDS = [
  'title',
  'type',
  'date',
  'endDate',
  'time',
  'timeEnd',
  'address',
  'note',
  'meetingMode',
  'meetingNote',
  'meetingTime',
  'meetingAddress',
] as const;

function journalView(e: SpecialEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of JOURNAL_FIELDS) out[f] = e[f] ?? null;
  return out;
}

/** The last day an event covers. */
function lastDay(e: { date: string; endDate?: string | null }): string {
  return e.endDate ?? e.date;
}

@Injectable()
export class SpecialEventsService {
  constructor(
    @InjectRepository(SpecialEvent)
    private readonly specialEventsRepo: Repository<SpecialEvent>,
    private readonly coVisitTemplate: CoVisitTemplateService,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
    // Last on purpose: the spec builds this service positionally.
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    /** Tells the congregation. Last, for the same reason. */
    private readonly eventNotifications: EventNotificationsService,
    /** The talk journal follows a circuit visit; see TalkExchangeService. */
    private readonly talkExchange: TalkExchangeService,
  ) {}

  /** Whether the journal should follow this event: a visit still ahead. */
  private async journalFollows(event: SpecialEvent): Promise<boolean> {
    return (
      event.type === CIRCUIT_OVERSEER_VISIT_TYPE &&
      !(await this.coVisitTemplate.weekIsOver(event))
    );
  }

  private async holds(
    user: AuthenticatedUser,
    types: ResponsibilityType[],
  ): Promise<boolean> {
    const n = await this.responsibilities.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(types),
      },
    });
    return n > 0;
  }

  /** Keeps the events — the controller's own guard, asked here for reads. */
  async canManage(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    return this.holds(user, [ResponsibilityType.BODY_COORDINATOR]);
  }

  /**
   * May read where the circuit overseer stays and with whom.
   *
   * A private address, and a family's home. It was sent to every member with
   * every event list — the app only chose not to draw it. The people who need
   * it are those who read or arrange the visit schedule: elders (who can open
   * the schedule), the service overseer and his assistant (who arrange it),
   * the body coordinator (who keeps the event) and administrators.
   */
  async seesAccommodation(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN || user.role === UserRole.ELDER) {
      return true;
    }
    return this.holds(user, [
      ResponsibilityType.BODY_COORDINATOR,
      ResponsibilityType.SERVICE_OVERSEER,
      ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
    ]);
  }

  /**
   * What leaves the server. The undo plan of the visit template is internal
   * bookkeeping for everyone; the accommodation only for those above.
   */
  private present(e: SpecialEvent, seesAccommodation: boolean): SpecialEvent {
    const out: Partial<SpecialEvent> = { ...e };
    delete out.coRevertData;
    if (!seesAccommodation) {
      out.coAccommodationAddress = null;
      out.coAccommodationPublisherId = null;
    }
    return out as SpecialEvent;
  }

  /**
   * Lists events for the tenant. By default returns only events that have not
   * finished yet (COALESCE(end_date, date) >= today on the congregation's own
   * clock), so a multi-day event stays visible until its last day. Ordered by
   * start date then time. Pass `all=true` to include past events; removed
   * ones (`includeRemoved=true`) only for those who keep the events.
   */
  async findAll(
    tenantId: string,
    query: QuerySpecialEventsDto,
    user?: AuthenticatedUser,
  ): Promise<SpecialEvent[]> {
    const qb = this.specialEventsRepo
      .createQueryBuilder('e')
      .where('e.congregation_id = :tenantId', { tenantId });

    // The bin is the keeper's tool. Anyone else asking for it gets the list
    // without it, as if they had not asked.
    if (
      query.includeRemoved === 'true' &&
      (!user || (await this.canManage(user)))
    ) {
      qb.withDeleted();
    }

    if (query.since) {
      // Everything from that date on, past and future — narrower than «all»,
      // wider than «only what is still ahead».
      qb.andWhere('COALESCE(e.end_date, e.date) >= :since', {
        since: query.since,
      });
    } else if (query.all !== 'true') {
      // The congregation's own day. The timezone used to be written in here
      // as a string, which is right for Ahlen and wrong for anyone else — and
      // no guard caught it, because it is not the `toISOString().slice()`
      // spelling the guard was looking for.
      const today = await this.clock.todayFor(tenantId);
      qb.andWhere('COALESCE(e.end_date, e.date) >= :today', { today });
    }

    qb.orderBy('e.date', 'ASC').addOrderBy('e.time', 'ASC');
    const rows = await qb.getMany();
    if (!user) return rows;
    const sees = await this.seesAccommodation(user);
    return rows.map((e) => this.present(e, sees));
  }

  async findOne(tenantId: string, id: string): Promise<SpecialEvent> {
    const event = await this.specialEventsRepo
      .createQueryBuilder('e')
      .withDeleted()
      .where('e.congregation_id = :tenantId', { tenantId })
      .andWhere('e.id = :id', { id })
      .getOne();

    if (!event) {
      throw new NotFoundException('Special event not found');
    }
    return event;
  }

  /** One event as this person may read it; a removed one only for keepers. */
  async findOneFor(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<SpecialEvent> {
    const event = await this.findOne(tenantId, id);
    if (event.deletedAt && !(await this.canManage(user))) {
      throw new NotFoundException('Special event not found');
    }
    return this.present(event, await this.seesAccommodation(user));
  }

  private assertDates(date: string, endDate: string | null | undefined) {
    if (endDate && endDate < date) {
      throw new BadRequestException({
        code: 'EVENT_END_BEFORE_START',
        message: 'The event cannot end before it starts',
      });
    }
  }

  /**
   * One circuit visit to a week. A second one would lay the template on the
   * same meetings twice — two service talks, the study hidden twice — and
   * which of them «the visit» is would depend on the order of a list.
   */
  private async assertVisitWeekFree(
    tenantId: string,
    date: string,
    exceptId?: string,
  ) {
    const week = mondayOf(date);
    const visits = await this.specialEventsRepo.find({
      where: {
        congregationId: tenantId,
        type: CIRCUIT_OVERSEER_VISIT_TYPE,
        deletedAt: IsNull(),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    if (visits.some((v) => mondayOf(v.date) === week)) {
      throw new ConflictException({
        code: 'CO_VISIT_WEEK_TAKEN',
        message: 'This week already has a circuit overseer visit',
      });
    }
  }

  /**
   * The Memorial is held once a year: a second one in the same service year
   * is a mistake, and every screen that asks «which Memorial» would pick
   * one of the two by chance. It also needs its hour — without it nobody
   * can be reminded (the reminder is sent for a time, not a day).
   */
  private async assertMemorial(
    tenantId: string,
    next: { type?: string | null; date: string; time?: string | null },
    exceptId?: string,
  ) {
    if (next.type !== 'memorial') return;
    if (!next.time?.trim()) {
      throw new BadRequestException({
        code: 'EVENT_MEMORIAL_NEEDS_TIME',
        message: 'The Memorial needs its starting time',
      });
    }
    const others = await this.specialEventsRepo.find({
      where: {
        congregationId: tenantId,
        type: 'memorial',
        deletedAt: IsNull(),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    const year = serviceYearOf(next.date);
    if (others.some((o) => serviceYearOf(o.date) === year)) {
      throw new ConflictException({
        code: 'EVENT_MEMORIAL_TAKEN',
        message: 'This service year already has a Memorial',
      });
    }
  }

  async create(
    tenantId: string,
    dto: CreateSpecialEventDto,
  ): Promise<SpecialEvent> {
    this.assertDates(dto.date, dto.endDate);
    assertEventShape(dto, null);
    await this.assertMemorial(tenantId, dto);
    if (dto.type === CIRCUIT_OVERSEER_VISIT_TYPE) {
      await this.assertVisitWeekFree(tenantId, dto.date);
    }
    const event = this.specialEventsRepo.create({
      ...dto,
      congregationId: tenantId,
    });
    Object.assign(
      event,
      settleMeeting(
        {
          type: event.type,
          meetingMode: 'usual',
          meetingNote: null,
          meetingTime: null,
          meetingAddress: null,
          replacesMeeting: false,
        },
        dto,
      ),
    );
    const saved = await this.specialEventsRepo.save(event);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'special_event',
      entityId: saved.id,
      after: journalView(saved),
    });
    // A visit entered for the record — its week already held — changes
    // nothing: the template never touches a week that is over. Nor is it
    // announced: the announcement, too, is only for what is ahead.
    const applied = await this.coVisitTemplate.apply(saved);
    if (await this.journalFollows(applied)) {
      await this.talkExchange.circuitVisitApplied(
        tenantId,
        mondayOf(applied.date),
      );
    }
    await this.eventNotifications.announce(applied, 'created');
    return this.present(applied, true);
  }

  /**
   * Changes an event.
   *
   * WHEN AN EVENT IS OVER it is history, and what defines it — its days and
   * its kind — stays as it was: a circuit visit moved out of a week that was
   * held would take the overseer's talks out of the programme that was
   * actually given. Its note, place and links can still be put right.
   *
   * A VISIT THAT MOVES takes its programme with it. The template's changes
   * were laid on the week of the old date and stayed there when the date
   * changed — the old week kept the service talk with the study hidden, the
   * new week got nothing. Now the old week is given back first, and the new
   * one gets the template (as far as its programme exists; the rest comes
   * when it is loaded). The same when an event becomes, or stops being, a
   * visit.
   */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateSpecialEventDto,
  ): Promise<SpecialEvent> {
    const event = await this.findOne(tenantId, id);
    if (event.deletedAt) {
      throw new NotFoundException('Special event not found');
    }
    const today = await this.clock.todayFor(tenantId);

    const nextDate = dto.date ?? event.date;
    const nextEnd = dto.endDate !== undefined ? dto.endDate : event.endDate;
    const nextType = dto.type !== undefined ? dto.type : event.type;

    const datesChanged =
      nextDate !== event.date || (nextEnd ?? null) !== (event.endDate ?? null);
    const typeChanged = (nextType ?? null) !== (event.type ?? null);
    const meeting = settleMeeting({ ...event, type: nextType }, dto);
    // Whether the meeting was held is history too: attendance was counted by
    // it. The hour, the place and the words can still be put right.
    const modeChanged = meeting.meetingMode !== (event.meetingMode ?? 'usual');

    if (
      lastDay(event) < today &&
      (datesChanged || typeChanged || modeChanged)
    ) {
      throw new BadRequestException({
        code: 'EVENT_PAST_LOCKED',
        message:
          'An event that is over keeps its days, its kind and whether the meeting was held; only its note, place and links can change',
      });
    }
    if (datesChanged && lastDay({ date: nextDate, endDate: nextEnd }) < today) {
      throw new BadRequestException({
        code: 'EVENT_MOVED_INTO_PAST',
        message: 'An event cannot be moved into the past',
      });
    }
    this.assertDates(nextDate, nextEnd);
    assertEventShape({ ...event, ...dto }, event);
    const nextTime = dto.time !== undefined ? dto.time : event.time;
    const memorialTouched =
      nextType === 'memorial' &&
      (typeChanged ||
        mondayOf(nextDate) !== mondayOf(event.date) ||
        (nextTime ?? null) !== (event.time ?? null));
    if (memorialTouched) {
      await this.assertMemorial(
        tenantId,
        { type: nextType, date: nextDate, time: nextTime },
        event.id,
      );
    }

    const weekChanged = mondayOf(nextDate) !== mondayOf(event.date);
    const templateMoves =
      (weekChanged || typeChanged) &&
      (event.type === CIRCUIT_OVERSEER_VISIT_TYPE ||
        nextType === CIRCUIT_OVERSEER_VISIT_TYPE);
    if (
      nextType === CIRCUIT_OVERSEER_VISIT_TYPE &&
      (weekChanged || typeChanged)
    ) {
      await this.assertVisitWeekFree(tenantId, nextDate, event.id);
    }

    const prevName = this.coVisitTemplate.displayName(event);
    const before = journalView(event);
    const signatureBefore = signatureOf(event);

    // Where the visit stood, for the journal: the entry of the old week
    // moves with the visit, or goes when the event stops being one.
    const wasVisit = event.type === CIRCUIT_OVERSEER_VISIT_TYPE;
    const oldWeek = mondayOf(event.date);
    const oldWeekGivenBack =
      templateMoves && !(await this.coVisitTemplate.weekIsOver(event));
    if (oldWeekGivenBack) {
      // Gives the old week back — sets coRevertData to null on `event`.
      await this.coVisitTemplate.revert(event);
    }

    Object.assign(event, dto, meeting);
    const saved = await this.specialEventsRepo.save(event);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'special_event',
      entityId: saved.id,
      before,
      after: journalView(saved),
      fields: [...JOURNAL_FIELDS],
    });

    // Told again only when what people plan by has changed — the days, the
    // hours, the place, the kind, whether the meeting goes. A corrected note
    // or link is not worth a message on every phone.
    const told = signatureOf(saved) !== signatureBefore;

    if (templateMoves) {
      const applied = await this.coVisitTemplate.apply(saved);
      if (wasVisit && oldWeekGivenBack) {
        if (applied.type === CIRCUIT_OVERSEER_VISIT_TYPE) {
          await this.talkExchange.circuitVisitMoved(
            tenantId,
            oldWeek,
            mondayOf(applied.date),
            prevName,
          );
        } else {
          await this.talkExchange.circuitVisitRemoved(
            tenantId,
            oldWeek,
            prevName,
          );
        }
      }
      if (await this.journalFollows(applied)) {
        await this.talkExchange.circuitVisitApplied(
          tenantId,
          mondayOf(applied.date),
        );
      }
      if (told) await this.eventNotifications.announce(applied, 'changed');
      return this.present(applied, true);
    }
    if (!(await this.coVisitTemplate.weekIsOver(saved))) {
      // Saving a visit offers its week the template again. A meeting that has
      // it is not touched a second time; one loaded since gets it; and a slot
      // left from before the overseer had it to himself is put right — so
      // «open the visit and save» is how a week is mended, by hand, today.
      if (saved.type === CIRCUIT_OVERSEER_VISIT_TYPE) {
        await this.coVisitTemplate.apply(saved);
      }
      await this.coVisitTemplate.syncSpeaker(saved, prevName);
    }
    // Another overseer's name on the same visit: the slot now carries it,
    // and the journal entry and the card follow.
    if (await this.journalFollows(saved)) {
      await this.talkExchange.circuitVisitApplied(
        tenantId,
        mondayOf(saved.date),
        prevName,
      );
    }
    if (told) await this.eventNotifications.announce(saved, 'changed');
    return this.present(saved, true);
  }

  /**
   * Where the circuit overseer stays — the one part of a visit the visit
   * schedule arranges. The service overseer and his assistant plan the visit
   * but do not keep the events, so the whole-event edit refused them and the
   * schedule's «who hosts» could not be saved by the very people it is for.
   */
  async updateAccommodation(
    tenantId: string,
    id: string,
    dto: UpdateAccommodationDto,
  ): Promise<SpecialEvent> {
    const event = await this.findOne(tenantId, id);
    if (event.deletedAt || event.type !== CIRCUIT_OVERSEER_VISIT_TYPE) {
      throw new NotFoundException('Circuit overseer visit not found');
    }
    if (dto.coAccommodationPublisherId !== undefined) {
      event.coAccommodationPublisherId = dto.coAccommodationPublisherId;
    }
    if (dto.coAccommodationAddress !== undefined) {
      event.coAccommodationAddress = dto.coAccommodationAddress;
    }
    return this.present(await this.specialEventsRepo.save(event), true);
  }

  /**
   * Removes an event into the bin.
   *
   * A coming visit takes its programme changes with it. One that is over is
   * history and is not removed at all — except by an administrator putting
   * right an entry made by mistake, and then only the entry goes: the
   * programme of a week that was held stays as it was given.
   */
  async remove(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const event = await this.findOne(tenantId, id);
    const today = await this.clock.todayFor(tenantId);
    const over = lastDay(event) < today;
    if (over && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException({
        code: 'EVENT_PAST_ADMIN_ONLY',
        message:
          'An event that is over is history; only an administrator can remove it',
      });
    }
    if (!over && !(await this.coVisitTemplate.weekIsOver(event))) {
      await this.coVisitTemplate.revert(event);
      if (event.type === CIRCUIT_OVERSEER_VISIT_TYPE) {
        await this.talkExchange.circuitVisitRemoved(
          tenantId,
          mondayOf(event.date),
          this.coVisitTemplate.displayName(event),
        );
      }
    }
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'special_event',
      entityId: id,
      action: 'DELETE',
      detail: { title: event.title, date: event.date },
    });
    await this.specialEventsRepo.softDelete({ id, congregationId: tenantId });
    if (!over) await this.eventNotifications.announce(event, 'cancelled');
  }

  async restore(tenantId: string, id: string): Promise<SpecialEvent> {
    const found = await this.findOne(tenantId, id);
    if (found.type === CIRCUIT_OVERSEER_VISIT_TYPE && found.deletedAt) {
      await this.assertVisitWeekFree(tenantId, found.date, found.id);
    }
    await this.specialEventsRepo.restore({ id, congregationId: tenantId });
    const event = await this.findOne(tenantId, id);
    const applied = await this.coVisitTemplate.apply(event);
    if (await this.journalFollows(applied)) {
      await this.talkExchange.circuitVisitApplied(
        tenantId,
        mondayOf(applied.date),
      );
    }
    if (found.deletedAt) {
      await this.eventNotifications.announce(applied, 'restored');
    }
    return this.present(applied, true);
  }
}
