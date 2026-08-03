import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { In, IsNull, Repository } from 'typeorm';
import { LocalNeedsTopic } from '../entities/local-needs-topic.entity';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateLocalNeedsTopicDto } from './dto/create-local-needs-topic.dto';
import { UpdateLocalNeedsTopicDto } from './dto/update-local-needs-topic.dto';
import { QueryLocalNeedsTopicsDto } from './dto/query-local-needs-topics.dto';
import { MarkUsedLocalNeedsTopicDto } from './dto/mark-used-local-needs-topic.dto';
import { CongregationClock } from '../common/congregation-clock.service';
import { mondayOf } from '../common/week';

@Injectable()
export class LocalNeedsService {
  constructor(
    @InjectRepository(LocalNeedsTopic)
    private readonly repo: Repository<LocalNeedsTopic>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
  ) {}

  /**
   * Responsibilities that may manage the local-needs backlog. Per the body of
   * elders: only the Life & Ministry overseer (midweek) edits; admins always
   * pass.
   */
  private static readonly MANAGER_RESPONSIBILITIES = [
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
  ];

  /** True when the user may edit the backlog (admin or Life & Ministry overseer). */
  private async isManager(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(LocalNeedsService.MANAGER_RESPONSIBILITIES),
      },
    });
    return held > 0;
  }

  private async assertCanManage(user: AuthenticatedUser): Promise<void> {
    if (!(await this.isManager(user))) {
      throw new ForbiddenException('Not allowed to manage local needs');
    }
  }

  /** Reading is limited to elders (admins and managers always pass). */
  private async assertCanView(user: AuthenticatedUser): Promise<void> {
    if (user.role === UserRole.ADMIN || user.role === UserRole.ELDER) return;
    if (await this.isManager(user)) return;
    throw new ForbiddenException('Local needs are visible to elders only');
  }

  private baseQuery(tenantId: string) {
    // leftJoin (not AndSelect) + explicit addSelect keeps encrypted publisher
    // columns out of the query while still hydrating a light speaker object.
    return this.repo
      .createQueryBuilder('t')
      .leftJoin('t.speaker', 's')
      .addSelect(['s.id', 's.displayName', 's.firstName', 's.lastName'])
      .where('t.congregation_id = :tenantId', { tenantId });
  }

  /**
   * Strip a title down to what two people would agree is "the same subject".
   *
   * The workbook import appends the first content note to a part's title
   * («Чтение Библии: Иса 60:1-22»), so the part often carries the topic's
   * title plus a colon and more. Everything else — case, quotes, dashes,
   * doubled spaces — is noise nobody means.
   */
  private static normaliseTitle(value: string): string {
    return value
      .toLowerCase()
      .replace(/[«»"'’“”.,:;!?()\[\]\-—–]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Notice that a planned topic has, in fact, already been in the programme.
   *
   * A topic only learned its week when someone placed it through «вставить
   * тему» or ticked it by hand. But the midweek programme is imported from the
   * workbook with its own part titles — so a subject can already stand in a
   * week that has passed while the backlog still lists it as waiting to be
   * used. That is precisely how the same subject gets taken twice.
   *
   * The match is deliberately strict: the same part of the meeting («В жизни
   * христианина»), a title that is equal once normalised or that the part's
   * title begins with, and nothing shorter than a few characters — a loose
   * match here would mark the wrong subject as done, which is worse than
   * marking nothing.
   *
   * Best-effort, and never fatal: this runs off a READ, and a list of topics
   * must not fail to load because a reconciliation query did.
   */
  private async reconcileWithProgramme(tenantId: string): Promise<void> {
    const planned = await this.repo.find({
      where: { congregationId: tenantId, usedWeek: IsNull() },
    });
    if (planned.length === 0) return;

    const parts = await this.assignmentsRepo
      .createQueryBuilder('a')
      .select(['a.id', 'a.weekStartDate', 'a.partTitle'])
      .where('a.congregation_id = :tenantId', { tenantId })
      .andWhere('a.part_key LIKE :key', { key: 'living_christians%' })
      .andWhere('a.part_title IS NOT NULL')
      .andWhere('a.deleted_at IS NULL')
      .getMany();
    if (parts.length === 0) return;

    for (const topic of planned) {
      const needle = LocalNeedsService.normaliseTitle(topic.title);
      if (needle.length < 6) continue;
      // The latest week that carries this subject: if it ran twice, the one
      // that matters for "has this been used" is the most recent.
      let best: Assignment | null = null;
      for (const part of parts) {
        const raw = part.partTitle ?? '';
        // The import appends the first content note after a colon
        // («Чтение Библии: Иса 60:1-22»), so the part is compared both whole
        // and cut at that colon. Equality either way — never "starts with",
        // which would let «Гостеприимство» claim «Гостеприимство в трудные
        // времена», a different subject entirely.
        const whole = LocalNeedsService.normaliseTitle(raw);
        const head = LocalNeedsService.normaliseTitle(raw.split(':')[0]);
        const same = whole === needle || head === needle;
        if (!same) continue;
        if (!best || part.weekStartDate > best.weekStartDate) best = part;
      }
      if (!best) continue;

      const before = {
        usedWeek: topic.usedWeek,
        usedAssignmentId: topic.usedAssignmentId,
      };
      topic.usedWeek = mondayOf(best.weekStartDate);
      topic.usedAssignmentId = best.id;
      await this.repo.save(topic);
      await this.auditLog.logUpdate({
        tenantId,
        entityType: 'local_need',
        entityId: topic.id,
        subjectId: topic.speakerPublisherId,
        before,
        after: {
          usedWeek: topic.usedWeek,
          usedAssignmentId: topic.usedAssignmentId,
        },
        fields: ['usedWeek', 'usedAssignmentId'],
        // Nobody did this; the app noticed it.
        system: true,
      });
    }
  }

  async findAll(
    tenantId: string,
    query: QueryLocalNeedsTopicsDto,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic[]> {
    await this.assertCanView(user);
    try {
      await this.reconcileWithProgramme(tenantId);
    } catch {
      // A list that loads is worth more than a reconciliation that ran.
    }
    const qb = this.baseQuery(tenantId);

    if (query.onlyPlanned === 'true') {
      qb.andWhere('t.used_week IS NULL');
    }
    if (query.includeRemoved === 'true') {
      qb.withDeleted();
    }

    // Planned (used_week null) first, then used topics newest-week first.
    return qb
      .orderBy('t.used_week', 'DESC', 'NULLS FIRST')
      .addOrderBy('t.created_at', 'ASC')
      .getMany();
  }

  async findOne(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanView(user);
    const found = await this.baseQuery(tenantId)
      .andWhere('t.id = :id', { id })
      .withDeleted()
      .getOne();
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    return found;
  }

  async create(
    tenantId: string,
    dto: CreateLocalNeedsTopicDto,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanManage(user);
    const entity = this.repo.create({
      ...dto,
      congregationId: tenantId,
      createdById: user.id,
    });
    const saved = await this.repo.save(entity);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'local_need',
      entityId: saved.id,
      subjectId: saved.speakerPublisherId,
      after: {
        title: saved.title,
        notes: saved.notes,
        speakerPublisherId: saved.speakerPublisherId,
        usedWeek: saved.usedWeek,
      },
    });
    return saved;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateLocalNeedsTopicDto,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanManage(user);
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    const before = {
      title: found.title,
      notes: found.notes,
      speakerPublisherId: found.speakerPublisherId,
      usedWeek: found.usedWeek,
    };
    Object.assign(found, dto);
    // A week is identified by its Monday everywhere else in the app; a topic
    // filed under a Wednesday would sort and group as its own private week.
    if (found.usedWeek) found.usedWeek = mondayOf(found.usedWeek);
    if (!found.usedWeek) found.usedAssignmentId = null;
    const saved = await this.repo.save(found);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'local_need',
      entityId: saved.id,
      subjectId: saved.speakerPublisherId,
      before,
      after: {
        title: saved.title,
        notes: saved.notes,
        speakerPublisherId: saved.speakerPublisherId,
        usedWeek: saved.usedWeek,
      },
      fields: ['title', 'notes', 'speakerPublisherId', 'usedWeek'],
    });
    return saved;
  }

  /**
   * Mark a topic as used — by default in the congregation's current week.
   *
   * The week comes from the SERVER's reading of the congregation's clock when
   * the caller does not name one, so «отметить как прошедшую» means the same
   * thing whatever timezone the phone is set to. Naming a week explicitly is
   * how a topic given three weeks ago is recorded after the fact.
   */
  async markUsed(
    tenantId: string,
    id: string,
    dto: MarkUsedLocalNeedsTopicDto,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanManage(user);
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    const before = {
      usedWeek: found.usedWeek,
      usedAssignmentId: found.usedAssignmentId,
    };
    found.usedWeek = mondayOf(
      dto.week ?? (await this.clock.todayFor(tenantId)),
    );
    found.usedAssignmentId = dto.assignmentId ?? null;
    const saved = await this.repo.save(found);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'local_need',
      entityId: saved.id,
      subjectId: saved.speakerPublisherId,
      before,
      after: {
        usedWeek: saved.usedWeek,
        usedAssignmentId: saved.usedAssignmentId,
      },
      fields: ['usedWeek', 'usedAssignmentId'],
    });
    return saved;
  }

  /** Put a topic back in the plan: no week, and no part it belongs to. */
  async markPlanned(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanManage(user);
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    const before = {
      usedWeek: found.usedWeek,
      usedAssignmentId: found.usedAssignmentId,
    };
    found.usedWeek = null;
    found.usedAssignmentId = null;
    const saved = await this.repo.save(found);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'local_need',
      entityId: saved.id,
      subjectId: saved.speakerPublisherId,
      before,
      after: { usedWeek: null, usedAssignmentId: null },
      fields: ['usedWeek', 'usedAssignmentId'],
    });
    return saved;
  }

  /**
   * The meeting part is gone, or no longer carries this topic — so the topic
   * was not used after all, and goes back to the plan.
   *
   * Called from the assignments service. Silent by design: nobody asked for
   * this, it is the app keeping its own record straight, and a notification
   * about it would be noise. It IS journalled, because a topic that changes
   * state on its own is exactly the kind of thing someone later disputes.
   */
  async releaseAssignment(
    tenantId: string,
    assignmentId: string,
  ): Promise<void> {
    const bound = await this.repo.find({
      where: { congregationId: tenantId, usedAssignmentId: assignmentId },
    });
    for (const topic of bound) {
      const before = {
        usedWeek: topic.usedWeek,
        usedAssignmentId: topic.usedAssignmentId,
      };
      topic.usedWeek = null;
      topic.usedAssignmentId = null;
      await this.repo.save(topic);
      await this.auditLog.logUpdate({
        tenantId,
        entityType: 'local_need',
        entityId: topic.id,
        subjectId: topic.speakerPublisherId,
        before,
        after: { usedWeek: null, usedAssignmentId: null },
        fields: ['usedWeek', 'usedAssignmentId'],
      });
    }
  }

  async remove(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.assertCanManage(user);
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'local_need',
      entityId: id,
      action: 'DELETE',
      subjectId: found.speakerPublisherId,
      detail: { title: found.title },
    });
    await this.repo.softDelete(id);
  }

  async restore(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.assertCanManage(user);
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (!found) {
      throw new NotFoundException('Local needs topic not found');
    }
    await this.repo.restore(id);
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'local_need',
      entityId: id,
      action: 'RESTORE',
      subjectId: found.speakerPublisherId,
      detail: { title: found.title },
    });
    return this.findOne(tenantId, id, user);
  }
}
