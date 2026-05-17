import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PushNotificationsService } from './push-notifications.service';
import { PushToken } from '../entities/push-token.entity';
import { PushReceipt } from '../entities/push-receipt.entity';
import type { WebPushService } from '../web-push/web-push.service';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';

jest.mock('expo-server-sdk', () => {
  class MockExpo {
    static isExpoPushToken(t: string): boolean {
      return typeof t === 'string' && /^ExponentPushToken\[/.test(t);
    }
    chunkPushNotifications(messages: any[]) {
      return [messages];
    }
    sendPushNotificationsAsync = jest.fn().mockResolvedValue([]);
    chunkPushNotificationReceiptIds(ids: string[]) {
      return [ids];
    }
    getPushNotificationReceiptsAsync = jest.fn().mockResolvedValue({});
  }
  return { Expo: MockExpo };
});

describe('PushNotificationsService', () => {
  let service: PushNotificationsService;
  let pushTokenRepo: jest.Mocked<Repository<PushToken>>;
  let userRepo: jest.Mocked<Repository<User>>;
  let pushReceiptRepo: jest.Mocked<Repository<PushReceipt>>;
  let webPushService: jest.Mocked<WebPushService>;

  beforeEach(() => {
    pushTokenRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      create: jest.fn().mockImplementation((data: any) => data),
    } as unknown as jest.Mocked<Repository<PushToken>>;

    userRepo = {
      findBy: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<Repository<User>>;
    pushReceiptRepo = {
      save: jest.fn().mockResolvedValue([]),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    } as unknown as jest.Mocked<Repository<PushReceipt>>;
    webPushService = {
      getSubscriptionsByTenant: jest.fn().mockResolvedValue([]),
      sendToSubscription: jest.fn().mockResolvedValue({ ok: true, errorCode: null }),
    } as unknown as jest.Mocked<WebPushService>;
    service = new PushNotificationsService(pushTokenRepo, userRepo, pushReceiptRepo, webPushService);
  });

  describe('registerToken', () => {
    it('rejects non-Expo-format tokens with BadRequestException', async () => {
      await expect(
        service.registerToken(
          'user-1',
          'cong-1',
          UserRole.ADMIN,
          'not-a-real-token',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a new row when this (userId, token) pair is new', async () => {
      pushTokenRepo.findOne.mockResolvedValue(null);
      pushTokenRepo.save.mockImplementation(async (x: any) => x);

      await service.registerToken(
        'user-1',
        'cong-1',
        UserRole.ADMIN,
        'ExponentPushToken[abc123]',
      );

      expect(pushTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          congregationId: 'cong-1',
          role: UserRole.ADMIN,
          token: 'ExponentPushToken[abc123]',
        }),
      );
    });

    it('updates an existing row (re-register flow)', async () => {
      pushTokenRepo.findOne.mockResolvedValue({
        id: 'pt-1',
        userId: 'user-1',
        congregationId: 'cong-1',
        role: UserRole.PUBLISHER,
        token: 'ExponentPushToken[abc123]',
        deviceInfo: null,
      } as any);
      pushTokenRepo.save.mockImplementation(async (x: any) => x);

      await service.registerToken(
        'user-1',
        'cong-1',
        UserRole.ADMIN,
        'ExponentPushToken[abc123]',
        { os: 'ios' },
      );

      expect(pushTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'pt-1',
          role: UserRole.ADMIN,
          deviceInfo: { os: 'ios' },
        }),
      );
    });
  });

  describe('sendStatusChange', () => {
    it('no-ops gracefully when there are no recipients', async () => {
      pushTokenRepo.find.mockResolvedValue([]);

      await expect(
        service.sendStatusChange(
          'cong-1',
          { id: 'pub-1', displayName: 'Test Publisher' },
          'active',
          'irregular',
        ),
      ).resolves.toBeUndefined();
    });

    it('queries by congregationId and triggers the Expo SDK when recipients exist', async () => {
      pushTokenRepo.find.mockResolvedValue([
        { token: 'ExponentPushToken[admin1]' } as any,
        { token: 'ExponentPushToken[elder1]' } as any,
      ]);

      await service.sendStatusChange(
        'cong-1',
        { id: 'pub-1', displayName: 'Müller Paul' },
        'active',
        'irregular',
        'user-self',
      );

      expect(pushTokenRepo.find).toHaveBeenCalledTimes(1);
      const call = pushTokenRepo.find.mock.calls[0][0] as any;
      expect(call.where.congregationId).toBe('cong-1');
    });
  });

  describe('unregisterToken', () => {
    it('delegates to repo.delete with the right keys', async () => {
      pushTokenRepo.delete.mockResolvedValue({ affected: 1 } as any);
      await service.unregisterToken('user-1', 'ExponentPushToken[abc123]');
      expect(pushTokenRepo.delete).toHaveBeenCalledWith({
        userId: 'user-1',
        token: 'ExponentPushToken[abc123]',
      });
    });
  });

  describe('checkReceipts', () => {
    it('returns zero counts when nothing is pending', async () => {
      pushReceiptRepo.find.mockResolvedValue([]);

      const result = await service.checkReceipts();

      expect(result).toEqual({ checked: 0, ok: 0, errors: 0, tokensDeleted: 0 });
      const expo = (service as any).expo;
      expect(expo.getPushNotificationReceiptsAsync).not.toHaveBeenCalled();
    });

    it('marks ok receipts and saves them', async () => {
      const pending = [
        { ticketId: 'ticket-1', token: 'ExponentPushToken[a]', status: 'pending', checkedAt: null, errorCode: null },
        { ticketId: 'ticket-2', token: 'ExponentPushToken[b]', status: 'pending', checkedAt: null, errorCode: null },
      ];
      pushReceiptRepo.find.mockResolvedValue(pending as any);
      (service as any).expo.getPushNotificationReceiptsAsync.mockResolvedValue({
        'ticket-1': { status: 'ok' },
        'ticket-2': { status: 'ok' },
      });

      const result = await service.checkReceipts();

      expect(result.ok).toBe(2);
      expect(result.errors).toBe(0);
      expect(result.tokensDeleted).toBe(0);
      expect(pushReceiptRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ ticketId: 'ticket-1', status: 'ok' }),
          expect.objectContaining({ ticketId: 'ticket-2', status: 'ok' }),
        ]),
      );
    });

    it('deletes push_tokens when receipt status is DeviceNotRegistered', async () => {
      const pending = [
        { ticketId: 'ticket-1', token: 'ExponentPushToken[stale]', status: 'pending', checkedAt: null, errorCode: null },
      ];
      pushReceiptRepo.find.mockResolvedValue(pending as any);
      pushTokenRepo.delete.mockResolvedValue({ affected: 1 } as any);
      (service as any).expo.getPushNotificationReceiptsAsync.mockResolvedValue({
        'ticket-1': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      });

      const result = await service.checkReceipts();

      expect(result.errors).toBe(1);
      expect(result.tokensDeleted).toBe(1);
      expect(pushTokenRepo.delete).toHaveBeenCalledTimes(1);
      const deleteArg = pushTokenRepo.delete.mock.calls[0][0] as any;
      expect(deleteArg.token).toBeDefined();
    });

    it('leaves receipts as pending when Expo has no receipt yet', async () => {
      const pending = [
        { ticketId: 'ticket-1', token: 'ExponentPushToken[a]', status: 'pending', checkedAt: null, errorCode: null },
      ];
      pushReceiptRepo.find.mockResolvedValue(pending as any);
      (service as any).expo.getPushNotificationReceiptsAsync.mockResolvedValue({});

      const result = await service.checkReceipts();

      expect(result.checked).toBe(0);
      expect(pushReceiptRepo.save).not.toHaveBeenCalled();
    });

    it('handles Expo network errors gracefully', async () => {
      const pending = [
        { ticketId: 'ticket-1', token: 'ExponentPushToken[a]', status: 'pending', checkedAt: null, errorCode: null },
      ];
      pushReceiptRepo.find.mockResolvedValue(pending as any);
      (service as any).expo.getPushNotificationReceiptsAsync.mockRejectedValue(new Error('network down'));

      const result = await service.checkReceipts();

      expect(result).toEqual({ checked: 0, ok: 0, errors: 0, tokensDeleted: 0 });
      expect(pushReceiptRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('cleanupOldReceipts', () => {
    it('delegates to repo.delete with a cutoff and returns affected count', async () => {
      pushReceiptRepo.delete.mockResolvedValue({ affected: 42 } as any);

      const count = await service.cleanupOldReceipts();

      expect(count).toBe(42);
      expect(pushReceiptRepo.delete).toHaveBeenCalledTimes(1);
      const arg = pushReceiptRepo.delete.mock.calls[0][0] as any;
      expect(arg.sentAt).toBeDefined();
    });

    it('returns 0 when delete.affected is null', async () => {
      pushReceiptRepo.delete.mockResolvedValue({ affected: null } as any);

      const count = await service.cleanupOldReceipts();

      expect(count).toBe(0);
    });
  });
});
