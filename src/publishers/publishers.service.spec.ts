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
import { Gender } from '../common/enums/gender.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
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

function makeUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
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
      makeReport({
        reportMonth: m,
        servedThisMonth: true,
        hoursReported: null,
      }),
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
  let pushNotificationsService: {
    sendStatusChange: jest.Mock;
    sendStatusChangeToUser: jest.Mock;
  };
  let usersService: { syncRoleFromAppointment: jest.Mock };

  beforeEach(() => {
    publishersRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      create: jest.fn((x: any) => x),
      manager: {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
      },
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
      sendStatusChangeToUser: jest.fn().mockResolvedValue(undefined),
    };
    usersService = {
      syncRoleFromAppointment: jest.fn().mockResolvedValue(undefined),
    };
    service = new PublishersService(
      publishersRepo,
      reportsRepo,
      auditLogService as any,
      pushNotificationsService as any,
      usersService as any,
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

    it('notifies the group overseer, the secretary and admins', async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.INACTIVE,
        statusManuallyOverridden: false,
        serviceGroupId: 'grp-9',
      });
      publishersRepo.findOne
        .mockResolvedValueOnce(pub)
        .mockResolvedValueOnce(
          makePublisher({ id: 'ovr-1', userId: 'user-overseer' }),
        );
      (publishersRepo.manager.findOne as jest.Mock)
        .mockResolvedValueOnce({ id: 'grp-9', overseerPublisherId: 'ovr-1' })
        .mockResolvedValueOnce({ userId: 'user-secretary' });
      (publishersRepo.manager.find as jest.Mock).mockResolvedValue([
        { id: 'user-admin-1' },
        { id: 'user-admin-2' },
      ]);
      reportsRepo.find.mockResolvedValue([
        makeReport({ reportMonth: '2026-04-01', servedThisMonth: true }),
      ]);
      publishersRepo.save.mockImplementation(async (x: any) => x);
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15));

      await service.recomputeStatus('cong-1', 'pub-1');
      await new Promise((r) => setImmediate(r));

      const targets =
        pushNotificationsService.sendStatusChangeToUser.mock.calls.map(
          (c) => c[1],
        );
      expect(new Set(targets)).toEqual(
        new Set([
          'user-overseer',
          'user-secretary',
          'user-admin-1',
          'user-admin-2',
        ]),
      );
      expect(pushNotificationsService.sendStatusChange).not.toHaveBeenCalled();
    });

    it('deduplicates when the overseer is also an admin', async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.INACTIVE,
        statusManuallyOverridden: false,
        serviceGroupId: 'grp-9',
      });
      publishersRepo.findOne
        .mockResolvedValueOnce(pub)
        .mockResolvedValueOnce(
          makePublisher({ id: 'ovr-1', userId: 'user-dual' }),
        );
      (publishersRepo.manager.findOne as jest.Mock)
        .mockResolvedValueOnce({ id: 'grp-9', overseerPublisherId: 'ovr-1' })
        .mockResolvedValueOnce(null);
      (publishersRepo.manager.find as jest.Mock).mockResolvedValue([
        { id: 'user-dual' },
      ]);
      reportsRepo.find.mockResolvedValue([
        makeReport({ reportMonth: '2026-04-01', servedThisMonth: true }),
      ]);
      publishersRepo.save.mockImplementation(async (x: any) => x);
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15));

      await service.recomputeStatus('cong-1', 'pub-1');
      await new Promise((r) => setImmediate(r));

      expect(
        pushNotificationsService.sendStatusChangeToUser,
      ).toHaveBeenCalledTimes(1);
      expect(
        pushNotificationsService.sendStatusChangeToUser.mock.calls[0][1],
      ).toBe('user-dual');
    });

    it('sends nothing when nobody qualifies', async () => {
      const pub = makePublisher({
        id: 'pub-1',
        status: PublisherStatus.INACTIVE,
        statusManuallyOverridden: false,
        serviceGroupId: 'grp-9',
      });
      publishersRepo.findOne.mockResolvedValue(pub);
      (publishersRepo.manager.findOne as jest.Mock)
        .mockResolvedValueOnce({ id: 'grp-9', overseerPublisherId: null })
        .mockResolvedValueOnce(null);
      (publishersRepo.manager.find as jest.Mock).mockResolvedValue([]);
      reportsRepo.find.mockResolvedValue([
        makeReport({ reportMonth: '2026-04-01', servedThisMonth: true }),
      ]);
      publishersRepo.save.mockImplementation(async (x: any) => x);
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 15));

      await service.recomputeStatus('cong-1', 'pub-1');
      await new Promise((r) => setImmediate(r));

      expect(
        pushNotificationsService.sendStatusChangeToUser,
      ).not.toHaveBeenCalled();
      expect(pushNotificationsService.sendStatusChange).not.toHaveBeenCalled();
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
      publishersRepo.find.mockResolvedValue(pubs);
      publishersRepo.findOne.mockImplementation(async (options: any) => {
        const id = options?.where?.id;
        return pubs.find((p) => p.id === id) ?? null;
      });
      reportsRepo.find.mockImplementation(async (options: any) => {
        const pubId = options?.where?.publisherId;
        if (pubId === 'a') {
          return [
            makeReport({ reportMonth: '2026-04-01', servedThisMonth: true }),
          ];
        }
        return [];
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
      ]);
      publishersRepo.findOne.mockRejectedValue(new Error('boom'));

      const summary = await service.recomputeAllStatuses();
      expect(summary.processed).toBe(1);
      expect(summary.errors).toBe(1);
      expect(summary.updated).toBe(0);
    });
  });

  describe('status for students and newcomers', () => {
    it('clears status to null for a student', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({
          id: 'pub-s',
          appointment: PublisherAppointment.STUDENT,
          status: PublisherStatus.INACTIVE,
          statusManuallyOverridden: false,
        }),
      );
      publishersRepo.save.mockImplementation(async (x: any) => x);

      const result = await service.recomputeStatus('cong-1', 'pub-s');

      expect(result).toBe('updated');
      expect(publishersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pub-s', status: null }),
      );
    });

    it('treats a newcomer who reported every month since start as active', () => {
      // Started 2 months ago; reported both months. Fewer than 6 served, but
      // that's all they could have — should be ACTIVE, not IRREGULAR.
      const now = new Date(Date.UTC(2026, 4, 15)); // May 2026
      const start = new Date(Date.UTC(2026, 3, 1)); // April 2026
      const reports = [
        {
          reportMonth: '2026-04-01',
          servedThisMonth: true,
          hoursReported: null,
        },
      ];
      expect(computeStatusFromReports(reports, now, start)).toBe(
        PublisherStatus.ACTIVE,
      );
    });

    it('still marks a long-time publisher with one report as irregular', () => {
      const now = new Date(Date.UTC(2026, 4, 15));
      const start = new Date(Date.UTC(2020, 0, 1)); // long ago
      const reports = [
        {
          reportMonth: '2026-04-01',
          servedThisMonth: true,
          hoursReported: null,
        },
      ];
      expect(computeStatusFromReports(reports, now, start)).toBe(
        PublisherStatus.IRREGULAR,
      );
    });
  });

  describe('appointment/pioneer consistency', () => {
    it('rejects creating an unbaptized publisher with a pioneer type', async () => {
      await expect(
        service.create('cong-1', {
          firstName: 'Ivan',
          lastName: 'N',
          gender: Gender.BROTHER,
          appointment: PublisherAppointment.UNBAPTIZED_PUBLISHER,
          pioneerType: PioneerType.REGULAR,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects creating a student with a pioneer type', async () => {
      await expect(
        service.create('cong-1', {
          firstName: 'Ivan',
          lastName: 'N',
          gender: Gender.BROTHER,
          appointment: PublisherAppointment.STUDENT,
          pioneerType: PioneerType.AUXILIARY_UNTIL_CANCELLED,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows a baptized publisher with a pioneer type', async () => {
      publishersRepo.save.mockImplementation(async (x: any) => x);
      const result = await service.create('cong-1', {
        firstName: 'Ivan',
        lastName: 'N',
        gender: Gender.BROTHER,
        appointment: PublisherAppointment.PUBLISHER,
        pioneerType: PioneerType.REGULAR,
      } as any);
      expect(result.pioneerType).toBe(PioneerType.REGULAR);
    });

    it('rejects updating a publisher to unbaptized while keeping a pioneer type', async () => {
      publishersRepo.findOne.mockResolvedValue(
        makePublisher({
          id: 'pub-1',
          appointment: PublisherAppointment.PUBLISHER,
          pioneerType: PioneerType.REGULAR,
        }),
      );
      await expect(
        service.update('cong-1', 'pub-1', {
          appointment: PublisherAppointment.UNBAPTIZED_PUBLISHER,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
