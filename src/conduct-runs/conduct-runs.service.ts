import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { todayIn } from '../common/congregation-clock';
import { ConductRun } from '../entities/conduct-run.entity';
import { ConductLive } from '../entities/conduct-live.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { Duty } from '../entities/duty.entity';
import { DutyType } from '../common/enums/duty-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { EventType } from '../common/enums/event-type.enum';
import {
  CHAIRMAN_PART_KEY,
  conductKind,
  type ConductKind,
} from '../common/conduct-kind';
import { MAIN_ROOM } from '../entities/conduct-room';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { isConductOverseer } from '../common/conduct-overseer';
import { MeetingDayService } from './meeting-day.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { addDaysISO } from '../common/week-rules';
import { SaveConductRunDto } from './dto/save-conduct-run.dto';

/**
 * How long a run may be read and kept: through the FOURTH day after the
 * meeting's own day, in the congregation's calendar; it goes the night after
 * (Lionel, 28 October 2026). A Wednesday's run is read until Sunday evening,
 * a Sunday's until Thursday evening.
 *
 * It used to be seven times twenty-four hours from the moment it was saved —
 * so on the next Wednesday at six in the evening last Wednesday's run was
 * still there, and nobody could tell why. Days, not hours: the screen can say
 * «хранится до воскресенья» and mean it.
 */
export const CONDUCT_RUN_KEEP_DAYS = 4;

/**
 * The chairman's run of a meeting, kept through the 4th day after it
 * (entities/conduct-run.entity.ts).
 *
 * WHO WRITES: the chairman named in that week's programme, the timekeeper
 * named in that meeting's duties (15 October 2026: he runs the screen while
 * the chairman watches, and his device is the one that ends the meeting), and
 * an admin. Nobody else ran the meeting.
 *
 * WHO READS: the admins, the brother who gives counsel and the overseer of
 * the Life and Ministry meeting (common/conduct-overseer.ts — Lionel,
 * 16 October 2026). Not the chairman afterwards: he sees the result on his
 * own screen when the meeting ends.
 */
@Injectable()
export class ConductRunsService {
  constructor(
    @InjectRepository(ConductRun)
    private readonly runs: Repository<ConductRun>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Duty)
    private readonly duties: Repository<Duty>,
    private readonly meetingDay: MeetingDayService,
    @InjectRepository(ConductLive)
    private readonly live: Repository<ConductLive>,
    private readonly clock: CongregationClock,
  ) {}

  /** Whether this account is the timekeeper named for that week's midweek meeting. */
  async isTimekeeper(
    user: AuthenticatedUser,
    week: string,
    kind: ConductKind = EventType.MIDWEEK,
  ): Promise<boolean> {
    const duty = await this.duties.findOne({
      where: {
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: kind,
        dutyType: DutyType.TIMEKEEPER,
      },
    });
    if (!duty?.publisherId) return false;
    const mine = await this.publishers.findOne({
      where: { id: duty.publisherId, congregationId: user.congregationId },
    });
    return !!mine && mine.userId === user.id;
  }

  /** The Monday, or a refusal. */
  private monday(value: string): string {
    const day = (value ?? '').slice(0, 10);
    const d = new Date(`${day}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      Number.isNaN(d.getTime()) ||
      d.getUTCDay() !== 1
    ) {
      throw new BadRequestException(
        refusal('WEEK_NOT_MONDAY', 'weekStartDate must be a Monday.'),
      );
    }
    return day;
  }

  /** Whether this account is the chairman named for that week's midweek meeting. */
  async isChairman(
    user: AuthenticatedUser,
    week: string,
    kind: ConductKind = EventType.MIDWEEK,
  ): Promise<boolean> {
    const chair = await this.assignments.findOne({
      where: {
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: kind,
        partKey: CHAIRMAN_PART_KEY[kind],
        deletedAt: IsNull(),
      },
    });
    if (!chair?.publisherId) return false;
    const mine = await this.publishers.findOne({
      where: { id: chair.publisherId, congregationId: user.congregationId },
    });
    return !!mine && mine.userId === user.id;
  }

  async save(
    user: AuthenticatedUser,
    dto: SaveConductRunDto,
    now = new Date(),
  ): Promise<ConductRun> {
    const week = this.monday(dto.weekStartDate);
    const kind = conductKind(dto.eventType);
    if (
      user.role !== UserRole.ADMIN &&
      !(await this.isChairman(user, week, kind)) &&
      !(await this.isTimekeeper(user, week, kind))
    ) {
      throw new ForbiddenException(
        refusal(
          'CONDUCT_RUN_FORBIDDEN',
          'Only the chairman or the timekeeper of that week saves how the meeting ran.',
        ),
      );
    }
    const segments = dto.segments.map((s) => ({
      key: s.key,
      assignmentId: s.assignmentId ?? null,
      publisherIds: s.publisherIds ?? [],
      plannedSec: s.plannedSec,
      actualSec: s.actualSec,
      counselSec: s.counselSec ?? null,
      startSec: s.startSec ?? null,
    }));
    const existing = await this.runs.findOne({
      where: {
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: kind,
        room: MAIN_ROOM,
      },
    });
    // AFTER THE MEETING'S DAY A RESULT IS NOT REPLACED (16 October 2026). A
    // result may still ARRIVE late — a phone that had no signal in the hall
    // sends it when it has one — but one already kept is the meeting's, and
    // a run finished days later on some device is not.
    if (
      existing &&
      (await this.meetingDay.isOver(user.congregationId, week, kind))
    ) {
      throw new ConflictException(
        refusal(
          'CONDUCT_RESULT_KEPT',
          'The result of this meeting is kept already; after its day it is not replaced.',
        ),
      );
    }
    const row =
      existing ??
      this.runs.create({
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: kind,
        room: MAIN_ROOM,
      });
    row.segments = segments;
    row.totalSec = dto.totalSec;
    row.plannedSec = dto.plannedSec;
    row.startedAt = dto.startedAt ? new Date(dto.startedAt) : null;
    row.savedBy = user.id;
    row.savedAt = now;
    return this.runs.save(row);
  }

  /**
   * «Это была проба — стереть» (Lionel, 25 October 2026): a run started to
   * try the screen, on the meeting's own day, left a result that nothing
   * could remove — and it stood among the results, and on Home, as if the
   * meeting had taken three minutes.
   *
   * The same hands that save a result may wipe it — the chairman, the
   * timekeeper, an admin — and only until the meeting's day is over: after
   * that the result is the meeting's, as save() holds. Both the result and
   * the run on the server go, so the meeting can be run again from the start
   * and every watching screen goes back to «not begun».
   */
  async drop(
    user: AuthenticatedUser,
    weekStartDate: string,
    kind: ConductKind = EventType.MIDWEEK,
  ): Promise<{ result: boolean; run: boolean }> {
    const week = this.monday(weekStartDate);
    if (
      user.role !== UserRole.ADMIN &&
      !(await this.isChairman(user, week, kind)) &&
      !(await this.isTimekeeper(user, week, kind))
    ) {
      throw new ForbiddenException(
        refusal(
          'CONDUCT_RUN_FORBIDDEN',
          'Only the chairman or the timekeeper of that week wipes how the meeting ran.',
        ),
      );
    }
    // Over by its day — or, where the day cannot be told (no meeting
    // settings), by the end of its week: a wipe errs towards keeping.
    const weekEnded =
      addDaysISO(week, 6) < (await this.clock.todayFor(user.congregationId));
    if (
      weekEnded ||
      (await this.meetingDay.isOver(user.congregationId, week, kind))
    ) {
      throw new ConflictException(
        refusal(
          'CONDUCT_RESULT_KEPT',
          'The result of this meeting is kept already; after its day it is not replaced.',
        ),
      );
    }
    const where = {
      congregationId: user.congregationId,
      weekStartDate: week,
      eventType: kind,
      room: MAIN_ROOM,
    };
    const result = await this.runs.delete(where);
    const run = await this.live.delete(where);
    return { result: (result.affected ?? 0) > 0, run: (run.affected ?? 0) > 0 };
  }

  /**
   * The last day a run may be read, YYYY-MM-DD in the congregation's
   * calendar: the meeting's day (the week rules') plus four. A week whose
   * rules give no day counts from the day the run was saved.
   */
  async keepUntil(
    run: Pick<
      ConductRun,
      'congregationId' | 'weekStartDate' | 'eventType' | 'savedAt'
    >,
  ): Promise<string> {
    const day =
      (await this.meetingDay.meetingDate(
        run.congregationId,
        String(run.weekStartDate).slice(0, 10),
        run.eventType as ConductKind,
      )) ??
      todayIn(
        new Date(run.savedAt),
        await this.clock.timezoneOf(run.congregationId),
      );
    return addDaysISO(day, CONDUCT_RUN_KEEP_DAYS);
  }

  /**
   * The run of that week — or null when there is none, or its days are over.
   * The age is checked HERE as well as by the nightly deletion: a night the
   * job does not run must not stretch the days. The answer carries
   * `keepUntil`, so the screen says the same day the server keeps to.
   */
  async find(
    user: AuthenticatedUser,
    weekStartDate: string,
    now = new Date(),
    kind: ConductKind = EventType.MIDWEEK,
  ): Promise<ConductRun | null> {
    const week = this.monday(weekStartDate);
    if (!(await isConductOverseer(user, this.publishers, kind))) {
      throw new ForbiddenException(
        refusal(
          'CONDUCT_RESULT_FORBIDDEN',
          'How a meeting ran is seen by those who oversee how it runs.',
        ),
      );
    }
    const run = await this.runs.findOne({
      where: {
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: kind,
        room: MAIN_ROOM,
      },
    });
    if (!run) return null;
    const keepUntil = await this.keepUntil(run);
    const today = todayIn(now, await this.clock.timezoneOf(run.congregationId));
    if (today > keepUntil) return null;
    return Object.assign(run, { keepUntil });
  }

  /** Every run whose days are over, in every congregation. Returns how many. */
  async deleteExpired(now = new Date()): Promise<number> {
    const all = await this.runs.find({
      select: {
        id: true,
        congregationId: true,
        weekStartDate: true,
        eventType: true,
        savedAt: true,
      },
    });
    const today = new Map<string, string>();
    const expired: string[] = [];
    for (const run of all) {
      let t = today.get(run.congregationId);
      if (!t) {
        t = todayIn(now, await this.clock.timezoneOf(run.congregationId));
        today.set(run.congregationId, t);
      }
      if (t > (await this.keepUntil(run))) expired.push(run.id);
    }
    if (expired.length === 0) return 0;
    const res = await this.runs.delete(expired);
    return res.affected ?? 0;
  }
}
