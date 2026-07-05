import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, IsNull, Not, In } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { SwapPublicTalkDto } from './dto/swap-public-talk.dto';
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
  code:
    | 'prayer_capability_missing'
    | 'treasures_capability_missing'
    | 'mic_capability_off'
    | 'mic_taken';
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
    const saved = await this.repo.save(assignment);
    // Keep the "К нам" journal in sync when the weekend public-talk slot is
    // created directly with a speaker (not only via update).
    if (saved.partKey === PUBLIC_TALK_PART_KEY) {
      await this.talkExchange.syncProgramToJournal(
        congregationId,
        saved.weekStartDate,
      );
    }
    return saved;
  }

  async bulkCreate(
    congregationId: string,
    dtos: CreateAssignmentDto[],
  ): Promise<Assignment[]> {
    const entities = dtos.map((dto) =>
      this.repo.create({ ...dto, congregationId }),
    );
    const saved = await this.repo.save(entities);
    const talkWeeks = new Set(
      saved
        .filter((a) => a.partKey === PUBLIC_TALK_PART_KEY)
        .map((a) => a.weekStartDate),
    );
    for (const week of talkWeeks) {
      await this.talkExchange.syncProgramToJournal(congregationId, week);
    }
    return saved;
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
    // Congregation rule (Stage 2): the Treasures talk and the midweek opening
    // prayer are linked both ways, and microphone #1 follows the speaker.
    const linkWarnings = await this.applyTreasuresPrayerLink(
      congregationId,
      saved,
      prevPublisherId,
    );
    ruleWarnings.push(...linkWarnings);
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

  /**
   * Congregation opt-in rule (Stage 2, extended): the Treasures-talk speaker
   * and the midweek opening prayer are linked BOTH ways — whichever part is
   * assigned first mirrors into the other, and microphone #1 always follows
   * the Treasures speaker (one-way; editing the mic changes nothing back).
   *
   * Manual overrides are respected: the mirrored slot is only touched when it
   * is empty or still holds the previous publisher of the edited part. When
   * the edited part is cleared, an auto-filled counterpart (and the mic) is
   * cleared too. Capability checks mirror the chairman rule: the target part's
   * capability must be on, otherwise the slot is left alone and a warning is
   * returned for the UI.
   */
  private async applyTreasuresPrayerLink(
    congregationId: string,
    edited: Assignment,
    prevPublisherId: string | null,
  ): Promise<AssignmentRuleWarning[]> {
    if (edited.eventType !== EventType.MIDWEEK) return [];
    const isTreasures = edited.partKey === 'treasures_talk';
    const isPrayer = edited.partKey === 'midweek_opening_prayer';
    if (!isTreasures && !isPrayer) return [];
    if (edited.publisherId === prevPublisherId) return [];
    const congregation = await this.congregationsRepo.findOne({
      where: { id: congregationId },
    });
    if (!congregation?.assignmentAutomationEnabled) return [];

    const warnings: AssignmentRuleWarning[] = [];
    const otherKey = isTreasures ? 'midweek_opening_prayer' : 'treasures_talk';
    const other = await this.repo.findOne({
      where: {
        congregationId,
        weekStartDate: edited.weekStartDate,
        eventType: edited.eventType,
        partKey: otherKey,
      },
    });

    // Track the Treasures speaker before this rule ran, so the mic reconcile
    // can tell an auto-filled slot from a manual one.
    let prevTreasuresId = isTreasures
      ? prevPublisherId
      : (other?.publisherId ?? null);
    let treasuresChanged = isTreasures;

    if (other) {
      const otherIsAutoOrEmpty =
        other.publisherId == null ||
        (prevPublisherId != null && other.publisherId === prevPublisherId);
      if (otherIsAutoOrEmpty) {
        if (edited.publisherId == null) {
          // Edited part cleared -> clear the auto-filled counterpart too.
          if (other.publisherId != null) {
            other.publisherId = null;
            if (other.status === AssignmentStatus.PUBLISHED) {
              other.changedSincePublish = true;
            }
            await this.repo.save(other);
            if (otherKey === 'treasures_talk') treasuresChanged = true;
          }
        } else {
          const pub = await this.publishersRepo.findOne({
            where: { id: edited.publisherId, congregationId },
          });
          const capability = otherKey; // part key doubles as capability key
          const hasCapability = pub?.capabilities?.[capability] === true;
          if (!hasCapability) {
            warnings.push({
              code:
                otherKey === 'treasures_talk'
                  ? 'treasures_capability_missing'
                  : 'prayer_capability_missing',
              partKey: otherKey,
              capability,
              publisherName: pub?.displayName ?? '',
            });
          } else if (other.publisherId !== edited.publisherId) {
            other.publisherId = edited.publisherId;
            if (other.status === AssignmentStatus.PUBLISHED) {
              other.changedSincePublish = true;
            }
            await this.repo.save(other);
            if (otherKey === 'treasures_talk') treasuresChanged = true;
          }
        }
      }
    }

    // Microphone #1 follows the Treasures speaker whenever it (may have)
    // changed — whether the talk was edited directly or via the prayer.
    if (treasuresChanged) {
      const micWarnings = await this.dutiesService.reconcileTreasuresMic(
        congregationId,
        edited.weekStartDate,
        edited.eventType,
        prevTreasuresId,
      );
      warnings.push(...micWarnings);
    }
    return warnings;
  }

  /**
   * Swap or move the weekend public-talk slot contents (speaker, invited
   * name/congregation, talk number) between two weeks. Used when the brother
   * booked for another week arrives today. 'swap' exchanges the two weeks;
   * 'move' fills the target and clears the source. The "К нам" journal is
   * re-synced for both weeks afterwards.
   */
  async swapPublicTalk(
    congregationId: string,
    dto: SwapPublicTalkDto,
  ): Promise<{ source: Assignment; target: Assignment }> {
    if (dto.sourceWeekStartDate === dto.targetWeekStartDate) {
      throw new BadRequestException('Source and target weeks must differ');
    }
    const findSlot = (week: string) =>
      this.repo.findOne({
        where: {
          congregationId,
          weekStartDate: week,
          partKey: PUBLIC_TALK_PART_KEY,
        },
      });
    const source = await findSlot(dto.sourceWeekStartDate);
    const target = await findSlot(dto.targetWeekStartDate);
    if (!source || !target) {
      throw new NotFoundException(
        'Both weeks must have a weekend public-talk slot',
      );
    }

    type TalkFields = Pick<
      Assignment,
      'publisherId' | 'speakerName' | 'speakerCongregation' | 'publicTalkId'
    >;
    const take = (a: Assignment): TalkFields => ({
      publisherId: a.publisherId,
      speakerName: a.speakerName,
      speakerCongregation: a.speakerCongregation,
      publicTalkId: a.publicTalkId,
    });
    const put = (a: Assignment, f: TalkFields) => {
      const changed =
        a.publisherId !== f.publisherId ||
        a.speakerName !== f.speakerName ||
        a.speakerCongregation !== f.speakerCongregation ||
        a.publicTalkId !== f.publicTalkId;
      Object.assign(a, f);
      if (changed && a.status === AssignmentStatus.PUBLISHED) {
        a.changedSincePublish = true;
      }
    };

    const fromSource = take(source);
    const fromTarget = take(target);
    put(target, fromSource);
    put(
      source,
      dto.mode === 'swap'
        ? fromTarget
        : {
            publisherId: null,
            speakerName: null,
            speakerCongregation: null,
            publicTalkId: null,
          },
    );

    await this.repo.save([source, target]);
    await this.talkExchange.syncProgramToJournal(
      congregationId,
      dto.sourceWeekStartDate,
    );
    await this.talkExchange.syncProgramToJournal(
      congregationId,
      dto.targetWeekStartDate,
    );
    return { source, target };
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
    // Deleting the weekend public-talk slot must also clear the "К нам"
    // journal entry — otherwise an accidental pick leaves a ghost record.
    if (existing.partKey === PUBLIC_TALK_PART_KEY) {
      await this.talkExchange.syncProgramToJournal(
        congregationId,
        existing.weekStartDate,
      );
    }
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
    const restored = await this.getById(congregationId, id);
    if (restored.partKey === PUBLIC_TALK_PART_KEY) {
      await this.talkExchange.syncProgramToJournal(
        congregationId,
        restored.weekStartDate,
      );
    }
    return restored;
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
