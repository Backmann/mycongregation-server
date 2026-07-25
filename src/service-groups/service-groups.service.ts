import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Brackets, Repository } from 'typeorm';
import { ServiceGroup } from '../entities/service-group.entity';
import { Publisher } from '../entities/publisher.entity';
import { CreateServiceGroupDto } from './dto/create-service-group.dto';
import { UpdateServiceGroupDto } from './dto/update-service-group.dto';
import { QueryServiceGroupsDto } from './dto/query-service-groups.dto';
import { PublishersService } from '../publishers/publishers.service';
import { QueryPublishersDto } from '../publishers/dto/query-publishers.dto';
import {
  publicRosterView,
  redactPrivateFields,
} from '../publishers/publisher-privacy';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

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
  ) {}

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
    return this.findAll(tenantId, query, privileged);
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
    return this.findOne(tenantId, id, privileged);
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
      await this.ensurePublisherInTenant(tenantId, dto.overseerPublisherId);
    }
    if (dto.assistantPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.assistantPublisherId);
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
    if (dto.overseerPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.overseerPublisherId);
    }
    if (dto.assistantPublisherId) {
      await this.ensurePublisherInTenant(tenantId, dto.assistantPublisherId);
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
      throw new BadRequestException('Service group already removed');
    }
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'service_group',
      entityId: id,
      action: 'DELETE',
      detail: { name: group.name },
    });
    await this.serviceGroupsRepo.softDelete(id);
  }

  async restore(
    tenantId: string,
    id: string,
  ): Promise<ServiceGroupWithLeaders> {
    const group = await this.findEntity(tenantId, id);
    if (!group.deletedAt) {
      throw new BadRequestException('Service group is not removed');
    }
    await this.serviceGroupsRepo.restore(id);
    return this.findOne(tenantId, id);
  }

  /**
   * Group member list. Privileged callers (admins, elders, members granted
   * private-data access) get the full rows; a regular publisher may load ONLY
   * every group, redacted to a name-and-scheduling roster: who serves with
   * whom is what the composition is for, and the names are on the posted
   * schedules anyway. What stays shut is the personal data — phones,
   * addresses, notes and the rest of the card — which is what the earlier
   * own-group-only rule was really protecting.
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
    }
    const result = await this.publishersService.findAll(tenantId, {
      ...query,
      serviceGroupId: id,
    });
    if (privileged) return result;
    // Students are not publishers and do not belong in a group's composition
    // as the congregation reads it; the elders who look after them still see
    // them here. The total is adjusted so the count matches the list shown.
    const visible = result.data.filter(
      (p) => p.appointment !== PublisherAppointment.STUDENT,
    );
    return {
      ...result,
      total: result.total - (result.data.length - visible.length),
      data: visible.map(publicRosterView),
    };
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

  private async ensurePublisherInTenant(
    tenantId: string,
    publisherId: string,
  ): Promise<void> {
    await this.publishersService.findOne(tenantId, publisherId);
  }
}
