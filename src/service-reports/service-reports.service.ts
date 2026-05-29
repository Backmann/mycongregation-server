import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PublishersService } from '../publishers/publishers.service';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { SubmitReportDto } from './dto/submit-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';

export interface GroupReportsResponse {
  reportMonth: string;
  scopeLabel: string;
  publishers: GroupReportRow[];
}

export interface GroupReportRow {
  publisherId: string;
  displayName: string;
  isPioneer: boolean;
  report:
    | (ServiceReport & { canEdit: boolean; lastEditedByName: string | null })
    | null;
}

export interface PublisherHistoryEntry {
  reportMonth: string;
  report:
    | (ServiceReport & { canEdit: boolean; lastEditedByName: string | null })
    | null;
}

export interface PublisherHistoryResponse {
  publisher: {
    id: string;
    displayName: string;
    status: PublisherStatus;
    statusManuallyOverridden: boolean;
    isPioneer: boolean;
  };
  timeline: PublisherHistoryEntry[];
}

/**
 * Caller's report permissions, resolved once per request.
 *
 * - alwaysEdit  — admin or the secretary: may edit/submit any report in any
 *   month, regardless of the self-edit window.
 * - alwaysView  — admin, elder, or the secretary: may view every report in
 *   the congregation.
 * - myPublisherId — the caller's linked publisher (own-report checks).
 * - overseenGroupIds — service groups the caller oversees; lets the overseer
 *   submit/edit reports for those groups within the self-edit window.
 */
interface ReportPermissionContext {
  userId: string;
  alwaysEdit: boolean;
  alwaysView: boolean;
  myPublisherId: string | null;
  overseenGroupIds: string[];
}

@Injectable()
export class ServiceReportsService {
  constructor(
    @InjectRepository(ServiceReport)
    private readonly reportsRepo: Repository<ServiceReport>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(ServiceGroup)
    private readonly serviceGroupsRepo: Repository<ServiceGroup>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    private readonly auditLogService: AuditLogService,
    private readonly publishersService: PublishersService,
  ) {}

  /**
   * Submit a monthly service report.
   *
   * Two modes (driven by `dto.publisherId`):
   * - Self-submission (default): the authenticated user's publisher.
   * - On-behalf submission: the report is for the publisher identified by
   *   `dto.publisherId`. Allowed for admins, the secretary, and the
   *   overseer of that publisher's service group. `submittedById` remains
   *   the caller's user id and `submittedOnBehalfOf` is set to true.
   *
   * Form variant (regular vs pioneer) is determined by the TARGET
   * publisher's pioneerType, not the caller's. One report per publisher
   * per month is still enforced by the UNIQUE constraint.
   */
  async submitOwnReport(
    tenantId: string,
    user: AuthenticatedUser,
    dto: SubmitReportDto,
  ): Promise<ServiceReport> {
    const { publisher, onBehalf } = await this.resolveSubmitTarget(
      tenantId,
      user,
      dto.publisherId,
    );
    const reportMonth = this.normalizeReportMonth(dto.reportMonth);
    const isPioneer = publisher.pioneerType !== PioneerType.NONE;

    this.validateFormVariant(dto, isPioneer);

    const report = this.reportsRepo.create({
      congregationId: tenantId,
      publisherId: publisher.id,
      reportMonth,
      servedThisMonth: isPioneer ? null : dto.servedThisMonth!,
      hoursReported: isPioneer ? dto.hoursReported! : null,
      bibleStudies: dto.bibleStudies,
      notes: dto.notes ?? null,
      submittedAt: new Date(),
      submittedById: user.id,
      submittedOnBehalfOf: onBehalf,
    });

    let saved: ServiceReport;
    try {
      saved = await this.reportsRepo.save(report);
    } catch (err: any) {
      // PostgreSQL unique_violation
      if (err?.code === '23505') {
        throw new ConflictException(
          `A report for ${reportMonth} has already been submitted.`,
        );
      }
      throw err;
    }
    // Recompute target publisher's status (no-op if manually overridden).
    await this.publishersService.recomputeStatus(tenantId, publisher.id);
    return saved;
  }

  /**
   * Resolve which publisher the report is for plus whether the submission
   * is on-behalf:
   * - No `dtoPublisherId`: caller's own publisher (self).
   * - `dtoPublisherId === caller's own publisher.id`: explicit self.
   * - `dtoPublisherId` of someone else: allowed only for admins, the
   *   secretary, or the overseer of the target's service group; otherwise
   *   ForbiddenException. Target must exist within the same congregation.
   */
  private async resolveSubmitTarget(
    tenantId: string,
    user: AuthenticatedUser,
    dtoPublisherId: string | undefined,
  ): Promise<{ publisher: Publisher; onBehalf: boolean }> {
    if (!dtoPublisherId) {
      const publisher = await this.resolveUserPublisher(tenantId, user.id);
      return { publisher, onBehalf: false };
    }

    const myPublisher = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId: user.id },
    });

    if (myPublisher && myPublisher.id === dtoPublisherId) {
      return { publisher: myPublisher, onBehalf: false };
    }

    const target = await this.publishersRepo.findOne({
      where: { id: dtoPublisherId, congregationId: tenantId },
    });
    if (!target) {
      throw new BadRequestException(
        'Target publisher not found in this congregation.',
      );
    }

    // On-behalf permission: admin or secretary (any group), or the overseer
    // of the target publisher's service group.
    let allowed =
      user.role === UserRole.ADMIN ||
      (await this.holdsSecretary(tenantId, user.id));
    if (!allowed && myPublisher && target.serviceGroupId) {
      const overseen = await this.overseenGroupIds(tenantId, myPublisher.id);
      allowed = overseen.includes(target.serviceGroupId);
    }
    if (!allowed) {
      throw new ForbiddenException(
        'Only an admin, the secretary, or the publisher\u2019s service group ' +
          'overseer may submit a report on their behalf.',
      );
    }

    return { publisher: target, onBehalf: true };
  }

  /**
   * Return the authenticated user's own service report history,
   * most recent month first. Each report carries a computed `canEdit`
   * boolean indicating whether the current user may PATCH it now.
   * Optional ?year filter.
   */
  async findMyReports(
    tenantId: string,
    user: AuthenticatedUser,
    year?: number,
  ): Promise<
    (ServiceReport & { canEdit: boolean; lastEditedByName: string | null })[]
  > {
    const publisher = await this.resolveUserPublisher(tenantId, user.id);
    const ctx = await this.buildPermissionContext(tenantId, user);

    const qb = this.reportsRepo
      .createQueryBuilder('report')
      .where('report.congregation_id = :tenantId', { tenantId })
      .andWhere('report.publisher_id = :publisherId', {
        publisherId: publisher.id,
      })
      .orderBy('report.report_month', 'DESC');

    if (year !== undefined) {
      qb.andWhere('EXTRACT(YEAR FROM report.report_month) = :year', { year });
    }

    const reports = await qb.getMany();
    const groupId = publisher.serviceGroupId ?? null;
    reports.forEach((r) => this.setCanEdit(r, ctx, groupId));
    await this.enrichEditorNames(reports);
    return reports as (ServiceReport & {
      canEdit: boolean;
      lastEditedByName: string | null;
    })[];
  }

  /**
   * Fetch a single service report by id, with a computed `canEdit`.
   * Read permission: own report, an admin/elder/secretary, or the overseer
   * of the report publisher's service group.
   */
  async findOne(
    tenantId: string,
    user: AuthenticatedUser,
    reportId: string,
  ): Promise<
    ServiceReport & { canEdit: boolean; lastEditedByName: string | null }
  > {
    const report = await this.reportsRepo.findOne({
      where: { id: reportId, congregationId: tenantId },
    });
    if (!report) {
      throw new NotFoundException('Service report not found.');
    }

    const ctx = await this.buildPermissionContext(tenantId, user);
    const publisher = await this.publishersRepo.findOne({
      where: { id: report.publisherId },
    });
    const groupId = publisher?.serviceGroupId ?? null;

    const isOwnReport = report.submittedById === user.id;
    const isOverseer =
      groupId !== null && ctx.overseenGroupIds.includes(groupId);
    if (!ctx.alwaysView && !isOwnReport && !isOverseer) {
      throw new ForbiddenException('You may only view your own reports.');
    }

    this.setCanEdit(report, ctx, groupId);
    await this.enrichEditorNames([report]);
    return report as ServiceReport & {
      canEdit: boolean;
      lastEditedByName: string | null;
    };
  }

  /**
   * Update an existing service report.
   *
   * Permission rules:
   * - Admins and the secretary may edit any report at any time.
   * - The original submitter may self-edit during the self-edit window
   *   (1st-10th of the month following `reportMonth`, Europe/Berlin).
   * - The overseer of the report publisher's service group may edit it
   *   within the same window.
   * - Everyone else (including elders) is denied — elders view only.
   *
   * `reportMonth`, `publisherId`, and submission metadata are immutable.
   * `lastEditedAt` and `lastEditedById` are stamped on success.
   * Form-variant rules (servedThisMonth vs hoursReported) are enforced.
   */
  async updateReport(
    tenantId: string,
    user: AuthenticatedUser,
    reportId: string,
    dto: UpdateReportDto,
  ): Promise<
    ServiceReport & { canEdit: boolean; lastEditedByName: string | null }
  > {
    const report = await this.reportsRepo.findOne({
      where: { id: reportId, congregationId: tenantId },
    });
    if (!report) {
      throw new NotFoundException('Service report not found.');
    }

    const ctx = await this.buildPermissionContext(tenantId, user);
    const publisher = await this.publishersRepo.findOne({
      where: { id: report.publisherId },
    });
    const groupId = publisher?.serviceGroupId ?? null;

    if (!this.canEditWithCtx(report, ctx, groupId)) {
      const isOwnReport = report.submittedById === user.id;
      if (isOwnReport) {
        throw new ForbiddenException(
          'Self-edit window has closed. The window is the 1st-10th of the ' +
            'month following the report month (Europe/Berlin). Contact the ' +
            'secretary to request changes.',
        );
      }
      throw new ForbiddenException(
        'You are not allowed to edit this report. Contact the secretary or ' +
          'an admin.',
      );
    }

    if (!publisher) {
      // Defensive — FK guarantees existence.
      throw new BadRequestException('Publisher record not found.');
    }
    const isPioneer = publisher.pioneerType !== PioneerType.NONE;

    this.validateUpdateFormVariant(dto, isPioneer);

    const before = {
      servedThisMonth: report.servedThisMonth,
      hoursReported: report.hoursReported,
      bibleStudies: report.bibleStudies,
      notes: report.notes,
    };

    if (dto.servedThisMonth !== undefined) {
      report.servedThisMonth = dto.servedThisMonth;
    }
    if (dto.hoursReported !== undefined) {
      report.hoursReported = dto.hoursReported;
    }
    if (dto.bibleStudies !== undefined) {
      report.bibleStudies = dto.bibleStudies;
    }
    if (dto.notes !== undefined) {
      report.notes = dto.notes;
    }

    report.lastEditedAt = new Date();
    report.lastEditedById = user.id;

    const saved = await this.reportsRepo.save(report);
    await this.auditLogService.logUpdate({
      tenantId,
      entityType: 'ServiceReport',
      entityId: saved.id,
      actorUserId: user.id,
      before,
      after: {
        servedThisMonth: saved.servedThisMonth,
        hoursReported: saved.hoursReported,
        bibleStudies: saved.bibleStudies,
        notes: saved.notes,
      },
      fields: ['servedThisMonth', 'hoursReported', 'bibleStudies', 'notes'],
    });
    // Recompute target publisher's status (no-op if manually overridden).
    await this.publishersService.recomputeStatus(tenantId, report.publisherId);
    this.setCanEdit(saved, ctx, groupId);
    await this.enrichEditorNames([saved]);
    return saved as ServiceReport & {
      canEdit: boolean;
      lastEditedByName: string | null;
    };
  }

  /**
   * Group-level pastoral view: for one month, lists every publisher in
   * the caller's scope and their report (if submitted) or `null`.
   *
   * Scope rules:
   * - Admin, elder, or secretary → all publishers in the congregation.
   * - Publisher who oversees one or more service groups → publishers in
   *   those groups.
   * - Otherwise → ForbiddenException.
   *
   * Each report includes `canEdit` and `lastEditedByName` (same as
   * other endpoints).
   */
  async findGroupReports(
    tenantId: string,
    user: AuthenticatedUser,
    reportMonthInput: string,
  ): Promise<GroupReportsResponse> {
    const normalizedMonth = this.normalizeReportMonth(reportMonthInput);
    const ctx = await this.buildPermissionContext(tenantId, user);

    let publisherScope: Publisher[];
    let scopeLabel: string;

    if (ctx.alwaysView) {
      publisherScope = await this.publishersRepo.find({
        where: { congregationId: tenantId },
        order: { lastName: 'ASC', firstName: 'ASC' },
      });
      scopeLabel = 'Congregation';
    } else {
      // Caller must be the overseer of at least one service group.
      if (ctx.myPublisherId === null || ctx.overseenGroupIds.length === 0) {
        throw new ForbiddenException(
          'You are not authorized to view group reports. Group reports are ' +
            'visible to elders, admins, the secretary, and service group ' +
            'overseers.',
        );
      }

      const overseerGroups = await this.serviceGroupsRepo.find({
        where: {
          congregationId: tenantId,
          id: In(ctx.overseenGroupIds),
        },
      });
      publisherScope = await this.publishersRepo.find({
        where: {
          congregationId: tenantId,
          serviceGroupId: In(ctx.overseenGroupIds),
        },
        order: { lastName: 'ASC', firstName: 'ASC' },
      });
      scopeLabel = overseerGroups.map((g) => g.name).join(', ');
    }

    const groupByPubId = new Map(
      publisherScope.map((p) => [p.id, p.serviceGroupId ?? null]),
    );

    const publisherIds = publisherScope.map((p) => p.id);
    const reports =
      publisherIds.length === 0
        ? []
        : await this.reportsRepo.find({
            where: {
              congregationId: tenantId,
              publisherId: In(publisherIds),
              reportMonth: normalizedMonth,
            },
          });

    reports.forEach((r) =>
      this.setCanEdit(r, ctx, groupByPubId.get(r.publisherId) ?? null),
    );
    await this.enrichEditorNames(reports);

    const reportByPubId = new Map(reports.map((r) => [r.publisherId, r]));

    return {
      reportMonth: normalizedMonth,
      scopeLabel,
      publishers: publisherScope.map((p) => ({
        publisherId: p.id,
        displayName: p.displayName,
        isPioneer: p.pioneerType !== PioneerType.NONE,
        report:
          (reportByPubId.get(p.id) as
            | (ServiceReport & {
                canEdit: boolean;
                lastEditedByName: string | null;
              })
            | undefined) ?? null,
      })),
    };
  }

  /**
   * Per-publisher history view — returns the last N months as a dense
   * timeline (null entries for months with no report). Admin/elder/secretary
   * may view any publisher; the overseer of the publisher's group may view
   * their members; regular publishers may only view their own record.
   */
  async findHistoryForPublisher(
    tenantId: string,
    user: AuthenticatedUser,
    publisherId: string,
    months: number,
  ): Promise<PublisherHistoryResponse> {
    const publisher = await this.publishersRepo.findOne({
      where: { id: publisherId, congregationId: tenantId },
    });
    if (!publisher) {
      throw new NotFoundException('Publisher not found.');
    }

    const ctx = await this.buildPermissionContext(tenantId, user);
    const groupId = publisher.serviceGroupId ?? null;
    const isOwner = publisher.userId === user.id;
    const isOverseer =
      groupId !== null && ctx.overseenGroupIds.includes(groupId);
    if (!ctx.alwaysView && !isOwner && !isOverseer) {
      throw new ForbiddenException(
        'You may only view your own report history.',
      );
    }

    const now = new Date();
    const windowStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
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
      order: { reportMonth: 'DESC' },
    });

    await this.enrichEditorNames(reports);

    type EnrichedReport = ServiceReport & {
      canEdit: boolean;
      lastEditedByName: string | null;
    };

    for (const r of reports) {
      this.setCanEdit(r, ctx, groupId);
    }

    const timeline: PublisherHistoryEntry[] = [];
    for (let i = 0; i < months; i++) {
      const m = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
      );
      const mStr = `${m.getUTCFullYear()}-${String(
        m.getUTCMonth() + 1,
      ).padStart(2, '0')}-01`;
      const found = reports.find(
        (r) => String(r.reportMonth).slice(0, 7) === mStr.slice(0, 7),
      );
      timeline.push({
        reportMonth: mStr,
        report: (found as EnrichedReport) ?? null,
      });
    }

    return {
      publisher: {
        id: publisher.id,
        displayName: publisher.displayName,
        status: publisher.status,
        statusManuallyOverridden: publisher.statusManuallyOverridden,
        isPioneer: publisher.pioneerType !== PioneerType.NONE,
      },
      timeline,
    };
  }

  /**
   * Resolve the caller's report permissions once per request.
   */
  private async buildPermissionContext(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<ReportPermissionContext> {
    const isAdmin = user.role === UserRole.ADMIN;
    const isElder = user.role === UserRole.ELDER;
    const secretary = isAdmin
      ? false
      : await this.holdsSecretary(tenantId, user.id);

    const myPublisher = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId: user.id },
    });
    const myPublisherId = myPublisher?.id ?? null;
    const overseenGroupIds = myPublisherId
      ? await this.overseenGroupIds(tenantId, myPublisherId)
      : [];

    return {
      userId: user.id,
      alwaysEdit: isAdmin || secretary,
      alwaysView: isAdmin || isElder || secretary,
      myPublisherId,
      overseenGroupIds,
    };
  }

  /** Whether the user holds the SECRETARY responsibility in this tenant. */
  private async holdsSecretary(
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const count = await this.responsibilitiesRepo.count({
      where: {
        congregationId: tenantId,
        userId,
        type: ResponsibilityType.SECRETARY,
      },
    });
    return count > 0;
  }

  /** Ids of the service groups overseen by the given publisher. */
  private async overseenGroupIds(
    tenantId: string,
    publisherId: string,
  ): Promise<string[]> {
    const groups = await this.serviceGroupsRepo.find({
      where: { congregationId: tenantId, overseerPublisherId: publisherId },
    });
    return groups.map((g) => g.id);
  }

  /**
   * Whether `user` (with a resolved permission context) may currently edit
   * `report`. `publisherGroupId` is the service group of the report's
   * publisher (null if none / unknown).
   *
   * Single source of truth for the canEdit boolean returned in API
   * responses AND the guard inside updateReport.
   */
  private canEditWithCtx(
    report: ServiceReport,
    ctx: ReportPermissionContext,
    publisherGroupId: string | null,
  ): boolean {
    if (ctx.alwaysEdit) return true;
    if (!this.isInSelfEditWindow(report.reportMonth)) return false;
    if (report.submittedById === ctx.userId) return true;
    if (
      publisherGroupId !== null &&
      ctx.overseenGroupIds.includes(publisherGroupId)
    ) {
      return true;
    }
    return false;
  }

  /** Attach a computed `canEdit` field to a report for API responses. */
  private setCanEdit(
    report: ServiceReport,
    ctx: ReportPermissionContext,
    publisherGroupId: string | null,
  ): void {
    (report as ServiceReport & { canEdit: boolean }).canEdit =
      this.canEditWithCtx(report, ctx, publisherGroupId);
  }

  /**
   * True if the current moment is within the self-edit window for
   * `reportMonth`.
   *
   * Window: through the 10th (inclusive) of the month following
   * reportMonth, evaluated in the congregation timezone (Europe/Berlin).
   * Closes at 00:00 Europe/Berlin on the 11th. Comparing calendar dates in
   * Berlin keeps the boundary correct across the summer-time change.
   *
   * Example: an April 2026 report (`reportMonth = "2026-04-01"`) is
   * self-editable through 2026-05-10 (Berlin); it closes at the start of
   * 2026-05-11 (Berlin).
   */
  private isInSelfEditWindow(reportMonth: string): boolean {
    const [yearStr, monthStr] = reportMonth.slice(0, 7).split('-');
    let ny = parseInt(yearStr, 10);
    let nm = parseInt(monthStr, 10) + 1; // month following the report month
    if (nm === 13) {
      nm = 1;
      ny += 1;
    }

    // Current calendar date in the congregation timezone, as YYYY-MM-DD so
    // the day boundary is unambiguous regardless of DST.
    const berlin = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now()));
    const [byStr, bmStr, bdStr] = berlin.split('-');
    const by = parseInt(byStr, 10);
    const bm = parseInt(bmStr, 10);
    const bd = parseInt(bdStr, 10);

    // Open while "now" (Berlin) is on or before the 10th of the month
    // following the report month.
    if (by !== ny) return by < ny;
    if (bm !== nm) return bm < nm;
    return bd <= 10;
  }

  /** Enforce form-variant rules on an update. */
  private validateUpdateFormVariant(
    dto: UpdateReportDto,
    isPioneer: boolean,
  ): void {
    if (isPioneer && dto.servedThisMonth !== undefined) {
      throw new BadRequestException(
        'servedThisMonth must not be provided for pioneers.',
      );
    }
    if (!isPioneer && dto.hoursReported !== undefined) {
      throw new BadRequestException(
        'hoursReported must not be provided for regular publishers.',
      );
    }
    if (
      dto.servedThisMonth === undefined &&
      dto.hoursReported === undefined &&
      dto.bibleStudies === undefined &&
      dto.notes === undefined
    ) {
      throw new BadRequestException(
        'At least one field must be provided to update.',
      );
    }
  }

  /**
   * Populate `lastEditedByName` on each report by looking up the editor's
   * publisher record in a single batch query. Mutates the array in place.
   *
   * Reports without `lastEditedById`, or whose editor has no linked
   * publisher record in this congregation, get `lastEditedByName: null`.
   */
  private async enrichEditorNames(reports: ServiceReport[]): Promise<void> {
    const editorIds = [
      ...new Set(
        reports
          .map((r) => r.lastEditedById)
          .filter((id): id is string => id !== null && id !== undefined),
      ),
    ];

    let nameByUserId: Map<string, string>;
    if (editorIds.length === 0) {
      nameByUserId = new Map();
    } else {
      const publishers = await this.publishersRepo.find({
        where: { userId: In(editorIds) },
      });
      nameByUserId = new Map(
        publishers
          .filter((p): p is Publisher & { userId: string } => p.userId !== null)
          .map((p) => [p.userId, p.displayName]),
      );
    }

    for (const r of reports) {
      (
        r as ServiceReport & {
          lastEditedByName: string | null;
        }
      ).lastEditedByName = r.lastEditedById
        ? (nameByUserId.get(r.lastEditedById) ?? null)
        : null;
    }
  }

  /** Look up the Publisher linked to the authenticated user. */
  private async resolveUserPublisher(
    tenantId: string,
    userId: string,
  ): Promise<Publisher> {
    const publisher = await this.publishersRepo.findOne({
      where: {
        congregationId: tenantId,
        userId,
      },
    });

    if (!publisher) {
      throw new BadRequestException(
        'You are not registered as a publisher in this congregation.',
      );
    }

    return publisher;
  }

  /** Truncate "YYYY-MM" or "YYYY-MM-DD" to "YYYY-MM-01". */
  private normalizeReportMonth(input: string): string {
    const yearMonth = input.slice(0, 7);
    return `${yearMonth}-01`;
  }

  /** Enforce form-variant rules based on publisher type. */
  private validateFormVariant(dto: SubmitReportDto, isPioneer: boolean): void {
    if (isPioneer) {
      if (dto.hoursReported === undefined) {
        throw new BadRequestException(
          'hoursReported is required for pioneers.',
        );
      }
      if (dto.servedThisMonth !== undefined) {
        throw new BadRequestException(
          'servedThisMonth must not be provided for pioneers; report hours instead.',
        );
      }
    } else {
      if (dto.servedThisMonth === undefined) {
        throw new BadRequestException(
          'servedThisMonth is required for regular publishers.',
        );
      }
      if (dto.hoursReported !== undefined) {
        throw new BadRequestException(
          'hoursReported must not be provided for regular publishers.',
        );
      }
    }
  }
}
