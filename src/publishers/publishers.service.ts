import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { OverrideStatusDto } from './dto/override-status.dto';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

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
    if (d.getTime() < windowStart.getTime() || d.getTime() > windowEnd.getTime()) {
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
    const sortOrder = (query.sortOrder ?? 'asc').toUpperCase() as 'ASC' | 'DESC';
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

  async create(
    tenantId: string,
    dto: CreatePublisherDto,
  ): Promise<Publisher> {
    const displayName = this.buildDisplayName(
      dto.firstName,
      dto.middleName ?? null,
      dto.lastName,
    );
    const publisher = this.publishersRepo.create({
      ...dto,
      congregationId: tenantId,
      displayName,
    });
    return this.publishersRepo.save(publisher);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdatePublisherDto,
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

    return this.publishersRepo.save(publisher);
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
    publisher.removedAt = new Date();
    publisher.restoredAt = null;
    publisher.isActive = false;
    await this.publishersRepo.save(publisher);
    await this.publishersRepo.softDelete(id);
    return this.findOne(tenantId, id);
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
