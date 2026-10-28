import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Brackets, Repository } from 'typeorm';
import { ServiceGroup } from '../entities/service-group.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { FieldServiceTemplateSlot } from '../entities/field-service-template-slot.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { Publisher } from '../entities/publisher.entity';
import { CreateServiceGroupDto } from './dto/create-service-group.dto';
import { UpdateServiceGroupDto } from './dto/update-service-group.dto';
import { QueryServiceGroupsDto } from './dto/query-service-groups.dto';
import { PublishersService } from '../publishers/publishers.service';
import { QueryPublishersDto } from '../publishers/dto/query-publishers.dto';
import {
  publicRosterPage,
  publicRosterView,
  redactPrivateFields,
} from '../publishers/publisher-privacy';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { Gender } from '../common/enums/gender.enum';

type ResolvedPublisher = Awaited<ReturnType<PublishersService['findOne']>>;

/**
 * A service group enriched with its resolved overseer and assistant
 * publisher records. The entity stores only publisher IDs (no FK relation,
 * see service-group.entity.ts), so leaders are resolved in the service layer
 * and attached here for API responses.
 */
export type ServiceGroupWithLeaders = ServiceGroup & {
  overseer: ResolvedPublisher | null;
  assistant: ResolvedPublisher | null;
};

@Injectable()
export class ServiceGroupsService {
  constructor(
    @InjectRepository(ServiceGroup)
    private readonly serviceGroupsRepo: Repository<ServiceGroup>,
    private readonly publishersService: PublishersService,
    private readonly auditLog: AuditLogService,
    // Optional so the specs that build this service by hand need not carry
    // them; Nest always provides them.
    @Optional()
    @InjectRepository(FieldServiceMeeting)
    private readonly meetingsRepo?: Repository<FieldServiceMeeting>,
    @Optional()
    @InjectRepository(FieldServiceTemplateSlot)
    private readonly slotsRepo?: Repository<FieldServiceTemplateSlot>,
    @Optional() private readonly clock?: CongregationClock,
  ) {}

  /**
   * What the group still has in field service, for the words of the
   * confirmation before it is removed (24 October 2026): its rows in the
   * template, its drafts and its announced meetings from today on.
   */
  async removalImpact(
    tenantId: string,
    id: string,
  ): Promise<{ slots: number; drafts: number; published: number }> {
    await this.findEntity(tenantId, id);
    const { drafts, published } = await this.meetingsAhead(tenantId, id);
    const slots = this.slotsRepo
      ? await this.slotsRepo.count({
          where: { congregationId: tenantId, serviceGroupId: id },
        })
      : 0;
    return { slots, drafts: drafts.length, published: published.length };
  }

  /** The group's meetings from today on, not called off, split by state. */
  private async meetingsAhead(tenantId: string, groupId: string) {
    const dayOf = (m: FieldServiceMeeting) => {
      const d = new Date(`${String(m.weekStartDate).slice(0, 10)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + m.dayOfWeek - 1);
      return d.toISOString().slice(0, 10);
    };
    if (!this.meetingsRepo || !this.clock) {
      return { drafts: [], published: [], dayOf };
    }
    const today = await this.clock.todayFor(tenantId);
    const monday = (() => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    })();
    const rows = await this.meetingsRepo
      .createQueryBuilder('m')
      .where('m.congregationId = :tenantId', { tenantId })
      .andWhere('m.serviceGroupId = :groupId', { groupId })
      .andWhere('m.cancelledAt IS NULL')
      .andWhere('m.weekStartDate >= :monday', { monday })
      .getMany();
    const ahead = rows.filter((m) => dayOf(m) >= today);
    return {
      drafts: ahead.filter((m) => m.publishedAt === null),
      published: ahead.filter((m) => m.publishedAt !== null),
      dayOf,
    };
  }

  async findAll(
    tenantId: string,
    query: QueryServiceGroupsDto,
    privileged = true,
  ) {
    const qb = this.serviceGroupsRepo
      .createQueryBuilder('sg')
      .where('sg.congregation_id = :tenantId', { tenantId });

    if (query.includeRemoved) {
      qb.withDeleted();
    }

    if (query.search) {
      const pattern = `%${query.search}%`;
      qb.andWhere(
        new Brackets((b) => {
          b.where('sg.name ILIKE :pattern', { pattern });
        }),
      );
    }

    const sortColumn = `sg.${query.sortBy ?? 'name'}`;
    const sortOrder = (query.sortOrder ?? 'asc').toUpperCase() as
      | 'ASC'
      | 'DESC';
    qb.orderBy(sortColumn, sortOrder);

    qb.take(query.limit ?? 50);
    qb.skip(query.offset ?? 0);

    const [data, total] = await qb.getManyAndCount();
    // The list carries the two leaders as well: the servant of a group and his
    // assistant are the point of contact, and having to open every group to
    // find out who they are is exactly what people complained about.
    const withLeaders = await Promise.all(
      data.map((g) => this.attachLeaders(tenantId, g, privileged)),
    );
    return {
      data: withLeaders,
      total,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    };
  }

  /**
   * Raw entity fetch with no leader resolution. Used internally by mutations
   * that need a managed entity to mutate and save.
   */
  private async findEntity(
    tenantId: string,
    id: string,
  ): Promise<ServiceGroup> {
    const group = await this.serviceGroupsRepo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (!group) {
      throw new NotFoundException('Service group not found');
    }
    return group;
  }

  /**
   * Resolves the overseer and assistant publisher records for a group and
   * attaches them. Resolution is independent of group membership — an
   * overseer or assistant need not be a member of the group they lead, which
   * is why looking them up in the group's member list (the previous client
   * behaviour) silently dropped non-member leaders. A leader whose publisher
   * record is missing or removed resolves to null rather than throwing.
   */
  /**
   * A group carries the two people it is organised around. They used to be
   * attached as FULL publisher rows — phone, address, notes — and the group
   * endpoints are open to every signed-in member, so that was a card handed
   * out with the group. Now the unprivileged get the same name-and-service
   * shape as the roster.
   */
  private async attachLeaders(
    tenantId: string,
    group: ServiceGroup,
    privileged: boolean,
  ): Promise<ServiceGroupWithLeaders> {
    const overseer = group.overseerPublisherId
      ? await this.publishersService
          .findOne(tenantId, group.overseerPublisherId)
          .catch(() => null)
      : null;
    const assistant = group.assistantPublisherId
      ? await this.publishersService
          .findOne(tenantId, group.assistantPublisherId)
          .catch(() => null)
      : null;
    const shape = (p: Publisher | null) =>
      p && !privileged ? publicRosterView(p) : p;
    return { ...group, overseer: shape(overseer), assistant: shape(assistant) };
  }

  /** Resolves the caller's standing, then reads. Used by the HTTP layer. */
  async findAllFor(
    tenantId: string,
    query: QueryServiceGroupsDto,
    user: AuthenticatedUser,
  ) {
    const privileged = await this.publishersService.resolvePrivateAccess(
      tenantId,
      user,
    );
    const page = await this.findAll(tenantId, query, privileged);
    /**
     * Какая группа — ТВОЯ.
     *
     * Приложение этого не знало: в строке группы такого признака не было, и
     * отдельного запроса тоже. Поэтому экран не мог ни пометить свою группу,
     * ни погасить чужие — он их не различал, и обычный возвещатель тыкался в
     * чужую, получая отказ без объяснения.
     *
     * Признак считается здесь, а не на клиенте: своя группа известна серверу
     * по карточке возвещателя, привязанной ко входу.
     */
    const ownGroupId = await this.publishersService.findOwnServiceGroupId(
      tenantId,
      user.id,
    );
    const counts = await this.countsFor(
      tenantId,
      page.data.map((g) => g.id),
      privileged,
      privileged
        ? new Set<string>()
        : await this.publishersService.overseenServiceGroupIds(
            tenantId,
            user.id,
          ),
    );
    return {
      ...page,
      data: page.data.map((g) => {
        const c = counts.get(g.id) ?? { members: 0, pioneers: 0 };
        return {
          ...this.notesFor(g, privileged, ownGroupId),
          mine: g.id === ownGroupId,
          memberCount: c.members,
          // How many pioneers a group has is for those who place people
          // between groups (28 October 2026); a publisher sees the size.
          ...(privileged ? { pioneerCount: c.pioneers } : {}),
        };
      }),
    };
  }

  /**
   * HOW BIG EACH GROUP IS, without a name (28 October 2026): the groups'
   * list showed none, and an ordinary publisher may not read another group's
   * members. The number matches what each reader would be shown: students are
   * not publishers and are never counted; for a reader without private access
   * those whose status is «inactive» are left out too, as the roster leaves
   * them out (decided 15 September) — except in the groups he oversees or
   * assists, where the roster keeps them (22 October). A pioneer counts once his service has
   * begun — a type set from a future month is not yet a pioneer.
   */
  private async countsFor(
    tenantId: string,
    groupIds: string[],
    privileged: boolean,
    /** Groups the reader oversees or assists: he sees their inactive too. */
    keepInactiveIn: ReadonlySet<string>,
  ): Promise<Map<string, { members: number; pioneers: number }>> {
    const out = new Map<string, { members: number; pioneers: number }>();
    const manager = (
      this.serviceGroupsRepo as { manager?: { query?: unknown } }
    ).manager as
      | { query?: (sql: string, params: unknown[]) => Promise<unknown> }
      | undefined;
    if (groupIds.length === 0 || typeof manager?.query !== 'function')
      return out;
    // The congregation's own day; without the clock (hand-built specs) a
    // pioneer counts whatever his start, as before this count existed.
    const today = this.clock
      ? await this.clock.todayFor(tenantId)
      : '9999-12-31';
    const rows = (await manager.query(
      `SELECT service_group_id AS "groupId",
              COUNT(*) FILTER (
                WHERE appointment <> 'student'
                  AND ($3::boolean OR status IS DISTINCT FROM 'inactive'
                       OR service_group_id = ANY($5::uuid[]))
              )::int AS members,
              COUNT(*) FILTER (
                WHERE pioneer_type IN ('regular', 'special', 'missionary')
                  AND (pioneer_since IS NULL OR pioneer_since <= $4::date)
              )::int AS pioneers
         FROM publishers
        WHERE congregation_id = $1
          AND deleted_at IS NULL
          AND service_group_id = ANY($2::uuid[])
        GROUP BY service_group_id`,
      [tenantId, groupIds, privileged, today, [...keepInactiveIn]],
    )) as { groupId: string; members: number; pioneers: number }[];
    for (const r of rows)
      out.set(r.groupId, { members: r.members, pioneers: r.pioneers });
    return out;
  }

  /**
   * A group's notes go to the elders and to the group itself.
   *
   * They were sent to every signed-in member for every group (6 October) —
   * the app draws them only on a group's own card, which an outsider cannot
   * open, and that was the whole protection. What is written about one group
   * is not for the members of another. One's own group keeps them: its card
   * shows them today, and nothing a person already reads is taken away here.
   */
  private notesFor<T extends { id: string; notes?: string | null }>(
    group: T,
    privileged: boolean,
    ownGroupId: string | null,
  ): T {
    if (privileged || group.id === ownGroupId) return group;
    return { ...group, notes: null };
  }

  async findOneFor(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<ServiceGroupWithLeaders> {
    const privileged = await this.publishersService.resolvePrivateAccess(
      tenantId,
      user,
    );
    const group = await this.findOne(tenantId, id, privileged);
    if (privileged) return group;
    const ownGroupId = await this.publishersService.findOwnServiceGroupId(
      tenantId,
      user.id,
    );
    return this.notesFor(group, privileged, ownGroupId);
  }

  async findOne(
    tenantId: string,
    id: string,
    privileged = true,
  ): Promise<ServiceGroupWithLeaders> {
    const group = await this.findEntity(tenantId, id);
    return this.attachLeaders(tenantId, group, privileged);
  }

  async create(
    tenantId: string,
    dto: CreateServiceGroupDto,
  ): Promise<ServiceGroupWithLeaders> {
    if (dto.overseerPublisherId) {
      await this.ensureLeader(tenantId, dto.overseerPublisherId);
    }
    if (dto.assistantPublisherId) {
      await this.ensureLeader(tenantId, dto.assistantPublisherId);
    }
    const group = this.serviceGroupsRepo.create({
      ...dto,
      congregationId: tenantId,
    });
    const saved = await this.serviceGroupsRepo.save(group);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'service_group',
      entityId: saved.id,
      after: {
        name: saved.name,
        overseerPublisherId: saved.overseerPublisherId,
        assistantPublisherId: saved.assistantPublisherId,
      },
    });
    await this.addLeadersToGroup(tenantId, saved);
    return this.attachLeaders(tenantId, saved, true);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateServiceGroupDto,
  ): Promise<ServiceGroupWithLeaders> {
    const group = await this.findEntity(tenantId, id);
    // Only a NEW choice is judged: a group saved for its name keeps whoever
    // it already had, so an old record never blocks an unrelated edit.
    if (
      dto.overseerPublisherId &&
      dto.overseerPublisherId !== group.overseerPublisherId
    ) {
      await this.ensureLeader(tenantId, dto.overseerPublisherId);
    }
    if (
      dto.assistantPublisherId &&
      dto.assistantPublisherId !== group.assistantPublisherId
    ) {
      await this.ensureLeader(tenantId, dto.assistantPublisherId);
    }
    // Snapshot before the in-place assign, or both sides would match.
    const before = {
      name: group.name,
      overseerPublisherId: group.overseerPublisherId,
      assistantPublisherId: group.assistantPublisherId,
    };
    Object.assign(group, dto);
    const saved = await this.serviceGroupsRepo.save(group);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'service_group',
      entityId: saved.id,
      before,
      after: {
        name: saved.name,
        overseerPublisherId: saved.overseerPublisherId,
        assistantPublisherId: saved.assistantPublisherId,
      },
      fields: ['name', 'overseerPublisherId', 'assistantPublisherId'],
    });
    await this.addLeadersToGroup(tenantId, saved);
    return this.attachLeaders(tenantId, saved, true);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const group = await this.findEntity(tenantId, id);
    if (group.deletedAt) {
      throw new BadRequestException(
        refusal('GROUP_ALREADY_REMOVED', 'Service group already removed'),
      );
    }
    // Its drafts go with it (24 October 2026): nobody was told of them, and
    // a draft of a group that no longer exists would be announced a week
    // before its month with no place and a conductor by rotation. Announced
    // meetings stay — people were told — and the month view marks them
    // «группа удалена» for the overseer to decide. Its template rows stay
    // too, asleep: preparing a month skips them, and they wake if the group
    // is restored.
    const ahead = await this.meetingsAhead(tenantId, id);
    const drafts = ahead.drafts;
    if (drafts.length && this.meetingsRepo) {
      await this.meetingsRepo.delete(drafts.map((m) => m.id));
    }
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'service_group',
      entityId: id,
      action: 'DELETE',
      detail: {
        name: group.name,
        ...(drafts.length
          ? {
              draftsRemoved: drafts.length,
              draftDates: drafts.map((m) => ahead.dayOf(m)).sort(),
            }
          : {}),
      },
    });
    await this.serviceGroupsRepo.softDelete(id);
  }

  async restore(
    tenantId: string,
    id: string,
  ): Promise<ServiceGroupWithLeaders> {
    const group = await this.findEntity(tenantId, id);
    if (!group.deletedAt) {
      throw new BadRequestException(
        refusal('GROUP_NOT_REMOVED', 'Service group is not removed'),
      );
    }
    await this.serviceGroupsRepo.restore(id);
    return this.findOne(tenantId, id);
  }

  /**
   * Состав группы.
   *
   * Администраторы, старейшины и допущенные к личным данным видят полные
   * строки. Обычный возвещатель — ТОЛЬКО СВОЮ группу, и без личных данных.
   *
   * Правило уже было таким, потом его сняли: рассудили, что имена и так висят
   * на доске, а закрыты должны быть телефоны и карточки. Решение Лионеля 15
   * сентября вернуло прежнее, и вот почему оно точнее. Список братьев для
   * обычного возвещателя ограничен его группой — а состав чужих групп
   * открывал ровно то же самое в два нажатия, так что ограничение списка было
   * видимостью. Либо закрыто и там и там, либо не закрыто нигде; половинчатое
   * правило хуже любого из двух.
   *
   * Названия чужих групп и их надзирателей это не трогает: их видно в списке
   * групп, и они там нужны — чтобы знать, к кому обратиться.
   */
  async findPublishers(
    tenantId: string,
    id: string,
    query: QueryPublishersDto,
    user: AuthenticatedUser,
  ) {
    await this.findEntity(tenantId, id);
    const privileged = await this.publishersService.resolvePrivateAccess(
      tenantId,
      user,
    );
    if (!privileged) {
      query.includeRemoved = false;
      const ownGroupId = await this.publishersService.findOwnServiceGroupId(
        tenantId,
        user.id,
      );
      if (ownGroupId !== id) {
        throw new ForbiddenException({
          code: 'OTHER_GROUP',
          message: 'You may only view your own service group',
        });
      }
    }
    const result = await this.publishersService.findAll(tenantId, {
      ...query,
      serviceGroupId: id,
    });
    if (privileged) return result;
    return publicRosterPage(
      result,
      await this.publishersService.overseenServiceGroupIds(tenantId, user.id),
    );
  }

  /** Add (or move) publishers into this group. Tenant- and existence-checked. */
  async addPublishers(
    tenantId: string,
    id: string,
    publisherIds: string[],
  ): Promise<void> {
    await this.findEntity(tenantId, id);
    for (const pid of publisherIds) {
      await this.ensurePublisherInTenant(tenantId, pid);
    }
    await this.publishersService.setServiceGroupBulk(
      tenantId,
      publisherIds,
      id,
    );
  }

  /** Remove one publisher from this group (no-op if they are in another). */
  async removePublisher(
    tenantId: string,
    id: string,
    publisherId: string,
  ): Promise<void> {
    await this.findEntity(tenantId, id);
    await this.publishersService.removeFromGroup(tenantId, publisherId, id);
  }

  /** A group's overseer and assistant are members of the group they lead. */
  private async addLeadersToGroup(
    tenantId: string,
    group: ServiceGroup,
  ): Promise<void> {
    const ids = [group.overseerPublisherId, group.assistantPublisherId].filter(
      (x): x is string => !!x,
    );
    if (ids.length > 0) {
      await this.publishersService.setServiceGroupBulk(tenantId, ids, group.id);
    }
  }

  /**
   * The overseer of a group and his assistant are brothers (23 October 2026).
   * The picker offered the whole roster, sisters included, and the server
   * took whomever it was given; the walk in German and English found a
   * sister offered as «Gruppenverantwortliche».
   */
  private async ensureLeader(
    tenantId: string,
    publisherId: string,
  ): Promise<void> {
    const p = await this.publishersService.findOne(tenantId, publisherId);
    if (p.gender !== Gender.BROTHER) {
      throw new BadRequestException(
        refusal(
          'GROUP_LEADER_SISTER',
          'The group overseer and his assistant are brothers.',
        ),
      );
    }
  }

  private async ensurePublisherInTenant(
    tenantId: string,
    publisherId: string,
  ): Promise<void> {
    await this.publishersService.findOne(tenantId, publisherId);
  }
}
