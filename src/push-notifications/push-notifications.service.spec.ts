import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PushNotificationsService } from './push-notifications.service';
import { PushToken } from '../entities/push-token.entity';
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
  }
  return { Expo: MockExpo };
});

describe('PushNotificationsService', () => {
  let service: PushNotificationsService;
  let pushTokenRepo: jest.Mocked<Repository<PushToken>>;

  beforeEach(() => {
    pushTokenRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      create: jest.fn().mockImplementation((data: any) => data),
    } as unknown as jest.Mocked<Repository<PushToken>>;

    service = new PushNotificationsService(pushTokenRepo);
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
});
