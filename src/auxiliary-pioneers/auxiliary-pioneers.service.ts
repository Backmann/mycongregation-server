import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { In, IsNull, Not, Repository } from 'typeorm';
import { AuxiliaryPioneer } from '../entities/auxiliary-pioneer.entity';
import { Publisher } from '../entities/publisher.entity';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { Responsibility } from '../entities/responsibility.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateAuxiliaryPioneerDto } from './dto/create-auxiliary-pioneer.dto';
import { StopAuxiliaryPioneerDto } from './dto/stop-auxiliary-pioneer.dto';
import { UpdateAuxiliaryPioneerDto } from './dto/update-auxiliary-pioneer.dto';
import {
  auxiliaryPioneerHourGoal,
  isActiveInMonth,
  monthKeyOf,
  monthsInRange,
  REDUCED_HOUR_EVENT_TYPES,
} from './auxiliary-pioneer-hours';
import { CongregationClock } from '../common/congregation-clock.service';
import { refusal } from '../common/errors/refusal';
import { ReportMonthClosure } from '../entities/report-month-closure.entity';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { pioneerTypeInMonth } from '../common/pioneer-status';

/** «Until cancelled» has no last month; this one stands for it in comparisons. */
const OPEN_END = '9999-12';

/** A period as months: its first, and its last (OPEN_END when open). */
interface MonthSpan {
  start: string; // YYYY-MM
  end: string; // YYYY-MM or OPEN_END
}

function spanOf(p: {
  startMonth: string;
  endMonth: string | null;
  untilCancelled: boolean;
}): MonthSpan {
  return {
    start: p.startMonth.slice(0, 7),
    end: p.untilCancelled || !p.endMonth ? OPEN_END : p.endMonth.slice(0, 7),
  };
}

/** The months a span covers, an open one taken up to `horizon`. */
function monthsOfSpan(span: MonthSpan, horizon: string): string[] {
  const end = span.end === OPEN_END ? horizon : span.end;
  if (end < span.start) return [];
  return monthsInRange(`${span.start}-01`, `${end}-01`);
}

/** «2026-10» plus n months. */
function addMonthsKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The roles/responsibilities that may manage auxiliary pioneers. */
const MANAGER_RESPONSIBILITIES = [
  ResponsibilityType.BODY_COORDINATOR,
  ResponsibilityType.SECRETARY,
  ResponsibilityType.SERVICE_OVERSEER,
];

export interface AuxPioneerMonthRow {
  id: string;
  publisherId: string;
  publisherName: string;
  startMonth: string;
  endMonth: string | null;
  untilCancelled: boolean;
  hourGoal: number;
}

export type AuxPioneerState = 'upcoming' | 'serving' | 'finished';

export interface AuxPioneerJournalRow {
  id: string;
  publisherId: string;
  publisherName: string;
  startMonth: string;
  endMonth: string | null;
  untilCancelled: boolean;
  state: AuxPioneerState;
  currentPioneerType: PioneerType;
}

/**
 * Who serves as an auxiliary pioneer THIS month — for everybody.
 *
 * Names, and nothing else: no hours, no terms («до отмены · с марта»), no
 * other month, no journal. A publisher is told who serves beside her now so
 * that she can go out with them (Lionel, 6 October 2026); the rest is the
 * working list of those who keep it.
 *
 * `publisherId` is there because two screens open to everybody — a group's
 * card and the roster's filter — mark these very people; they read the whole
 * journal for it, which gave every signed-in person every period ever served.
 */
export interface AuxPioneersServingNow {
  month: string;
  people: { publisherId: string; name: string }[];
}

/** Один собственный период — ровно то, что нужно назвать на главной. */
export interface MyAuxPioneerPeriod {
  startMonth: string;
  endMonth: string | null;
  untilCancelled: boolean;
}

/**
 * Собственное положение вошедшего возвещателя вокруг месяца: период,
 * покрывающий этот месяц, и ближайший ещё не начавшийся. Смысл `upcoming` в
 * том, чтобы в июле было видно: август уже оформлен.
 */
export interface MyAuxPioneerStatus {
  serving: boolean;
  current: MyAuxPioneerPeriod | null;
  upcoming: MyAuxPioneerPeriod | null;
}

@Injectable()
export class AuxiliaryPioneersService {
  constructor(
    @InjectRepository(AuxiliaryPioneer)
    private readonly repo: Repository<AuxiliaryPioneer>,
    @InjectRepository(Publisher)
    private readonly publisherRepo: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilityRepo: Repository<Responsibility>,
    @InjectRepository(SpecialEvent)
    private readonly eventRepo: Repository<SpecialEvent>,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
    @InjectRepository(ReportMonthClosure)
    private readonly closuresRepo: Repository<ReportMonthClosure>,
    @InjectRepository(PioneerSpell)
    private readonly spellsRepo: Repository<PioneerSpell>,
  ) {}

  /** The congregation's current month, «YYYY-MM». */
  private async currentMonthKey(congregationId: string): Promise<string> {
    return monthKeyOf(await this.clock.todayFor(congregationId));
  }

  /**
   * THE RULES OF A PERIOD (29 October 2026). Every way a period is written —
   * this screen, the month ticked while filling a card, and soon the
   * application — comes through here, so the rules cannot part company.
   *
   *   • one person, one period a month: two rows for the same October made
   *     him an auxiliary pioneer twice in the working list;
   *   • a regular, special or missionary pioneer is not also an auxiliary
   *     one — asked of the spells, month by month, so a sister who pioneered
   *     years ago may serve as an auxiliary pioneer now;
   *   • a CLOSED month stays as it was sent to the branch: the monthly
   *     figures count auxiliary pioneers by these rows, so changing one moved
   *     a sent figure without a word. As with reports, only an administrator
   *     or the secretary may change it.
   *
   * `changed` are the months whose membership the write changes — not the
   * whole period: moving the end of an open period does not touch a closed
   * September in it.
   */
  private async assertPeriodAllowed(
    congregationId: string,
    user: AuthenticatedUser | null,
    publisherId: string,
    span: MonthSpan,
    changed: string[],
    excludeId: string | null,
  ): Promise<void> {
    const others = await this.repo.find({
      where: { congregationId, publisherId },
    });
    for (const o of others) {
      if (o.id === excludeId) continue;
      const os = spanOf(o);
      if (os.start <= span.end && span.start <= os.end) {
        const first = os.start > span.start ? os.start : span.start;
        throw new BadRequestException(
          refusal(
            'AUX_OVERLAP',
            'This publisher already serves as an auxiliary pioneer in one of these months.',
            { month: first },
          ),
        );
      }
    }

    const spells = await this.spellsRepo.find({
      where: { congregationId, publisherId },
    });
    if (spells.length > 0) {
      // An open period is asked up to a year ahead: a regular appointment
      // later than that closes the auxiliary period when it is entered.
      const horizon = addMonthsKey(
        await this.currentMonthKey(congregationId),
        12,
      );
      for (const m of monthsOfSpan(
        span,
        horizon > span.start ? horizon : span.start,
      )) {
        if (pioneerTypeInMonth(spells, `${m}-01`) !== PioneerType.NONE) {
          throw new BadRequestException(
            refusal(
              'AUX_PERMANENT_PIONEER',
              'This publisher is a permanent pioneer in that month.',
              { month: m },
            ),
          );
        }
      }
    }

    await this.assertMonthsOpen(congregationId, user, changed);
  }

  /**
   * None of `changed` is a closed month — unless `user` may change one.
   * `user` null: nobody may (a deletion is not let across a closed month).
   */
  private async assertMonthsOpen(
    congregationId: string,
    user: AuthenticatedUser | null,
    changed: string[],
  ): Promise<void> {
    if (
      changed.length > 0 &&
      !(user && (await this.mayChangeClosed(congregationId, user)))
    ) {
      const closed = await this.closuresRepo.find({
        where: {
          congregationId,
          reportMonth: In([...new Set(changed)].map((m) => `${m}-01`)),
        },
      });
      if (closed.length > 0) {
        const month = closed
          .map((c) => String(c.reportMonth).slice(0, 7))
          .sort()[0];
        throw new ForbiddenException(
          refusal(
            'AUX_MONTH_CLOSED',
            'That month is closed. Ask the secretary to change it.',
            { month },
          ),
        );
      }
    }
  }

  /** Admins and the secretary — the two who may change a closed month. */
  private async mayChangeClosed(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    return (
      (await this.responsibilityRepo.count({
        where: {
          congregationId,
          userId: user.id,
          type: ResponsibilityType.SECRETARY,
        },
      })) > 0
    );
  }

  /** Months in one list and not the other, both taken up to `horizon`. */
  private static changedMonths(
    before: MonthSpan | null,
    after: MonthSpan | null,
    horizon: string,
  ): string[] {
    const a = new Set(before ? monthsOfSpan(before, horizon) : []);
    const b = new Set(after ? monthsOfSpan(after, horizon) : []);
    return [
      ...[...a].filter((m) => !b.has(m)),
      ...[...b].filter((m) => !a.has(m)),
    ];
  }

  /**
   * Managers: admins, body coordinator, secretary, service overseer — as a
   * plain answer, without refusing.
   *
   * A screen that offers what the server will refuse is worse than a screen
   * that offers nothing: the history fill is open to a group overseer as well,
   * and marking a month of auxiliary service is not. He is shown the mark
   * greyed out with a word about who may set it, and for that the question has
   * to be askable without throwing.
   */
  async canManage(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const holds = await this.responsibilityRepo.count({
      where: {
        congregationId,
        userId: user.id,
        type: In(MANAGER_RESPONSIBILITIES),
      },
    });
    return holds > 0;
  }

  /** Managers: admins, body coordinator, secretary, service overseer. */
  async assertCanManage(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (await this.canManage(congregationId, user)) return;
    throw new ForbiddenException(
      refusal(
        'AUX_PIONEERS_FORBIDDEN',
        'Only admins, the body coordinator, the secretary or the service ' +
          'overseer may manage auxiliary pioneers.',
      ),
    );
  }

  private normalizeMonth(iso: string): string {
    return `${iso.slice(0, 7)}-01`;
  }

  /** Reduced-hour events (Memorial, CO visit) as bare {date, endDate}. */
  private async reducedHourEvents(
    congregationId: string,
  ): Promise<{ date: string; endDate: string | null }[]> {
    const events = await this.eventRepo.find({
      where: {
        congregationId,
        type: In(REDUCED_HOUR_EVENT_TYPES as unknown as string[]),
      },
      select: ['date', 'endDate'],
    });
    return events.map((e) => ({ date: e.date, endDate: e.endDate }));
  }

  /** Everyone serving in the given month, with the computed hour goal. */
  async listForMonth(
    congregationId: string,
    monthIso: string,
  ): Promise<{ month: string; hourGoal: number; rows: AuxPioneerMonthRow[] }> {
    const monthKey = monthKeyOf(monthIso);
    const all = await this.repo.find({ where: { congregationId } });
    const active = all.filter((p) =>
      isActiveInMonth(
        {
          startMonth: p.startMonth,
          endMonth: p.endMonth,
          untilCancelled: p.untilCancelled,
        },
        monthKey,
      ),
    );
    const events = await this.reducedHourEvents(congregationId);
    const hourGoal = auxiliaryPioneerHourGoal(monthKey, events);
    const names = await this.namesByIds(
      congregationId,
      active.map((p) => p.publisherId),
    );
    const rows: AuxPioneerMonthRow[] = active.map((p) => ({
      id: p.id,
      publisherId: p.publisherId,
      publisherName: names.get(p.publisherId) ?? '—',
      startMonth: p.startMonth,
      endMonth: p.endMonth,
      untilCancelled: p.untilCancelled,
      hourGoal,
    }));
    rows.sort((a, b) => a.publisherName.localeCompare(b.publisherName));
    return { month: `${monthKey}-01`, hourGoal, rows };
  }

  /**
   * This month's auxiliary pioneers, by name — the only answer about them
   * that is given to everybody (see AuxPioneersServingNow).
   *
   * The month is the congregation's own, read from its clock: it cannot be
   * asked for, so there is no way to page back through who served when.
   * Somebody whose card has been removed is not named.
   */
  async servingNow(congregationId: string): Promise<AuxPioneersServingNow> {
    const monthKey = monthKeyOf(await this.clock.todayFor(congregationId));
    const all = await this.repo.find({ where: { congregationId } });
    const ids = [
      ...new Set(
        all
          .filter((p) =>
            isActiveInMonth(
              {
                startMonth: p.startMonth,
                endMonth: p.endMonth,
                untilCancelled: p.untilCancelled,
              },
              monthKey,
            ),
          )
          .map((p) => p.publisherId),
      ),
    ];
    const publishers =
      ids.length === 0
        ? []
        : await this.publisherRepo.find({
            where: { id: In(ids), congregationId, removedAt: IsNull() },
            select: ['id', 'displayName'],
          });
    const people = publishers
      .map((p) => ({ publisherId: p.id, name: p.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { month: `${monthKey}-01`, people };
  }

  /**
   * Permanent pioneers whose card carries no date at all.
   *
   * The card holds `pioneerType` and `pioneerSince`, and the second is
   * frequently empty: of ten regular pioneers here, eight have neither a date
   * of appointment nor a start of ministry. That was harmless while every
   * reader asked «is he a pioneer now» — and it stops being harmless the
   * moment history is kept by spells, because a spell needs a beginning. A man
   * without one would simply cease to have pioneered in any past month: his
   * hours, his line in the monthly figures and his year's goal would all move,
   * silently and wrongly.
   *
   * So this names them, and nothing more. It computes nothing, changes
   * nothing, and blocks nothing — it exists so the dates can be filled in by
   * hand BEFORE anything is moved onto spells.
   */
  async pioneersMissingDate(congregationId: string): Promise<
    {
      publisherId: string;
      displayName: string;
      pioneerType: PioneerType;
    }[]
  > {
    const rows = await this.publisherRepo.find({
      where: {
        congregationId,
        pioneerType: Not(PioneerType.NONE),
        pioneerSince: IsNull(),
        ministryStartDate: IsNull(),
      },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
    return rows.map((p) => ({
      publisherId: p.id,
      displayName: p.displayName,
      pioneerType: p.pioneerType,
    }));
  }

  /** Full history — who serves now and who served before. */
  async journal(congregationId: string): Promise<AuxPioneerJournalRow[]> {
    const all = await this.repo.find({ where: { congregationId } });
    const nowKey = await this.currentMonthKey(congregationId);
    const names = await this.namesByIds(
      congregationId,
      all.map((p) => p.publisherId),
    );
    const pioneerTypes = await this.pioneerTypesByIds(
      congregationId,
      all.map((p) => p.publisherId),
    );
    const rows = all.map((p) => {
      const startKey = p.startMonth.slice(0, 7);
      const serving = isActiveInMonth(
        {
          startMonth: p.startMonth,
          endMonth: p.endMonth,
          untilCancelled: p.untilCancelled,
        },
        nowKey,
      );
      // Three time-relative states: a record entirely in the future is
      // "upcoming"; one covering the current month is "serving"; one entirely
      // in the past is "finished". This makes the journal correct at any point
      // in time — e.g. "only August" is upcoming in July, serving in August,
      // finished in September — without any recomputation.
      let state: AuxPioneerState;
      if (serving) {
        state = 'serving';
      } else if (startKey > nowKey) {
        state = 'upcoming';
      } else {
        state = 'finished';
      }
      return {
        id: p.id,
        publisherId: p.publisherId,
        publisherName: names.get(p.publisherId) ?? '—',
        startMonth: p.startMonth,
        endMonth: p.endMonth,
        untilCancelled: p.untilCancelled,
        state,
        currentPioneerType: pioneerTypes.get(p.publisherId) ?? PioneerType.NONE,
      };
    });
    // Serving first, then upcoming (soonest first), then finished (most recent
    // first).
    const order: Record<AuxPioneerState, number> = {
      serving: 0,
      upcoming: 1,
      finished: 2,
    };
    rows.sort((a, b) => {
      if (a.state !== b.state) return order[a.state] - order[b.state];
      if (a.state === 'upcoming') {
        return a.startMonth.localeCompare(b.startMonth); // soonest first
      }
      return b.startMonth.localeCompare(a.startMonth); // most recent first
    });
    return rows;
  }

  async create(
    congregationId: string,
    user: AuthenticatedUser,
    dto: CreateAuxiliaryPioneerDto,
  ): Promise<AuxiliaryPioneer> {
    await this.assertCanManage(congregationId, user);
    const publisher = await this.publisherRepo.findOne({
      where: { id: dto.publisherId, congregationId },
    });
    if (!publisher) throw new NotFoundException('Publisher not found.');
    // Only baptized publishers may serve as auxiliary pioneers.
    if (
      publisher.appointment === PublisherAppointment.UNBAPTIZED_PUBLISHER ||
      publisher.appointment === PublisherAppointment.STUDENT
    ) {
      throw new BadRequestException(
        refusal(
          'PIONEER_NOT_BAPTIZED',
          'Only baptized publishers can serve as auxiliary pioneers.',
        ),
      );
    }
    const untilCancelled = dto.untilCancelled === true;
    const startMonth = this.normalizeMonth(dto.startMonth);
    const endMonth =
      untilCancelled || !dto.endMonth
        ? null
        : this.normalizeMonth(dto.endMonth);
    if (endMonth && endMonth < startMonth) {
      throw new BadRequestException(
        refusal('END_BEFORE_START', 'End month cannot precede start month.'),
      );
    }
    // A regular pioneer's card says so today; the spells say it per month.
    const span = spanOf({ startMonth, endMonth, untilCancelled });
    const horizon = await this.currentMonthKey(congregationId);
    await this.assertPeriodAllowed(
      congregationId,
      user,
      dto.publisherId,
      span,
      AuxiliaryPioneersService.changedMonths(null, span, horizon),
      null,
    );
    const row = this.repo.create({
      congregationId,
      publisherId: dto.publisherId,
      startMonth,
      endMonth,
      untilCancelled,
      note: dto.note ?? null,
      createdBy: user.id,
    });
    const saved = await this.repo.save(row);
    await this.auditLog.logCreate({
      tenantId: congregationId,
      entityType: 'auxiliary_pioneer',
      entityId: saved.id,
      subjectId: saved.publisherId,
      after: {
        startMonth: saved.startMonth,
        endMonth: saved.endMonth,
        untilCancelled: saved.untilCancelled,
      },
    });
    return saved;
  }

  /**
   * Edit a period (start/end months, until-cancelled). The publisher is not
   * changed. When untilCancelled becomes true the end month is cleared.
   */
  async update(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAuxiliaryPioneerDto,
  ): Promise<AuxiliaryPioneer> {
    await this.assertCanManage(congregationId, user);
    const row = await this.repo.findOne({ where: { id, congregationId } });
    if (!row) throw new NotFoundException('Record not found.');
    const before = {
      startMonth: row.startMonth,
      endMonth: row.endMonth,
      untilCancelled: row.untilCancelled,
    };

    if (dto.startMonth !== undefined) {
      row.startMonth = this.normalizeMonth(dto.startMonth);
    }
    if (dto.untilCancelled !== undefined) {
      row.untilCancelled = dto.untilCancelled;
    }
    if (row.untilCancelled) {
      row.endMonth = null;
    } else if (dto.endMonth !== undefined) {
      row.endMonth = this.normalizeMonth(dto.endMonth);
    }
    if (row.endMonth && row.endMonth < row.startMonth) {
      throw new BadRequestException(
        refusal('END_BEFORE_START', 'End month cannot precede start month.'),
      );
    }
    {
      const horizon = await this.currentMonthKey(congregationId);
      const after = spanOf(row);
      await this.assertPeriodAllowed(
        congregationId,
        user,
        row.publisherId,
        after,
        AuxiliaryPioneersService.changedMonths(spanOf(before), after, horizon),
        row.id,
      );
    }
    const saved = await this.repo.save(row);
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'auxiliary_pioneer',
      entityId: saved.id,
      subjectId: saved.publisherId,
      before,
      after: {
        startMonth: saved.startMonth,
        endMonth: saved.endMonth,
        untilCancelled: saved.untilCancelled,
      },
      fields: ['startMonth', 'endMonth', 'untilCancelled'],
    });
    return saved;
  }

  /** Stop a period: set an end month (defaults to the current month). */
  async stop(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
    dto: StopAuxiliaryPioneerDto,
  ): Promise<AuxiliaryPioneer> {
    await this.assertCanManage(congregationId, user);
    const row = await this.repo.findOne({ where: { id, congregationId } });
    if (!row) throw new NotFoundException('Record not found.');
    // WRITES the end month. The congregation's day, or a period stopped just
    // after midnight on the 1st would be closed in the month before.
    const endMonth = this.normalizeMonth(
      dto.endMonth ?? (await this.clock.todayFor(congregationId)),
    );
    if (endMonth < row.startMonth) {
      throw new BadRequestException(
        refusal('END_BEFORE_START', 'End month cannot precede start month.'),
      );
    }
    const beforeStop = {
      endMonth: row.endMonth,
      untilCancelled: row.untilCancelled,
    };
    {
      // Stopping in the past takes months away; a closed one stays.
      const horizon = await this.currentMonthKey(congregationId);
      const after = spanOf({ ...row, endMonth, untilCancelled: false });
      await this.assertPeriodAllowed(
        congregationId,
        user,
        row.publisherId,
        after,
        AuxiliaryPioneersService.changedMonths(spanOf(row), after, horizon),
        row.id,
      );
    }
    row.endMonth = endMonth;
    row.untilCancelled = false;
    const saved = await this.repo.save(row);
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'auxiliary_pioneer',
      entityId: saved.id,
      subjectId: saved.publisherId,
      before: beforeStop,
      after: { endMonth: saved.endMonth, untilCancelled: saved.untilCancelled },
      fields: ['endMonth', 'untilCancelled'],
    });
    return saved;
  }

  async remove(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<void> {
    await this.assertCanManage(congregationId, user);
    const row = await this.repo.findOne({ where: { id, congregationId } });
    if (!row) throw new NotFoundException('Record not found.');
    // A period that has begun is history: it is stopped, not deleted. Only
    // the two who may change a closed month may delete one — to take back a
    // row entered by mistake — and then not across a closed month.
    const nowKey = await this.currentMonthKey(congregationId);
    if (row.startMonth.slice(0, 7) <= nowKey) {
      if (!(await this.mayChangeClosed(congregationId, user))) {
        throw new ForbiddenException(
          refusal(
            'AUX_REMOVE_STARTED',
            'This period has already begun. Stop it instead of deleting it.',
          ),
        );
      }
      await this.assertMonthsOpen(
        congregationId,
        null,
        AuxiliaryPioneersService.changedMonths(spanOf(row), null, nowKey),
      );
    }
    await this.writeDelete(congregationId, row);
  }

  /**
   * Take back a month written a moment ago for a report that was then
   * refused (ServiceReportsService.undoAuxSpell). Not a decision of anybody's
   * — the half-state it ends was never meant to exist — so none of the rules
   * of remove() apply; the journal still keeps it.
   */
  async undoJustCreated(congregationId: string, id: string): Promise<void> {
    const row = await this.repo.findOne({ where: { id, congregationId } });
    if (!row) return;
    await this.writeDelete(congregationId, row);
  }

  private async writeDelete(
    congregationId: string,
    row: AuxiliaryPioneer,
  ): Promise<void> {
    const id = row.id;
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'auxiliary_pioneer',
      entityId: id,
      action: 'DELETE',
      subjectId: row.publisherId,
      detail: { startMonth: row.startMonth, endMonth: row.endMonth },
    });
    await this.repo.delete({ id, congregationId });
  }

  /**
   * Whether the current user's own publisher record is an active auxiliary
   * pioneer in the given month. Used by the report form and the "you serve as
   * an auxiliary pioneer" badges — available to the publisher themselves.
   */
  /**
   * Собственное положение вызывающего — никогда не список собрания. Отдаёт
   * период, покрывающий `monthIso`, и ближайший начинающийся после него.
   */
  async myAuxiliaryPioneerStatus(
    congregationId: string,
    user: AuthenticatedUser,
    monthIso: string,
  ): Promise<MyAuxPioneerStatus> {
    const publisher = await this.publisherRepo.findOne({
      where: { congregationId, userId: user.id },
      select: ['id'],
    });
    if (!publisher) return { serving: false, current: null, upcoming: null };

    const monthKey = monthKeyOf(monthIso);
    const rows = await this.repo.find({
      where: { congregationId, publisherId: publisher.id },
    });
    const shape = (p: AuxiliaryPioneer): MyAuxPioneerPeriod => ({
      startMonth: p.startMonth,
      endMonth: p.endMonth,
      untilCancelled: p.untilCancelled,
    });
    const current = rows.find((p) => isActiveInMonth(shape(p), monthKey));
    // Ближайший из ещё не начавшихся: их может быть несколько, нужен первый.
    const upcoming = rows
      .filter((p) => monthKeyOf(p.startMonth) > monthKey)
      .sort((a, b) => a.startMonth.localeCompare(b.startMonth))[0];

    return {
      serving: !!current,
      current: current ? shape(current) : null,
      upcoming: upcoming ? shape(upcoming) : null,
    };
  }

  async isSelfActiveAuxiliaryPioneer(
    congregationId: string,
    user: AuthenticatedUser,
    monthIso: string,
  ): Promise<boolean> {
    // Один источник истины: «служу ли я» — это то же вычисление, что и период.
    const status = await this.myAuxiliaryPioneerStatus(
      congregationId,
      user,
      monthIso,
    );
    return status.serving;
  }

  /**
   * Is this publisher an active auxiliary pioneer in the given month? Used by
   * the reports module to switch the report form to the hours variant.
   */
  /**
   * Every month this publisher has served as an auxiliary pioneer.
   *
   * The single-month check reads all of his spells anyway, so asking it once
   * per month — twenty-four times, to draw a history screen — would be
   * twenty-four identical queries for one answer.
   */
  async monthsServedBy(
    congregationId: string,
    publisherId: string,
  ): Promise<Set<string>> {
    const rows = await this.repo.find({
      where: { congregationId, publisherId },
    });
    const out = new Set<string>();
    for (const p of rows) {
      const start = monthKeyOf(p.startMonth);
      // An open-ended spell runs to today; a closed one to its last month.
      const end = p.untilCancelled
        ? await this.currentMonthKey(congregationId)
        : monthKeyOf(p.endMonth ?? p.startMonth);
      for (const m of monthsInRange(`${start}-01`, `${end}-01`)) out.add(m);
    }
    return out;
  }

  async isActiveAuxiliaryPioneer(
    congregationId: string,
    publisherId: string,
    monthIso: string,
  ): Promise<boolean> {
    const monthKey = monthKeyOf(monthIso);
    const rows = await this.repo.find({
      where: { congregationId, publisherId },
    });
    return rows.some((p) =>
      isActiveInMonth(
        {
          startMonth: p.startMonth,
          endMonth: p.endMonth,
          untilCancelled: p.untilCancelled,
        },
        monthKey,
      ),
    );
  }

  /**
   * The set of months (YYYY-MM) in which a publisher served as an auxiliary
   * pioneer, within [fromMonthKey, toMonthKey] inclusive. Used by the S-21 card
   * to mark auxiliary months and show their hours, from real service periods
   * (so back-dated entries are reflected correctly).
   */
  async auxiliaryMonthsForPublisher(
    congregationId: string,
    publisherId: string,
    fromMonthKey: string, // "YYYY-MM"
    toMonthKey: string, // "YYYY-MM"
  ): Promise<Set<string>> {
    const rows = await this.repo.find({
      where: { congregationId, publisherId },
    });
    const result = new Set<string>();
    // Walk each month in the range and test membership against every period.
    const [fy, fm] = fromMonthKey.split('-').map((n) => parseInt(n, 10));
    const [ty, tm] = toMonthKey.split('-').map((n) => parseInt(n, 10));
    const cursor = new Date(Date.UTC(fy, fm - 1, 1));
    const end = new Date(Date.UTC(ty, tm - 1, 1));
    while (cursor.getTime() <= end.getTime()) {
      const key = `${cursor.getUTCFullYear()}-${String(
        cursor.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      const active = rows.some((p) =>
        isActiveInMonth(
          {
            startMonth: p.startMonth,
            endMonth: p.endMonth,
            untilCancelled: p.untilCancelled,
          },
          key,
        ),
      );
      if (active) result.add(key);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return result;
  }

  /**
   * Publisher IDs that are active auxiliary pioneers in the given month — one
   * query, for callers that classify many publishers at once (e.g. the group
   * reports screen deciding who needs the hours form).
   */
  async activePublisherIdsForMonth(
    congregationId: string,
    monthIso: string,
  ): Promise<Set<string>> {
    const monthKey = monthKeyOf(monthIso);
    const rows = await this.repo.find({ where: { congregationId } });
    const out = new Set<string>();
    for (const p of rows) {
      if (
        isActiveInMonth(
          {
            startMonth: p.startMonth,
            endMonth: p.endMonth,
            untilCancelled: p.untilCancelled,
          },
          monthKey,
        )
      ) {
        out.add(p.publisherId);
      }
    }
    return out;
  }

  /**
   * Close any open auxiliary-pioneer period for a publisher — used when they
   * become a regular/special/missionary pioneer, so the two don't overlap. The
   * period is ended the month before `fromMonthIso` (the auxiliary service runs
   * up to, but not including, the month regular pioneering starts). Periods
   * that already ended earlier are left untouched. Returns how many were closed.
   */
  async closeActiveForPublisher(
    congregationId: string,
    publisherId: string,
    fromMonthIso: string,
    reason: 'became_pioneer' | 'departed' = 'became_pioneer',
  ): Promise<number> {
    const fromKey = monthKeyOf(fromMonthIso);
    const [y, m] = fromKey.split('-').map((n) => parseInt(n, 10));
    const prev = new Date(Date.UTC(y, m - 2, 1)); // month before `from`
    const endMonth = `${prev.getUTCFullYear()}-${String(
      prev.getUTCMonth() + 1,
    ).padStart(2, '0')}-01`;

    const rows = await this.repo.find({
      where: { congregationId, publisherId },
    });
    let closed = 0;
    for (const row of rows) {
      const stillOpen =
        row.untilCancelled ||
        row.endMonth === null ||
        row.endMonth >= `${fromKey}-01`;
      if (!stillOpen) continue;
      // Don't create an inverted range: if the period starts on/after the new
      // pioneer month, remove it instead of ending it before it began.
      // Journalled like any other change (29 October 2026): these two used
      // to cut a period short, or take it away, without a line.
      if (row.startMonth >= `${fromKey}-01`) {
        await this.auditLog.logEvent({
          tenantId: congregationId,
          entityType: 'auxiliary_pioneer',
          entityId: row.id,
          action: 'DELETE',
          subjectId: row.publisherId,
          detail: {
            startMonth: row.startMonth,
            endMonth: row.endMonth,
            reason,
          },
        });
        await this.repo.remove(row);
      } else {
        const before = {
          endMonth: row.endMonth,
          untilCancelled: row.untilCancelled,
        };
        row.endMonth = endMonth;
        row.untilCancelled = false;
        await this.repo.save(row);
        await this.auditLog.logUpdate({
          tenantId: congregationId,
          entityType: 'auxiliary_pioneer',
          entityId: row.id,
          subjectId: row.publisherId,
          before,
          after: { endMonth: row.endMonth, untilCancelled: false },
          fields: ['endMonth', 'untilCancelled'],
        });
      }
      closed++;
    }
    return closed;
  }

  private async namesByIds(
    congregationId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const publishers = await this.publisherRepo.find({
      where: { id: In(ids), congregationId },
      select: ['id', 'displayName'],
    });
    return new Map(publishers.map((p) => [p.id, p.displayName]));
  }

  /** Current pioneer type per publisher id — for the journal to flag those who
   * have moved on to permanent pioneering. */
  private async pioneerTypesByIds(
    congregationId: string,
    ids: string[],
  ): Promise<Map<string, PioneerType>> {
    if (ids.length === 0) return new Map();
    const publishers = await this.publisherRepo.find({
      where: { id: In(ids), congregationId },
      select: ['id', 'pioneerType'],
    });
    return new Map(publishers.map((p) => [p.id, p.pioneerType]));
  }
}
