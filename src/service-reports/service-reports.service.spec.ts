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
import { setNow, restoreNow } from '../common/testing/set-now';
import { clockStub } from '../common/testing/clock-stub';

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
  let auditLogService: {
    logUpdate: jest.Mock;
    logEvent: jest.Mock;
    findForEntity: jest.Mock;
  };
  let publishersService: {
    recomputeStatus: jest.Mock;
    recomputeForCongregation: jest.Mock;
  };
  let auxiliaryPioneersService: {
    isActiveAuxiliaryPioneer: jest.Mock;
    activePublisherIdsForMonth: jest.Mock;
    auxiliaryMonthsForPublisher: jest.Mock;
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
    // Resolving «my card» reads the LIST now, so a login with two cards is
    // settled by a rule instead of by chance. The tests set findOne; mirror it
    // into find so each one keeps saying what it was written to say.
    (publishersRepo.find as jest.Mock).mockImplementation(async (opts: any) => {
      if (!opts?.where?.userId) return [];
      const one = await (publishersRepo.findOne as jest.Mock)(opts);
      return one ? [one] : [];
    });

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
      logEvent: jest.fn(),
      logUpdate: jest.fn(),
      findForEntity: jest.fn(),
    };
    publishersService = {
      recomputeStatus: jest.fn(),
      recomputeForCongregation: jest.fn().mockResolvedValue({}),
    };
    auxiliaryPioneersService = {
      isActiveAuxiliaryPioneer: jest.fn().mockResolvedValue(false),
      activePublisherIdsForMonth: jest.fn().mockResolvedValue(new Set()),
      auxiliaryMonthsForPublisher: jest.fn().mockResolvedValue(new Set()),
    };
    service = new ServiceReportsService(
      reportsRepo,
      publishersRepo,
      serviceGroupsRepo,
      responsibilitiesRepo,
      closuresRepo,
      clockStub(),
      auditLogService as any,
      publishersService as any,
      auxiliaryPioneersService as any,
    );
  });

  afterEach(() => {
    restoreNow();
    jest.restoreAllMocks();
  });

  // =========================================================
  // isMonthStillCollecting (private)
  // =========================================================

  /**
   * The window a publisher may correct his own report in.
   *
   * It used to close on the 10th while collection ran to the 20th, and those
   * ten days were a trap: whoever filed on the 13th could not fix a typo in
   * the report he had just handed in, because the window had shut before he
   * filed. One deadline now — the month's own.
   */
  describe('isMonthStillCollecting', () => {
    const callWindow = (reportMonth: string): boolean =>
      (service as any).isMonthStillCollecting(reportMonth, 'Europe/Berlin');

    it('is open in the middle of the collecting month', () => {
      setNow(Date.UTC(2026, 4, 5));
      expect(callWindow('2026-04-01')).toBe(true);
    });

    it('is STILL open on the 13th — the day the old window had already shut', () => {
      setNow(Date.UTC(2026, 4, 13));
      expect(callWindow('2026-04-01')).toBe(true);
    });

    it('is open late on the eve of the closing day', () => {
      // 2026-05-19 23:00 Europe/Berlin (CEST, UTC+2) === 21:00 UTC.
      setNow(Date.UTC(2026, 4, 19, 21, 0, 0));
      expect(callWindow('2026-04-01')).toBe(true);
    });

    it('is shut on the closing day itself — the month has settled', () => {
      setNow(Date.UTC(2026, 4, 20, 10, 0, 0));
      expect(callWindow('2026-04-01')).toBe(false);
    });

    it('is shut well afterwards', () => {
      setNow(Date.UTC(2026, 5, 30));
      expect(callWindow('2026-04-01')).toBe(false);
    });

    it('handles the year rollover (December → next January)', () => {
      setNow(Date.UTC(2027, 0, 15));
      expect(callWindow('2026-12-01')).toBe(true);

      setNow(Date.UTC(2027, 0, 25));
      expect(callWindow('2026-12-01')).toBe(false);
    });

    it('reads only the month, whatever day the month string carries', () => {
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
    });

    it('owner editing own report within window → true', () => {
      const report = makeReport({ submittedById: 'u1' });
      expect(callCan(report, ctxFor())).toBe(true);
    });

    it('owner editing own report AFTER window closes → false', () => {
      setNow(Date.UTC(2026, 4, 30));
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
      setNow(Date.UTC(2026, 4, 30));
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
      setNow(Date.UTC(2026, 4, 30));
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

  describe('myReportStanding', () => {
    const user = { id: 'user-self' } as any;

    // Freeze "now" so the previous-month maths is stable regardless of when
    // the suite runs.
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-15T09:00:00'));
      // The start of a publisher's reporting life now also considers his
      // first report, so the standing asks for his report months.
      reportsRepo.find.mockResolvedValue([]);
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('not applicable when the user has no linked publisher', async () => {
      publishersRepo.findOne.mockResolvedValue(null);
      await expect(service.myReportStanding('cong-1', user)).resolves.toEqual({
        applicable: false,
        reportMonth: null,
        submitted: false,
        reportId: null,
        closesOn: null,
        daysLeft: null,
      });
    });

    it('not applicable for a student', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ appointment: PublisherAppointment.STUDENT }),
      );
      const r = await service.myReportStanding('cong-1', user);
      expect(r.applicable).toBe(false);
    });

    it('not applicable for an explicitly inactivated publisher', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ isActive: false }),
      );
      const r = await service.myReportStanding('cong-1', user);
      expect(r.applicable).toBe(false);
    });

    it('not applicable before the publisher began reporting', async () => {
      // Baptised in June 2026; the previous month (April 2026) predates it.
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ baptismDate: '2026-06-01' }),
      );
      const r = await service.myReportStanding('cong-1', user);
      expect(r.applicable).toBe(false);
    });

    it('outstanding when no report exists for the previous month', async () => {
      publishersRepo.findOne.mockResolvedValue(makePublisher());
      reportsRepo.findOne.mockResolvedValue(null);
      const r = await service.myReportStanding('cong-1', user);
      expect(r).toEqual({
        applicable: true,
        reportMonth: '2026-04-01',
        submitted: false,
        reportId: null,
        // 15 May: April closes on the 20th, so the 19th is the last day of
        // use and four days remain. The screen says the number rather than
        // the rule, and it is answered here so the app never counts it twice.
        closesOn: '2026-05-19',
        daysLeft: 4,
      });
    });

    it('submitted when a report exists for the previous month', async () => {
      publishersRepo.findOne.mockResolvedValue(makePublisher());
      reportsRepo.findOne.mockResolvedValue(
        makeReport({ id: 'r-april', reportMonth: '2026-04-01' }),
      );
      const r = await service.myReportStanding('cong-1', user);
      expect(r).toEqual({
        applicable: true,
        reportMonth: '2026-04-01',
        submitted: true,
        reportId: 'r-april',
        closesOn: '2026-05-19',
        daysLeft: 4,
      });
    });

    it('the previous month rolls across the year boundary', async () => {
      jest.setSystemTime(new Date('2026-01-10T09:00:00'));
      publishersRepo.findOne.mockResolvedValue(makePublisher());
      reportsRepo.findOne.mockResolvedValue(null);
      const r = await service.myReportStanding('cong-1', user);
      expect(r.reportMonth).toBe('2025-12-01');
    });
  });

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

      it('restores a deleted report instead of blocking the month for ever', async () => {
        // Nothing in the app deletes a report today, but the unique key counts
        // deleted rows — so a row removed by hand in the database would lock
        // that month out of the app with no way back through it.
        const pgErr: any = new Error('duplicate key');
        pgErr.code = '23505';
        reportsRepo.save
          .mockRejectedValueOnce(pgErr)
          .mockImplementation(async (x: any) => x);
        reportsRepo.findOne.mockResolvedValue({
          id: 'old-report',
          deletedAt: new Date('2026-07-15T10:00:00Z'),
        } as any);
        (reportsRepo as any).restore = jest.fn(async () => undefined);

        const saved = await service.submitOwnReport(
          'cong-1',
          makeUser({ id: 'user-self' }),
          { reportMonth: '2026-04', servedThisMonth: true, bibleStudies: 0 },
        );

        expect((reportsRepo as any).restore).toHaveBeenCalledWith('old-report');
        // And the row that goes back to the database is no longer deleted.
        // Calling restore() and then saving the entity we already held wrote
        // the deletion back on top of it, and the report stayed invisible.
        expect(saved.deletedAt).toBeNull();
      });

      it('names the report standing in the way, so the app can open it', async () => {
        const pgErr: any = new Error('duplicate key');
        pgErr.code = '23505';
        reportsRepo.save.mockRejectedValue(pgErr);
        reportsRepo.findOne.mockResolvedValue({
          id: 'live-report',
          deletedAt: null,
        } as any);

        await expect(
          service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
            reportMonth: '2026-04',
            servedThisMonth: true,
            bibleStudies: 0,
          }),
        ).rejects.toMatchObject({
          response: { code: 'REPORT_EXISTS', reportId: 'live-report' },
        });
      });

      it('says so plainly when the row is not in this congregation at all', async () => {
        // The month is taken by a row the congregation's own queries cannot
        // see — the case that left a publisher looking at a free month he
        // could not file. Silence here is what made it a mystery.
        const pgErr: any = new Error('duplicate key');
        pgErr.code = '23505';
        reportsRepo.save.mockRejectedValue(pgErr);
        reportsRepo.findOne.mockResolvedValue(null as any);

        await expect(
          service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
            reportMonth: '2026-04',
            servedThisMonth: true,
            bibleStudies: 0,
          }),
        ).rejects.toMatchObject({
          response: { code: 'REPORT_EXISTS_ELSEWHERE' },
        });
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

    describe('future pioneer start date', () => {
      afterEach(() => jest.restoreAllMocks());

      it('uses the publisher (non-hours) form before pioneerSince arrives', async () => {
        setNow(Date.UTC(2026, 4, 30)); // May
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({
            pioneerType: PioneerType.REGULAR,
            pioneerSince: '2026-06-01',
          }),
        );
        auxiliaryPioneersService.isActiveAuxiliaryPioneer.mockResolvedValue(
          false,
        );
        const saved = makeReport({ servedThisMonth: true });
        reportsRepo.save.mockResolvedValue(saved);

        // Reporting for April (before June start) → served checkbox, not hours.
        const result = await service.submitOwnReport(
          'cong-1',
          makeUser({ id: 'user-self' }),
          {
            reportMonth: '2026-04',
            servedThisMonth: true,
            bibleStudies: 0,
          },
        );
        expect(result).toBe(saved);
      });

      it('rejects the hours form before pioneerSince arrives', async () => {
        setNow(Date.UTC(2026, 4, 30)); // May
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({
            pioneerType: PioneerType.REGULAR,
            pioneerSince: '2026-06-01',
          }),
        );
        auxiliaryPioneersService.isActiveAuxiliaryPioneer.mockResolvedValue(
          false,
        );

        await expect(
          service.submitOwnReport('cong-1', makeUser({ id: 'user-self' }), {
            reportMonth: '2026-04',
            hoursReported: 60,
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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

      it('forbids self-edit once the report month has settled', async () => {
        // 20 May: April's collection window has closed. Until 3 September this
        // read «12 May», when the window shut on the 10th — the eight days
        // between were the trap this change removes.
        setNow(Date.UTC(2026, 4, 20));
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
        setNow(Date.UTC(2026, 4, 30));
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

        setNow(Date.UTC(2026, 4, 5, 12, 0, 0));

        await service.updateReport(
          'cong-1',
          makeUser({ id: 'user-self', role: UserRole.PUBLISHER }),
          'r-1',
          { bibleStudies: 3, notes: 'new' },
        );

        expect(auditLogService.logUpdate).toHaveBeenCalledTimes(1);
        const call = auditLogService.logUpdate.mock.calls[0][0];
        expect(call.tenantId).toBe('cong-1');
        expect(call.entityType).toBe('service_report');
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

        setNow(Date.UTC(2026, 4, 5, 12, 0, 0));

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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
      publishersRepo.find.mockResolvedValue([]);
      reportsRepo.find.mockResolvedValue([]);
      serviceGroupsRepo.find.mockResolvedValue([]);

      await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        '2026-04',
      );

      // The publisher query must exclude students.
      // `where` is typed as "one condition or an array of them", so it has to
      // be narrowed before reading a field off it.
      const whereOf = (c: any) =>
        (Array.isArray(c?.[0]?.where) ? c[0].where[0] : c?.[0]?.where) as
          | Record<string, unknown>
          | undefined;
      const call = publishersRepo.find.mock.calls.find(
        (c) => whereOf(c)?.congregationId === 'cong-1',
      );
      expect(whereOf(call)?.appointment).toBeDefined();
    });

    it('allows ELDER to see all publishers in the congregation', async () => {
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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
      setNow(Date.UTC(2026, 4, 5));
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

    it('aggregates the four categories and the active total for an admin', async () => {
      publishersRepo.findOne.mockResolvedValue(null);
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p-pub-a', pioneerType: PioneerType.NONE }),
        makePublisher({ id: 'p-pub-b', pioneerType: PioneerType.NONE }),
        makePublisher({ id: 'p-pub-c', pioneerType: PioneerType.NONE }),
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
      // Only the INACTIVE line is a count of statuses now. «Все активные» is
      // counted the way S-1 words it — everyone who handed in a report at
      // least once in the last six months — so it comes from the reports
      // themselves, and here that is the six distinct publishers above.
      publishersRepo.count.mockResolvedValue(5);

      const result = await service.getSummary(
        'cong-1',
        makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(result.reportMonth).toBe('2026-04-01');
      expect(result.totalActivePublishers).toBe(6);
      expect(result.totalInactivePublishers).toBe(5);
      expect(result.categories.map((c) => c.pioneerType)).toEqual([
        'none',
        'auxiliary',
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

      // Averages: pioneer hours (50+100+120)/3 = 90; five reporters shared
      // (2 publishers + 3 pioneers), studies (2+1+3+4+6)/5 = 3.2; submitted
      // 5/42 ≈ 12%; active 42/(42+5) ≈ 89%.
      expect(result.averages.pioneerHours).toBe(90);
      expect(result.averages.bibleStudies).toBeCloseTo(3.2, 1);
      // Both percentages hang off «все активные», which is now the form's
      // figure rather than a count of statuses — so they move with it.
      expect(result.averages.submittedPct).toBe(83);
      expect(result.averages.activePct).toBe(55);
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

      // No reports in the window at all — so nobody has reported in six
      // months, and the form's figure is zero. It used to answer 7, the count
      // of publishers whose STATUS said active.
      expect(result.totalActivePublishers).toBe(0);
      expect(result.totalInactivePublishers).toBe(2);
      expect(result.categories).toHaveLength(5);
      expect(result.categories.every((c) => c.count === 0)).toBe(true);
      expect(result.categories[0].bibleStudies).toBe(0);
    });

    /**
     * Both cases below were reported from a real congregation: the studies of
     * auxiliary pioneers turned up on the publishers' line, and a sister who
     * becomes a regular pioneer NEXT month was already counted as one, taking
     * her 30 hours with her.
     */
    describe('the month decides the category, not today', () => {
      const summaryFor = async (month = '2026-04') =>
        service.getSummary(
          'cong-1',
          makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
          month,
        );

      const line = (result: any, key: string) =>
        result.categories.find((c: any) => c.pioneerType === key);

      beforeEach(() => {
        publishersRepo.count.mockResolvedValue(10);
      });

      it('puts an auxiliary pioneer on her own line, not among the publishers', async () => {
        publishersRepo.find.mockResolvedValue([
          makePublisher({ id: 'p-pub' }),
          makePublisher({ id: 'p-aux' }),
        ]);
        auxiliaryPioneersService.activePublisherIdsForMonth.mockResolvedValue(
          new Set(['p-aux']),
        );
        reportsRepo.find.mockResolvedValue([
          makeReport({
            publisherId: 'p-pub',
            servedThisMonth: true,
            bibleStudies: 2,
          }),
          makeReport({
            publisherId: 'p-aux',
            servedThisMonth: true,
            hoursReported: 30,
            bibleStudies: 2,
          }),
        ]);

        const result = await summaryFor();

        // The publishers' line keeps only the publisher's own studies — this
        // is the "20 instead of 18" the congregation saw.
        expect(line(result, 'none')).toMatchObject({
          count: 1,
          bibleStudies: 2,
        });
        // And the auxiliary line exists at all, with her hours on it. They
        // used to be discarded entirely.
        expect(line(result, 'auxiliary')).toMatchObject({
          count: 1,
          hours: 30,
          bibleStudies: 2,
        });
      });

      it('does not count a pioneer whose appointment starts next month', async () => {
        publishersRepo.find.mockResolvedValue([
          makePublisher({ id: 'p-reg', pioneerType: PioneerType.REGULAR }),
          // Appointed from May while we are reporting April.
          makePublisher({
            id: 'p-susanne',
            pioneerType: PioneerType.REGULAR,
            pioneerSince: '2026-05-01',
          }),
        ]);
        auxiliaryPioneersService.activePublisherIdsForMonth.mockResolvedValue(
          new Set(['p-susanne']),
        );
        reportsRepo.find.mockResolvedValue([
          makeReport({ publisherId: 'p-reg', hoursReported: 50 }),
          makeReport({ publisherId: 'p-susanne', hoursReported: 30 }),
        ]);

        const result = await summaryFor('2026-04');

        // Nine regulars, not ten — and without her thirty hours.
        expect(line(result, PioneerType.REGULAR)).toMatchObject({
          count: 1,
          hours: 50,
        });
        expect(line(result, 'auxiliary')).toMatchObject({
          count: 1,
          hours: 30,
        });
      });

      it('counts her as a regular pioneer once the month arrives', async () => {
        publishersRepo.find.mockResolvedValue([
          makePublisher({
            id: 'p-susanne',
            pioneerType: PioneerType.REGULAR,
            pioneerSince: '2026-05-01',
          }),
        ]);
        auxiliaryPioneersService.activePublisherIdsForMonth.mockResolvedValue(
          new Set(),
        );
        reportsRepo.find.mockResolvedValue([
          makeReport({
            publisherId: 'p-susanne',
            reportMonth: '2026-05-01',
            hoursReported: 60,
          }),
        ]);

        const result = await summaryFor('2026-05');

        expect(line(result, PioneerType.REGULAR)).toMatchObject({
          count: 1,
          hours: 60,
        });
        expect(line(result, 'auxiliary')).toMatchObject({ count: 0, hours: 0 });
      });

      it('lets a started permanent appointment outrank a stale auxiliary period', async () => {
        publishersRepo.find.mockResolvedValue([
          makePublisher({
            id: 'p-both',
            pioneerType: PioneerType.REGULAR,
            pioneerSince: '2026-01-01',
          }),
        ]);
        // A period left open by mistake must not drag her back down a line.
        auxiliaryPioneersService.activePublisherIdsForMonth.mockResolvedValue(
          new Set(['p-both']),
        );
        reportsRepo.find.mockResolvedValue([
          makeReport({ publisherId: 'p-both', hoursReported: 70 }),
        ]);

        const result = await summaryFor();

        expect(line(result, PioneerType.REGULAR)).toMatchObject({ count: 1 });
        expect(line(result, 'auxiliary')).toMatchObject({ count: 0 });
      });

      it('includes auxiliary hours in the pioneer average and excludes a future pioneer', async () => {
        publishersRepo.find.mockResolvedValue([
          makePublisher({ id: 'p-aux' }),
          makePublisher({
            id: 'p-future',
            pioneerType: PioneerType.REGULAR,
            pioneerSince: '2026-09-01',
          }),
        ]);
        // Both are serving as auxiliary pioneers this month — which is exactly
        // the situation of someone awaiting a regular appointment.
        auxiliaryPioneersService.activePublisherIdsForMonth.mockResolvedValue(
          new Set(['p-aux', 'p-future']),
        );
        reportsRepo.find.mockResolvedValue([
          makeReport({ publisherId: 'p-aux', hoursReported: 30 }),
          makeReport({ publisherId: 'p-future', hoursReported: 50 }),
        ]);

        const result = await summaryFor();

        // Both report hours and both are auxiliary this month, so the average
        // is over the two of them — the future appointment changes nothing.
        expect(result.averages.pioneerHours).toBe(40);
      });
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

    it('marks months served as an auxiliary pioneer', async () => {
      publishersRepo.findOne.mockResolvedValue(makePublisher({ id: 'pub-1' }));
      reportsRepo.find.mockResolvedValue([
        makeReport({
          publisherId: 'pub-1',
          reportMonth: '2025-10-01',
          hoursReported: 30,
          bibleStudies: 1,
        }),
        makeReport({
          publisherId: 'pub-1',
          reportMonth: '2025-11-01',
          servedThisMonth: true,
          bibleStudies: 2,
        }),
      ]);
      auxiliaryPioneersService.auxiliaryMonthsForPublisher.mockResolvedValue(
        new Set(['2025-10']),
      );

      const result = await service.getS21Data(
        'cong-1',
        makeUser({ id: 'elder', role: UserRole.ELDER }),
        'pub-1',
        2026,
      );

      const oct = result.months.find((m) => m.reportMonth === '2025-10-01');
      const nov = result.months.find((m) => m.reportMonth === '2025-11-01');
      expect(oct?.wasAuxiliaryPioneer).toBe(true);
      expect(oct?.hoursReported).toBe(30);
      expect(nov?.wasAuxiliaryPioneer).toBe(false);
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

    it('rejects a student (they do not submit reports)', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({
          id: 'pub-1',
          appointment: PublisherAppointment.STUDENT,
        }),
      );

      await expect(
        service.getS21Data(
          'cong-1',
          makeUser({ id: 'elder', role: UserRole.ELDER }),
          'pub-1',
          2026,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
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

    it('closeMonth settles the statuses and lets them be heard', async () => {
      // The month is over because the secretary says so, not because a date
      // arrived. He is at the screen, so this is the recompute that speaks.
      responsibilitiesRepo.count.mockResolvedValue(1);
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-sec', userId: 'sec-id' }),
      );
      closuresRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        reportMonth: '2026-04-01',
        closedAt: new Date('2026-05-12T09:00:00Z'),
      } as ReportMonthClosure);

      await service.closeMonth(
        'cong-1',
        makeUser({ id: 'sec-id', role: UserRole.PUBLISHER }),
        '2026-04',
      );

      expect(publishersService.recomputeForCongregation).toHaveBeenCalledWith(
        'cong-1',
        { notify: 'always' },
      );
    });

    it('closeMonth still closes the month when the recompute fails', async () => {
      // Bookkeeping the secretary must be able to finish. The nightly sweep
      // will put the statuses right.
      responsibilitiesRepo.count.mockResolvedValue(1);
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-sec', userId: 'sec-id' }),
      );
      closuresRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        reportMonth: '2026-04-01',
        closedAt: new Date('2026-05-12T09:00:00Z'),
      } as ReportMonthClosure);
      publishersService.recomputeForCongregation.mockRejectedValueOnce(
        new Error('boom'),
      );

      const result = await service.closeMonth(
        'cong-1',
        makeUser({ id: 'sec-id', role: UserRole.PUBLISHER }),
        '2026-04',
      );

      expect(closuresRepo.save).toHaveBeenCalled();
      expect(result.closed).toBe(true);
    });

    it('reopenMonth puts the statuses back without telling anyone', async () => {
      publishersRepo.findOne.mockResolvedValue(null);
      closuresRepo.findOne.mockResolvedValue(null);

      await service.reopenMonth(
        'cong-1',
        makeUser({ id: 'admin-id', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(publishersService.recomputeForCongregation).toHaveBeenCalledWith(
        'cong-1',
        { notify: 'never' },
      );
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
      setNow(Date.UTC(2026, 4, 5));
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

  // =========================================================
  // getReportCollection — how the month's collection stands
  // =========================================================
  describe('getReportCollection', () => {
    const admin = {
      id: 'user-admin',
      role: UserRole.ADMIN,
      congregationId: 'cong-1',
    } as any;

    const scopePublishers = [
      { id: 'p1', serviceGroupId: 'grp-1' },
      { id: 'p2', serviceGroupId: 'grp-1' },
      { id: 'p3', serviceGroupId: 'grp-2' },
    ];

    it('counts who has handed a report in for the month being collected', async () => {
      setNow(Date.UTC(2026, 7, 3, 9, 0, 0)); // 3 August
      publishersRepo.findOne.mockResolvedValue(null as any);
      publishersRepo.find.mockResolvedValue(scopePublishers as any);
      reportsRepo.find.mockResolvedValue([{ publisherId: 'p1' }] as any);

      const result = await service.getReportCollection('cong-1', admin);

      expect(result.reportMonth).toBe('2026-07-01');
      expect(result.scope).toBe('congregation');
      expect(result.expected).toBe(3);
      expect(result.received).toBe(1);
      expect(result.deadline).toBe('2026-08-20');
      // Nobody is late on the 3rd — the reports are still coming in.
      expect(result.pastDeadline).toBe(false);
    });

    it('says the deadline has passed once it has', async () => {
      setNow(Date.UTC(2026, 7, 20, 9, 0, 0)); // 20 August
      publishersRepo.findOne.mockResolvedValue(null as any);
      publishersRepo.find.mockResolvedValue(scopePublishers as any);
      reportsRepo.find.mockResolvedValue([] as any);

      const result = await service.getReportCollection('cong-1', admin);

      expect(result.reportMonth).toBe('2026-07-01');
      expect(result.pastDeadline).toBe(true);
    });

    it('counts only his own groups for a group overseer', async () => {
      setNow(Date.UTC(2026, 7, 3, 9, 0, 0));
      publishersRepo.findOne.mockResolvedValue({ id: 'pub-o' } as any);
      serviceGroupsRepo.find.mockResolvedValue([{ id: 'grp-1' }] as any);
      publishersRepo.find.mockResolvedValue(scopePublishers as any);
      reportsRepo.find.mockResolvedValue([{ publisherId: 'p2' }] as any);

      const result = await service.getReportCollection('cong-1', {
        id: 'user-overseer',
        role: UserRole.ELDER,
        congregationId: 'cong-1',
      } as any);

      expect(result.scope).toBe('group');
      expect(result.expected).toBe(2); // p3 is in another group
      expect(result.received).toBe(1);
    });

    it('refuses an ordinary publisher', async () => {
      setNow(Date.UTC(2026, 7, 3, 9, 0, 0));
      publishersRepo.findOne.mockResolvedValue({ id: 'pub-x' } as any);
      serviceGroupsRepo.find.mockResolvedValue([] as any);

      await expect(
        service.getReportCollection('cong-1', {
          id: 'user-x',
          role: UserRole.PUBLISHER,
          congregationId: 'cong-1',
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

/**
 * Whose report is open on the screen.
 *
 * The edit form had no way to know: it showed the READER's own name and
 * pioneer badge above somebody else's month, so opening Наталья's report from
 * her history looked exactly like opening your own. The data went to the right
 * row all along — what lied was the page.
 */
describe('ServiceReportsService.findOne — the report names its owner', () => {
  it('carries the publisher name and pioneer standing', async () => {
    const owner = {
      id: 'pub-2',
      displayName: 'Беловодская Наталья',
      serviceGroupId: 'g1',
      pioneerType: 'regular',
    };
    const report = {
      id: 'r1',
      congregationId: 'c1',
      publisherId: 'pub-2',
      reportMonth: '2026-08-01',
      submittedById: 'user-9',
    };
    const svc = new (ServiceReportsService as any)(
      { findOne: jest.fn().mockResolvedValue(report), find: jest.fn() },
      { findOne: jest.fn().mockResolvedValue(owner), find: jest.fn() },
      { find: jest.fn().mockResolvedValue([]) },
      { find: jest.fn().mockResolvedValue([]) },
      { findOne: jest.fn(), find: jest.fn() },
      { find: jest.fn().mockResolvedValue([]) },
      { logCreate: jest.fn(), logUpdate: jest.fn() },
      { timezoneOf: jest.fn().mockResolvedValue('Europe/Berlin') },
      { recomputeStatus: jest.fn() },
    );
    jest.spyOn(svc as any, 'buildPermissionContext').mockResolvedValue({
      alwaysView: true,
      alwaysEdit: true,
      overseenGroupIds: [],
    });
    jest.spyOn(svc as any, 'isMonthClosed').mockResolvedValue(false);
    jest.spyOn(svc as any, 'enrichEditorNames').mockResolvedValue(undefined);

    const out = await svc.findOne('c1', { id: 'user-1' } as never, 'r1');

    expect(out.publisherName).toBe('Беловодская Наталья');
    expect(out.publisherIsPioneer).toBe(true);
  });
});

/**
 * Taking a report back.
 *
 * A group overseer ticks the wrong line and until now nobody could undo it:
 * the app had editing but no removing, and the journal's undo covers a dozen
 * kinds of record without covering this one. The mistaken row counted for
 * ever — in who handed in, in the status, in the annual report.
 */
describe('ServiceReportsService.removeReport', () => {
  const build = (canEdit: boolean) => {
    const reportsRepo = {
      softDelete: jest.fn(),
      restore: jest.fn(),
      findOne: jest.fn(),
    };
    const audit = { logEvent: jest.fn() };
    const publishers = { recomputeStatus: jest.fn() };
    // Constructor order: reports, publishers, groups, responsibilities,
    // closures, clock, audit, publishersService, auxiliaryPioneers.
    const svc = new (ServiceReportsService as any)(
      reportsRepo,
      { findOne: jest.fn(), find: jest.fn() },
      { find: jest.fn().mockResolvedValue([]) },
      { find: jest.fn().mockResolvedValue([]) },
      { findOne: jest.fn(), find: jest.fn() },
      { timezoneOf: jest.fn().mockResolvedValue('Europe/Berlin') },
      audit,
      publishers,
      { find: jest.fn().mockResolvedValue([]) },
    );
    jest.spyOn(svc as any, 'findOne').mockResolvedValue({
      id: 'r1',
      publisherId: 'pub-2',
      reportMonth: '2026-08-01',
      canEdit,
      publisherName: 'Беловодская Наталья',
    });
    return { svc, reportsRepo, audit, publishers };
  };

  it('takes the row out of the counts and writes it down', async () => {
    const { svc, reportsRepo, audit, publishers } = build(true);

    await expect(
      svc.removeReport('c1', { id: 'u1' } as never, 'r1'),
    ).resolves.toEqual({ removed: true });

    expect(reportsRepo.softDelete).toHaveBeenCalledWith('r1');
    // Softly: the row keeps its place, so the screen can say «убрана, кем и
    // когда» rather than reading as «не сдавал». Different facts.
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entityId: 'r1' }),
    );
    // The status counted that month; it must count it no longer.
    expect(publishers.recomputeStatus).toHaveBeenCalledWith('c1', 'pub-2');
  });

  it('refuses when the person could not have edited it either', async () => {
    const { svc, reportsRepo } = build(false);

    await expect(
      svc.removeReport('c1', { id: 'u1' } as never, 'r1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(reportsRepo.softDelete).not.toHaveBeenCalled();
  });
});

/**
 * A month whose report was TAKEN BACK is not a month never handed in.
 *
 * Softly removed rows fall out of an ordinary query without a word, so a
 * corrected mistake read on screen exactly like «не сдавал». The two are
 * different facts and the group screen has to tell them apart: the live report
 * stays in `report`, the taken-back one arrives as `removedReport` with the
 * name of whoever took it, and it is never counted as handed in.
 */
describe('ServiceReportsService.findGroupReports — the missed-months count', () => {
  it('does not count the month still being collected as missed', async () => {
    // 4 September: August is open until the 19th, so somebody who has not filed
    // yet is early, not delinquent. Counting from the month on screen made
    // thirty of eighty-eight publishers «пропустившими месяц» — a flag that
    // calls a third of the congregation delinquent teaches the overseer to
    // ignore it.
    setNow(Date.UTC(2026, 8, 4));
    const publishers = [
      {
        id: 'p1',
        displayName: 'Не успел Иван',
        serviceGroupId: 'g1',
        pioneerType: 'none',
        pioneerSince: null,
      },
    ];
    // Reported every month up to and including July; August not yet filed.
    const history = ['2026-05', '2026-06', '2026-07'].map((m) => ({
      publisherId: 'p1',
      reportMonth: `${m}-01`,
    }));

    const svc = new (ServiceReportsService as any)(
      {
        find: jest
          .fn()
          .mockResolvedValueOnce([]) // the selected month: nothing filed
          .mockResolvedValue(history), // the look-back
        findOne: jest.fn(),
      },
      { find: jest.fn().mockResolvedValue(publishers), findOne: jest.fn() },
      { find: jest.fn().mockResolvedValue([]) },
      { find: jest.fn().mockResolvedValue([]) },
      { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) },
      { timezoneOf: jest.fn().mockResolvedValue('Europe/Berlin') },
      { findActorsFor: jest.fn().mockResolvedValue([]), logEvent: jest.fn() },
      { recomputeStatus: jest.fn() },
      {
        activePublisherIdsForMonth: jest.fn().mockResolvedValue(new Set()),
      },
    );
    jest.spyOn(svc as any, 'buildPermissionContext').mockResolvedValue({
      alwaysView: true,
      alwaysEdit: true,
      overseenGroupIds: [],
      myPublisherId: null,
    });
    jest.spyOn(svc as any, 'isMonthClosed').mockResolvedValue(false);
    jest.spyOn(svc as any, 'enrichEditorNames').mockResolvedValue(undefined);

    const out = await svc.findGroupReports(
      'c1',
      { id: 'u1' } as never,
      '2026-08-01',
    );

    expect(out.publishers[0].consecutiveMissing).toBe(0);
    restoreNow();
  });
});

describe('ServiceReportsService.findGroupReports — a taken-back report', () => {
  it('arrives in its own field, named and dated, and out of the counts', async () => {
    const removedAt = new Date('2026-09-04T10:00:00Z');
    const publishers = [
      {
        id: 'p1',
        displayName: 'Сдавший Иван',
        serviceGroupId: 'g1',
        pioneerType: 'none',
        pioneerSince: null,
      },
      {
        id: 'p2',
        displayName: 'Убранный Пётр',
        serviceGroupId: 'g1',
        pioneerType: 'none',
        pioneerSince: null,
      },
    ];
    const reports = [
      {
        id: 'r-live',
        publisherId: 'p1',
        congregationId: 'c1',
        reportMonth: '2026-08-01',
        servedThisMonth: true,
        hoursReported: null,
        bibleStudies: 0,
        deletedAt: null,
      },
      {
        id: 'r-gone',
        publisherId: 'p2',
        congregationId: 'c1',
        reportMonth: '2026-08-01',
        servedThisMonth: true,
        hoursReported: null,
        bibleStudies: 0,
        deletedAt: removedAt,
      },
    ];

    const reportsRepo = {
      find: jest.fn().mockResolvedValue(reports),
      findOne: jest.fn(),
    };
    const svc = new (ServiceReportsService as any)(
      reportsRepo,
      { find: jest.fn().mockResolvedValue(publishers), findOne: jest.fn() },
      { find: jest.fn().mockResolvedValue([]) },
      { find: jest.fn().mockResolvedValue([]) },
      { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) },
      { timezoneOf: jest.fn().mockResolvedValue('Europe/Berlin') },
      {
        // The name of whoever took it back lives in the journal, where the
        // removal is already written down — not a second time on the report.
        findActorsFor: jest
          .fn()
          .mockResolvedValue([
            { entityId: 'r-gone', actorName: 'Шейфер Сергей' },
          ]),
        logEvent: jest.fn(),
      },
      { recomputeStatus: jest.fn() },
      {
        activePublisherIdsForMonth: jest.fn().mockResolvedValue(new Set()),
      },
    );
    jest.spyOn(svc as any, 'buildPermissionContext').mockResolvedValue({
      alwaysView: true,
      alwaysEdit: true,
      overseenGroupIds: [],
      myPublisherId: null,
    });
    jest.spyOn(svc as any, 'isMonthClosed').mockResolvedValue(false);
    jest.spyOn(svc as any, 'enrichEditorNames').mockResolvedValue(undefined);

    const out = await svc.findGroupReports(
      'c1',
      { id: 'u1' } as never,
      '2026-08-01',
    );

    // The rows only reach us because the query asks for the deleted ones.
    // Without this the mock would happily hand them over and the test would
    // pass against the very behaviour it exists to forbid — checked by putting
    // the old query back and watching this line fail.
    expect(reportsRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );

    const live = out.publishers.find((r: any) => r.publisherId === 'p1');
    const gone = out.publishers.find((r: any) => r.publisherId === 'p2');

    expect(live.report?.id).toBe('r-live');
    expect(live.removedReport).toBeNull();

    // Not handed in — and not silent either.
    expect(gone.report).toBeNull();
    expect(gone.removedReport).toEqual({
      id: 'r-gone',
      removedAt: removedAt.toISOString(),
      removedByName: 'Шейфер Сергей',
    });
  });
});

/**
 * «Все активные возвещатели», by the S-1 form's own words.
 *
 * The form says it plainly: count everyone who handed in a report at least
 * once in the LAST SIX MONTHS. This used to be a count of service statuses —
 * active plus irregular — and the two are different rules: the status has its
 * own start of counting and its own restart after a lapse. A figure copied
 * into a form sent to the branch has to be the figure the form asks for.
 */
describe('getSummary — «все активные» follows the form, not the status', () => {
  it('counts distinct publishers who reported in the last six months', async () => {
    const reportsRepo = {
      find: jest
        .fn()
        // The month itself.
        .mockResolvedValueOnce([])
        // The six-month window: three people, one of them twice.
        .mockResolvedValue([
          { publisherId: 'p1' },
          { publisherId: 'p2' },
          { publisherId: 'p1' },
          { publisherId: 'p3' },
        ]),
      findOne: jest.fn(),
    };
    const publishersRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };
    const svc = new (ServiceReportsService as any)(
      reportsRepo,
      publishersRepo,
      { find: jest.fn().mockResolvedValue([]) },
      { find: jest.fn().mockResolvedValue([]) },
      { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) },
      { timezoneOf: jest.fn().mockResolvedValue('Europe/Berlin') },
      { findActorsFor: jest.fn().mockResolvedValue([]), logEvent: jest.fn() },
      { recomputeStatus: jest.fn() },
      { activePublisherIdsForMonth: jest.fn().mockResolvedValue(new Set()) },
    );
    jest.spyOn(svc as any, 'buildPermissionContext').mockResolvedValue({
      alwaysView: true,
      alwaysEdit: true,
      overseenGroupIds: [],
    });
    jest.spyOn(svc as any, 'isMonthClosed').mockResolvedValue(false);

    const out = await svc.getSummary(
      'c1',
      { id: 'u1', role: 'admin' } as never,
      '2026-08',
    );

    expect(out.totalActivePublishers).toBe(3);
    // And the window is six months ending at the month asked for.
    const windowCall = reportsRepo.find.mock.calls[1][0];
    expect(JSON.stringify(windowCall.where.reportMonth)).toContain(
      '2026-03-01',
    );
  });
});

/**
 * Two things the publisher history was getting wrong.
 *
 * It drew two years of months whatever the person's own history, so anyone who
 * joined last autumn had a year of «отчёта нет» stretching behind him — for
 * months nobody ever asked him about. And filing was allowed into a CLOSED
 * month: only «has the month ended» was ever checked, so a report could land in
 * a month whose figures had already gone to the branch, changing its summary
 * afterwards with nothing to say so.
 */
describe('history and closed months', () => {
  it('stops the timeline at the month counting begins', async () => {
    const publisher = {
      id: 'p1',
      displayName: 'Новенький Иван',
      serviceGroupId: 'g1',
      ministryStartDate: '2026-06-01',
      baptismDate: null,
      pioneerType: 'none',
      pioneerSince: null,
      status: 'active',
      statusManuallyOverridden: false,
    };
    const svc = new (ServiceReportsService as any)(
      { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
      {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(publisher),
      },
      { find: jest.fn().mockResolvedValue([]) },
      { find: jest.fn().mockResolvedValue([]) },
      { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) },
      { timezoneOf: jest.fn().mockResolvedValue('Europe/Berlin') },
      { findActorsFor: jest.fn().mockResolvedValue([]), logEvent: jest.fn() },
      { recomputeStatus: jest.fn() },
      {
        activePublisherIdsForMonth: jest.fn().mockResolvedValue(new Set()),
        monthsServedBy: jest.fn().mockResolvedValue(new Set()),
      },
    );
    jest.spyOn(svc as any, 'buildPermissionContext').mockResolvedValue({
      alwaysView: true,
      alwaysEdit: true,
      overseenGroupIds: [],
    });
    jest.spyOn(svc as any, 'closedMonthsSet').mockResolvedValue(new Set());
    jest.spyOn(svc as any, 'enrichEditorNames').mockResolvedValue(undefined);
    setNow(Date.UTC(2026, 8, 4));

    const out = await svc.findHistoryForPublisher(
      'c1',
      { id: 'u1' } as never,
      'p1',
      24,
    );

    const months = out.timeline.map((e: any) => e.reportMonth.slice(0, 7));
    expect(months).toContain('2026-06');
    // Nothing before he was a publisher.
    expect(months).not.toContain('2026-05');
    restoreNow();
  });
});

/**
 * Which form each month of the history wants.
 *
 * A secretary walking a paper S-21 card down the months needs the right field
 * drawn for each one, and today's card is the wrong place to ask: a sister who
 * became a regular pioneer in March needs «участвовал» for February and hours
 * for March. The server already decides this when a report is filed and
 * refuses the wrong shape — so it says the same thing here.
 */
describe('publisher history — which form each month wants', () => {
  const build = (publisher: Record<string, unknown>, auxMonths: string[]) => {
    const svc = new (ServiceReportsService as any)(
      { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
      {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(publisher),
      },
      { find: jest.fn().mockResolvedValue([]) },
      { find: jest.fn().mockResolvedValue([]) },
      { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) },
      { timezoneOf: jest.fn().mockResolvedValue('Europe/Berlin') },
      { findActorsFor: jest.fn().mockResolvedValue([]), logEvent: jest.fn() },
      { recomputeStatus: jest.fn() },
      {
        activePublisherIdsForMonth: jest.fn().mockResolvedValue(new Set()),
        monthsServedBy: jest.fn().mockResolvedValue(new Set(auxMonths)),
      },
    );
    jest.spyOn(svc as any, 'buildPermissionContext').mockResolvedValue({
      alwaysView: true,
      alwaysEdit: true,
      overseenGroupIds: [],
    });
    jest.spyOn(svc as any, 'closedMonthsSet').mockResolvedValue(new Set());
    jest.spyOn(svc as any, 'enrichEditorNames').mockResolvedValue(undefined);
    return svc;
  };

  const base = {
    id: 'p1',
    displayName: 'Сестра Анна',
    serviceGroupId: 'g1',
    ministryStartDate: '2020-01-01',
    baptismDate: null,
    pioneerType: 'none',
    pioneerSince: null,
    status: 'active',
    statusManuallyOverridden: false,
  };

  const monthsOf = async (svc: unknown) => {
    const out = await (svc as any).findHistoryForPublisher(
      'c1',
      { id: 'u1' } as never,
      'p1',
      12,
    );
    return new Map<string, boolean>(
      out.timeline.map((e: { reportMonth: string; wantsHours: boolean }) => [
        e.reportMonth.slice(0, 7),
        e.wantsHours,
      ]),
    );
  };

  it('asks for hours only from the month she became a regular pioneer', async () => {
    setNow(Date.UTC(2026, 8, 4));
    const svc = build(
      { ...base, pioneerType: 'regular', pioneerSince: '2026-03-01' },
      [],
    );

    const months = await monthsOf(svc);

    expect(months.get('2026-02')).toBe(false);
    expect(months.get('2026-03')).toBe(true);
    expect(months.get('2026-08')).toBe(true);
    restoreNow();
  });

  it('asks for hours in the months of an auxiliary spell, and not around it', async () => {
    setNow(Date.UTC(2026, 8, 4));
    const svc = build(base, ['2026-04', '2026-05']);

    const months = await monthsOf(svc);

    expect(months.get('2026-03')).toBe(false);
    expect(months.get('2026-04')).toBe(true);
    expect(months.get('2026-05')).toBe(true);
    expect(months.get('2026-06')).toBe(false);
    restoreNow();
  });
});
