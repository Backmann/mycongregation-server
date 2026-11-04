import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { MeetingMove } from '../entities/meeting-move.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { MeetingAttendance } from '../entities/meeting-attendance.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import {
  loadWeekRulesContext,
  rulesFromContext,
  WeekRulesContext,
} from '../common/week-rules.service';
import { addDaysISO, isoDowOf, MeetingKind } from '../common/week-rules';
import { EVENT_TYPE_RESPONSIBILITY } from '../common/guards/assignment-section.guard';
import { EventType } from '../common/enums/event-type.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { refusal } from '../common/errors/refusal';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { MoveMeetingDto } from './dto/move-meeting.dto';
import { MeetingMoveNotificationsService } from './meeting-move-notifications.service';

/** What a move did, for the caller (and, next, for the announcement). */
export interface MoveResult {
  move: MeetingMove | null;
  /** The day and hour it had before this change. */
  from: { date: string; time: string | null };
  /** The day and hour it has now. */
  to: { date: string; time: string | null; address: string | null };
  /** Held before today: nobody is told (4 November 2026). */
  past: boolean;
  /** The attendance figure that went with it, if one was recorded. */
  attendanceMoved: boolean;
}

/**
 * A meeting moved for one week (4 November 2026) — the rules Lionel gave:
 *
 *  - only inside its own week, and never onto the day of the other meeting;
 *  - the midweek meeting of a visit week is not moved: the visit sets its day;
 *  - a meeting that is not held (a convention week, the one the Memorial
 *    takes, an event flagged «no usual meeting») has nothing to move;
 *  - a day an event keeps «with changes» is left to that event — one source
 *    for the hour, not two;
 *  - who: the midweek meeting — the Life and Ministry overseer, the weekend —
 *    the body coordinator (as for their programmes), and an administrator;
 *  - after the fact (the meeting is already past, somebody forgot to enter
 *    it): allowed to the administrator and the body coordinator only, and an
 *    attendance figure already entered moves with the meeting, so the S-3
 *    sheet stays true.
 *
 * Telling people about it is the next step; this one keeps the record right.
 */
@Injectable()
export class MeetingMovesService {
  constructor(
    @InjectRepository(MeetingMove)
    private readonly moves: Repository<MeetingMove>,
    @InjectRepository(MeetingSettings)
    private readonly settings: Repository<MeetingSettings>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
    private readonly dataSource: DataSource,
    private readonly announcer: MeetingMoveNotificationsService,
  ) {}

  /** The moves from a week on (every member reads them: the rules need them). */
  list(tenantId: string, fromWeek?: string): Promise<MeetingMove[]> {
    return this.moves.find({
      where: {
        congregationId: tenantId,
        ...(fromWeek ? { weekStartDate: MoreThanOrEqual(fromWeek) } : {}),
      },
      order: { weekStartDate: 'ASC', eventType: 'ASC' },
    });
  }

  async move(
    user: AuthenticatedUser,
    week: string,
    kind: MeetingKind,
    dto: MoveMeetingDto,
  ): Promise<MoveResult> {
    const tenantId = user.congregationId;
    assertMonday(week);
    if (dto.date < week || dto.date > addDaysISO(week, 6)) {
      throw new BadRequestException(
        refusal('MOVE_OUTSIDE_WEEK', 'The new day must be in the same week'),
      );
    }
    await this.assertMayMove(user, kind);

    const ctx = await loadWeekRulesContext(
      this.settings,
      this.events,
      tenantId,
    );
    const usual = this.usualOf(ctx, week, kind);
    const other: MeetingKind = kind === 'midweek' ? 'weekend' : 'midweek';

    // What it is now — the move in place, if there is one.
    const current = rulesFromContext(ctx, week);
    const fromDate = current.dateOf(kind) as string;
    const fromTime = current.timeOf(kind);

    if (usual.rules.dateOf(other) === dto.date && usual.otherHeld) {
      throw new BadRequestException(
        refusal(
          'MOVE_OTHER_MEETING_DAY',
          'That day belongs to the other meeting of the week',
        ),
      );
    }
    for (const day of [usual.date, dto.date]) {
      if (changedOn(ctx, day)) {
        throw new ConflictException(
          refusal(
            'MOVE_CHANGED_EVENT_DAY',
            'An event keeps the meeting with changes on that day',
            { date: day },
          ),
        );
      }
    }

    const hall = usual.rules.version?.address?.trim() || null;
    const typed = dto.address?.trim() || null;
    const address = typed && typed !== hall ? typed : null;
    if (dto.date === usual.date && dto.time === usual.time && !address) {
      throw new BadRequestException(
        refusal('MOVE_SAME_AS_USUAL', 'That is the usual day, hour and place'),
      );
    }

    const today = await this.clock.todayFor(tenantId);
    const past = fromDate < today || dto.date < today;
    if (past) await this.assertMayMoveAfterwards(user);

    const result = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(MeetingMove);
      const before = await repo.findOne({
        where: {
          congregationId: tenantId,
          weekStartDate: week,
          eventType: kind,
        },
      });
      const row = repo.create({
        ...(before ?? {}),
        congregationId: tenantId,
        weekStartDate: week,
        eventType: kind,
        date: dto.date,
        time: dto.time,
        address,
        movedById: user.id,
      });
      const saved = await repo.save(row);
      const attendanceMoved = await this.carryAttendance(
        m,
        user,
        kind,
        fromDate,
        dto.date,
      );
      const after = snapshot(saved);
      if (before) {
        await this.auditLog.logRawUpdate({
          tenantId,
          entityType: 'meeting_move',
          entityId: saved.id,
          actorUserId: user.id,
          changedFields: Object.keys(after).filter(
            (k) => snapshot(before)[k] !== after[k],
          ),
          before: snapshot(before),
          after,
        });
      } else {
        await this.auditLog.logCreate({
          tenantId,
          entityType: 'meeting_move',
          entityId: saved.id,
          actorUserId: user.id,
          after,
        });
      }
      return {
        move: saved,
        from: { date: fromDate, time: fromTime },
        to: { date: dto.date, time: dto.time, address },
        past,
        attendanceMoved,
      };
    });
    // Told only once it is saved; a failed message never undoes the move.
    await this.announce(tenantId, week, kind, result, false);
    return result;
  }

  /** «Вернуть на обычный день»: the move is removed. */
  async moveBack(
    user: AuthenticatedUser,
    week: string,
    kind: MeetingKind,
  ): Promise<MoveResult> {
    const tenantId = user.congregationId;
    assertMonday(week);
    await this.assertMayMove(user, kind);
    const existing = await this.moves.findOne({
      where: { congregationId: tenantId, weekStartDate: week, eventType: kind },
    });
    if (!existing) {
      throw new NotFoundException(
        refusal('MOVE_NOT_FOUND', 'This meeting is not moved'),
      );
    }
    const ctx = await loadWeekRulesContext(
      this.settings,
      this.events,
      tenantId,
    );
    const usual = this.usualOf(ctx, week, kind);
    const today = await this.clock.todayFor(tenantId);
    const past = existing.date < today || usual.date < today;
    if (past) await this.assertMayMoveAfterwards(user);

    const result = await this.dataSource.transaction(async (m) => {
      await m.getRepository(MeetingMove).delete({ id: existing.id });
      const attendanceMoved = await this.carryAttendance(
        m,
        user,
        kind,
        existing.date,
        usual.date,
      );
      await this.auditLog.logEvent({
        tenantId,
        entityType: 'meeting_move',
        entityId: existing.id,
        actorUserId: user.id,
        action: 'DELETE',
        detail: snapshot(existing),
      });
      return {
        move: null,
        from: { date: existing.date, time: existing.time },
        to: { date: usual.date, time: usual.time, address: null },
        past,
        attendanceMoved,
      };
    });
    await this.announce(tenantId, week, kind, result, true);
    return result;
  }

  private announce(
    tenantId: string,
    week: string,
    kind: MeetingKind,
    r: MoveResult,
    back: boolean,
  ): Promise<void> {
    return this.announcer.announce({
      tenantId,
      week,
      kind,
      past: r.past,
      move: { kind, from: r.from, to: r.to, back },
    });
  }

  /**
   * The meeting as it would be WITHOUT a move of it — what a move is judged
   * against. Refuses a meeting that has nothing to move.
   */
  private usualOf(ctx: WeekRulesContext, week: string, kind: MeetingKind) {
    const others = (ctx.moves ?? []).filter(
      (x) => !(x.weekStartDate === week && x.eventType === kind),
    );
    const rules = rulesFromContext({ ...ctx, moves: others }, week);
    const date = rules.dateOf(kind);
    const heldKinds = new Set(rules.meetings.map((x) => x.kind));
    if (!rules.version || !date || !heldKinds.has(kind)) {
      throw new ConflictException(
        refusal('MOVE_NOT_HELD', 'This meeting is not held that week'),
      );
    }
    if (kind === 'midweek' && rules.coVisit) {
      throw new ConflictException(
        refusal(
          'MOVE_VISIT_WEEK',
          'The visit sets the midweek meeting of its week',
        ),
      );
    }
    const other: MeetingKind = kind === 'midweek' ? 'weekend' : 'midweek';
    return {
      rules,
      date,
      time: rules.timeOf(kind),
      otherHeld: heldKinds.has(other),
    };
  }

  /**
   * The attendance figure is kept by the meeting's calendar date: when the
   * meeting moves, a figure already entered moves with it, in the same
   * transaction (Lionel, 4 November 2026), and the change is journalled.
   */
  private async carryAttendance(
    m: EntityManager,
    user: AuthenticatedUser,
    kind: MeetingKind,
    fromDate: string,
    toDate: string,
  ): Promise<boolean> {
    if (fromDate === toDate) return false;
    const repo = m.getRepository(MeetingAttendance);
    const eventType =
      kind === 'midweek' ? EventType.MIDWEEK : EventType.WEEKEND;
    const row = await repo.findOne({
      where: { congregationId: user.congregationId, date: fromDate, eventType },
    });
    if (!row) return false;
    const taken = await repo.findOne({
      where: { congregationId: user.congregationId, date: toDate, eventType },
    });
    if (taken) {
      throw new ConflictException(
        refusal(
          'MOVE_ATTENDANCE_CLASH',
          'An attendance figure is already recorded on the new day',
          { date: toDate },
        ),
      );
    }
    await repo.update({ id: row.id }, { date: toDate });
    await this.auditLog.logRawUpdate({
      tenantId: user.congregationId,
      entityType: 'meeting_attendance',
      entityId: row.id,
      actorUserId: user.id,
      changedFields: ['date'],
      before: { date: fromDate },
      after: { date: toDate },
    });
    return true;
  }

  private async assertMayMove(
    user: AuthenticatedUser,
    kind: MeetingKind,
  ): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    const allowed =
      EVENT_TYPE_RESPONSIBILITY[
        kind === 'midweek' ? EventType.MIDWEEK : EventType.WEEKEND
      ];
    if (await this.holds(user, allowed)) return;
    throw new ForbiddenException(
      refusal('NEEDS_RESPONSIBILITY', 'Not allowed to move this meeting', {
        responsibilities: allowed,
      }),
    );
  }

  /** After the fact: the administrator and the body coordinator only. */
  private async assertMayMoveAfterwards(
    user: AuthenticatedUser,
  ): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    if (await this.holds(user, [ResponsibilityType.BODY_COORDINATOR])) return;
    throw new ForbiddenException(
      refusal(
        'MOVE_PAST_NEEDS_COORDINATOR',
        'A past meeting is moved by the administrator or the body coordinator',
      ),
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
}

function assertMonday(week: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || isoDowOf(week) !== 1) {
    throw new BadRequestException(
      refusal('WEEK_NOT_MONDAY', 'weekStartDate must be a Monday.'),
    );
  }
}

/** An event that keeps the meeting «with changes» (an hour or a place) on this day. */
function changedOn(ctx: WeekRulesContext, day: string): boolean {
  return (ctx.changed ?? []).some(
    (e) =>
      (!!e.meetingTime?.trim() || !!e.meetingAddress?.trim()) &&
      e.date <= day &&
      (e.endDate ?? e.date) >= day,
  );
}

function snapshot(m: MeetingMove): Record<string, unknown> {
  return {
    weekStartDate: m.weekStartDate,
    eventType: m.eventType,
    date: m.date,
    time: m.time,
    address: m.address,
  };
}
