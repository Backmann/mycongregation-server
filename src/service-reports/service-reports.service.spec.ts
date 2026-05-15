import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { ServiceReportsService } from './service-reports.service';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { PioneerType } from '../common/enums/pioneer-type.enum';
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
    } as unknown as jest.Mocked<Repository<Publisher>>;

    serviceGroupsRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<ServiceGroup>>;

    service = new ServiceReportsService(
      reportsRepo,
      publishersRepo,
      serviceGroupsRepo,
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

    it('returns true on May 10 23:59 UTC for April report (last second of window)', () => {
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.UTC(2026, 4, 10, 23, 59, 59));
      expect(callWindow('2026-04-01')).toBe(true);
    });

    it('returns false the instant the window closes (May 11 00:00 UTC for April)', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 11, 0, 0, 0));
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
  // canEditReport (private)
  // =========================================================

  describe('canEditReport', () => {
    const callCan = (
      report: ServiceReport,
      user: AuthenticatedUser,
    ): boolean => (service as any).canEditReport(report, user);

    beforeEach(() => {
      // Inside window for April reports.
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
    });

    it('PUBLISHER editing own report within window → true', () => {
      const user = makeUser({ id: 'u1', role: UserRole.PUBLISHER });
      const report = makeReport({ submittedById: 'u1' });
      expect(callCan(report, user)).toBe(true);
    });

    it('PUBLISHER editing own report AFTER window closes → false', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 12));
      const user = makeUser({ id: 'u1', role: UserRole.PUBLISHER });
      const report = makeReport({ submittedById: 'u1' });
      expect(callCan(report, user)).toBe(false);
    });

    it("PUBLISHER editing another user's report → false (even within window)", () => {
      const user = makeUser({ id: 'u1', role: UserRole.PUBLISHER });
      const report = makeReport({ submittedById: 'u2' });
      expect(callCan(report, user)).toBe(false);
    });

    it("MINISTERIAL_SERVANT editing another user's report → false", () => {
      const user = makeUser({ id: 'ms', role: UserRole.MINISTERIAL_SERVANT });
      const report = makeReport({ submittedById: 'u2' });
      expect(callCan(report, user)).toBe(false);
    });

    it("ELDER editing another user's report → true even after window", () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 30));
      const user = makeUser({ id: 'elder', role: UserRole.ELDER });
      const report = makeReport({ submittedById: 'u2' });
      expect(callCan(report, user)).toBe(true);
    });

    it("ADMIN editing another user's report → true even after window", () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 30));
      const user = makeUser({ id: 'admin', role: UserRole.ADMIN });
      const report = makeReport({ submittedById: 'u2' });
      expect(callCan(report, user)).toBe(true);
    });
  });

  // =========================================================
  // submitOwnReport
  // =========================================================

  describe('submitOwnReport', () => {
    describe('regular publisher form (PioneerType.NONE)', () => {
      beforeEach(() => {
        publishersRepo.findOne.mockResolvedValue(
          makePublisher({ pioneerType: PioneerType.NONE }),
        );
      });

      it('accepts servedThisMonth=true and persists the right shape', async () => {
        const saved = makeReport();
        reportsRepo.save.mockResolvedValue(saved);

        const result = await service.submitOwnReport('cong-1', 'user-self', {
          reportMonth: '2026-04',
          servedThisMonth: true,
          bibleStudies: 2,
        });

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
          service.submitOwnReport('cong-1', 'user-self', {
            reportMonth: '2026-04',
            hoursReported: 50,
            bibleStudies: 0,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('throws BadRequest if servedThisMonth is missing', async () => {
        await expect(
          service.submitOwnReport('cong-1', 'user-self', {
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

        const result = await service.submitOwnReport('cong-1', 'user-self', {
          reportMonth: '2026-04',
          hoursReported: 60,
          bibleStudies: 1,
        });

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
          service.submitOwnReport('cong-1', 'user-self', {
            reportMonth: '2026-04',
            servedThisMonth: true,
            bibleStudies: 0,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('throws BadRequest if hoursReported is missing', async () => {
        await expect(
          service.submitOwnReport('cong-1', 'user-self', {
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
        const pgErr: any = new Error('duplicate key value violates unique constraint');
        pgErr.code = '23505';
        reportsRepo.save.mockRejectedValue(pgErr);

        await expect(
          service.submitOwnReport('cong-1', 'user-self', {
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
          service.submitOwnReport('cong-1', 'user-self', {
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
          service.submitOwnReport('cong-1', 'orphan-user', {
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
        await service.submitOwnReport('cong-1', 'user-self', {
          reportMonth: '2026-04',
          servedThisMonth: true,
          bibleStudies: 0,
        });
        expect(reportsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ reportMonth: '2026-04-01' }),
        );
      });

      it('normalizes "YYYY-MM-DD" → "YYYY-MM-01" regardless of day', async () => {
        await service.submitOwnReport('cong-1', 'user-self', {
          reportMonth: '2026-04-25',
          servedThisMonth: true,
          bibleStudies: 0,
        });
        expect(reportsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ reportMonth: '2026-04-01' }),
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

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'admin', role: UserRole.ADMIN }),
        '2026-04',
      );

      expect(result.scopeLabel).toBe('Congregation');
      expect(result.publishers).toHaveLength(2);
      expect(serviceGroupsRepo.find).not.toHaveBeenCalled();
    });

    it('allows ELDER to see all publishers in the congregation', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 5));
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p1' }),
      ]);
      reportsRepo.find.mockResolvedValue([]);

      const result = await service.findGroupReports(
        'cong-1',
        makeUser({ id: 'elder', role: UserRole.ELDER }),
        '2026-04',
      );

      expect(result.publishers).toHaveLength(1);
      expect(serviceGroupsRepo.find).not.toHaveBeenCalled();
    });

    it('forbids non-elder/admin who oversees no group', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({ id: 'pub-me' }),
      );
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
        where: {
          congregationId: 'cong-1',
          overseerPublisherId: 'pub-overseer',
        },
      });
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
      publishersRepo.find.mockResolvedValue([
        makePublisher({ id: 'p1' }),
      ]);
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
});
