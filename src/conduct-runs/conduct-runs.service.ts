import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { ConductRun } from '../entities/conduct-run.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { Duty } from '../entities/duty.entity';
import { DutyType } from '../common/enums/duty-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { EventType } from '../common/enums/event-type.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { isAppointedBrother } from '../common/appointed-brother';
import { SaveConductRunDto } from './dto/save-conduct-run.dto';

/** How long a run may be read and kept — Lionel, 14 October 2026. */
export const CONDUCT_RUN_KEEP_DAYS = 7;
const KEEP_MS = CONDUCT_RUN_KEEP_DAYS * 24 * 60 * 60 * 1000;

/**
 * The chairman's run of a midweek meeting, kept seven days
 * (entities/conduct-run.entity.ts).
 *
 * WHO WRITES: the chairman named in that week's programme, the timekeeper
 * named in that meeting's duties (15 October 2026: he runs the screen while
 * the chairman watches, and his device is the one that ends the meeting), and
 * an admin. Nobody else ran the meeting.
 *
 * WHO READS: every appointed brother — the elders AND the ministerial
 * servants, by the role of the account or by the card (Lionel, 15 October
 * 2026: «итог 7 дней видят все назначенные братья») — the chairman of that
 * week, and an admin. It is a view of people's parts against the clock; a
 * publisher has no task that needs it.
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
  ) {}

  /** Whether this account is the timekeeper named for that week's midweek meeting. */
  async isTimekeeper(user: AuthenticatedUser, week: string): Promise<boolean> {
    const duty = await this.duties.findOne({
      where: {
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: EventType.MIDWEEK,
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
  async isChairman(user: AuthenticatedUser, week: string): Promise<boolean> {
    const chair = await this.assignments.findOne({
      where: {
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: EventType.MIDWEEK,
        partKey: 'midweek_chairman',
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
    if (
      user.role !== UserRole.ADMIN &&
      !(await this.isChairman(user, week)) &&
      !(await this.isTimekeeper(user, week))
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
    }));
    const existing = await this.runs.findOne({
      where: {
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: EventType.MIDWEEK,
      },
    });
    const row =
      existing ??
      this.runs.create({
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: EventType.MIDWEEK,
      });
    row.segments = segments;
    row.totalSec = dto.totalSec;
    row.plannedSec = dto.plannedSec;
    row.savedBy = user.id;
    row.savedAt = now;
    return this.runs.save(row);
  }

  /**
   * The run of that week — or null when there is none, or it is older than
   * seven days. The age is checked HERE as well as by the nightly deletion:
   * a night the job does not run must not stretch the seven days.
   */
  async find(
    user: AuthenticatedUser,
    weekStartDate: string,
    now = new Date(),
  ): Promise<ConductRun | null> {
    const week = this.monday(weekStartDate);
    const reader =
      (await isAppointedBrother(user, this.publishers)) ||
      (await this.isChairman(user, week));
    if (!reader) {
      throw new ForbiddenException(
        refusal(
          'CONDUCT_RESULT_FORBIDDEN',
          'How a meeting ran is seen by its chairman and the appointed brothers.',
        ),
      );
    }
    const run = await this.runs.findOne({
      where: {
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: EventType.MIDWEEK,
      },
    });
    if (!run) return null;
    if (now.getTime() - new Date(run.savedAt).getTime() > KEEP_MS) return null;
    return run;
  }

  /** Every run older than seven days, in every congregation. Returns how many. */
  async deleteExpired(now = new Date()): Promise<number> {
    const res = await this.runs.delete({
      savedAt: LessThan(new Date(now.getTime() - KEEP_MS)),
    });
    return res.affected ?? 0;
  }
}
