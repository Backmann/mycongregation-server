import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { Gender } from '../common/enums/gender.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { OverrideStatusDto } from './dto/override-status.dto';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { UsersService } from '../users/users.service';
import { GrantAccessDto } from './dto/grant-access.dto';
import { UpdateAccessDto } from './dto/update-access.dto';

/**
 * Pure status-computation helper, exported for unit testing.
 *
 * Window: last 6 calendar months including the month containing
 * `currentMonth` (so May 2026 covers Dec 2025 → May 2026).
 *
 * A report counts as "served" when servedThisMonth=true OR hoursReported>0.
 * Months are de-duplicated, so multiple rows for the same month count once.
 */
export function computeStatusFromReports(
  reports: {
    reportMonth: string;
    servedThisMonth: boolean | null;
    hoursReported: number | null;
  }[],
  currentMonth: Date,
): PublisherStatus {
  const windowStart = new Date(
    Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 5, 1),
  );
  const windowEnd = new Date(
    Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), 1),
  );

  const servedMonths = new Set<string>();
  for (const r of reports) {
    // r.reportMonth is YYYY-MM-DD; normalise to YYYY-MM-01 UTC.
    const ymd = r.reportMonth.slice(0, 10);
    const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
    if (
      d.getTime() < windowStart.getTime() ||
      d.getTime() > windowEnd.getTime()
    ) {
      continue;
    }
    const served =
      r.servedThisMonth === true ||
      (r.hoursReported !== null && r.hoursReported > 0);
    if (served) servedMonths.add(ymd.slice(0, 7));
  }

  if (servedMonths.size === 0) return PublisherStatus.INACTIVE;
  if (servedMonths.size >= 6) return PublisherStatus.ACTIVE;
  return PublisherStatus.IRREGULAR;
}
import { CreatePublisherDto } from './dto/create-publisher.dto';
import { UpdatePublisherDto } from './dto/update-publisher.dto';
import { QueryPublishersDto } from './dto/query-publishers.dto';
import { RemovePublisherDto } from './dto/remove-publisher.dto';

export type RecomputeResult = 'skipped_override' | 'unchanged' | 'updated';

/**
 * Map a publisher's spiritual appointment to the login role granted with it.
 * Admin is never derived — it is an explicit, separate elevation.
 */
export function deriveRoleFromAppointment(
  appointment: PublisherAppointment,
): UserRole {
  switch (appointment) {
    case PublisherAppointment.ELDER:
      return UserRole.ELDER;
    case PublisherAppointment.MINISTERIAL_SERVANT:
      return UserRole.MINISTERIAL_SERVANT;
    default:
      return UserRole.PUBLISHER;
  }
}

export interface AccessSummary {
  hasAccess: boolean;
  email: string | null;
  role: UserRole | null;
  isActive: boolean | null;
  lastLoginAt: Date | null;
}

@Injectable()
export class PublishersService {
  private readonly logger = new Logger(PublishersService.name);

  constructor(
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(ServiceReport)
    private readonly reportsRepo: Repository<ServiceReport>,
    private readonly auditLogService: AuditLogService,
    private readonly pushNotificationsService: PushNotificationsService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Recompute and persist a publisher's status from the last 6 months of
   * reports. No-op when statusManuallyOverridden=true. Skips the save if
   * the computed status matches the stored value.
   */
  async recomputeStatus(
    tenantId: string,
    publisherId: string,
  ): Promise<RecomputeResult> {
    const publisher = await this.publishersRepo.findOne({
      where: { id: publisherId, congregationId: tenantId },
    });
    if (!publisher) {
      throw new NotFoundException('Publisher not found.');
    }
    if (publisher.statusManuallyOverridden) return 'skipped_override';

    const now = new Date(Date.now());
    const windowStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
    );
    const windowStartStr = `${windowStart.getUTCFullYear()}-${String(
      windowStart.getUTCMonth() + 1,
    ).padStart(2, '0')}-01`;

    const reports = await this.reportsRepo.find({
      where: {
        publisherId,
        congregationId: tenantId,
        reportMonth: MoreThanOrEqual(windowStartStr),
      },
    });

    const newStatus = computeStatusFromReports(reports, now);
    if (publisher.status === newStatus) return 'unchanged';

    const before = { status: publisher.status };
    publisher.status = newStatus;
    await this.publishersRepo.save(publisher);
    // Auto-recompute writes a system-level audit entry (actor=publisher's
    // user if linked, else use a sentinel). For now we log under the
    // publisher's userId if present; otherwise skip the audit row.
    if (publisher.userId) {
      await this.auditLogService.logUpdate({
        tenantId,
        entityType: 'Publisher',
        entityId: publisher.id,
        actorUserId: publisher.userId,
        before,
        after: { status: newStatus },
        fields: ['status'],
      });
    }
    // Fire-and-forget push to admin/elder devices. Best-effort: errors are
    // swallowed so a push failure can never break the status pipeline.
    this.pushNotificationsService
      .sendStatusChange(
        tenantId,
        { id: publisher.id, displayName: publisher.displayName },
        before.status,
        newStatus,
        publisher.userId ?? undefined,
      )
      .catch((err: any) => {
        this.logger.warn(
          `sendStatusChange failed for publisher=${publisher.id}: ${err?.message ?? err}`,
        );
      });
    return 'updated';
  }

  /**
   * Iterate every active publisher across all congregations and recompute
   * status. Used by both the nightly cron and the admin manual trigger.
   * Per-publisher errors are caught and counted — one bad row does not
   * fail the run.
   */
  async recomputeAllStatuses(): Promise<{
    processed: number;
    updated: number;
    unchanged: number;
    skipped: number;
    errors: number;
    durationMs: number;
  }> {
    const startedAt = Date.now();
    const publishers = await this.publishersRepo.find({
      where: { removedAt: IsNull() },
    });

    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let errors = 0;

    for (const p of publishers) {
      try {
        const result = await this.recomputeStatus(p.congregationId, p.id);
        if (result === 'updated') updated++;
        else if (result === 'unchanged') unchanged++;
        else if (result === 'skipped_override') skipped++;
      } catch (err: any) {
        errors++;
        this.logger.warn(
          `recomputeStatus failed for publisher=${p.id} cong=${p.congregationId}: ${err?.message ?? err}`,
        );
      }
    }

    return {
      processed: publishers.length,
      updated,
      unchanged,
      skipped,
      errors,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Manually set a publisher's status (admin/elder only). Sets the sticky
   * statusManuallyOverridden flag so auto-recompute won't undo this.
   */
  async overrideStatus(
    tenantId: string,
    user: AuthenticatedUser,
    publisherId: string,
    dto: OverrideStatusDto,
  ): Promise<Publisher> {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.ELDER) {
      throw new ForbiddenException(
        'Only elders and admins may override publisher status.',
      );
    }
    const publisher = await this.publishersRepo.findOne({
      where: { id: publisherId, congregationId: tenantId },
    });
    if (!publisher) {
      throw new NotFoundException('Publisher not found.');
    }

    const before = {
      status: publisher.status,
      statusManuallyOverridden: publisher.statusManuallyOverridden,
    };

    publisher.status = dto.status;
    publisher.statusManuallyOverridden = true;
    publisher.statusOverriddenById = user.id;
    publisher.statusOverriddenAt = new Date();

    const saved = await this.publishersRepo.save(publisher);

    await this.auditLogService.logUpdate({
      tenantId,
      entityType: 'Publisher',
      entityId: saved.id,
      actorUserId: user.id,
      before,
      after: {
        status: saved.status,
        statusManuallyOverridden: true,
      },
      fields: ['status', 'statusManuallyOverridden'],
    });

    return saved;
  }

  /**
   * Clear a manual override and trigger an immediate recompute from
   * current reports (admin/elder only).
   */
  async clearOverride(
    tenantId: string,
    user: AuthenticatedUser,
    publisherId: string,
  ): Promise<Publisher> {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.ELDER) {
      throw new ForbiddenException(
        'Only elders and admins may clear status overrides.',
      );
    }
    const publisher = await this.publishersRepo.findOne({
      where: { id: publisherId, congregationId: tenantId },
    });
    if (!publisher) {
      throw new NotFoundException('Publisher not found.');
    }

    const before = {
      statusManuallyOverridden: publisher.statusManuallyOverridden,
    };

    publisher.statusManuallyOverridden = false;
    publisher.statusOverriddenById = null;
    publisher.statusOverriddenAt = null;
    await this.publishersRepo.save(publisher);

    await this.auditLogService.logUpdate({
      tenantId,
      entityType: 'Publisher',
      entityId: publisher.id,
      actorUserId: user.id,
      before,
      after: { statusManuallyOverridden: false },
      fields: ['statusManuallyOverridden'],
    });

    // Re-fetch to ensure recompute sees the cleared override flag.
    await this.recomputeStatus(tenantId, publisherId);

    const refreshed = await this.publishersRepo.findOne({
      where: { id: publisherId, congregationId: tenantId },
    });
    return refreshed!;
  }

  async findAll(tenantId: string, query: QueryPublishersDto) {
    const qb = this.publishersRepo
      .createQueryBuilder('publisher')
      .where('publisher.congregation_id = :tenantId', { tenantId });

    if (query.includeRemoved) {
      qb.withDeleted();
    }

    if (query.familyId) {
      qb.andWhere('publisher.family_id = :familyId', {
        familyId: query.familyId,
      });
    }
    if (query.serviceGroupId) {
      qb.andWhere('publisher.service_group_id = :sgId', {
        sgId: query.serviceGroupId,
      });
    }
    if (query.appointment) {
      qb.andWhere('publisher.appointment = :appointment', {
        appointment: query.appointment,
      });
    }
    if (query.pioneerType) {
      qb.andWhere('publisher.pioneer_type = :pioneerType', {
        pioneerType: query.pioneerType,
      });
    }
    if (query.isActive !== undefined) {
      qb.andWhere('publisher.is_active = :isActive', {
        isActive: query.isActive,
      });
    }

    if (query.search) {
      const pattern = `%${query.search}%`;
      qb.andWhere(
        new Brackets((b) => {
          b.where('publisher.first_name ILIKE :pattern', { pattern })
            .orWhere('publisher.last_name ILIKE :pattern', { pattern })
            .orWhere('publisher.middle_name ILIKE :pattern', { pattern })
            .orWhere('publisher.display_name ILIKE :pattern', { pattern });
        }),
      );
    }

    const sortColumn = `publisher.${query.sortBy ?? 'lastName'}`;
    const sortOrder = (query.sortOrder ?? 'asc').toUpperCase() as
      | 'ASC'
      | 'DESC';
    qb.orderBy(sortColumn, sortOrder);

    qb.take(query.limit ?? 50);
    qb.skip(query.offset ?? 0);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    };
  }

  async findOne(tenantId: string, id: string): Promise<Publisher> {
    const publisher = await this.publishersRepo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (!publisher) {
      throw new NotFoundException('Publisher not found');
    }
    return publisher;
  }

  // ---------------------------------------------------------------------------
  // App access — link a person (Publisher) to a login (User).
  // ---------------------------------------------------------------------------

  async getAccess(tenantId: string, id: string): Promise<AccessSummary> {
    const publisher = await this.findOne(tenantId, id);
    if (!publisher.userId) {
      return {
        hasAccess: false,
        email: null,
        role: null,
        isActive: null,
        lastLoginAt: null,
      };
    }
    const user = await this.usersService.findByIdInCongregation(
      publisher.userId,
      tenantId,
    );
    return {
      hasAccess: true,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
    };
  }

  async grantAccess(
    tenantId: string,
    id: string,
    dto: GrantAccessDto,
    actor: AuthenticatedUser,
  ): Promise<AccessSummary> {
    const publisher = await this.findOne(tenantId, id);
    if (publisher.userId) {
      throw new ConflictException('This person already has app access');
    }
    const email = (dto.email ?? publisher.email ?? '').trim();
    if (!email) {
      throw new BadRequestException(
        'An email address is required to grant access',
      );
    }
    const role = dto.isAdmin
      ? UserRole.ADMIN
      : deriveRoleFromAppointment(publisher.appointment);
    const created = await this.usersService.createUserByAdmin(
      { email, password: dto.password, role },
      tenantId,
      actor.id,
    );
    publisher.userId = created.id;
    await this.publishersRepo.save(publisher);
    return this.getAccess(tenantId, id);
  }

  async updateAccess(
    tenantId: string,
    id: string,
    dto: UpdateAccessDto,
    actor: AuthenticatedUser,
  ): Promise<AccessSummary> {
    const publisher = await this.findOne(tenantId, id);
    if (!publisher.userId) {
      throw new NotFoundException('This person has no app access');
    }
    if (dto.password !== undefined) {
      await this.usersService.resetPasswordByAdmin(
        publisher.userId,
        dto.password,
        tenantId,
        actor.id,
      );
    }
    if (dto.isActive !== undefined) {
      await this.usersService.setActiveByAdmin(
        publisher.userId,
        dto.isActive,
        tenantId,
        actor.id,
      );
    }
    if (dto.isAdmin !== undefined) {
      const role = dto.isAdmin
        ? UserRole.ADMIN
        : deriveRoleFromAppointment(publisher.appointment);
      await this.usersService.updateRoleByAdmin(
        publisher.userId,
        role,
        tenantId,
        actor.id,
      );
    }
    return this.getAccess(tenantId, id);
  }

  async create(tenantId: string, dto: CreatePublisherDto): Promise<Publisher> {
    const displayName = this.buildDisplayName(
      dto.firstName,
      dto.middleName ?? null,
      dto.lastName,
    );
    const capabilities = {
      ...(dto.gender === Gender.SISTER ? { hospitality: true } : {}),
      ...(dto.capabilities ?? {}),
    };
    const publisher = this.publishersRepo.create({
      ...dto,
      congregationId: tenantId,
      displayName,
      capabilities,
    });
    return this.publishersRepo.save(publisher);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdatePublisherDto,
    actorUserId?: string,
  ): Promise<Publisher> {
    const publisher = await this.findOne(tenantId, id);
    Object.assign(publisher, dto);

    if (
      dto.firstName !== undefined ||
      dto.middleName !== undefined ||
      dto.lastName !== undefined
    ) {
      publisher.displayName = this.buildDisplayName(
        publisher.firstName,
        publisher.middleName,
        publisher.lastName,
      );
    }

    // Keep a linked login's role in sync with the person's appointment.
    if (dto.appointment !== undefined && publisher.userId) {
      await this.usersService.syncRoleFromAppointment(
        publisher.userId,
        deriveRoleFromAppointment(publisher.appointment),
        tenantId,
        actorUserId,
      );
    }

    return this.publishersRepo.save(publisher);
  }

  /**
   * Bulk-assign publishers to a service group (membership). One group per
   * publisher, so this moves them out of any previous group. Tenant-scoped.
   */
  async setServiceGroupBulk(
    tenantId: string,
    publisherIds: string[],
    serviceGroupId: string,
  ): Promise<void> {
    if (publisherIds.length === 0) return;
    await this.publishersRepo.update(
      { id: In(publisherIds), congregationId: tenantId },
      { serviceGroupId },
    );
  }

  /** Remove a publisher from a group, but only if currently in that group. */
  async removeFromGroup(
    tenantId: string,
    publisherId: string,
    serviceGroupId: string,
  ): Promise<void> {
    await this.publishersRepo.update(
      { id: publisherId, congregationId: tenantId, serviceGroupId },
      { serviceGroupId: null },
    );
  }

  async remove(
    tenantId: string,
    id: string,
    dto: RemovePublisherDto,
  ): Promise<Publisher> {
    const publisher = await this.findOne(tenantId, id);
    if (publisher.deletedAt) {
      throw new BadRequestException('Publisher already removed');
    }
    publisher.removalReason = dto.reason;
    publisher.removedNote = dto.note ?? null;
    publisher.removedAt = dto.date ? new Date(dto.date) : new Date();
    publisher.restoredAt = null;
    publisher.isActive = false;
    await this.publishersRepo.save(publisher);
    await this.publishersRepo.softDelete(id);
    return this.findOne(tenantId, id);
  }

  /**
   * Permanently delete a publisher row (hard delete). Refuses if the publisher
   * has any history (service reports, program assignments, duties or
   * field-service conductor roles) so that history is never silently broken;
   * such publishers must be marked departed via remove() instead. Intended for
   * clean-up of mistaken / duplicate records only. Admin-gated in the controller.
   */
  async purge(tenantId: string, id: string): Promise<{ deleted: true }> {
    await this.findOne(tenantId, id);
    const mgr = this.publishersRepo.manager;
    const [reports, asPub, asAsst, duties, fsm] = await Promise.all([
      this.reportsRepo.count({ where: { publisherId: id } }),
      mgr.getRepository(Assignment).count({ where: { publisherId: id } }),
      mgr
        .getRepository(Assignment)
        .count({ where: { assistantPublisherId: id } }),
      mgr.getRepository(Duty).count({ where: { publisherId: id } }),
      mgr
        .getRepository(FieldServiceMeeting)
        .count({ where: { conductorPublisherId: id } }),
    ]);
    if (reports + asPub + asAsst + duties + fsm > 0) {
      throw new BadRequestException('publisher_has_history');
    }
    await this.publishersRepo.delete({ id, congregationId: tenantId });
    return { deleted: true };
  }

  async restore(tenantId: string, id: string): Promise<Publisher> {
    const publisher = await this.findOne(tenantId, id);
    if (!publisher.deletedAt) {
      throw new BadRequestException('Publisher is not removed');
    }
    await this.publishersRepo.restore(id);
    publisher.restoredAt = new Date();
    publisher.isActive = true;
    publisher.deletedAt = null;
    await this.publishersRepo.save(publisher);
    return this.findOne(tenantId, id);
  }

  /**
   * Russian-style "Фамилия Имя Отчество". Override per-locale later if needed.
   */
  private buildDisplayName(
    firstName: string,
    middleName: string | null,
    lastName: string,
  ): string {
    return [lastName, firstName, middleName].filter(Boolean).join(' ');
  }
}
