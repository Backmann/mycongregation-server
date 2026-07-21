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
  let publishersService: { recomputeAllStatuses: jest.Mock };
  let pushNotificationsService: jest.Mocked<PushNotificationsService>;
  let auditLogService: { cleanupOldAuditLogs: jest.Mock };

  beforeEach(() => {
    publishersService = {
      recomputeAllStatuses: jest.fn().mockResolvedValue({
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
    service = new ScheduledJobsService(
      publishersService as any,
      pushNotificationsService,
      auditLogService as any,
      { runDueReminders: jest.fn() } as any,
    );
  });

  it('handleNightlyStatusRecompute delegates to recomputeAllStatuses', async () => {
    await service.handleNightlyStatusRecompute();
    expect(publishersService.recomputeAllStatuses).toHaveBeenCalledTimes(1);
  });

  it('swallows errors without re-throwing so the cron host stays alive', async () => {
    publishersService.recomputeAllStatuses.mockRejectedValue(new Error('boom'));
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
});
