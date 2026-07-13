import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ReportMonthClosure } from '../entities/report-month-closure.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PublishersService } from '../publishers/publishers.service';
import { AuxiliaryPioneersService } from '../auxiliary-pioneers/auxiliary-pioneers.service';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { Gender } from '../common/enums/gender.enum';
import { SpiritualStatus } from '../common/enums/spiritual-status.enum';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { SubmitReportDto } from './dto/submit-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';

export interface GroupReportsResponse {
  reportMonth: string;
  scopeLabel: string;
  closed: boolean;
  /** The caller's own service group id (so the client can expand it). */
  myGroupId: string | null;
  publishers: GroupReportRow[];
}

export interface GroupReportRow {
  publisherId: string;
  displayName: string;
  groupId: string | null;
  groupName: string | null;
  isPioneer: boolean;
  /** Months in a row without a report, counting back from the selected month. */
  consecutiveMissing: number;
  report:
    | (ServiceReport & { canEdit: boolean; lastEditedByName: string | null })
    | null;
  canManage: boolean;
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
    status: PublisherStatus | null;
    statusManuallyOverridden: boolean;
    isPioneer: boolean;
  };
  timeline: PublisherHistoryEntry[];
}

/**
 * One pioneer-type line of the secretary's monthly summary.
 *
 * - `count`     — number of reports counted for this category in the month.
 *   For ordinary publishers (`PioneerType.NONE`) this counts only those who
 *   marked that they shared in the ministry (`servedThisMonth === true`).
 *   For every pioneer type it counts each submitted report.
 * - `hours`     — sum of reported hours; `null` for ordinary publishers, who
 *   no longer report hours.
 * - `bibleStudies` — sum of Bible studies across the counted reports.
 */
export interface ServiceReportSummaryCategory {
  pioneerType: PioneerType;
  count: number;
  hours: number | null;
  bibleStudies: number;
}

/**
 * Aggregated field-service figures for one month, for the secretary/admin.
 *
 * `categories` is always five fixed lines in reporting order (publishers,
 * auxiliary, regular, special, missionary). `totalActivePublishers` counts
 * everyone whose service status is active or irregular (i.e. not lapsed for
 * six months) — independent of whether they reported this month.
 * `totalInactivePublishers` is a separate count of those whose status is
 * inactive; it is never folded into the active total.
 */
export interface S21MonthRow {
  reportMonth: string;
  servedThisMonth: boolean | null;
  hoursReported: number | null;
  bibleStudies: number;
  notes: string | null;
}

export interface S21DataResponse {
  serviceYear: number;
  publisher: {
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    gender: Gender;
    birthDate: string | null;
    baptismDate: string | null;
    spiritualStatus: SpiritualStatus;
    appointment: PublisherAppointment;
    pioneerType: PioneerType;
  };
  months: S21MonthRow[];
}

export interface ServiceYearSummary {
  serviceYear: number;
  firstMonth: string;
  lastMonth: string;
  totalHours: number;
  totalStudies: number;
  avgMonthlyPioneerReports: number;
  monthly: {
    reportMonth: string;
    hours: number;
    studies: number;
    reporters: number;
  }[];
}

export interface ServiceReportSummary {
  reportMonth: string;
  categories: ServiceReportSummaryCategory[];
  totalActivePublishers: number;
  totalInactivePublishers: number;
  averages: {
    /** Average hours among pioneers who reported hours this month. */
    pioneerHours: number;
    /** Average bible studies among everyone who reported this month. */
    bibleStudies: number;
    /** Publishers who submitted a report, as a share of active publishers. */
    submittedPct: number;
    /** Active publishers as a share of all (active + inactive). */
    activePct: number;
  };
  closed: boolean;
}

/**
 * Closure state for a single reporting month.
 *
 * A month is "closed" once the secretary (or an admin) confirms it: edits are
 * then frozen for everyone except admins and the secretary, who may always
 * re-enter any month. `canManage` tells the client whether the caller may
 * toggle the closure.
 */
export interface ClosureStatus {
  reportMonth: string;
  closed: boolean;
  closedAt: string | null;
  canManage: boolean;
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
    @InjectRepository(ReportMonthClosure)
    private readonly closuresRepo: Repository<ReportMonthClosure>,
    private readonly auditLogService: AuditLogService,
    private readonly publishersService: PublishersService,
    private readonly auxiliaryPioneersService: AuxiliaryPioneersService,
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
    // Students (appointment=STUDENT) are not reporting publishers — they never
    // submit a service report, not even on their behalf.
    if (publisher.appointment === PublisherAppointment.STUDENT) {
      throw new BadRequestException('Students do not submit service reports');
    }
    const reportMonth = this.normalizeReportMonth(dto.reportMonth);
    this.assertMonthIsReportable(reportMonth);
    // The hours form applies to actual pioneers AND to anyone serving as an
    // auxiliary pioneer in this report month (they report hours that month).
    const isAuxThisMonth =
      await this.auxiliaryPioneersService.isActiveAuxiliaryPioneer(
        tenantId,
        publisher.id,
        reportMonth,
      );
    const isPioneer =
      publisher.pioneerType !== PioneerType.NONE || isAuxThisMonth;

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
    const closedMonths = await this.closedMonthsSet(
      tenantId,
      reports.map((r) => r.reportMonth),
    );
    reports.forEach((r) =>
      this.setCanEdit(
        r,
        ctx,
        groupId,
        closedMonths.has(r.reportMonth.slice(0, 10)),
      ),
    );
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

    this.setCanEdit(
      report,
      ctx,
      groupId,
      await this.isMonthClosed(tenantId, report.reportMonth),
    );
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

    const isClosed = await this.isMonthClosed(tenantId, report.reportMonth);
    if (!this.canEditWithCtx(report, ctx, groupId, isClosed)) {
      if (isClosed && !ctx.alwaysEdit) {
        throw new ForbiddenException(
          'This month has been closed by the secretary. Only the secretary ' +
            'or an admin can make further changes.',
        );
      }
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
    // The hours form also applies to an auxiliary pioneer for the month this
    // report belongs to — so editing their report keeps the hours variant.
    const isAuxThisMonth =
      await this.auxiliaryPioneersService.isActiveAuxiliaryPioneer(
        tenantId,
        publisher.id,
        report.reportMonth,
      );
    const isPioneer =
      publisher.pioneerType !== PioneerType.NONE || isAuxThisMonth;

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
    this.setCanEdit(saved, ctx, groupId, isClosed);
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

    // The caller's own service group, so the client can expand it by default.
    const myPublisher = ctx.myPublisherId
      ? await this.publishersRepo.findOne({
          where: { id: ctx.myPublisherId, congregationId: tenantId },
        })
      : null;
    const myGroupId = myPublisher?.serviceGroupId ?? null;

    let publisherScope: Publisher[];
    let scopeLabel: string;

    if (ctx.alwaysView) {
      publisherScope = await this.publishersRepo.find({
        where: {
          congregationId: tenantId,
          appointment: Not(PublisherAppointment.STUDENT),
        },
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
          appointment: Not(PublisherAppointment.STUDENT),
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

    const isClosed = await this.isMonthClosed(tenantId, normalizedMonth);
    reports.forEach((r) =>
      this.setCanEdit(
        r,
        ctx,
        groupByPubId.get(r.publisherId) ?? null,
        isClosed,
      ),
    );
    await this.enrichEditorNames(reports);

    const reportByPubId = new Map(reports.map((r) => [r.publisherId, r]));

    // Consecutive months without a report, counting backwards from the selected
    // month, per publisher — for the "missed N months" flag. Look back up to 12
    // months in one query.
    const lookbackStart = new Date(normalizedMonth + 'T00:00:00Z');
    lookbackStart.setUTCMonth(lookbackStart.getUTCMonth() - 12);
    const lookbackStr = `${lookbackStart.getUTCFullYear()}-${String(
      lookbackStart.getUTCMonth() + 1,
    ).padStart(2, '0')}-01`;
    const historyRows =
      publisherIds.length === 0
        ? []
        : await this.reportsRepo.find({
            where: {
              congregationId: tenantId,
              publisherId: In(publisherIds),
              reportMonth: MoreThanOrEqual(lookbackStr),
            },
            select: ['publisherId', 'reportMonth'],
          });
    const reportedMonths = new Map<string, Set<string>>();
    for (const r of historyRows) {
      let set = reportedMonths.get(r.publisherId);
      if (!set) {
        set = new Set();
        reportedMonths.set(r.publisherId, set);
      }
      set.add(r.reportMonth.slice(0, 7));
    }
    // Reporting start month per publisher (ministry start / baptism): months
    // before it are not counted as missed — a newcomer isn't penalised for
    // months before they began reporting.
    const startMonthOf = (p: Publisher): string | null => {
      const raw =
        p.appointment === PublisherAppointment.UNBAPTIZED_PUBLISHER
          ? p.ministryStartDate
          : p.baptismDate;
      return raw ? raw.slice(0, 7) : null;
    };
    const startByPubId = new Map<string, string | null>(
      publisherScope.map((p) => [p.id, startMonthOf(p)]),
    );

    const consecutiveMissingFor = (publisherId: string): number => {
      const set = reportedMonths.get(publisherId) ?? new Set();
      const start = startByPubId.get(publisherId) ?? null;
      let count = 0;
      const cursor = new Date(normalizedMonth + 'T00:00:00Z');
      for (let i = 0; i < 12; i++) {
        const ym = `${cursor.getUTCFullYear()}-${String(
          cursor.getUTCMonth() + 1,
        ).padStart(2, '0')}`;
        if (set.has(ym)) break;
        // Stop counting once we reach a month before the publisher's start.
        if (start && ym < start) break;
        count++;
        cursor.setUTCMonth(cursor.getUTCMonth() - 1);
      }
      return count;
    };

    // Resolve group names so the client can render sections by service group.
    const allGroups = await this.serviceGroupsRepo.find({
      where: { congregationId: tenantId },
    });
    const groupNameById = new Map(allGroups.map((g) => [g.id, g.name]));

    // Publishers serving as auxiliary pioneers this month also use the hours
    // form, so they must be flagged as pioneers for this month's report.
    const auxThisMonth =
      await this.auxiliaryPioneersService.activePublisherIdsForMonth(
        tenantId,
        normalizedMonth,
      );

    return {
      reportMonth: normalizedMonth,
      scopeLabel,
      closed: isClosed,
      myGroupId,
      publishers: publisherScope.map((p) => ({
        publisherId: p.id,
        displayName: p.displayName,
        groupId: p.serviceGroupId ?? null,
        groupName: p.serviceGroupId
          ? (groupNameById.get(p.serviceGroupId) ?? null)
          : null,
        isPioneer: p.pioneerType !== PioneerType.NONE || auxThisMonth.has(p.id),
        consecutiveMissing: consecutiveMissingFor(p.id),
        report:
          (reportByPubId.get(p.id) as
            | (ServiceReport & {
                canEdit: boolean;
                lastEditedByName: string | null;
              })
            | undefined) ?? null,
        canManage:
          (ctx.alwaysEdit ||
            ctx.overseenGroupIds.includes(groupByPubId.get(p.id) ?? '')) &&
          (!isClosed || ctx.alwaysEdit),
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

    const closedMonths = await this.closedMonthsSet(
      tenantId,
      reports.map((r) => r.reportMonth),
    );
    for (const r of reports) {
      this.setCanEdit(
        r,
        ctx,
        groupId,
        closedMonths.has(r.reportMonth.slice(0, 10)),
      );
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
   * Data for the S-21 publisher record card, guarded strictly for elders (the
   * secretary is an elder too) and admins — the card consolidates sensitive
   * fields (spiritual status, full service history) and must not be assembled
   * by anyone else. Returns the full publisher plus the 12 reports of the
   * requested service year (Sep of year-1 .. Aug of year).
   */
  async getS21Data(
    tenantId: string,
    user: AuthenticatedUser,
    publisherId: string,
    serviceYear: number,
  ): Promise<S21DataResponse> {
    const isAdmin = user.role === UserRole.ADMIN;
    const isElder = user.role === UserRole.ELDER;
    if (!isAdmin && !isElder) {
      throw new ForbiddenException(
        'The S-21 record card is available only to elders and administrators.',
      );
    }

    const publisher = await this.publishersRepo.findOne({
      where: { id: publisherId, congregationId: tenantId },
    });
    if (!publisher) {
      throw new NotFoundException('Publisher not found.');
    }
    // Students don't submit service reports, so an S-21 card is meaningless.
    if (publisher.appointment === PublisherAppointment.STUDENT) {
      throw new BadRequestException(
        'The S-21 record card does not apply to students.',
      );
    }

    // Service year: Sep (year-1) .. Aug (year).
    const first = `${serviceYear - 1}-09-01`;
    const last = `${serviceYear}-08-01`;
    const reports = await this.reportsRepo.find({
      where: {
        publisherId,
        congregationId: tenantId,
        reportMonth: Between(first, last),
      },
      order: { reportMonth: 'ASC' },
    });

    const months: S21MonthRow[] = reports.map((r) => ({
      reportMonth: r.reportMonth,
      servedThisMonth: r.servedThisMonth,
      hoursReported: r.hoursReported,
      bibleStudies: r.bibleStudies,
      notes: r.notes,
    }));

    return {
      serviceYear,
      publisher: {
        id: publisher.id,
        firstName: publisher.firstName,
        lastName: publisher.lastName,
        displayName: publisher.displayName,
        gender: publisher.gender,
        birthDate: publisher.birthDate,
        baptismDate: publisher.baptismDate,
        spiritualStatus: publisher.spiritualStatus,
        appointment: publisher.appointment,
        pioneerType: publisher.pioneerType,
      },
      months,
    };
  }

  /**
   * Monthly field-service summary for the secretary and administrators.
   *
   * Returns five fixed category lines (publishers, auxiliary, regular,
   * special, missionary) with counts/hours/studies for the given month, plus
   * the congregation's total active-or-irregular publisher count. Restricted
   * to admins and the holder of the SECRETARY responsibility.
   */
  async getSummary(
    tenantId: string,
    user: AuthenticatedUser,
    reportMonthInput: string,
  ): Promise<ServiceReportSummary> {
    const reportMonth = this.normalizeReportMonth(reportMonthInput);
    const ctx = await this.buildPermissionContext(tenantId, user);

    // alwaysEdit is exactly "admin or secretary" — the summary's audience.
    if (!ctx.alwaysEdit) {
      throw new ForbiddenException(
        'Only administrators and the secretary may view the service summary.',
      );
    }

    const publishers = await this.publishersRepo.find({
      where: { congregationId: tenantId },
    });
    const typeByPubId = new Map<string, PioneerType>(
      publishers.map((p) => [p.id, p.pioneerType]),
    );

    const reports = await this.reportsRepo.find({
      where: { congregationId: tenantId, reportMonth },
    });

    const order: PioneerType[] = [
      PioneerType.NONE,
      PioneerType.AUXILIARY_UNTIL_CANCELLED,
      PioneerType.REGULAR,
      PioneerType.SPECIAL,
      PioneerType.MISSIONARY,
    ];
    const acc = new Map<
      PioneerType,
      { count: number; hours: number; bibleStudies: number }
    >(order.map((t) => [t, { count: 0, hours: 0, bibleStudies: 0 }]));

    for (const report of reports) {
      const type = typeByPubId.get(report.publisherId);
      if (type === undefined) continue;
      const bucket = acc.get(type);
      if (!bucket) continue;

      if (type === PioneerType.NONE) {
        // Ordinary publishers: count only those who shared in the ministry.
        if (report.servedThisMonth === true) {
          bucket.count += 1;
          bucket.bibleStudies += report.bibleStudies ?? 0;
        }
      } else {
        bucket.count += 1;
        bucket.hours += report.hoursReported ?? 0;
        bucket.bibleStudies += report.bibleStudies ?? 0;
      }
    }

    const categories: ServiceReportSummaryCategory[] = order.map((type) => {
      const bucket = acc.get(type)!;
      return {
        pioneerType: type,
        count: bucket.count,
        hours: type === PioneerType.NONE ? null : bucket.hours,
        bibleStudies: bucket.bibleStudies,
      };
    });

    const totalActivePublishers = await this.publishersRepo.count({
      where: {
        congregationId: tenantId,
        status: In([PublisherStatus.ACTIVE, PublisherStatus.IRREGULAR]),
      },
    });

    // Inactive publishers are counted on their own line and are never added
    // into the active total.
    const totalInactivePublishers = await this.publishersRepo.count({
      where: {
        congregationId: tenantId,
        status: PublisherStatus.INACTIVE,
      },
    });

    const closed = await this.isMonthClosed(tenantId, reportMonth);

    // Averages / rates for the summary.
    let pioneerHoursSum = 0;
    let pioneerHoursCount = 0;
    let studiesSum = 0;
    let reportedCount = 0;
    for (const report of reports) {
      const type = typeByPubId.get(report.publisherId);
      if (type === undefined) continue;
      const shared =
        report.servedThisMonth === true ||
        (report.hoursReported != null && report.hoursReported > 0);
      if (shared) {
        reportedCount += 1;
        studiesSum += report.bibleStudies ?? 0;
      }
      if (type !== PioneerType.NONE && report.hoursReported != null) {
        pioneerHoursSum += report.hoursReported;
        pioneerHoursCount += 1;
      }
    }
    const totalPublishers = totalActivePublishers + totalInactivePublishers;
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const averages = {
      pioneerHours:
        pioneerHoursCount > 0 ? round1(pioneerHoursSum / pioneerHoursCount) : 0,
      bibleStudies: reportedCount > 0 ? round1(studiesSum / reportedCount) : 0,
      submittedPct:
        totalActivePublishers > 0
          ? Math.round((reportedCount / totalActivePublishers) * 100)
          : 0,
      activePct:
        totalPublishers > 0
          ? Math.round((totalActivePublishers / totalPublishers) * 100)
          : 0,
    };

    return {
      reportMonth,
      categories,
      totalActivePublishers,
      totalInactivePublishers,
      averages,
      closed,
    };
  }

  /**
   * Yearly totals for a service year (September of year-1 through August of
   * `year`), plus a per-month breakdown for the trend. Same audience as the
   * monthly summary (admin/secretary).
   */
  async getYearSummary(
    tenantId: string,
    user: AuthenticatedUser,
    serviceYear: number,
  ): Promise<ServiceYearSummary> {
    const ctx = await this.buildPermissionContext(tenantId, user);
    if (!ctx.alwaysEdit) {
      throw new ForbiddenException(
        'Only administrators and the secretary may view the service summary.',
      );
    }

    // Service year runs Sep (year-1) .. Aug (year).
    const months: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(serviceYear - 1, 8 + i, 1)); // month 8 = Sep
      months.push(
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
          2,
          '0',
        )}-01`,
      );
    }
    const first = months[0];
    const last = months[months.length - 1];

    const publishers = await this.publishersRepo.find({
      where: { congregationId: tenantId },
    });
    const typeByPubId = new Map<string, PioneerType>(
      publishers.map((p) => [p.id, p.pioneerType]),
    );

    const reports = await this.reportsRepo.find({
      where: {
        congregationId: tenantId,
        reportMonth: Between(first, last),
      },
    });

    // Per-month accumulation.
    const monthAcc = new Map<
      string,
      { hours: number; studies: number; reporters: number; pioneers: number }
    >(
      months.map((m) => [
        m.slice(0, 7),
        { hours: 0, studies: 0, reporters: 0, pioneers: 0 },
      ]),
    );
    let totalHours = 0;
    let totalStudies = 0;
    let totalPioneerReports = 0;

    for (const r of reports) {
      const key = r.reportMonth.slice(0, 7);
      const bucket = monthAcc.get(key);
      if (!bucket) continue;
      const type = typeByPubId.get(r.publisherId);
      const shared =
        r.servedThisMonth === true ||
        (r.hoursReported != null && r.hoursReported > 0);
      if (shared) {
        bucket.reporters += 1;
        bucket.studies += r.bibleStudies ?? 0;
        totalStudies += r.bibleStudies ?? 0;
      }
      if (type !== undefined && type !== PioneerType.NONE) {
        const h = r.hoursReported ?? 0;
        bucket.hours += h;
        bucket.pioneers += 1;
        totalHours += h;
        totalPioneerReports += 1;
      }
    }

    const monthly = months.map((m) => {
      const b = monthAcc.get(m.slice(0, 7))!;
      return {
        reportMonth: m,
        hours: b.hours,
        studies: b.studies,
        reporters: b.reporters,
      };
    });

    return {
      serviceYear,
      firstMonth: first,
      lastMonth: last,
      totalHours,
      totalStudies,
      avgMonthlyPioneerReports:
        Math.round((totalPioneerReports / 12) * 10) / 10,
      monthly,
    };
  }

  /**
   * Closure status for a month. Readable by any authenticated user (so the
   * UI can show a "closed" badge); `canManage` reflects whether the caller
   * may toggle it (admins and the secretary).
   */
  async getClosureStatus(
    tenantId: string,
    user: AuthenticatedUser,
    reportMonthInput: string,
  ): Promise<ClosureStatus> {
    const reportMonth = this.normalizeReportMonth(reportMonthInput);
    const ctx = await this.buildPermissionContext(tenantId, user);
    return this.buildClosureStatus(tenantId, reportMonth, ctx.alwaysEdit);
  }

  /**
   * Confirm/close a reporting month. Idempotent — closing an already-closed
   * month is a no-op. Only admins and the secretary may close.
   */
  async closeMonth(
    tenantId: string,
    user: AuthenticatedUser,
    reportMonthInput: string,
  ): Promise<ClosureStatus> {
    const reportMonth = this.normalizeReportMonth(reportMonthInput);
    const ctx = await this.buildPermissionContext(tenantId, user);
    if (!ctx.alwaysEdit) {
      throw new ForbiddenException(
        'Only administrators and the secretary may close a month.',
      );
    }
    const existing = await this.closuresRepo.findOne({
      where: { congregationId: tenantId, reportMonth },
    });
    if (!existing) {
      const row = this.closuresRepo.create({
        congregationId: tenantId,
        reportMonth,
        closedById: user.id,
      });
      await this.closuresRepo.save(row);
    }
    return this.buildClosureStatus(tenantId, reportMonth, ctx.alwaysEdit);
  }

  /**
   * Re-open a previously closed month. Idempotent. Only admins and the
   * secretary may reopen — letting them correct after a premature close.
   */
  async reopenMonth(
    tenantId: string,
    user: AuthenticatedUser,
    reportMonthInput: string,
  ): Promise<ClosureStatus> {
    const reportMonth = this.normalizeReportMonth(reportMonthInput);
    const ctx = await this.buildPermissionContext(tenantId, user);
    if (!ctx.alwaysEdit) {
      throw new ForbiddenException(
        'Only administrators and the secretary may reopen a month.',
      );
    }
    await this.closuresRepo.delete({ congregationId: tenantId, reportMonth });
    return this.buildClosureStatus(tenantId, reportMonth, ctx.alwaysEdit);
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
    // Both the group overseer and the group assistant oversee the group: they
    // may view their group's reports and submit/edit on behalf of its members.
    const groups = await this.serviceGroupsRepo.find({
      where: [
        { congregationId: tenantId, overseerPublisherId: publisherId },
        { congregationId: tenantId, assistantPublisherId: publisherId },
      ],
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
    isClosed: boolean,
  ): boolean {
    if (ctx.alwaysEdit) return true;
    // A closed month is frozen for everyone except admins/secretary above.
    if (isClosed) return false;
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
    isClosed: boolean,
  ): void {
    (report as ServiceReport & { canEdit: boolean }).canEdit =
      this.canEditWithCtx(report, ctx, publisherGroupId, isClosed);
  }

  /** Whether a single reporting month is closed for this congregation. */
  private async isMonthClosed(
    tenantId: string,
    reportMonth: string,
  ): Promise<boolean> {
    const count = await this.closuresRepo.count({
      where: { congregationId: tenantId, reportMonth },
    });
    return count > 0;
  }

  /**
   * Closed months among a set, as a Set of normalized `YYYY-MM-01` strings.
   * Used by the multi-month list views to avoid a per-report query.
   */
  private async closedMonthsSet(
    tenantId: string,
    reportMonths: string[],
  ): Promise<Set<string>> {
    const distinct = [...new Set(reportMonths.map((m) => m.slice(0, 10)))];
    if (distinct.length === 0) return new Set();
    const rows = await this.closuresRepo.find({
      where: { congregationId: tenantId, reportMonth: In(distinct) },
    });
    return new Set(rows.map((r) => String(r.reportMonth).slice(0, 10)));
  }

  /** Assemble a ClosureStatus for the given month. */
  private async buildClosureStatus(
    tenantId: string,
    reportMonth: string,
    canManage: boolean,
  ): Promise<ClosureStatus> {
    const row = await this.closuresRepo.findOne({
      where: { congregationId: tenantId, reportMonth },
    });
    return {
      reportMonth,
      closed: !!row,
      closedAt: row ? row.closedAt.toISOString() : null,
      canManage,
    };
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
          .flatMap((r) => [r.lastEditedById, r.submittedById])
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
          submittedByName: string | null;
        }
      ).submittedByName = r.submittedById
        ? (nameByUserId.get(r.submittedById) ?? null)
        : null;
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

  /**
   * A service report can only be submitted for a month that has already
   * finished. The current month is still in progress, so it (and any future
   * month) is rejected — in July you report for June, not July.
   */
  private assertMonthIsReportable(reportMonth: string): void {
    const now = new Date();
    const currentMonthStart = `${now.getFullYear()}-${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}-01`;
    if (reportMonth >= currentMonthStart) {
      throw new BadRequestException(
        'Reports can only be submitted for a month that has already ended.',
      );
    }
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
