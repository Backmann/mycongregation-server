import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { SubmitReportDto } from './dto/submit-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';

@Injectable()
export class ServiceReportsService {
  constructor(
    @InjectRepository(ServiceReport)
    private readonly reportsRepo: Repository<ServiceReport>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
  ) {}

  /**
   * Submit own monthly service report.
   * Authenticated user is resolved to their Publisher record.
   * One report per Publisher per month is enforced by UNIQUE constraint.
   */
  async submitOwnReport(
    tenantId: string,
    userId: string,
    dto: SubmitReportDto,
  ): Promise<ServiceReport> {
    const publisher = await this.resolveUserPublisher(tenantId, userId);
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
      submittedById: userId,
      submittedOnBehalfOf: false,
    });

    try {
      return await this.reportsRepo.save(report);
    } catch (err: any) {
      // PostgreSQL unique_violation
      if (err?.code === '23505') {
        throw new ConflictException(
          `A report for ${reportMonth} has already been submitted.`,
        );
      }
      throw err;
    }
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
  ): Promise<(ServiceReport & { canEdit: boolean })[]> {
    const publisher = await this.resolveUserPublisher(tenantId, user.id);

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
    return reports.map((r) => this.withCanEdit(r, user));
  }

  /**
   * Fetch a single service report by id, with a computed `canEdit`.
   * Read permission: own report, or elder/admin role.
   */
  async findOne(
    tenantId: string,
    user: AuthenticatedUser,
    reportId: string,
  ): Promise<ServiceReport & { canEdit: boolean }> {
    const report = await this.reportsRepo.findOne({
      where: { id: reportId, congregationId: tenantId },
    });
    if (!report) {
      throw new NotFoundException('Service report not found.');
    }

    const isElderOrAdmin =
      user.role === UserRole.ADMIN || user.role === UserRole.ELDER;
    const isOwnReport = report.submittedById === user.id;
    if (!isElderOrAdmin && !isOwnReport) {
      throw new ForbiddenException('You may only view your own reports.');
    }

    return this.withCanEdit(report, user);
  }

  /**
   * Update an existing service report.
   *
   * Permission rules:
   * - The original submitter may self-edit during the self-edit window
   *   (1st-10th of the month following `reportMonth`, UTC).
   * - Elders and admins may edit any report at any time.
   * - Others are denied.
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
  ): Promise<ServiceReport & { canEdit: boolean }> {
    const report = await this.reportsRepo.findOne({
      where: { id: reportId, congregationId: tenantId },
    });
    if (!report) {
      throw new NotFoundException('Service report not found.');
    }

    if (!this.canEditReport(report, user)) {
      const isOwnReport = report.submittedById === user.id;
      if (isOwnReport) {
        throw new ForbiddenException(
          'Self-edit window has closed. The window is the 1st-10th of the ' +
            'month following the report month. Contact an elder or admin ' +
            'to request changes.',
        );
      }
      throw new ForbiddenException(
        'You may only edit your own reports. Contact an elder or admin to ' +
          'edit reports for other publishers.',
      );
    }

    const publisher = await this.publishersRepo.findOne({
      where: { id: report.publisherId },
    });
    if (!publisher) {
      // Defensive — FK guarantees existence.
      throw new BadRequestException('Publisher record not found.');
    }
    const isPioneer = publisher.pioneerType !== PioneerType.NONE;

    this.validateUpdateFormVariant(dto, isPioneer);

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
    return this.withCanEdit(saved, user);
  }

  /**
   * Whether `user` may currently edit `report`.
   *
   * Single source of truth for the canEdit boolean returned in API
   * responses AND the guard inside updateReport.
   */
  private canEditReport(
    report: ServiceReport,
    user: AuthenticatedUser,
  ): boolean {
    const isElderOrAdmin =
      user.role === UserRole.ADMIN || user.role === UserRole.ELDER;
    if (isElderOrAdmin) return true;

    const isOwnReport = report.submittedById === user.id;
    if (!isOwnReport) return false;

    return this.isInSelfEditWindow(report.reportMonth);
  }

  /**
   * True if the current moment is within the self-edit window for
   * `reportMonth`.
   *
   * Window: 1st through 10th inclusive of the month following
   * reportMonth, evaluated in UTC. Closes at 00:00 UTC on the 11th.
   *
   * Example: an April 2026 report (`reportMonth = "2026-04-01"`) is
   * self-editable from 2026-05-01 00:00 UTC through 2026-05-11 00:00 UTC
   * (exclusive).
   */
  private isInSelfEditWindow(reportMonth: string): boolean {
    const yearMonth = reportMonth.slice(0, 7);
    const [yearStr, monthStr] = yearMonth.split('-');
    const year = parseInt(yearStr, 10);
    const monthOneBased = parseInt(monthStr, 10);
    // Date.UTC month is 0-indexed; passing 1-indexed month yields the
    // NEXT month. 11th at 00:00 UTC is the half-open upper bound.
    const windowEndMs = Date.UTC(year, monthOneBased, 11);
    return Date.now() < windowEndMs;
  }

  /** Attach a computed `canEdit` field to a report for API responses. */
  private withCanEdit(
    report: ServiceReport,
    user: AuthenticatedUser,
  ): ServiceReport & { canEdit: boolean } {
    (report as ServiceReport & { canEdit: boolean }).canEdit =
      this.canEditReport(report, user);
    return report as ServiceReport & { canEdit: boolean };
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
