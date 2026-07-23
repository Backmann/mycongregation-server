import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { reportedMinistry } from '../common/reported-ministry';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { User } from '../entities/user.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { ServiceReport } from '../entities/service-report.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { Gender } from '../common/enums/gender.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { OverrideStatusDto } from './dto/override-status.dto';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { deriveRoleFromAppointment } from './derive-role';
import { UsersService } from '../users/users.service';
import { AuxiliaryPioneersService } from '../auxiliary-pioneers/auxiliary-pioneers.service';
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
  /**
   * First month the publisher was expected to report (start of ministry /
   * baptism, or their first report). Months before this are not counted as
   * missed — a newcomer isn't penalised for months before they began.
   */
  startMonth?: Date | null,
): PublisherStatus {
  const sixMonthsAgo = new Date(
    Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 5, 1),
  );
  // Window starts at the later of "6 months ago" and the publisher's start.
  const windowStart =
    startMonth && startMonth.getTime() > sixMonthsAgo.getTime()
      ? new Date(
          Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth(), 1),
        )
      : sixMonthsAgo;
  // The last month that could have a report is the previous month (the current
  // month isn't finished yet).
  const windowEnd = new Date(
    Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 1, 1),
  );

  // How many months the publisher could have reported in the window (inclusive
  // of both ends), capped at 6.
  let windowMonths = 0;
  {
    const cursor = new Date(windowStart.getTime());
    while (cursor.getTime() <= windowEnd.getTime() && windowMonths < 6) {
      windowMonths++;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

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
    const served = reportedMinistry(r);
    if (served) servedMonths.add(ymd.slice(0, 7));
  }

  if (servedMonths.size === 0) return PublisherStatus.INACTIVE;
  // Active if they reported every month they could have (a newcomer who has
  // reported all of their first months counts as active), or 6+ overall.
  if (servedMonths.size >= 6 || servedMonths.size >= windowMonths) {
    return PublisherStatus.ACTIVE;
  }
  return PublisherStatus.IRREGULAR;
}
import { CreatePublisherDto } from './dto/create-publisher.dto';
import { UpdatePublisherDto } from './dto/update-publisher.dto';
import { QueryPublishersDto } from './dto/query-publishers.dto';
import { RemovePublisherDto } from './dto/remove-publisher.dto';

export type RecomputeResult = 'skipped_override' | 'unchanged' | 'updated';

export interface AccessSummary {
  hasAccess: boolean;
  email: string | null;
  role: UserRole | null;
  isActive: boolean | null;
  lastLoginAt: Date | null;
  canViewPrivateData: boolean | null;
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
    private readonly auxiliaryPioneersService: AuxiliaryPioneersService,
  ) {}

  /**
   * Recompute and persist a publisher's status from the last 6 months of
   * reports. No-op when statusManuallyOverridden=true. Skips the save if
   * the computed status matches the stored value.
   */
  /**
   * The month from which a publisher is expected to report: their ministry
   * start (unbaptized) or baptism date (baptized). Returns null if neither is
   * set — the status logic then falls back to the plain 6-month window.
   */
  private reportingStartMonth(publisher: Publisher): Date | null {
    const raw =
      publisher.appointment === PublisherAppointment.UNBAPTIZED_PUBLISHER
        ? publisher.ministryStartDate
        : publisher.baptismDate;
    if (!raw) return null;
    const d = new Date(`${raw.slice(0, 7)}-01T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
  }

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

    // Students don't submit service reports, so they have no service status.
    if (publisher.appointment === PublisherAppointment.STUDENT) {
      if (publisher.status === null) return 'unchanged';
      const before: { status: PublisherStatus | null } = {
        status: publisher.status,
      };
      publisher.status = null;
      await this.publishersRepo.save(publisher);
      if (publisher.userId) {
        await this.auditLogService.logUpdate({
          tenantId,
          entityType: 'Publisher',
          entityId: publisher.id,
          actorUserId: publisher.userId,
          before,
          after: { status: null } as { status: PublisherStatus | null },
          fields: ['status'],
        });
      }
      return 'updated';
    }

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

    const startMonth = this.reportingStartMonth(publisher);
    const newStatus = computeStatusFromReports(reports, now, startMonth);
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
    // Notify a SCOPED set — the overseer of this publisher's service group,
    // the congregation secretary (keeps the reporting records), and all
    // admins. A status change (e.g. becoming irregular/inactive after missing
    // reports) is sensitive and must not fan out to every elder or the whole
    // congregation. Best-effort: errors are swallowed so a push failure can
    // never break the status pipeline.
    const recipientUserIds = await this.resolveStatusChangeRecipients(
      tenantId,
      publisher.serviceGroupId,
    );
    for (const recipientUserId of recipientUserIds) {
      this.pushNotificationsService
        .sendStatusChangeToUser(
          tenantId,
          recipientUserId,
          { id: publisher.id, displayName: publisher.displayName },
          before.status ?? '',
          newStatus,
        )
        .catch((err: any) => {
          this.logger.warn(
            `sendStatusChange failed for publisher=${publisher.id}: ${err?.message ?? err}`,
          );
        });
    }
    return 'updated';
  }

  /**
   * Resolve the set of user accounts that should be notified of a publisher's
   * status change: the overseer of the publisher's service group, the
   * congregation secretary, and every admin. Deduplicated; entries without a
   * linked user account are dropped. Returns an empty array when nobody
   * qualifies (rather than broadcasting).
   */
  private async resolveStatusChangeRecipients(
    tenantId: string,
    serviceGroupId: string | null,
  ): Promise<string[]> {
    const userIds = new Set<string>();

    // 1) Overseer of the publisher's service group.
    if (serviceGroupId) {
      const group = await this.publishersRepo.manager.findOne(ServiceGroup, {
        where: { id: serviceGroupId, congregationId: tenantId },
      });
      if (group?.overseerPublisherId) {
        const overseer = await this.publishersRepo.findOne({
          where: {
            id: group.overseerPublisherId,
            congregationId: tenantId,
          },
        });
        if (overseer?.userId) userIds.add(overseer.userId);
      }
    }

    // 2) Congregation secretary (holds the SECRETARY responsibility).
    const secretary = await this.publishersRepo.manager.findOne(
      Responsibility,
      {
        where: { congregationId: tenantId, type: ResponsibilityType.SECRETARY },
      },
    );
    if (secretary?.userId) userIds.add(secretary.userId);

    // 3) All admins of the congregation.
    const admins = await this.publishersRepo.manager.find(User, {
      where: { congregationId: tenantId, role: UserRole.ADMIN },
    });
    for (const a of admins) {
      if (a.id) userIds.add(a.id);
    }

    return [...userIds];
  }

  /**
   * Iterate every active publisher across all congregations and recompute
   * status. Used by both the nightly cron and the admin manual trigger.
   * Per-publisher errors are caught and counted — one bad row does not
   * fail the run.
   */
  /**
   * Recompute statuses for ONE congregation.
   *
   * It used to walk every active publisher in the database regardless of who
   * asked, so an administrator of one congregation silently rewrote statuses
   * in all the others. That was a bug wearing the clothes of a feature. The
   * fix is to scope it rather than to guard it: a road that does not exist
   * cannot be taken by mistake, and the operation stays useful to every
   * administrator within their own congregation.
   */
  /**
   * Every congregation, for the nightly job ONLY.
   *
   * It is a separate, plainly named method rather than an optional parameter
   * on the scoped one. An optional parameter is an invitation: someone wires
   * the endpoint to it, forgets the argument, and the whole platform is
   * rewritten by one congregation's administrator — which is exactly what used
   * to happen here. A name like this cannot be reached by forgetting.
   */
  async recomputeEveryCongregation(): Promise<{
    processed: number;
    updated: number;
    unchanged: number;
    skipped: number;
    errors: number;
    durationMs: number;
  }> {
    const startedAt = Date.now();
    // Taken from the publishers themselves rather than from a congregations
    // repository: a congregation with nobody in it has nothing to recompute,
    // and this avoids giving the publishers service a dependency it would
    // otherwise never use.
    const rows = await this.publishersRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.congregation_id', 'congregationId')
      .where('p.removed_at IS NULL')
      .getRawMany<{ congregationId: string }>();
    const congregations = rows.map((r) => ({ id: r.congregationId }));
    const total = {
      processed: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
    };
    for (const congregation of congregations) {
      const one = await this.recomputeForCongregation(congregation.id);
      total.processed += one.processed;
      total.updated += one.updated;
      total.unchanged += one.unchanged;
      total.skipped += one.skipped;
      total.errors += one.errors;
    }
    total.durationMs = Date.now() - startedAt;
    return total;
  }

  async recomputeForCongregation(congregationId: string): Promise<{
    processed: number;
    updated: number;
    unchanged: number;
    skipped: number;
    errors: number;
    durationMs: number;
  }> {
    const startedAt = Date.now();
    const publishers = await this.publishersRepo.find({
      where: { congregationId, removedAt: IsNull() },
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

  /**
   * Names-only roster for schedule display: every congregation member sees
   * assignment names on the posted schedules anyway, so exposing id +
   * displayName to any authenticated member leaks nothing new — while the
   * full directory stays restricted to privileged users (or, for a regular
   * publisher, to their own service group).
   */
  async roster(
    tenantId: string,
  ): Promise<{ data: { id: string; displayName: string }[] }> {
    const rows = await this.publishersRepo
      .createQueryBuilder('publisher')
      .select(['publisher.id', 'publisher.displayName'])
      .where('publisher.congregation_id = :tenantId', { tenantId })
      .orderBy('publisher.display_name', 'ASC')
      .getMany();
    return {
      data: rows.map((r) => ({ id: r.id, displayName: r.displayName })),
    };
  }

  /** Service group of the caller's own publisher record (null if unlinked). */
  async findOwnServiceGroupId(
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    const me = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId },
    });
    return me?.serviceGroupId ?? null;
  }

  /**
   * Whether the user holds ANY responsibility in the congregation. Planners
   * (schedule/duty/cleaning editors — possibly ministerial servants, not
   * elders) need the full name roster for their pickers. Queried through the
   * repository manager to avoid injecting yet another repository.
   */
  async holdsAnyResponsibility(
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const held = await this.publishersRepo.manager.count(Responsibility, {
      where: { congregationId: tenantId, userId },
    });
    return held > 0;
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

  /**
   * Whether the caller may see publishers' private data: admins and
   * elders always may; any other role only if granted via
   * canViewPrivateData.
   */
  async resolvePrivateAccess(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN || user.role === UserRole.ELDER) {
      return true;
    }
    const account = await this.usersService.findByIdInCongregation(
      user.id,
      tenantId,
    );
    return account.canViewPrivateData === true;
  }

  async getAccess(tenantId: string, id: string): Promise<AccessSummary> {
    const publisher = await this.findOne(tenantId, id);
    if (!publisher.userId) {
      return {
        hasAccess: false,
        email: null,
        role: null,
        isActive: null,
        lastLoginAt: null,
        canViewPrivateData: null,
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
      canViewPrivateData: user.canViewPrivateData,
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

    if (!dto.sendInvite && !dto.password) {
      throw new BadRequestException(
        'Provide a password or enable the email invitation',
      );
    }

    const created = await this.usersService.createUserByAdmin(
      {
        email,
        password: dto.sendInvite ? undefined : dto.password,
        role,
      },
      tenantId,
      actor.id,
    );
    publisher.userId = created.id;
    await this.publishersRepo.save(publisher);

    if (dto.sendInvite) {
      // sendInvitation: issue a 72h token and email the link.
      await this.usersService.sendInvitation(created.id, email);
    }

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
    if (dto.email !== undefined) {
      await this.usersService.changeEmailByAdmin(
        publisher.userId,
        dto.email,
        tenantId,
      );
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
    if (dto.canViewPrivateData !== undefined) {
      await this.usersService.setPrivateAccessByAdmin(
        publisher.userId,
        dto.canViewPrivateData,
        tenantId,
        actor.id,
      );
    }
    return this.getAccess(tenantId, id);
  }

  /**
   * Re-issue a fresh 72h invitation link and email it — for someone whose
   * original invite expired before they set a password. Reuses the same
   * invitation flow as first-time access.
   */
  async resendInvite(tenantId: string, id: string): Promise<AccessSummary> {
    const publisher = await this.findOne(tenantId, id);
    if (!publisher.userId) {
      throw new NotFoundException('This person has no app access');
    }
    const user = await this.usersService.findByIdInCongregation(
      publisher.userId,
      tenantId,
    );
    await this.usersService.sendInvitation(user.id, user.email);
    return this.getAccess(tenantId, id);
  }

  /**
   * Enforce that a publisher's appointment is consistent with pioneer service:
   * only baptized publishers (publisher / ministerial servant / elder) may be
   * pioneers. Students and unbaptized publishers may report field service (the
   * "served" checkbox) but cannot be pioneers of any kind.
   */
  private assertAppointmentConsistency(
    appointment: PublisherAppointment | undefined,
    pioneerType: PioneerType | undefined,
  ): void {
    if (appointment === undefined) return;
    const isBaptized =
      appointment === PublisherAppointment.PUBLISHER ||
      appointment === PublisherAppointment.MINISTERIAL_SERVANT ||
      appointment === PublisherAppointment.ELDER;
    if (
      !isBaptized &&
      pioneerType !== undefined &&
      pioneerType !== PioneerType.NONE
    ) {
      throw new BadRequestException(
        'Only baptized publishers may be pioneers; students and unbaptized ' +
          'publishers cannot have a pioneer type.',
      );
    }
  }

  async create(tenantId: string, dto: CreatePublisherDto): Promise<Publisher> {
    this.assertAppointmentConsistency(dto.appointment, dto.pioneerType);
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

  /**
   * "These contacts are still correct" for someone else — the secretary doing
   * the yearly check for a publisher who does not use the app.
   */
  async confirmContacts(
    tenantId: string,
    id: string,
    actorUserId?: string,
  ): Promise<Publisher> {
    const publisher = await this.findOne(tenantId, id);
    publisher.contactsConfirmedAt = new Date();
    publisher.contactsConfirmedByUserId = actorUserId ?? null;
    publisher.lastEditedById = actorUserId ?? publisher.lastEditedById;
    return this.publishersRepo.save(publisher);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdatePublisherDto,
    actorUserId?: string,
  ): Promise<Publisher> {
    const publisher = await this.findOne(tenantId, id);
    const prevPioneerType = publisher.pioneerType;
    // Contacts count as checked whenever somebody touches them — the publisher
    // themselves or the secretary on their behalf. One rule, so the card always
    // shows a date somebody can trust.
    const contactsBefore = {
      mobilePhone: publisher.mobilePhone ?? null,
      email: publisher.email ?? null,
      address: publisher.address ?? null,
    };
    Object.assign(publisher, dto);
    const contactsChanged =
      (publisher.mobilePhone ?? null) !== contactsBefore.mobilePhone ||
      (publisher.email ?? null) !== contactsBefore.email ||
      (publisher.address ?? null) !== contactsBefore.address;
    if (contactsChanged) {
      publisher.contactsConfirmedAt = new Date();
      publisher.contactsConfirmedByUserId = actorUserId ?? null;
    }
    this.assertAppointmentConsistency(
      publisher.appointment,
      publisher.pioneerType,
    );

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

    publisher.lastEditedById = actorUserId ?? publisher.lastEditedById;
    const saved = await this.publishersRepo.save(publisher);

    // Becoming a regular/special/missionary pioneer ends any open auxiliary
    // period — the two must not overlap. Uses the pioneer start month if given,
    // else the current month.
    const PERMANENT: PioneerType[] = [
      PioneerType.REGULAR,
      PioneerType.SPECIAL,
      PioneerType.MISSIONARY,
    ];
    const becamePermanent =
      PERMANENT.includes(publisher.pioneerType) &&
      !PERMANENT.includes(prevPioneerType);
    if (becamePermanent) {
      const fromMonth =
        publisher.pioneerSince ?? new Date().toISOString().slice(0, 10);
      await this.auxiliaryPioneersService.closeActiveForPublisher(
        tenantId,
        publisher.id,
        fromMonth,
      );
    }

    return saved;
  }

  /**
   * Resolves the display name (or email) of the login that last edited a
   * publisher card. Used to sign edits on the card; null if unknown.
   */
  async resolveEditorName(
    tenantId: string,
    userId: string | null,
  ): Promise<string | null> {
    if (!userId) return null;
    const editor = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId },
      withDeleted: true,
    });
    if (editor) return editor.displayName;
    const user = await this.usersService
      .findByIdInCongregation(userId, tenantId)
      .catch(() => null);
    return user?.email ?? null;
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
