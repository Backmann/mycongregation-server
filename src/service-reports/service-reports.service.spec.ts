// Mock expo-server-sdk to avoid Jest ESM parse errors. Specs that transitively
// import publishers.service.ts pull in push-notifications.service.ts, which
// imports the real Expo SDK; the SDK uses ESM (`import assert from 'node:assert'`)
// that Jest's default transform doesn't process inside node_modules.
jest.mock('expo-server-sdk', () => {
  class MockExpo {
    static isExpoPushToken() {
      return true;
    }
    chunkPushNotifications(messages: any[]) {
      return [messages];
    }
    sendPushNotificationsAsync = jest.fn().mockResolvedValue([]);
  }
  return { Expo: MockExpo };
});

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { ServiceReportsService } from './service-reports.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ReportMonthClosure } from '../entities/report-month-closure.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

// ===========================================================
// Fixtures
// ===========================================================

function makeUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-self',
    email: 'self@example.com',
    role: UserRole.PUBLISHER,
    congregationId: 'cong-1',
    uiLanguage: 'ru',
    ...overrides,
  };
}

function makePublisher(overrides: Partial<Publisher> = {}): Publisher {
  return {
    id: 'pub-self',
    congregationId: 'cong-1',
    userId: 'user-self',
    displayName: 'Self Test',
    firstName: 'Self',
    lastName: 'Test',
    pioneerType: PioneerType.NONE,
    ...overrides,
  } as Publisher;
}

function makeReport(overrides: Partial<ServiceReport> = {}): ServiceReport {
  return {
    id: 'report-1',
    congregationId: 'cong-1',
    publisherId: 'pub-self',
    reportMonth: '2026-04-01',
    servedThisMonth: true,
    hoursReported: null,
    bibleStudies: 0,
    notes: null,
    submittedAt: new Date('2026-05-01T10:00:00Z'),
    submittedById: 'user-self',
    submittedOnBehalfOf: false,
    lastEditedAt: null,
    lastEditedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as ServiceReport;
}

// ===========================================================
// Setup
// ===========================================================

describe('ServiceReportsService', () => {
  let service: ServiceReportsService;
  let reportsRepo: jest.Mocked<Repository<ServiceReport>>;
  let publishersRepo: jest.Mocked<Repository<Publisher>>;
  let serviceGroupsRepo: jest.Mocked<Repository<ServiceGroup>>;
  let responsibilitiesRepo: jest.Mocked<Repository<Responsibility>>;
  let closuresRepo: jest.Mocked<Repository<ReportMonthClosure>>;
  let auditLogService: { logUpdate: jest.Mock; findForEntity: jest.Mock };
  let publishersService: { recomputeStatus: jest.Mock };
  let auxiliaryPioneersService: {
    isActiveAuxiliaryPioneer: jest.Mock;
    activePublisherIdsForMonth: jest.Mock;
  };

  beforeEach(() => {
    reportsRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn((data: Partial<ServiceReport>) => data),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<ServiceReport>>;

    publishersRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<Repository<Publisher>>;

    serviceGroupsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<ServiceGroup>>;

    responsibilitiesRepo = {
      count: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<Repository<Responsibility>>;

    closuresRepo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: Partial<ReportMonthClosure>) => data),
      save: jest.fn(async (r: any) => r),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as jest.Mocked<Repository<ReportMonthClosure>>;

    auditLogService = {
      logUpdate: jest.fn(),
      findForEntity: jest.fn(),
    };
    publishersService = { recomputeStatus: jest.fn() };
    auxiliaryPioneersService = {
      isActiveAuxiliaryPioneer: jest.fn().mockResolvedValue(false),
      activePublisherIdsForMonth: jest.fn().mockResolvedValue(new Set()),
    };
    service = new ServiceReportsService(
      reportsRepo,
      publishersRepo,
      serviceGroupsRepo,
      responsibilitiesRepo,
      closuresRepo,
      auditLogService as any,
      publishersService as any,
      auxiliaryPioneersService as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================
  // isInSelfEditWindow (private)
  // =========================================================

  describe('isInSelfEditWindow', () => {
    const callWindow = (reportMonth: string): boolean =>
      (service as any).isInSelfEditWindow(reportMonth);

    it('returns true when current date is mid-window (May 5 for April report)', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      expect(callWindow('2026-04-01')).toBe(true);
    });

    it('returns true late on the 10th Berlin time (last day of window)', () => {
      // 2026-05-10 23:59:59 Europe/Berlin (CEST, UTC+2) === 21:59:59 UTC.
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.UTC(2026, 4, 10, 21, 59, 59));
      expect(callWindow('2026-04-01')).toBe(true);
    });

    it('returns false at 00:00 on the 11th Berlin time (window closed)', () => {
      // 2026-05-11 00:00 Europe/Berlin (CEST, UTC+2) === 2026-05-10 22:00 UTC.
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 10, 22, 0, 0));
      expect(callWindow('2026-04-01')).toBe(false);
    });

    it('returns false well after the window closed (May 30 for April report)', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 30));
      expect(callWindow('2026-04-01')).toBe(false);
    });

    it('handles year rollover (December → next January)', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2027, 0, 5));
      expect(callWindow('2026-12-01')).toBe(true);

      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2027, 0, 11));
      expect(callWindow('2026-12-01')).toBe(false);
    });

    it('treats YYYY-MM-DD identical to YYYY-MM-01 (only first 7 chars matter)', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      expect(callWindow('2026-04-15')).toBe(true);
      expect(callWindow('2026-04-30')).toBe(true);
    });
  });

  // =========================================================
  // canEditWithCtx (private)
  // =========================================================

  describe('canEditWithCtx', () => {
    const callCan = (
      report: ServiceReport,
      ctx: any,
      groupId: string | null = null,
      isClosed = false,
    ): boolean =>
      (service as any).canEditWithCtx(report, ctx, groupId, isClosed);

    const ctxFor = (over: Record<string, any> = {}) => ({
      userId: 'u1',
      alwaysEdit: false,
      alwaysView: false,
      myPublisherId: 'pub-u1',
      overseenGroupIds: [] as string[],
      ...over,
    });

    beforeEach(() => {
      // Inside window for April reports.
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
    });

    it('owner editing own report within window → true', () => {
      const report = makeReport({ submittedById: 'u1' });
      expect(callCan(report, ctxFor())).toBe(true);
    });

    it('owner editing own report AFTER window closes → false', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 30));
      const report = makeReport({ submittedById: 'u1' });
      expect(callCan(report, ctxFor())).toBe(false);
    });

    it("non-privileged editing another's report → false", () => {
      const report = makeReport({ submittedById: 'u2' });
      expect(callCan(report, ctxFor())).toBe(false);
    });

    it('elder (alwaysView but not alwaysEdit) editing another → false', () => {
      const report = makeReport({ submittedById: 'u2' });
      expect(callCan(report, ctxFor({ alwaysView: true }))).toBe(false);
    });

    it('admin/secretary (alwaysEdit) → true even after window', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 30));
      const report = makeReport({ submittedById: 'u2' });
      expect(callCan(report, ctxFor({ alwaysEdit: true }))).toBe(true);
    });

    it("group overseer editing a member's report within window → true", () => {
      const report = makeReport({ submittedById: 'u2' });
      expect(callCan(report, ctxFor({ overseenGroupIds: ['g1'] }), 'g1')).toBe(
        true,
      );
    });

    it('group overseer AFTER window → false', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 30));
      const report = makeReport({ submittedById: 'u2' });
      expect(callCan(report, ctxFor({ overseenGroupIds: ['g1'] }), 'g1')).toBe(
        false,
      );
    });

    it('owner within window but month CLOSED → false', () => {
      const report = makeReport({ submittedById: 'u1' });
      expect(callCan(report, ctxFor(), null, true)).toBe(false);
    });

    it('overseer within window but month CLOSED → false', () => {
      const report = makeReport({ submittedById: 'u2' });
      expect(
        callCan(report, ctxFor({ overseenGroupIds: ['g1'] }), 'g1', true),
      ).toBe(false);
    });

    it('admin/secretary (alwaysEdit) → true even when month CLOSED', () => {
      const report = makeReport({ submittedById: 'u2' });
      expect(callCan(report, ctxFor({ alwaysEdit: true }), null, true)).toBe(
        true,
      );
    });
  });

  // =========================================================
  // submitOwnReport
  // =========================================================

  describe('submitOwnReport', () => {
    it('rejects a report for the current (unfinished) month', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-self' }),
      );
      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(
        now.getMonth() + 1,
      ).padStart(2, '0')}`;
      await expect(
        service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
          reportMonth: thisMonth,
          servedThisMonth: true,
          bibleStudies: 0,
        }),
      ).rejects.toThrow('already ended');
      expect(reportsRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a report for a future month', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-self' }),
      );
      const future = new Date();
      future.setMonth(future.getMonth() + 2);
      const futureMonth = `${future.getFullYear()}-${String(
        future.getMonth() + 1,
      ).padStart(2, '0')}`;
      await expect(
        service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
          reportMonth: futureMonth,
          servedThisMonth: true,
          bibleStudies: 0,
        }),
      ).rejects.toThrow('already ended');
      expect(reportsRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a report from a student (appointment=STUDENT)', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ appointment: PublisherAppointment.STUDENT }),
      );
      await expect(
        service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
          reportMonth: '2026-04',
          servedThisMonth: true,
          bibleStudies: 0,
        }),
      ).rejects.toThrow('Students do not submit service reports');
      expect(reportsRepo.create).not.toHaveBeenCalled();
    });

    it('an active auxiliary pioneer gets the hours form (pioneerType NONE)', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-self', pioneerType: PioneerType.NONE }),
      );
      auxiliaryPioneersService.isActiveAuxiliaryPioneer.mockResolvedValue(true);
      reportsRepo.save.mockResolvedValue(makeReport());

      await service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
        reportMonth: '2026-04',
        hoursReported: 15,
        bibleStudies: 1,
      });

      expect(reportsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ hoursReported: 15, servedThisMonth: null }),
      );
    });

    it('an active auxiliary pioneer is rejected if they send the non-hours form', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-self', pioneerType: PioneerType.NONE }),
      );
      auxiliaryPioneersService.isActiveAuxiliaryPioneer.mockResolvedValue(true);
      await expect(
        service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
          reportMonth: '2026-04',
          servedThisMonth: true,
          bibleStudies: 0,
        }),
      ).rejects.toThrow();
    });

    describe('regular publisher form (PioneerType.NONE)', () => {
      beforeEach(() => {
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.NONE }),
        );
      });

      it('accepts servedThisMonth=true and persists the right shape', async () => {
        const saved = makeReport();
        reportsRepo.save.mockResolvedValue(saved);

        const result = await service.submitOwnReport(
          'cong-1',
          makeUser({ id: 'user-self' }),
          {
            reportMonth: '2026-04',
            servedThisMonth: true,
            bibleStudies: 2,
          },
        );

        expect(reportsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            congregationId: 'cong-1',
            publisherId: 'pub-self',
            reportMonth: '2026-04-01',
            servedThisMonth: true,
            hoursReported: null,
            bibleStudies: 2,
          }),
        );
        expect(result).toBe(saved);
      });

      it('throws BadRequest if hoursReported is supplied (form variant mismatch)', async () => {
        await expect(
          service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
            reportMonth: '2026-04',
            hoursReported: 50,
            bibleStudies: 0,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('throws BadRequest if servedThisMonth is missing', async () => {
        await expect(
          service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
            reportMonth: '2026-04',
            bibleStudies: 0,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('pioneer form (PioneerType !== NONE)', () => {
      beforeEach(() => {
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.REGULAR }),
        );
      });

      it('accepts hoursReported and persists the right shape', async () => {
        const saved = makeReport({ servedThisMonth: null, hoursReported: 60 });
        reportsRepo.save.mockResolvedValue(saved);

        const result = await service.submitOwnReport(
          'cong-1',
          makeUser({ id: 'user-self' }),
          {
            reportMonth: '2026-04',
            hoursReported: 60,
            bibleStudies: 1,
          },
        );

        expect(reportsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            servedThisMonth: null,
            hoursReported: 60,
          }),
        );
        expect(result).toBe(saved);
      });

      it('throws BadRequest if servedThisMonth is supplied', async () => {
        await expect(
          service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
            reportMonth: '2026-04',
            servedThisMonth: true,
            bibleStudies: 0,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('throws BadRequest if hoursReported is missing', async () => {
        await expect(
          service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
            reportMonth: '2026-04',
            bibleStudies: 0,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('duplicate prevention', () => {
      beforeEach(() => {
        publishersRepo.findOne.mockResolvedValue(makePublisher());
      });

      it('translates Postgres unique violation (23505) to ConflictException', async () => {
        const pgErr: any = new Error(
          'duplicate key value violates unique constraint',
        );
        pgErr.code = '23505';
        reportsRepo.save.mockRejectedValue(pgErr);

        await expect(
          service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
            reportMonth: '2026-04',
            servedThisMonth: true,
            bibleStudies: 0,
          }),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('re-throws non-23505 errors unchanged', async () => {
        const otherErr = new Error('connection lost');
        reportsRepo.save.mockRejectedValue(otherErr);

        await expect(
          service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
            reportMonth: '2026-04',
            servedThisMonth: true,
            bibleStudies: 0,
          }),
        ).rejects.toBe(otherErr);
      });
    });

    describe('user not linked to a publisher', () => {
      it('throws BadRequestException', async () => {
        publishersRepo.findOne.mockResolvedValue(null);

        await expect(
          service.submitOwnReport('cong-1', makeUser({ id: 'orphan-user' }), {
            reportMonth: '2026-04',
            servedThisMonth: true,
            bibleStudies: 0,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('reportMonth normalization', () => {
      beforeEach(() => {
        publishersRepo.findOne.mockResolvedValue(makePublisher());
        reportsRepo.save.mockResolvedValue(makeReport());
      });

      it('normalizes "YYYY-MM" → "YYYY-MM-01"', async () => {
        await service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
          reportMonth: '2026-04',
          servedThisMonth: true,
          bibleStudies: 0,
        });
        expect(reportsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ reportMonth: '2026-04-01' }),
        );
      });

      it('normalizes "YYYY-MM-DD" → "YYYY-MM-01" regardless of day', async () => {
        await service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
          reportMonth: '2026-04-25',
          servedThisMonth: true,
          bibleStudies: 0,
        });
        expect(reportsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ reportMonth: '2026-04-01' }),
        );
      });
    });

    describe('on-behalf submission (admin/secretary/overseer)', () => {
      it('accepts on-behalf when caller is ADMIN', async () => {
        publishersRepo.findOne.mockImplementation(async (opts: any) => {
          if (opts.where.userId === 'admin-id') {
            return makePublisher({ id: 'pub-admin', userId: 'admin-id' });
          }
          if (opts.where.id === 'pub-target') {
            return makePublisher({
              id: 'pub-target',
              userId: 'target-user',
              displayName: 'Target Pub',
              pioneerType: PioneerType.NONE,
            });
          }
          return null;
        });
        reportsRepo.save.mockImplementation(async (r: any) => r);

        await service.submitOwnReport(
          'cong-1',
          makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
          {
            reportMonth: '2026-04',
            publisherId: 'pub-target',
            servedThisMonth: true,
            bibleStudies: 1,
          },
        );

        expect(reportsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            publisherId: 'pub-target',
            submittedById: 'admin-id',
            submittedOnBehalfOf: true,
          }),
        );
      });

      it('forbids on-behalf from a plain elder (not secretary/overseer)', async () => {
        publishersRepo.findOne.mockImplementation(async (opts: any) => {
          if (opts.where.userId === 'elder-id') {
            return makePublisher({ id: 'pub-elder', userId: 'elder-id' });
          }
          if (opts.where.id === 'pub-target') {
            return makePublisher({
              id: 'pub-target',
              pioneerType: PioneerType.NONE,
            });
          }
          return null;
        });

        await expect(
          service.submitOwnReport(
            'cong-1',
            makeUser({ id: 'elder-id', role: UserRole.ELDER }),
            {
              reportMonth: '2026-04',
              publisherId: 'pub-target',
              servedThisMonth: false,
              bibleStudies: 0,
            },
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('accepts on-behalf when caller holds the secretary responsibility', async () => {
        responsibilitiesRepo.count.mockResolvedValue(1);
        publishersRepo.findOne.mockImplementation(async (opts: any) => {
          if (opts.where.userId === 'sec-id') {
            return makePublisher({ id: 'pub-sec', userId: 'sec-id' });
          }
          if (opts.where.id === 'pub-target') {
            return makePublisher({
              id: 'pub-target',
              pioneerType: PioneerType.NONE,
            });
          }
          return null;
        });
        reportsRepo.save.mockImplementation(async (r: any) => r);

        await service.submitOwnReport(
          'cong-1',
          makeUser({ id: 'sec-id', role: UserRole.ELDER }),
          {
            reportMonth: '2026-04',
            publisherId: 'pub-target',
            servedThisMonth: false,
            bibleStudies: 0,
          },
        );

        expect(reportsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            publisherId: 'pub-target',
            submittedOnBehalfOf: true,
          }),
        );
      });

      it('accepts on-behalf when caller oversees the target group', async () => {
        publishersRepo.findOne.mockImplementation(async (opts: any) => {
          if (opts.where.userId === 'ov-id') {
            return makePublisher({ id: 'pub-ov', userId: 'ov-id' });
          }
          if (opts.where.id === 'pub-target') {
            return makePublisher({
              id: 'pub-target',
              serviceGroupId: 'g1',
              pioneerType: PioneerType.NONE,
            });
          }
          return null;
        });
        serviceGroupsRepo.find.mockResolvedValue([
          { id: 'g1', name: 'Group 1' } as ServiceGroup,
        ]);
        reportsRepo.save.mockImplementation(async (r: any) => r);

        await service.submitOwnReport(
          'cong-1',
          makeUser({ id: 'ov-id', role: UserRole.PUBLISHER }),
          {
            reportMonth: '2026-04',
            publisherId: 'pub-target',
            servedThisMonth: false,
            bibleStudies: 0,
          },
        );

        expect(reportsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            publisherId: 'pub-target',
            submittedOnBehalfOf: true,
          }),
        );
      });

      it('forbids on-behalf from a non-privileged publisher', async () => {
        publishersRepo.findOne.mockImplementation(async (opts: any) => {
          if (opts.where.userId === 'user-self') {
            return makePublisher({ id: 'pub-self', userId: 'user-self' });
          }
          if (opts.where.id === 'pub-someone-else') {
            return makePublisher({
              id: 'pub-someone-else',
              serviceGroupId: 'g9',
              pioneerType: PioneerType.NONE,
            });
          }
          return null;
        });
        serviceGroupsRepo.find.mockResolvedValue([]);

        await expect(
          service.submitOwnReport(
            'cong-1',
            makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
            {
              reportMonth: '2026-04',
              publisherId: 'pub-someone-else',
              servedThisMonth: true,
              bibleStudies: 0,
            },
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('throws BadRequest when target publisher does not exist in this congregation', async () => {
        publishersRepo.findOne.mockImplementation(async (opts: any) => {
          if (opts.where.userId === 'admin-id') {
            return makePublisher({ id: 'pub-admin', userId: 'admin-id' });
          }
          return null;
        });

        await expect(
          service.submitOwnReport(
            'cong-1',
            makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
            {
              reportMonth: '2026-04',
              publisherId: 'pub-nonexistent',
              servedThisMonth: true,
              bibleStudies: 0,
            },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("treats publisherId === caller's own publisher as a self submission", async () => {
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ id: 'pub-self', userId: 'user-self' }),
        );
        reportsRepo.save.mockImplementation(async (r: any) => r);

        await service.submitOwnReport(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          {
            reportMonth: '2026-04',
            publisherId: 'pub-self',
            servedThisMonth: true,
            bibleStudies: 0,
          },
        );

        expect(reportsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ submittedOnBehalfOf: false }),
        );
      });
    });
  });

  // =========================================================
  // findOne
  // =========================================================

  describe('findOne', () => {
    it('returns own report with canEdit=true when in window', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      reportsRepo.findOne.mockResolvedValue(
        makeReport({ submittedById: 'user-self' }),
      );
      publishersRepo.find.mockResolvedValue([]);

      const result = await service.findOne(
        'cong-1',
        makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
        'report-1',
      );

      expect(result.canEdit).toBe(true);
      expect(result.lastEditedByName).toBeNull();
    });

    it("forbids non-elder/admin from reading another user's report", async () => {
      reportsRepo.findOne.mockResolvedValue(
        makeReport({ submittedById: 'other-user' }),
      );

      await expect(
        service.findOne(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          'report-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("allows admin to read another user's report", async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      reportsRepo.findOne.mockResolvedValue(
        makeReport({ submittedById: 'other-user' }),
      );
      publishersRepo.find.mockResolvedValue([]);

      const result = await service.findOne(
        'cong-1',
        makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
        'report-1',
      );

      expect(result.canEdit).toBe(true);
    });

    it('throws NotFoundException when the id is missing', async () => {
      reportsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findOne('cong-1', makeUser(), 'missing-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('populates lastEditedByName from the editor publisher displayName', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      reportsRepo.findOne.mockResolvedValue(
        makeReport({
          submittedById: 'user-self',
          lastEditedById: 'editor-user',
        }),
      );
      publishersRepo.find.mockResolvedValue([
        makePublisher({
          userId: 'editor-user',
          displayName: 'Smith Bob',
        }),
      ]);

      const result = await service.findOne(
        'cong-1',
        makeUser({ id: 'user-self' }),
        'report-1',
      );

      expect(result.lastEditedByName).toBe('Smith Bob');
    });
  });

  // =========================================================
  // updateReport
  // =========================================================

  describe('updateReport', () => {
    beforeEach(() => {
      // Default: mid-window for April reports.
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
    });

    describe('permissions', () => {
      it('allows self-edit within the window', async () => {
        reportsRepo.findOne.mockResolvedValue(
          makeReport({ submittedById: 'user-self' }),
        );
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.NONE }),
        );
        publishersRepo.find.mockResolvedValue([]);
        reportsRepo.save.mockImplementation(async (r: any) => r);

        const result = await service.updateReport(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          'report-1',
          { notes: 'fixed typo' },
        );

        expect((result as any).notes).toBe('fixed typo');
      });

      it('forbids self-edit AFTER window closed for non-admin/elder', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 12));
        reportsRepo.findOne.mockResolvedValue(
          makeReport({ submittedById: 'user-self' }),
        );

        await expect(
          service.updateReport(
            'cong-1',
            makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
            'report-1',
            { notes: 'too late' },
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it("forbids non-admin/elder from editing another user's report", async () => {
        reportsRepo.findOne.mockResolvedValue(
          makeReport({ submittedById: 'someone-else' }),
        );

        await expect(
          service.updateReport(
            'cong-1',
            makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
            'report-1',
            { notes: 'meddling' },
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('allows admin to edit any report even out of window', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 30));
        reportsRepo.findOne.mockResolvedValue(
          makeReport({ submittedById: 'someone-else' }),
        );
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.NONE }),
        );
        publishersRepo.find.mockResolvedValue([]);
        reportsRepo.save.mockImplementation(async (r: any) => r);

        await expect(
          service.updateReport(
            'cong-1',
            makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
            'report-1',
            { notes: 'late correction by secretary' },
          ),
        ).resolves.toBeDefined();
      });
    });

    describe('form variant validation on update', () => {
      beforeEach(() => {
        reportsRepo.findOne.mockResolvedValue(
          makeReport({ submittedById: 'user-self' }),
        );
        publishersRepo.find.mockResolvedValue([]);
        reportsRepo.save.mockImplementation(async (r: any) => r);
      });

      it('rejects servedThisMonth on update for a pioneer publisher', async () => {
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.REGULAR }),
        );

        await expect(
          service.updateReport(
            'cong-1',
            makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
            'report-1',
            { servedThisMonth: true },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('rejects hoursReported on update for a regular publisher', async () => {
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.NONE }),
        );

        await expect(
          service.updateReport(
            'cong-1',
            makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
            'report-1',
            { hoursReported: 60 },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('allows hoursReported when the publisher is an auxiliary pioneer that month', async () => {
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.NONE }),
        );
        auxiliaryPioneersService.isActiveAuxiliaryPioneer.mockResolvedValue(
          true,
        );

        const result = await service.updateReport(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          'report-1',
          { hoursReported: 30 },
        );
        expect(result.hoursReported).toBe(30);
      });

      it('rejects servedThisMonth for an auxiliary pioneer that month', async () => {
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.NONE }),
        );
        auxiliaryPioneersService.isActiveAuxiliaryPioneer.mockResolvedValue(
          true,
        );

        await expect(
          service.updateReport(
            'cong-1',
            makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
            'report-1',
            { servedThisMonth: true },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('side effects', () => {
      it('stamps lastEditedAt + lastEditedById on a successful update', async () => {
        reportsRepo.findOne.mockResolvedValue(
          makeReport({ submittedById: 'user-self' }),
        );
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.NONE }),
        );
        publishersRepo.find.mockResolvedValue([]);

        let saved: any;
        reportsRepo.save.mockImplementation(async (r: any) => {
          saved = r;
          return r;
        });

        await service.updateReport(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          'report-1',
          { notes: 'updated' },
        );

        expect(saved.lastEditedAt).toBeInstanceOf(Date);
        expect(saved.lastEditedById).toBe('user-self');
      });
    });

    describe('edge cases', () => {
      it('throws BadRequestException on empty update body', async () => {
        reportsRepo.findOne.mockResolvedValue(
          makeReport({ submittedById: 'user-self' }),
        );
        publishersRepo.findOne.mockResolvedValue(makePublisher());

        await expect(
          service.updateReport(
            'cong-1',
            makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
            'report-1',
            {},
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('throws NotFoundException when the report id does not exist', async () => {
        reportsRepo.findOne.mockResolvedValue(null);

        await expect(
          service.updateReport('cong-1', makeUser(), 'missing-id', {
            notes: 'x',
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    describe('audit logging', () => {
      it('calls auditLogService.logUpdate with before/after snapshots', async () => {
        const r = makeReport({
          id: 'r-1',
          submittedById: 'user-self',
          reportMonth: '2026-04-01',
          bibleStudies: 2,
          notes: 'old',
        });
        reportsRepo.findOne.mockResolvedValue(r);
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.NONE }),
        );
        publishersRepo.find.mockResolvedValue([]);
        reportsRepo.save.mockImplementation(async (x: any) => x);

        jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5, 12, 0, 0));

        await service.updateReport(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          'r-1',
          { bibleStudies: 3, notes: 'new' },
        );

        expect(auditLogService.logUpdate).toHaveBeenCalledTimes(1);
        const call = auditLogService.logUpdate.mock.calls[0][0];
        expect(call.tenantId).toBe('cong-1');
        expect(call.entityType).toBe('ServiceReport');
        expect(call.entityId).toBe('r-1');
        expect(call.actorUserId).toBe('user-self');
        expect(call.fields).toEqual([
          'servedThisMonth',
          'hoursReported',
          'bibleStudies',
          'notes',
        ]);
        expect(call.before.bibleStudies).toBe(2);
        expect(call.before.notes).toBe('old');
        expect(call.after.bibleStudies).toBe(3);
        expect(call.after.notes).toBe('new');
      });

      it('still calls logUpdate even when no fields actually changed (service decides no-op)', async () => {
        const r = makeReport({
          id: 'r-1',
          submittedById: 'user-self',
          reportMonth: '2026-04-01',
          bibleStudies: 2,
        });
        reportsRepo.findOne.mockResolvedValue(r);
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.NONE }),
        );
        publishersRepo.find.mockResolvedValue([]);
        reportsRepo.save.mockImplementation(async (x: any) => x);

        jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5, 12, 0, 0));

        await service.updateReport(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          'r-1',
          { bibleStudies: 2 },
        );

        // The service forwards to audit log unconditionally; the audit log
        // service itself decides whether to write a row.
        expect(auditLogService.logUpdate).toHaveBeenCalledTimes(1);
      });
    });
  });

  // =========================================================
  // findMyReports
  // =========================================================

  describe('findMyReports', () => {
    function mockQueryBuilder(reports: ServiceReport[]) {
      const qb: any = {
        where: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        orderBy: jest.fn(() => qb),
        getMany: jest.fn().mockResolvedValue(reports),
      };
      reportsRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    it('returns reports enriched with canEdit + lastEditedByName', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.findOne.mockResolvedValue(makePublisher());
      mockQueryBuilder([
        makeReport({
          id: 'r1',
          submittedById: 'user-self',
          lastEditedById: null,
        }),
        makeReport({
          id: 'r2',
          submittedById: 'user-self',
          lastEditedById: 'editor-x',
        }),
      ]);
      publishersRepo.find.mockResolvedValue([
        makePublisher({ userId: 'editor-x', displayName: 'Doe Jane' }),
      ]);

      const result = await service.findMyReports(
        'cong-1',
        makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
      );

      expect(result).toHaveLength(2);
      expect(result[0].canEdit).toBe(true);
      expect(result[0].lastEditedByName).toBeNull();
      expect(result[1].lastEditedByName).toBe('Doe Jane');
    });

    it('applies the optional year filter to the query', async () => {
      publishersRepo.findOne.mockResolvedValue(makePublisher());
      const qb = mockQueryBuilder([]);

      await service.findMyReports(
        'cong-1',
        makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
        2026,
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('EXTRACT(YEAR FROM'),
        { year: 2026 },
      );
    });

    it('throws BadRequestException when caller has no publisher record', async () => {
      publishersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findMyReports('cong-1', makeUser({ id: 'orphan' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // =========================================================
  // findGroupReports (Phase B)
  // =========================================================

  describe('findGroupReports', () => {
    it('allows ADMIN to see all publishers in the congregation', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p1', displayName: 'Alpha' }),
        makePublisher({ id: 'p2', displayName: 'Beta' }),
      ]);
      reportsRepo.find.mockResolvedValue([]);
      serviceGroupsRepo.find.mockResolvedValue([]);

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(result.scopeLabel).toBe('Congregation');
      expect(result.publishers).toHaveLength(2);
    });

    it('returns the caller\u2019s own group id as myGroupId', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-me', serviceGroupId: 'my-group' }),
      );
      serviceGroupsRepo.find.mockResolvedValue([
        { id: 'my-group', name: 'My Group' } as ServiceGroup,
      ]);
      publishersRepo.find.mockResolvedValue([makePublisher({ id: 'p1' })]);
      reportsRepo.find.mockResolvedValue([]);

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'user-me', role: UserRole.PUBLISHER }),
        '2026-04',
      );

      expect(result.myGroupId).toBe('my-group');
    });

    it('reports consecutiveMissing for a publisher with no recent reports', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p1', displayName: 'Alpha' }),
      ]);
      // No reports at all (neither the selected month nor the lookback window).
      reportsRepo.find.mockResolvedValue([]);
      serviceGroupsRepo.find.mockResolvedValue([]);

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        '2026-04',
      );

      // 2026-04, 2026-03, ... all missing → capped at 12.
      expect(result.publishers[0].consecutiveMissing).toBeGreaterThanOrEqual(1);
    });

    it('excludes students (appointment=STUDENT) from the congregation list', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.find.mockResolvedValue([]);
      reportsRepo.find.mockResolvedValue([]);
      serviceGroupsRepo.find.mockResolvedValue([]);

      await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        '2026-04',
      );

      // The publisher query must exclude students.
      const call = publishersRepo.find.mock.calls.find(
        (c) => c[0]?.where?.congregationId === 'cong-1',
      );
      expect(call?.[0]?.where?.appointment).toBeDefined();
    });

    it('allows ELDER to see all publishers in the congregation', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.find.mockResolvedValue([makePublisher({ id: 'p1' })]);
      reportsRepo.find.mockResolvedValue([]);
      serviceGroupsRepo.find.mockResolvedValue([]);

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'elder', role: UserRole.ELDER }),
        '2026-04',
      );

      expect(result.publishers).toHaveLength(1);
    });

    it('forbids non-elder/admin who oversees no group', async () => {
      publishersRepo.findOne.mockResolvedValue(makePublisher({ id: 'pub-me' }));
      serviceGroupsRepo.find.mockResolvedValue([]);

      await expect(
        service.findGroupReports(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          '2026-04',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows overseer to see publishers in their group(s)', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-overseer' }),
      );
      serviceGroupsRepo.find.mockResolvedValue([
        { id: 'group-1', name: 'Group 1' } as ServiceGroup,
      ]);
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p1', displayName: 'Alpha' }),
        makePublisher({ id: 'p2', displayName: 'Beta' }),
      ]);
      reportsRepo.find.mockResolvedValue([]);

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'user-overseer', role: UserRole.PUBLISHER }),
        '2026-04',
      );

      expect(result.scopeLabel).toBe('Group 1');
      expect(result.publishers).toHaveLength(2);
      expect(serviceGroupsRepo.find).toHaveBeenCalledWith({
        where: [
          { congregationId: 'cong-1', overseerPublisherId: 'pub-overseer' },
          { congregationId: 'cong-1', assistantPublisherId: 'pub-overseer' },
        ],
      });
    });

    it('allows the group ASSISTANT to see their group (same as overseer)', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-assistant' }),
      );
      serviceGroupsRepo.find.mockResolvedValue([
        { id: 'group-1', name: 'Group 1' } as ServiceGroup,
      ]);
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p1', displayName: 'Alpha' }),
      ]);
      reportsRepo.find.mockResolvedValue([]);

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'user-assistant', role: UserRole.PUBLISHER }),
        '2026-04',
      );

      expect(result.publishers).toHaveLength(1);
      // The query is an OR over overseer/assistant, so the assistant resolves
      // the same group.
      expect(serviceGroupsRepo.find).toHaveBeenCalledWith({
        where: [
          { congregationId: 'cong-1', overseerPublisherId: 'pub-assistant' },
          { congregationId: 'cong-1', assistantPublisherId: 'pub-assistant' },
        ],
      });
    });

    it('includes groupName on each row for client grouping', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p1', displayName: 'Alpha', serviceGroupId: 'g1' }),
      ]);
      reportsRepo.find.mockResolvedValue([]);
      serviceGroupsRepo.find.mockResolvedValue([
        { id: 'g1', name: 'Group One' } as ServiceGroup,
      ]);

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(result.publishers[0].groupName).toBe('Group One');
      expect(result.publishers[0].groupId).toBe('g1');
    });

    it('flags an auxiliary pioneer as isPioneer for the month (hours form)', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.find.mockResolvedValue([
        makePublisher({
          id: 'p-aux',
          displayName: 'Aux',
          pioneerType: PioneerType.NONE,
        }),
      ]);
      reportsRepo.find.mockResolvedValue([]);
      serviceGroupsRepo.find.mockResolvedValue([]);
      auxiliaryPioneersService.activePublisherIdsForMonth.mockResolvedValue(
        new Set(['p-aux']),
      );

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(result.publishers[0].isPioneer).toBe(true);
    });

    it('returns null report for publishers without a submission', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p1', displayName: 'Alpha' }),
        makePublisher({ id: 'p2', displayName: 'Beta' }),
      ]);
      reportsRepo.find.mockResolvedValue([
        makeReport({ id: 'r1', publisherId: 'p1' }),
      ]);

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(result.publishers[0].report).not.toBeNull();
      expect(result.publishers[0].report!.id).toBe('r1');
      expect(result.publishers[1].report).toBeNull();
    });

    it('enriches each report with canEdit and lastEditedByName', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.find.mockResolvedValue([makePublisher({ id: 'p1' })]);
      reportsRepo.find.mockResolvedValue([
        makeReport({
          id: 'r1',
          publisherId: 'p1',
          lastEditedById: null,
        }),
      ]);

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(result.publishers[0].report).not.toBeNull();
      expect(result.publishers[0].report!.canEdit).toBe(true);
      expect(result.publishers[0].report!.lastEditedByName).toBeNull();
    });
  });

  // =========================================================
  // getSummary — secretary/admin monthly figures
  // =========================================================
  describe('getSummary', () => {
    it('forbids a plain publisher', async () => {
      responsibilitiesRepo.count.mockResolvedValue(0);
      publishersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getSummary(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          '2026-04',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids an elder (view-only, not a summary recipient)', async () => {
      responsibilitiesRepo.count.mockResolvedValue(0);
      publishersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getSummary(
          'cong-1',
          makeUser({ id: 'elder-id', role: UserRole.ELDER }),
          '2026-04',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('aggregates the five categories and the active total for an admin', async () => {
      publishersRepo.findOne.mockResolvedValue(null);
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p-pub-a', pioneerType: PioneerType.NONE }),
        makePublisher({ id: 'p-pub-b', pioneerType: PioneerType.NONE }),
        makePublisher({ id: 'p-pub-c', pioneerType: PioneerType.NONE }),
        makePublisher({
          id: 'p-aux',
          pioneerType: PioneerType.AUXILIARY_UNTIL_CANCELLED,
        }),
        makePublisher({ id: 'p-reg', pioneerType: PioneerType.REGULAR }),
        makePublisher({ id: 'p-spec', pioneerType: PioneerType.SPECIAL }),
        makePublisher({ id: 'p-miss', pioneerType: PioneerType.MISSIONARY }),
      ]);
      reportsRepo.find.mockResolvedValue([
        // two publishers shared, one explicitly did not — only the two count
        makeReport({
          publisherId: 'p-pub-a',
          servedThisMonth: true,
          hoursReported: null,
          bibleStudies: 2,
        }),
        makeReport({
          publisherId: 'p-pub-b',
          servedThisMonth: true,
          hoursReported: null,
          bibleStudies: 1,
        }),
        makeReport({
          publisherId: 'p-pub-c',
          servedThisMonth: false,
          hoursReported: null,
          bibleStudies: 5,
        }),
        makeReport({
          publisherId: 'p-aux',
          servedThisMonth: null,
          hoursReported: 30,
          bibleStudies: 1,
        }),
        makeReport({
          publisherId: 'p-reg',
          servedThisMonth: null,
          hoursReported: 50,
          bibleStudies: 3,
        }),
        makeReport({
          publisherId: 'p-spec',
          servedThisMonth: null,
          hoursReported: 100,
          bibleStudies: 4,
        }),
        makeReport({
          publisherId: 'p-miss',
          servedThisMonth: null,
          hoursReported: 120,
          bibleStudies: 6,
        }),
      ]);
      // active+irregular query passes an In([...]) operator; the inactive
      // query passes the bare 'inactive' string — distinguish on that.
      publishersRepo.count.mockImplementation(async (opts: any) =>
        typeof opts?.where?.status === 'string' ? 5 : 42,
      );

      const result = await service.getSummary(
        'cong-1',
        makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(result.reportMonth).toBe('2026-04-01');
      expect(result.totalActivePublishers).toBe(42);
      expect(result.totalInactivePublishers).toBe(5);
      expect(result.categories.map((c) => c.pioneerType)).toEqual([
        PioneerType.NONE,
        PioneerType.AUXILIARY_UNTIL_CANCELLED,
        PioneerType.REGULAR,
        PioneerType.SPECIAL,
        PioneerType.MISSIONARY,
      ]);

      const byType = Object.fromEntries(
        result.categories.map((c) => [c.pioneerType, c]),
      );
      // publishers: only the two who shared; studies summed over them; no hours
      expect(byType[PioneerType.NONE].count).toBe(2);
      expect(byType[PioneerType.NONE].hours).toBeNull();
      expect(byType[PioneerType.NONE].bibleStudies).toBe(3);
      // pioneers: each report counts, hours + studies summed
      expect(byType[PioneerType.AUXILIARY_UNTIL_CANCELLED]).toMatchObject({
        count: 1,
        hours: 30,
        bibleStudies: 1,
      });
      expect(byType[PioneerType.REGULAR]).toMatchObject({
        count: 1,
        hours: 50,
        bibleStudies: 3,
      });
      expect(byType[PioneerType.SPECIAL]).toMatchObject({
        count: 1,
        hours: 100,
        bibleStudies: 4,
      });
      expect(byType[PioneerType.MISSIONARY]).toMatchObject({
        count: 1,
        hours: 120,
        bibleStudies: 6,
      });

      // Averages: pioneer hours (30+50+100+120)/4 = 75; six reporters shared
      // (2 publishers + 4 pioneers), studies (2+1+1+3+4+6)/6 = 2.8; submitted
      // 6/42 ≈ 14%; active 42/(42+5) ≈ 89%.
      expect(result.averages.pioneerHours).toBe(75);
      expect(result.averages.bibleStudies).toBeCloseTo(2.8, 1);
      expect(result.averages.submittedPct).toBe(14);
      expect(result.averages.activePct).toBe(89);
    });

    it('allows the secretary and returns zeroed categories when no reports', async () => {
      responsibilitiesRepo.count.mockResolvedValue(1);
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-sec', userId: 'sec-id' }),
      );
      publishersRepo.find.mockResolvedValue([]);
      reportsRepo.find.mockResolvedValue([]);
      publishersRepo.count.mockImplementation(async (opts: any) =>
        typeof opts?.where?.status === 'string' ? 2 : 7,
      );

      const result = await service.getSummary(
        'cong-1',
        makeUser({ id: 'sec-id', role: UserRole.PUBLISHER }),
        '2026-04',
      );

      expect(result.totalActivePublishers).toBe(7);
      expect(result.totalInactivePublishers).toBe(2);
      expect(result.categories).toHaveLength(5);
      expect(result.categories.every((c) => c.count === 0)).toBe(true);
      expect(result.categories[0].bibleStudies).toBe(0);
    });
  });

  // =========================================================
  // Year summary — service year Sep..Aug
  // =========================================================
  describe('getS21Data', () => {
    it('forbids a plain publisher', async () => {
      await expect(
        service.getS21Data(
          'cong-1',
          makeUser({ id: 'user-x', role: UserRole.PUBLISHER }),
          'pub-1',
          2026,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids a ministerial servant', async () => {
      await expect(
        service.getS21Data(
          'cong-1',
          makeUser({ id: 'user-ms', role: UserRole.MINISTERIAL_SERVANT }),
          'pub-1',
          2026,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an elder and returns the year rows', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-1', firstName: 'Anna', lastName: 'B' }),
      );
      reportsRepo.find.mockResolvedValue([
        makeReport({
          publisherId: 'pub-1',
          reportMonth: '2025-09-01',
          servedThisMonth: true,
          bibleStudies: 2,
        }),
      ]);

      const result = await service.getS21Data(
        'cong-1',
        makeUser({ id: 'elder', role: UserRole.ELDER }),
        'pub-1',
        2026,
      );

      expect(result.serviceYear).toBe(2026);
      expect(result.publisher.id).toBe('pub-1');
      expect(result.months).toHaveLength(1);
      expect(result.months[0].reportMonth).toBe('2025-09-01');
    });

    it('allows an admin', async () => {
      publishersRepo.findOne.mockResolvedValue(makePublisher({ id: 'pub-1' }));
      reportsRepo.find.mockResolvedValue([]);

      const result = await service.getS21Data(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        'pub-1',
        2026,
      );
      expect(result.months).toEqual([]);
    });
  });

  describe('getYearSummary', () => {
    it('forbids a plain publisher', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub', userId: 'user-x' }),
      );
      await expect(
        service.getYearSummary(
          'cong-1',
          makeUser({ id: 'user-x', role: UserRole.PUBLISHER }),
          2026,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sums hours and studies across the service year for an admin', async () => {
      publishersRepo.findOne.mockResolvedValue(null);
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p-reg', pioneerType: PioneerType.REGULAR }),
        makePublisher({ id: 'p-pub', pioneerType: PioneerType.NONE }),
      ]);
      reportsRepo.find.mockResolvedValue([
        makeReport({
          publisherId: 'p-reg',
          reportMonth: '2025-09-01',
          servedThisMonth: null,
          hoursReported: 50,
          bibleStudies: 2,
        }),
        makeReport({
          publisherId: 'p-reg',
          reportMonth: '2025-10-01',
          servedThisMonth: null,
          hoursReported: 60,
          bibleStudies: 3,
        }),
        makeReport({
          publisherId: 'p-pub',
          reportMonth: '2025-09-01',
          servedThisMonth: true,
          hoursReported: null,
          bibleStudies: 1,
        }),
      ]);

      const result = await service.getYearSummary(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        2026,
      );

      expect(result.serviceYear).toBe(2026);
      expect(result.firstMonth).toBe('2025-09-01');
      expect(result.lastMonth).toBe('2026-08-01');
      expect(result.totalHours).toBe(110);
      expect(result.totalStudies).toBe(6);
      expect(result.monthly).toHaveLength(12);
      // September bucket: 50 hours, studies 2 (reg) + 1 (pub) = 3.
      const sep = result.monthly.find((m) => m.reportMonth === '2025-09-01');
      expect(sep?.hours).toBe(50);
      expect(sep?.studies).toBe(3);
    });
  });

  // =========================================================
  // Month closure — close / reopen / status + freeze
  // =========================================================
  describe('month closure', () => {
    it('getClosureStatus reports open with canManage for an admin', async () => {
      publishersRepo.findOne.mockResolvedValue(null);
      closuresRepo.findOne.mockResolvedValue(null);

      const result = await service.getClosureStatus(
        'cong-1',
        makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(result).toMatchObject({
        reportMonth: '2026-04-01',
        closed: false,
        closedAt: null,
        canManage: true,
      });
    });

    it('getClosureStatus: canManage is false for a plain publisher', async () => {
      responsibilitiesRepo.count.mockResolvedValue(0);
      publishersRepo.findOne.mockResolvedValue(null);
      closuresRepo.findOne.mockResolvedValue(null);

      const result = await service.getClosureStatus(
        'cong-1',
        makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
        '2026-04',
      );

      expect(result.canManage).toBe(false);
    });

    it('closeMonth forbids a plain publisher', async () => {
      responsibilitiesRepo.count.mockResolvedValue(0);
      publishersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.closeMonth(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          '2026-04',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(closuresRepo.save).not.toHaveBeenCalled();
    });

    it('closeMonth inserts a closure and returns closed=true for the secretary', async () => {
      responsibilitiesRepo.count.mockResolvedValue(1);
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-sec', userId: 'sec-id' }),
      );
      closuresRepo.findOne
        .mockResolvedValueOnce(null) // existing? no
        .mockResolvedValueOnce({
          reportMonth: '2026-04-01',
          closedAt: new Date('2026-05-12T09:00:00Z'),
        } as ReportMonthClosure); // buildClosureStatus re-read

      const result = await service.closeMonth(
        'cong-1',
        makeUser({ id: 'sec-id', role: UserRole.PUBLISHER }),
        '2026-04',
      );

      expect(closuresRepo.save).toHaveBeenCalled();
      expect(result.closed).toBe(true);
      expect(result.canManage).toBe(true);
    });

    it('closeMonth is idempotent — no second insert when already closed', async () => {
      publishersRepo.findOne.mockResolvedValue(null);
      closuresRepo.findOne.mockResolvedValue({
        reportMonth: '2026-04-01',
        closedAt: new Date(),
      } as ReportMonthClosure);

      await service.closeMonth(
        'cong-1',
        makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(closuresRepo.save).not.toHaveBeenCalled();
    });

    it('reopenMonth deletes the closure for an admin', async () => {
      publishersRepo.findOne.mockResolvedValue(null);
      closuresRepo.findOne.mockResolvedValue(null);

      const result = await service.reopenMonth(
        'cong-1',
        makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(closuresRepo.delete).toHaveBeenCalledWith({
        congregationId: 'cong-1',
        reportMonth: '2026-04-01',
      });
      expect(result.closed).toBe(false);
    });

    it('updateReport is frozen when the month is closed (owner, in window)', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      reportsRepo.findOne.mockResolvedValue(
        makeReport({
          id: 'rep-1',
          publisherId: 'pub-self',
          submittedById: 'user-self',
          reportMonth: '2026-04-01',
        }),
      );
      responsibilitiesRepo.count.mockResolvedValue(0);
      publishersRepo.findOne.mockImplementation(async (opts: any) => {
        if (opts.where.userId === 'user-self') {
          return makePublisher({ id: 'pub-self', userId: 'user-self' });
        }
        if (opts.where.id === 'pub-self') {
          return makePublisher({ id: 'pub-self', userId: 'user-self' });
        }
        return null;
      });
      closuresRepo.count.mockResolvedValue(1); // month closed

      await expect(
        service.updateReport(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          'rep-1',
          { bibleStudies: 3 },
        ),
      ).rejects.toThrow(/closed/i);
      expect(reportsRepo.save).not.toHaveBeenCalled();
    });
  });
});
