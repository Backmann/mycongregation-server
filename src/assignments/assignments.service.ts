import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, IsNull, Not, In } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { QueryAssignmentDto } from './dto/query-assignment.dto';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { EventType } from '../common/enums/event-type.enum';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { TalkExchangeService } from '../talk-exchange/talk-exchange.service';
import { DutiesService } from '../duties/duties.service';

const PUBLIC_TALK_PART_KEY = 'public_talk_speaker';

/**
 * Congregation-opt-in rule: whoever is chairman is also assigned the
 * concluding (midweek) / opening (weekend) prayer of the same meeting.
 * Maps the chairman part to its prayer part + the capability the prayer needs.
 */
const CHAIRMAN_PRAYER_RULES: Record<
  string,
  { prayerPartKey: string; prayerCapability: string }
> = {
  midweek_chairman: {
    prayerPartKey: 'midweek_closing_prayer',
    prayerCapability: 'midweek_opening_prayer',
  },
  weekend_chairman: {
    prayerPartKey: 'weekend_opening_prayer',
    prayerCapability: 'weekend_opening_prayer',
  },
};

export interface AssignmentRuleWarning {
  code: 'prayer_capability_missing' | 'mic_capability_off' | 'mic_taken';
  publisherName: string;
  partKey?: string;
  capability?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AssignmentsService {
  constructor(
    @InjectRepository(Assignment)
    private readonly repo: Repository<Assignment>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(Congregation)
    private readonly congregationsRepo: Repository<Congregation>,
    private readonly pushNotifications: PushNotificationsService,
    private readonly talkExchange: TalkExchangeService,
    private readonly dutiesService: DutiesService,
  ) {}

  /**
   * Schedule editors (admin, or holders of a schedule responsibility) may
   * see drafts and removed rows; everyone else only sees the published
   * programme. No user context (internal module-to-module call) is trusted.
   */
  private async canSeeDrafts(user?: AuthenticatedUser): Promise<boolean> {
    if (!user) return true;
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In([
          'life_ministry_overseer',
          'body_coordinator',
        ] as ResponsibilityType[]),
      },
    });
    return held > 0;
  }

  async list(
    congregationId: string,
    query: QueryAssignmentDto,
    user?: AuthenticatedUser,
  ): Promise<PaginatedResult<Assignment>> {
    const editor = await this.canSeeDrafts(user);
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.congregationId = :congregationId', { congregationId });

    if (query.weekStart) {
      qb.andWhere('a.weekStartDate >= :weekStart', {
        weekStart: query.weekStart,
      });
    }
    if (query.weekEnd) {
      qb.andWhere('a.weekStartDate < :weekEnd', { weekEnd: query.weekEnd });
    }
    if (query.eventType) {
      qb.andWhere('a.eventType = :eventType', { eventType: query.eventType });
    }
    if (!editor) {
      // Non-editors only ever see the published programme.
      qb.andWhere("a.status = 'published'");
    } else if (query.status) {
      qb.andWhere('a.status = :status', { status: query.status });
    }
    if (query.publisherId) {
      qb.andWhere(
        '(a.publisherId = :publisherId OR a.assistantPublisherId = :publisherId)',
        { publisherId: query.publisherId },
      );
    }
    if (query.partKey) {
      qb.andWhere('a.partKey = :partKey', { partKey: query.partKey });
    }

    if (editor && query.includeRemoved) {
      qb.withDeleted();
    }

    qb.orderBy('a.weekStartDate', 'ASC')
      .addOrderBy('a.eventType', 'ASC')
      .addOrderBy('a.partOrder', 'ASC')
      .addOrderBy('a.partKey', 'ASC')
      .skip(offset)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, limit, offset };
  }

  async getById(
    congregationId: string,
    id: string,
    user?: AuthenticatedUser,
  ): Promise<Assignment> {
    const assignment = await this.repo.findOne({
      where: { id, congregationId },
      withDeleted: true,
    });
    if (!assignment) {
      throw new NotFoundException(`Assignment ${id} not found`);
    }
    if (
      (String(assignment.status) !== 'published' || assignment.deletedAt) &&
      !(await this.canSeeDrafts(user))
    ) {
      // Hide non-published / removed rows from non-editors as if absent.
      throw new NotFoundException(`Assignment ${id} not found`);
    }
    return assignment;
  }

  async create(
    congregationId: string,
    dto: CreateAssignmentDto,
  ): Promise<Assignment> {
    const assignment = this.repo.create({
      ...dto,
      congregationId,
    });
    return this.repo.save(assignment);
  }

  async bulkCreate(
    congregationId: string,
    dtos: CreateAssignmentDto[],
  ): Promise<Assignment[]> {
    const entities = dtos.map((dto) =>
      this.repo.create({ ...dto, congregationId }),
    );
    return this.repo.save(entities);
  }

  async update(
    congregationId: string,
    id: string,
    dto: UpdateAssignmentDto,
  ): Promise<Assignment> {
    const existing = await this.getById(congregationId, id);
    if (existing.deletedAt) {
      throw new NotFoundException(
        `Assignment ${id} is removed; restore it before updating`,
      );
    }
    const prevPublisherId = existing.publisherId;
    // If a published assignment's assignee / partner / invited speaker changes,
    // flag it so the scheduler can notify the congregation of the change.
    const changed =
      existing.status === AssignmentStatus.PUBLISHED &&
      ((dto.publisherId !== undefined &&
        dto.publisherId !== existing.publisherId) ||
        (dto.assistantPublisherId !== undefined &&
          dto.assistantPublisherId !== existing.assistantPublisherId) ||
        (dto.speakerName !== undefined &&
          dto.speakerName !== existing.speakerName) ||
        (dto.speakerCongregation !== undefined &&
          dto.speakerCongregation !== existing.speakerCongregation));
    Object.assign(existing, dto);
    if (changed) existing.changedSincePublish = true;
    const saved = await this.repo.save(existing);
    // Keep the "К нам" journal in sync with the weekend public-talk slot.
    if (saved.partKey === PUBLIC_TALK_PART_KEY) {
      await this.talkExchange.syncProgramToJournal(
        congregationId,
        saved.weekStartDate,
      );
    }
    // Congregation rule: chairman -> concluding/opening prayer auto-fill.
    const ruleWarnings = await this.applyChairmanPrayerRule(
      congregationId,
      saved,
      prevPublisherId,
    );
    // Congregation rule (Stage 2): Treasures-talk speaker -> microphone #1.
    if (saved.partKey === 'treasures_talk') {
      const micWarnings = await this.dutiesService.reconcileTreasuresMic(
        congregationId,
        saved.weekStartDate,
        saved.eventType,
        prevPublisherId,
      );
      ruleWarnings.push(...micWarnings);
    }
    if (ruleWarnings.length) {
      (
        saved as Assignment & { ruleWarnings?: AssignmentRuleWarning[] }
      ).ruleWarnings = ruleWarnings;
    }
    return saved;
  }

  /**
   * When the congregation has automation enabled and the chairman of a meeting
   * changes, mirror that publisher into the meeting's prayer slot — but only
   * if the slot is empty or still holds the previous chairman (so manual
   * overrides are respected). If the new chairman lacks the prayer capability,
   * the prayer is left untouched and a warning is returned for the UI to show.
   */
  private async applyChairmanPrayerRule(
    congregationId: string,
    chairman: Assignment,
    prevPublisherId: string | null,
  ): Promise<AssignmentRuleWarning[]> {
    const rule = CHAIRMAN_PRAYER_RULES[chairman.partKey];
    if (!rule) return [];
    if (chairman.publisherId === prevPublisherId) return [];
    const congregation = await this.congregationsRepo.findOne({
      where: { id: congregationId },
    });
    if (!congregation?.assignmentAutomationEnabled) return [];

    const prayer = await this.repo.findOne({
      where: {
        congregationId,
        weekStartDate: chairman.weekStartDate,
        eventType: chairman.eventType,
        partKey: rule.prayerPartKey,
      },
    });
    if (!prayer) return [];

    const prayerIsAutoOrEmpty =
      prayer.publisherId == null ||
      (prevPublisherId != null && prayer.publisherId === prevPublisherId);
    if (!prayerIsAutoOrEmpty) return [];

    // Chairman cleared -> clear the auto-filled prayer too.
    if (chairman.publisherId == null) {
      if (prayer.publisherId != null) {
        prayer.publisherId = null;
        if (prayer.status === AssignmentStatus.PUBLISHED) {
          prayer.changedSincePublish = true;
        }
        await this.repo.save(prayer);
      }
      return [];
    }

    const pub = await this.publishersRepo.findOne({
      where: { id: chairman.publisherId, congregationId },
    });
    const hasCapability = pub?.capabilities?.[rule.prayerCapability] === true;
    if (!hasCapability) {
      return [
        {
          code: 'prayer_capability_missing',
          partKey: rule.prayerPartKey,
          capability: rule.prayerCapability,
          publisherName: pub?.displayName ?? '',
        },
      ];
    }

    if (prayer.publisherId !== chairman.publisherId) {
      prayer.publisherId = chairman.publisherId;
      if (prayer.status === AssignmentStatus.PUBLISHED) {
        prayer.changedSincePublish = true;
      }
      await this.repo.save(prayer);
    }
    return [];
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const existing = await this.getById(congregationId, id);
    if (existing.deletedAt) {
      return;
    }
    await this.repo.softDelete({
      id,
      congregationId,
    });
  }

  async restore(congregationId: string, id: string): Promise<Assignment> {
    const existing = await this.repo.findOne({
      where: {
        id,
        congregationId,
        deletedAt: Not(IsNull()),
      },
      withDeleted: true,
    });
    if (!existing) {
      throw new NotFoundException(`Removed assignment ${id} not found`);
    }
    await this.repo.restore({
      id,
      congregationId,
    });
    return this.getById(congregationId, id);
  }

  /**
   * Bulk-publish one meeting: every draft assignment of the given week +
   * section becomes published. Soft-deleted rows are left untouched, as
   * are already-published and cancelled rows (idempotent by design).
   */
  async publishMeeting(
    congregationId: string,
    weekStartDate: string,
    eventType: EventType,
    notify = true,
  ): Promise<{ published: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .update(Assignment)
      .set({ status: 'published' as AssignmentStatus })
      .where('congregationId = :congregationId', { congregationId })
      .andWhere('weekStartDate = :weekStartDate', { weekStartDate })
      .andWhere('eventType = :eventType', { eventType })
      .andWhere("status = 'draft'")
      .andWhere('deletedAt IS NULL')
      .execute();
    const published = result.affected ?? 0;
    // Publishing re-broadcasts the programme, so any pending "changed since
    // publish" flags on this meeting are now covered — clear them.
    await this.repo
      .createQueryBuilder()
      .update(Assignment)
      .set({ changedSincePublish: false })
      .where('congregationId = :congregationId', { congregationId })
      .andWhere('weekStartDate = :weekStartDate', { weekStartDate })
      .andWhere('eventType = :eventType', { eventType })
      .andWhere('changedSincePublish = true')
      .andWhere('deletedAt IS NULL')
      .execute();
    const kind = String(eventType);
    if (notify && published > 0 && (kind === 'midweek' || kind === 'weekend')) {
      // Fire-and-forget: the congregation learns the programme is out.
      void this.pushNotifications.sendSchedulePublished(
        congregationId,
        kind,
        weekStartDate,
      );
    }
    return { published };
  }

  /**
   * Notify the congregation that an already-published meeting was edited.
   * Sends one push naming the changed part titles (when present), then clears
   * the per-assignment "changed since publish" flags for that meeting.
   */
  async notifyChanges(
    congregationId: string,
    weekStartDate: string,
    eventType: EventType,
  ): Promise<{ notified: number }> {
    const changedRows = await this.repo.find({
      where: {
        congregationId,
        weekStartDate,
        eventType,
        changedSincePublish: true,
      },
      order: { partOrder: 'ASC' },
    });
    if (changedRows.length === 0) {
      return { notified: 0 };
    }
    const partTitles = changedRows
      .map((a) => a.partTitle?.trim())
      .filter((t): t is string => !!t);
    const parts = partTitles.join(', ');

    await this.repo
      .createQueryBuilder()
      .update(Assignment)
      .set({ changedSincePublish: false })
      .where('congregationId = :congregationId', { congregationId })
      .andWhere('weekStartDate = :weekStartDate', { weekStartDate })
      .andWhere('eventType = :eventType', { eventType })
      .andWhere('changedSincePublish = true')
      .andWhere('deletedAt IS NULL')
      .execute();

    const kind = String(eventType);
    if (kind === 'midweek' || kind === 'weekend') {
      void this.pushNotifications.sendScheduleChanged(
        congregationId,
        kind,
        weekStartDate,
        parts,
      );
    }
    return { notified: changedRows.length };
  }
}
