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

export interface AuxPioneerJournalRow {
  id: string;
  publisherId: string;
  publisherName: string;
  startMonth: string;
  endMonth: string | null;
  untilCancelled: boolean;
  serving: boolean;
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
    const rows = all.map((p) => ({
      id: p.id,
      publisherId: p.publisherId,
      publisherName: names.get(p.publisherId) ?? '—',
      startMonth: p.startMonth,
      endMonth: p.endMonth,
      untilCancelled: p.untilCancelled,
      serving: isActiveInMonth(
        {
          startMonth: p.startMonth,
          endMonth: p.endMonth,
          untilCancelled: p.untilCancelled,
        },
        nowKey,
      ),
    }));
    // Serving first, then by most recent start.
    rows.sort((a, b) => {
      if (a.serving !== b.serving) return a.serving ? -1 : 1;
      return b.startMonth.localeCompare(a.startMonth);
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
