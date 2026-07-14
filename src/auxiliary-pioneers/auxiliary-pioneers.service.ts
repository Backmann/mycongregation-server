import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuxiliaryPioneer } from '../entities/auxiliary-pioneer.entity';
import { Publisher } from '../entities/publisher.entity';
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
  REDUCED_HOUR_EVENT_TYPES,
} from './auxiliary-pioneer-hours';

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
  ) {}

  /** Managers: admins, body coordinator, secretary, service overseer. */
  async assertCanManage(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    const holds = await this.responsibilityRepo.count({
      where: {
        congregationId,
        userId: user.id,
        type: In(MANAGER_RESPONSIBILITIES),
      },
    });
    if (holds === 0) {
      throw new ForbiddenException(
        'Only admins, the body coordinator, the secretary or the service ' +
          'overseer may manage auxiliary pioneers.',
      );
    }
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

  /** Full history — who serves now and who served before. */
  async journal(congregationId: string): Promise<AuxPioneerJournalRow[]> {
    const all = await this.repo.find({ where: { congregationId } });
    const nowKey = monthKeyOf(new Date());
    const names = await this.namesByIds(
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
        'Only baptized publishers can serve as auxiliary pioneers.',
      );
    }
    const untilCancelled = dto.untilCancelled === true;
    const startMonth = this.normalizeMonth(dto.startMonth);
    const endMonth =
      untilCancelled || !dto.endMonth
        ? null
        : this.normalizeMonth(dto.endMonth);
    if (endMonth && endMonth < startMonth) {
      throw new BadRequestException('End month cannot precede start month.');
    }
    const row = this.repo.create({
      congregationId,
      publisherId: dto.publisherId,
      startMonth,
      endMonth,
      untilCancelled,
      note: dto.note ?? null,
      createdBy: user.id,
    });
    return this.repo.save(row);
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
      throw new BadRequestException('End month cannot precede start month.');
    }
    return this.repo.save(row);
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
    const endMonth = this.normalizeMonth(
      dto.endMonth ?? new Date().toISOString().slice(0, 10),
    );
    if (endMonth < row.startMonth) {
      throw new BadRequestException('End month cannot precede start month.');
    }
    row.endMonth = endMonth;
    row.untilCancelled = false;
    return this.repo.save(row);
  }

  async remove(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<void> {
    await this.assertCanManage(congregationId, user);
    const row = await this.repo.findOne({ where: { id, congregationId } });
    if (!row) throw new NotFoundException('Record not found.');
    await this.repo.delete({ id, congregationId });
  }

  /**
   * Whether the current user's own publisher record is an active auxiliary
   * pioneer in the given month. Used by the report form and the "you serve as
   * an auxiliary pioneer" badges — available to the publisher themselves.
   */
  async isSelfActiveAuxiliaryPioneer(
    congregationId: string,
    user: AuthenticatedUser,
    monthIso: string,
  ): Promise<boolean> {
    const publisher = await this.publisherRepo.findOne({
      where: { congregationId, userId: user.id },
      select: ['id'],
    });
    if (!publisher) return false;
    return this.isActiveAuxiliaryPioneer(
      congregationId,
      publisher.id,
      monthIso,
    );
  }

  /**
   * Is this publisher an active auxiliary pioneer in the given month? Used by
   * the reports module to switch the report form to the hours variant.
   */
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
      if (row.startMonth >= `${fromKey}-01`) {
        await this.repo.remove(row);
      } else {
        row.endMonth = endMonth;
        row.untilCancelled = false;
        await this.repo.save(row);
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
}
