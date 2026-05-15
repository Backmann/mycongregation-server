import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  computeStatusFromReports,
  PublishersService,
} from './publishers.service';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function makePublisher(overrides: Partial<Publisher> = {}): Publisher {
  return {
    id: 'pub-1',
    congregationId: 'cong-1',
    displayName: 'Test Publisher',
    firstName: 'Test',
    lastName: 'Publisher',
    isActive: true,
    isRegular: true,
    pioneerType: PioneerType.NONE,
    status: PublisherStatus.INACTIVE,
    statusManuallyOverridden: false,
    statusOverriddenById: null,
    statusOverriddenAt: null,
    ...overrides,
  } as unknown as Publisher;
}

function makeReport(overrides: Partial<ServiceReport> = {}): ServiceReport {
  return {
    id: 'r-1',
    publisherId: 'pub-1',
    congregationId: 'cong-1',
    reportMonth: '2026-04-01',
    servedThisMonth: true,
    hoursReported: null,
    bibleStudies: 0,
    notes: null,
    ...overrides,
  } as unknown as ServiceReport;
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-self',
    email: 'self@example.com',
    role: UserRole.PUBLISHER,
    congregationId: 'cong-1',
    ...overrides,
  } as AuthenticatedUser;
}

describe('computeStatusFromReports (pure function)', () => {
  // currentMonth is May 2026 → window covers Dec 2025 through May 2026
  const may2026 = new Date(Date.UTC(2026, 4, 15));

  it('returns INACTIVE for an empty report list', () => {
    expect(computeStatusFromReports([], may2026)).toBe(
      PublisherStatus.INACTIVE,
    );
  });

  it('returns ACTIVE when all 6 months in window have served reports', () => {
    const months = [
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
    ];
    const reports = months.map((m) =>
      makeReport({ reportMonth: m, servedThisMonth: true, hoursReported: null }),
    );
    expect(computeStatusFromReports(reports, may2026)).toBe(
      PublisherStatus.ACTIVE,
    );
  });

  it('returns IRREGULAR when 1-5 months in window have served reports', () => {
    const reports = [
      makeReport({ reportMonth: '2026-03-01', servedThisMonth: true }),
      makeReport({ reportMonth: '2026-04-01', servedThisMonth: true }),
    ];
    expect(computeStatusFromReports(reports, may2026)).toBe(
      PublisherStatus.IRREGULAR,
    );
  });

  it('returns INACTIVE when every report in window has servedThisMonth=false', () => {
    const reports = [
      makeReport({ reportMonth: '2026-03-01', servedThisMonth: false }),
      makeReport({ reportMonth: '2026-04-01', servedThisMonth: false }),
    ];
    expect(computeStatusFromReports(reports, may2026)).toBe(
      PublisherStatus.INACTIVE,
    );
  });

  it('counts a pioneer hours>0 report as served', () => {
    const reports = [
      makeReport({
        reportMonth: '2026-04-01',
        servedThisMonth: null,
        hoursReported: 60,
      }),
    ];
    expect(computeStatusFromReports(reports, may2026)).toBe(
      PublisherStatus.IRREGULAR,
    );
  });

  it('does not count a pioneer hours=0 report as served', () => {
    const reports = [
      makeReport({
        reportMonth: '2026-04-01',
        servedThisMonth: null,
        hoursReported: 0,
      }),
    ];
    expect(computeStatusFromReports(reports, may2026)).toBe(
      PublisherStatus.INACTIVE,
    );
  });

  it('ignores reports older than the 6-month window', () => {
    const reports = [
      // 7 months before May 2026 = October 2025 — outside window
      makeReport({ reportMonth: '2025-10-01', servedThisMonth: true }),
      // 8 months before — also outside
      makeReport({ reportMonth: '2025-09-01', servedThisMonth: true }),
    ];
    expect(computeStatusFromReports(reports, may2026)).toBe(
      PublisherStatus.INACTIVE,
    );
  });

  it('deduplicates by month so two reports for the same month count once', () => {
    const reports = [
      makeReport({ reportMonth: '2026-04-01', servedThisMonth: true }),
      makeReport({ reportMonth: '2026-04-01', servedThisMonth: true }),
    ];
    expect(computeStatusFromReports(reports, may2026)).toBe(
      PublisherStatus.IRREGULAR,
    );
  });
});

describe('PublishersService.recomputeStatus + overrideStatus', () => {
  let service: PublishersService;
  let publishersRepo: jest.Mocked<Repository<Publisher>>;
  let reportsRepo: jest.Mocked<Repository<ServiceReport>>;
  let auditLogService: { logUpdate: jest.Mock; findForEntity: jest.Mock };
  let pushNotificationsService: { sendStatusChange: jest.Mock };

  beforeEach(() => {
    publishersRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<Repository<Publisher>>;
    reportsRepo = {
      find: jest.fn(),
    } as unknown as jest.Mocked<Repository<ServiceReport>>;
    auditLogService = {
      logUpdate: jest.fn(),
      findForEntity: jest.fn(),
    };
    pushNotificationsService = {
      sendStatusChange: jest.fn().mockResolvedValue(undefined),
    };
    service = new PublishersService(
      publishersRepo,
      reportsRepo,
      auditLogService as any,
      pushNotificationsService as any,
    );
  });

  describe('recomputeStatus', () => {
    it('updates publisher status when status was not manually overridden', async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.INACTIVE,
        statusManuallyOverridden: false,
      });
      publishersRepo.findOne.mockResolvedValue(pub);
      reportsRepo.find.mockResolvedValue([
        makeReport({ reportMonth: '2026-04-01', servedThisMonth: true }),
      ]);
      publishersRepo.save.mockImplementation(async (x: any) => x);

      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15));

      await service.recomputeStatus('cong-1', 'pub-1');

      expect(publishersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'pub-1',
          status: PublisherStatus.IRREGULAR,
        }),
      );
    });

    it('does NOT update when statusManuallyOverridden=true', async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.ACTIVE,
        statusManuallyOverridden: true,
      });
      publishersRepo.findOne.mockResolvedValue(pub);
      reportsRepo.find.mockResolvedValue([
        makeReport({ reportMonth: '2026-04-01', servedThisMonth: false }),
      ]);

      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15));

      await service.recomputeStatus('cong-1', 'pub-1');

      expect(publishersRepo.save).not.toHaveBeenCalled();
    });

    it('does not write when computed status equals stored status (no-op save)', async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.INACTIVE,
        statusManuallyOverridden: false,
      });
      publishersRepo.findOne.mockResolvedValue(pub);
      reportsRepo.find.mockResolvedValue([]);

      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15));

      await service.recomputeStatus('cong-1', 'pub-1');

      expect(publishersRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the publisher does not exist', async () => {
      publishersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.recomputeStatus('cong-1', 'pub-missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('overrideStatus', () => {
    it('sets status + statusManuallyOverridden flag + actor metadata + writes audit log', async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.INACTIVE,
        statusManuallyOverridden: false,
      });
      publishersRepo.findOne.mockResolvedValue(pub);
      publishersRepo.save.mockImplementation(async (x: any) => x);

      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15, 10, 0, 0));

      await service.overrideStatus(
        'cong-1',
        makeUser({ id: 'admin-1', role: UserRole.ADMIN }),
        'pub-1',
        { status: PublisherStatus.ACTIVE },
      );

      expect(publishersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PublisherStatus.ACTIVE,
          statusManuallyOverridden: true,
          statusOverriddenById: 'admin-1',
        }),
      );
      expect(auditLogService.logUpdate).toHaveBeenCalledTimes(1);
      const call = auditLogService.logUpdate.mock.calls[0][0];
      expect(call.entityType).toBe('Publisher');
      expect(call.entityId).toBe('pub-1');
      expect(call.actorUserId).toBe('admin-1');
      expect(call.before.status).toBe(PublisherStatus.INACTIVE);
      expect(call.after.status).toBe(PublisherStatus.ACTIVE);
    });

    it('forbids non-admin/elder callers', async () => {
      await expect(
        service.overrideStatus(
          'cong-1',
          makeUser({ id: 'pub-user', role: UserRole.PUBLISHER }),
          'pub-1',
          { status: PublisherStatus.ACTIVE },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('clearOverride', () => {
    it('resets the override flag and triggers recompute', async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.ACTIVE,
        statusManuallyOverridden: true,
        statusOverriddenById: 'admin-1',
        statusOverriddenAt: new Date(),
      });
      // 1st findOne in clearOverride, 2nd findOne inside recomputeStatus
      publishersRepo.findOne
        .mockResolvedValueOnce(pub)
        .mockResolvedValueOnce({ ...pub, statusManuallyOverridden: false });
      publishersRepo.save.mockImplementation(async (x: any) => x);
      reportsRepo.find.mockResolvedValue([]);

      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15));

      await service.clearOverride(
        'cong-1',
        makeUser({ id: 'admin-1', role: UserRole.ADMIN }),
        'pub-1',
      );

      // First save: clearing the override
      expect(publishersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'pub-1',
          statusManuallyOverridden: false,
          statusOverriddenById: null,
          statusOverriddenAt: null,
        }),
      );
    });
  });

  describe('recomputeStatus return values', () => {
    it("returns 'updated' when computed status differs from stored", async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.INACTIVE,
        statusManuallyOverridden: false,
      });
      publishersRepo.findOne.mockResolvedValue(pub);
      reportsRepo.find.mockResolvedValue([
        makeReport({ reportMonth: '2026-04-01', servedThisMonth: true }),
      ]);
      publishersRepo.save.mockImplementation(async (x: any) => x);
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15));

      const result = await service.recomputeStatus('cong-1', 'pub-1');
      expect(result).toBe('updated');
    });

    it("returns 'unchanged' when computed status equals stored", async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.INACTIVE,
        statusManuallyOverridden: false,
      });
      publishersRepo.findOne.mockResolvedValue(pub);
      reportsRepo.find.mockResolvedValue([]);
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15));

      const result = await service.recomputeStatus('cong-1', 'pub-1');
      expect(result).toBe('unchanged');
    });

    it("returns 'skipped_override' when statusManuallyOverridden=true", async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.ACTIVE,
        statusManuallyOverridden: true,
      });
      publishersRepo.findOne.mockResolvedValue(pub);

      const result = await service.recomputeStatus('cong-1', 'pub-1');
      expect(result).toBe('skipped_override');
    });
  });

  describe('recomputeAllStatuses', () => {
    it('iterates publishers, aggregates counts, respects overrides', async () => {
      const pubs = [
        makePublisher({
          id: 'a',
          congregationId: 'cong-1',
          status: PublisherStatus.INACTIVE,
          statusManuallyOverridden: false,
        }),
        makePublisher({
          id: 'b',
          congregationId: 'cong-1',
          status: PublisherStatus.ACTIVE,
          statusManuallyOverridden: true,
        }),
        makePublisher({
          id: 'c',
          congregationId: 'cong-1',
          status: PublisherStatus.INACTIVE,
          statusManuallyOverridden: false,
        }),
      ];
      publishersRepo.find.mockResolvedValue(pubs as any);
      publishersRepo.findOne.mockImplementation(async (options: any) => {
        const id = options?.where?.id;
        return pubs.find((p) => p.id === id) ?? null;
      });
      reportsRepo.find.mockImplementation(async (options: any) => {
        const pubId = options?.where?.publisherId;
        if (pubId === 'a') {
          return [
            makeReport({ reportMonth: '2026-04-01', servedThisMonth: true }),
          ] as any;
        }
        return [] as any;
      });
      publishersRepo.save.mockImplementation(async (x: any) => x);
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15));

      const summary = await service.recomputeAllStatuses();
      expect(summary.processed).toBe(3);
      expect(summary.updated).toBe(1); // 'a': inactive → irregular
      expect(summary.unchanged).toBe(1); // 'c': stays inactive
      expect(summary.skipped).toBe(1); // 'b': manual override
      expect(summary.errors).toBe(0);
    });

    it('counts per-publisher errors without failing the whole run', async () => {
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'broken', congregationId: 'cong-1' }),
      ] as any);
      publishersRepo.findOne.mockRejectedValue(new Error('boom'));

      const summary = await service.recomputeAllStatuses();
      expect(summary.processed).toBe(1);
      expect(summary.errors).toBe(1);
      expect(summary.updated).toBe(0);
    });
  });
});
