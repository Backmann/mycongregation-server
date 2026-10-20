import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { ConductLive } from '../entities/conduct-live.entity';
import { MAIN_ROOM } from '../entities/conduct-room';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { Duty } from '../entities/duty.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { EventType } from '../common/enums/event-type.enum';
import { DutyType } from '../common/enums/duty-type.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import {
  isCongregationElder,
  isConductOverseer,
} from '../common/conduct-overseer';
import { CHAIRMAN_PART_KEY, type ConductKind } from '../common/conduct-kind';
import { MeetingDayService } from '../conduct-runs/meeting-day.service';

/** How long a live row is kept — a day; the meeting is long over by then. */
export const CONDUCT_LIVE_KEEP_MS = 24 * 60 * 60 * 1000;
/** The largest state the screen may store (a run is a few hundred bytes). */
const MAX_STATE_CHARS = 32_000;

export interface ConductLiveView {
  weekStartDate: string;
  epoch: number;
  state: Record<string, unknown>;
  controllerUserId: string;
  controllerName: string | null;
  /** Whether the asking DEVICE is the one whose taps count. */
  mine: boolean;
  /**
   * The asking account runs it — on another of its devices (18 October
   * 2026): this one watches and says «вы ведёте время на другом устройстве».
   */
  mineElsewhere: boolean;
  controllerSeenAt: string;
  chairmanSeenAt: string | null;
  updatedAt: string;
}

/**
 * Who the asker is for this meeting — so the screen knows, without reading
 * the duties itself, whether he may run it and whether a timekeeper is named
 * (the chairman then opens watching, not running).
 */
export interface ConductLiveRoles {
  mayRun: boolean;
  isChairman: boolean;
  isTimekeeper: boolean;
  hasTimekeeper: boolean;
  timekeeperName: string | null;
}

/**
 * A midweek meeting while it runs (entities/conduct-live.entity.ts).
 *
 * WHO RUNS IT: the chairman of that week, the timekeeper named for that
 * meeting (duty «Ведущий времени»), and an admin — one of them at a time.
 * The first to start becomes the controller; any of the three may take over
 * (`take`), and from then on only the new one's writes are accepted.
 * One DEVICE of that account, too (18 October 2026): the account's other
 * devices watch until they take over (entities/conduct-live.entity.ts).
 *
 * WHO WATCHES: those three, every elder (18 October 2026), and those who
 * oversee how the meeting runs —
 * the admins, the counsel brother and the Life and Ministry overseer
 * (common/conduct-overseer.ts; Lionel, 16 October 2026 — on 15 October it
 * was every appointed brother). It shows who has which part and how long it
 * is taking; nobody else has a task that needs it.
 *
 * EVERY ANSWER CARRIES THE SERVER'S TIME. The devices' clocks disagree by
 * seconds; times in the state are server time, and each device corrects by
 * the difference.
 *
 * A READ IS ALSO A SIGN OF LIFE. The controller's device asks every few
 * seconds anyway (to learn of a take-over), so its asking is what tells the
 * chairman «ведущий на связи». The same for the chairman, the other way.
 */
@Injectable()
export class ConductLiveService {
  constructor(
    @InjectRepository(ConductLive)
    private readonly live: Repository<ConductLive>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Duty)
    private readonly duties: Repository<Duty>,
    private readonly meetingDay: MeetingDayService,
  ) {}

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

  /** The account behind a card, or null. */
  private async userOfPublisher(
    congregationId: string,
    publisherId: string | null | undefined,
  ): Promise<string | null> {
    if (!publisherId) return null;
    const p = await this.publishers.findOne({
      where: { id: publisherId, congregationId },
    });
    return p?.userId ?? null;
  }

  /** The chairman's account for that week's meeting of this kind, or null. */
  async chairmanUser(
    congregationId: string,
    week: string,
    kind: ConductKind = EventType.MIDWEEK,
  ): Promise<string | null> {
    const chair = await this.assignments.findOne({
      where: {
        congregationId,
        weekStartDate: week,
        eventType: kind,
        partKey: CHAIRMAN_PART_KEY[kind],
        deletedAt: IsNull(),
      },
    });
    return this.userOfPublisher(congregationId, chair?.publisherId);
  }

  /** The timekeeper's account for that week's meeting of this kind, or null. */
  async timekeeperUser(
    congregationId: string,
    week: string,
    kind: ConductKind = EventType.MIDWEEK,
  ): Promise<string | null> {
    const duty = await this.duties.findOne({
      where: {
        congregationId,
        weekStartDate: week,
        eventType: kind,
        dutyType: DutyType.TIMEKEEPER,
      },
    });
    return this.userOfPublisher(congregationId, duty?.publisherId);
  }

  /** Chairman, timekeeper, admin — the hands that may run the meeting. */
  async mayRun(
    user: AuthenticatedUser,
    week: string,
    kind: ConductKind = EventType.MIDWEEK,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const [chair, keeper] = await Promise.all([
      this.chairmanUser(user.congregationId, week, kind),
      this.timekeeperUser(user.congregationId, week, kind),
    ]);
    return chair === user.id || keeper === user.id;
  }

  /** Who oversees how the meeting runs (common/conduct-overseer.ts). */
  private isOverseer(
    user: AuthenticatedUser,
    kind: ConductKind,
  ): Promise<boolean> {
    return isConductOverseer(user, this.publishers, kind);
  }

  /** A meeting whose day has passed is not run any more (16 October 2026). */
  private async refuseIfOver(
    congregationId: string,
    week: string,
    kind: ConductKind,
  ) {
    if (await this.meetingDay.isOver(congregationId, week, kind)) {
      throw new ConflictException(
        refusal(
          'CONDUCT_MEETING_OVER',
          'This meeting is over; it is not run again after its day.',
        ),
      );
    }
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException(
      refusal(
        'CONDUCT_LIVE_FORBIDDEN',
        'The meeting as it runs is watched by those who oversee how it runs, and run by its chairman or timekeeper.',
      ),
    );
  }

  private async nameOf(
    congregationId: string,
    userId: string,
  ): Promise<string | null> {
    const p = await this.publishers.findOne({
      where: { congregationId, userId },
    });
    return p?.displayName ?? null;
  }

  /**
   * Whether this account on this device is the hand whose taps count. A row
   * from an app before devices (no device on it), or an app that names none,
   * is the account's on any device — as it was until 18 October 2026.
   */
  private isHand(
    row: ConductLive,
    user: AuthenticatedUser,
    deviceId: string | null,
  ): boolean {
    if (row.controllerUserId !== user.id) return false;
    return (
      !row.controllerDeviceId ||
      !deviceId ||
      row.controllerDeviceId === deviceId
    );
  }

  private async view(
    row: ConductLive,
    user: AuthenticatedUser,
    deviceId: string | null = null,
  ): Promise<ConductLiveView> {
    const mine = this.isHand(row, user, deviceId);
    return {
      weekStartDate: row.weekStartDate,
      epoch: row.epoch,
      state: row.state,
      controllerUserId: row.controllerUserId,
      controllerName: await this.nameOf(
        row.congregationId,
        row.controllerUserId,
      ),
      mine,
      mineElsewhere: !mine && row.controllerUserId === user.id,
      controllerSeenAt: new Date(row.controllerSeenAt).toISOString(),
      chairmanSeenAt: row.chairmanSeenAt
        ? new Date(row.chairmanSeenAt).toISOString()
        : null,
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private findRow(congregationId: string, week: string, kind: ConductKind) {
    return this.live.findOne({
      where: {
        congregationId,
        weekStartDate: week,
        eventType: kind,
        room: MAIN_ROOM,
      },
    });
  }

  /**
   * The meeting as it runs (or null), and who the asker is for it. Asking is
   * also the asker's sign of life: the controller's and the chairman's —
   * saved without touching updatedAt, which says when the MEETING last
   * changed.
   */
  async find(
    user: AuthenticatedUser,
    weekStartDate: string,
    now = new Date(),
    kind: ConductKind = EventType.MIDWEEK,
    deviceId: string | null = null,
  ): Promise<{ live: ConductLiveView | null; roles: ConductLiveRoles }> {
    const week = this.monday(weekStartDate);
    const [chair, keeperDuty] = await Promise.all([
      this.chairmanUser(user.congregationId, week, kind),
      this.duties.findOne({
        where: {
          congregationId: user.congregationId,
          weekStartDate: week,
          eventType: kind,
          dutyType: DutyType.TIMEKEEPER,
        },
      }),
    ]);
    const keeper = await this.userOfPublisher(
      user.congregationId,
      keeperDuty?.publisherId,
    );
    const isChairman = !!chair && chair === user.id;
    const isTimekeeper = !!keeper && keeper === user.id;
    const mayRun = user.role === UserRole.ADMIN || isChairman || isTimekeeper;
    // The screen on the stage watches (common/stage.ts); it never runs.
    if (
      !mayRun &&
      user.role !== UserRole.STAGE &&
      !(await this.isOverseer(user, kind)) &&
      !(await isCongregationElder(user, this.publishers))
    )
      throw this.forbidden();
    const roles: ConductLiveRoles = {
      mayRun,
      isChairman,
      isTimekeeper,
      hasTimekeeper: !!keeperDuty?.publisherId,
      timekeeperName: keeper
        ? await this.nameOf(user.congregationId, keeper)
        : null,
    };

    // After the meeting's day there is no meeting «as it runs» to show — only
    // its result (conduct-runs). A row left from a run started after the
    // day is not shown to anybody (16 October 2026).
    if (await this.meetingDay.isOver(user.congregationId, week, kind)) {
      return { live: null, roles };
    }
    const row = await this.findRow(user.congregationId, week, kind);
    if (
      !row ||
      now.getTime() - new Date(row.updatedAt).getTime() > CONDUCT_LIVE_KEEP_MS
    ) {
      return { live: null, roles };
    }
    // Only the device that taps is the controller's sign of life: the same
    // account watching on its phone must not hide that the iPad went quiet.
    if (this.isHand(row, user, deviceId)) {
      await this.live.update({ id: row.id }, {
        controllerSeenAt: now,
        updatedAt: () => '"updated_at"',
      } as never);
      row.controllerSeenAt = now;
    } else if (isChairman) {
      await this.live.update({ id: row.id }, {
        chairmanSeenAt: now,
        updatedAt: () => '"updated_at"',
      } as never);
      row.chairmanSeenAt = now;
    }
    return { live: await this.view(row, user, deviceId), roles };
  }

  private checkState(state: unknown): Record<string, unknown> {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'state must be an object.', {
          fields: [{ field: 'state', rules: ['isObject'] }],
        }),
      );
    }
    if (JSON.stringify(state).length > MAX_STATE_CHARS) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'state is too large.', {
          fields: [{ field: 'state', rules: ['maxLength'] }],
        }),
      );
    }
    return state as Record<string, unknown>;
  }

  /**
   * A tap of the controller. With no row yet, the first of the three hands
   * to start becomes the controller. Otherwise only the controller, with the
   * current epoch, is heard; anybody else — or the controller with an epoch
   * that a take-over has passed — is told who runs it now.
   */
  async write(
    user: AuthenticatedUser,
    weekStartDate: string,
    epoch: number,
    stateIn: unknown,
    now = new Date(),
    kind: ConductKind = EventType.MIDWEEK,
    deviceId: string | null = null,
  ): Promise<ConductLiveView> {
    const week = this.monday(weekStartDate);
    const state = this.checkState(stateIn);
    if (!(await this.mayRun(user, week, kind))) throw this.forbidden();
    await this.refuseIfOver(user.congregationId, week, kind);
    const row = await this.findRow(user.congregationId, week, kind);
    if (!row) {
      const created = await this.live.save(
        this.live.create({
          congregationId: user.congregationId,
          weekStartDate: week,
          eventType: kind,
          room: MAIN_ROOM,
          state,
          epoch: 1,
          controllerUserId: user.id,
          controllerDeviceId: deviceId,
          controllerSeenAt: now,
          chairmanSeenAt: null,
        }),
      );
      return this.view(created, user, deviceId);
    }
    if (!this.isHand(row, user, deviceId) || row.epoch !== epoch) {
      throw new ConflictException(
        refusal(
          'CONDUCT_LIVE_NOT_YOURS',
          'Somebody else runs this meeting now.',
          {
            controllerName: await this.nameOf(
              user.congregationId,
              row.controllerUserId,
            ),
            epoch: row.epoch,
          },
        ),
      );
    }
    row.state = state;
    row.controllerSeenAt = now;
    // A row from an app before devices is bound to the first that names itself.
    if (!row.controllerDeviceId && deviceId) row.controllerDeviceId = deviceId;
    const saved = await this.live.save(row);
    return this.view(saved, user, deviceId);
  }

  /**
   * Take the meeting over: from now on this account's taps count, and the
   * previous controller's are refused. The state goes on from where the
   * server has it — or, given, from the taker's own (the chairman's iPad that
   * kept counting through a gap in the signal).
   */
  async take(
    user: AuthenticatedUser,
    weekStartDate: string,
    stateIn: unknown,
    now = new Date(),
    kind: ConductKind = EventType.MIDWEEK,
    deviceId: string | null = null,
  ): Promise<ConductLiveView> {
    const week = this.monday(weekStartDate);
    if (!(await this.mayRun(user, week, kind))) throw this.forbidden();
    await this.refuseIfOver(user.congregationId, week, kind);
    const row = await this.findRow(user.congregationId, week, kind);
    if (!row) {
      return this.write(user, week, 0, stateIn ?? {}, now, kind, deviceId);
    }
    row.epoch += 1;
    row.controllerUserId = user.id;
    row.controllerDeviceId = deviceId;
    row.controllerSeenAt = now;
    if (stateIn !== undefined && stateIn !== null)
      row.state = this.checkState(stateIn);
    const saved = await this.live.save(row);
    return this.view(saved, user, deviceId);
  }

  /** Every live row older than a day, in every congregation. Returns how many. */
  async deleteExpired(now = new Date()): Promise<number> {
    const res = await this.live.delete({
      updatedAt: LessThan(new Date(now.getTime() - CONDUCT_LIVE_KEEP_MS)),
    });
    return res.affected ?? 0;
  }
}
