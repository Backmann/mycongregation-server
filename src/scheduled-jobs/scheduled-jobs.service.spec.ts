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

import { ScheduledJobsService } from './scheduled-jobs.service';
import type { PushNotificationsService } from '../push-notifications/push-notifications.service';

describe('ScheduledJobsService', () => {
  let service: ScheduledJobsService;
  let annualSent: { nightly: jest.Mock };
  let monthlySent: { nightly: jest.Mock };
  let users: { forgetDeadSessions: jest.Mock };
  let publishersService: { recomputeEveryCongregation: jest.Mock };
  let pushNotificationsService: jest.Mocked<PushNotificationsService>;
  let auditLogService: { cleanupOldAuditLogs: jest.Mock };

  beforeEach(() => {
    publishersService = {
      recomputeEveryCongregation: jest.fn().mockResolvedValue({
        processed: 5,
        updated: 2,
        unchanged: 1,
        skipped: 1,
        errors: 1,
        durationMs: 250,
      }),
    };
    pushNotificationsService = {
      checkReceipts: jest
        .fn()
        .mockResolvedValue({ checked: 0, ok: 0, errors: 0, tokensDeleted: 0 }),
      cleanupOldReceipts: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<PushNotificationsService>;
    auditLogService = {
      cleanupOldAuditLogs: jest.fn().mockResolvedValue(0),
    };
    const notificationsService = {
      deliverDue: jest.fn().mockResolvedValue({ sent: 0 }),
      cleanupOld: jest.fn().mockResolvedValue(0),
    };
    annualSent = { nightly: jest.fn(async () => 0) };
    monthlySent = { nightly: jest.fn(async () => 0) };
    users = { forgetDeadSessions: jest.fn(async () => 0) };
    service = new ScheduledJobsService(
      publishersService as any,
      pushNotificationsService,
      notificationsService as any,
      auditLogService as any,
      { runDueReminders: jest.fn() } as any,
      { ensureForToday: jest.fn(async () => 0) } as never,
      { runDue: jest.fn(async () => 0) } as never,
      // The group-visit task pass, raised and lowered by the data itself.
      { ensureForToday: jest.fn(async () => 0) } as never,
      // «The Memorial is tomorrow», sent after 19:00 in the congregation's own
      // evening. The service decides whether anything is due; this tick only
      // asks.
      { remindEveningBefore: jest.fn(async () => 0) } as never,
      // «Tomorrow — …» for the congregation's events, the same way.
      { remindEveningBefore: jest.fn(async () => 0) } as never,
      // The annual report's calendar: the September task and the freeze.
      annualSent as never,
      monthlySent as never,
      // The evening digest of a person's own assignments.
      {
        tick: jest.fn(async () => undefined),
        announceDuties: jest.fn(async () => 0),
      } as never,
      users as never,
    );
  });

  describe('the nightly sweep of dead sessions', () => {
    it('asks the users service, once', async () => {
      await service.handleDeadSessionsCleanup();
      expect(users.forgetDeadSessions).toHaveBeenCalledTimes(1);
    });

    it('a failure is logged and goes no further — the next job still runs', async () => {
      users.forgetDeadSessions.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.handleDeadSessionsCleanup(),
      ).resolves.toBeUndefined();
    });
  });

  it('handleNightlyStatusRecompute delegates to recomputeEveryCongregation', async () => {
    await service.handleNightlyStatusRecompute();
    expect(publishersService.recomputeEveryCongregation).toHaveBeenCalledTimes(
      1,
    );
  });

  it('swallows errors without re-throwing so the cron host stays alive', async () => {
    publishersService.recomputeEveryCongregation.mockRejectedValue(
      new Error('boom'),
    );
    await expect(
      service.handleNightlyStatusRecompute(),
    ).resolves.toBeUndefined();
  });

  it('handleAuditLogCleanup delegates to cleanupOldAuditLogs', async () => {
    auditLogService.cleanupOldAuditLogs.mockResolvedValue(3);
    await service.handleAuditLogCleanup();
    expect(auditLogService.cleanupOldAuditLogs).toHaveBeenCalledTimes(1);
  });

  it('handleAuditLogCleanup swallows errors so the cron host stays alive', async () => {
    auditLogService.cleanupOldAuditLogs.mockRejectedValue(new Error('boom'));
    await expect(service.handleAuditLogCleanup()).resolves.toBeUndefined();
  });

  it('runs the annual report round and survives its failure', async () => {
    await service.handleAnnualReportSent();
    expect(annualSent.nightly).toHaveBeenCalledTimes(1);
    expect(monthlySent.nightly).toHaveBeenCalledTimes(1);

    // One failing does not stop the other.
    annualSent.nightly.mockRejectedValueOnce(new Error('boom'));
    await expect(service.handleAnnualReportSent()).resolves.toBeUndefined();
    expect(monthlySent.nightly).toHaveBeenCalledTimes(2);
  });
});
