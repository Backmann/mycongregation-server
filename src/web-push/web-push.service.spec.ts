import { Repository } from 'typeorm';
import { WebPushService } from './web-push.service';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';
import { UserRole } from '../common/enums/user-role.enum';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require('web-push');

describe('WebPushService', () => {
  let service: WebPushService;
  let subRepo: jest.Mocked<Repository<WebPushSubscription>>;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    subRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      create: jest.fn().mockImplementation((data: any) => data),
    } as unknown as jest.Mocked<Repository<WebPushSubscription>>;
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('VAPID configuration', () => {
    it('reports configured=true when both VAPID keys are set', () => {
      process.env.VAPID_PUBLIC_KEY = 'public';
      process.env.VAPID_PRIVATE_KEY = 'private';
      service = new WebPushService(subRepo);

      expect(service.isConfigured()).toBe(true);
      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        expect.any(String),
        'public',
        'private',
      );
    });

    it('reports configured=false when VAPID keys are missing', () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      service = new WebPushService(subRepo);

      expect(service.isConfigured()).toBe(false);
      expect(webpush.setVapidDetails).not.toHaveBeenCalled();
    });
  });

  describe('registerSubscription', () => {
    beforeEach(() => {
      service = new WebPushService(subRepo);
    });

    it('creates a new row when the endpoint is new', async () => {
      subRepo.findOne.mockResolvedValue(null);
      subRepo.save.mockImplementation(async (x: any) => x);

      await service.registerSubscription('user-1', 'cong-1', UserRole.PUBLISHER, {
        endpoint: 'https://fcm.googleapis.com/abc',
        keys: { p256dh: 'pub', auth: 'auth1' },
        userAgent: 'Mozilla/5.0',
      });

      expect(subRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          congregationId: 'cong-1',
          role: UserRole.PUBLISHER,
          endpoint: 'https://fcm.googleapis.com/abc',
          p256dh: 'pub',
          auth: 'auth1',
          userAgent: 'Mozilla/5.0',
        }),
      );
    });

    it('updates an existing row when endpoint matches (re-subscribe)', async () => {
      subRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-old',
        congregationId: 'cong-old',
        role: UserRole.PUBLISHER,
        endpoint: 'https://fcm.googleapis.com/abc',
        p256dh: 'oldkey',
        auth: 'oldauth',
        userAgent: null,
        lastFailedAt: new Date(),
      } as any);
      subRepo.save.mockImplementation(async (x: any) => x);

      await service.registerSubscription('user-new', 'cong-new', UserRole.ELDER, {
        endpoint: 'https://fcm.googleapis.com/abc',
        keys: { p256dh: 'newkey', auth: 'newauth' },
        userAgent: 'New UA',
      });

      expect(subRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sub-1',
          userId: 'user-new',
          congregationId: 'cong-new',
          role: UserRole.ELDER,
          p256dh: 'newkey',
          auth: 'newauth',
          userAgent: 'New UA',
          lastFailedAt: null,
        }),
      );
    });
  });

  describe('removeSubscription', () => {
    beforeEach(() => {
      service = new WebPushService(subRepo);
    });

    it('deletes by (userId, endpoint) and returns affected count', async () => {
      subRepo.delete.mockResolvedValue({ affected: 1 } as any);

      const result = await service.removeSubscription('user-1', 'https://fcm.googleapis.com/abc');

      expect(subRepo.delete).toHaveBeenCalledWith({
        userId: 'user-1',
        endpoint: 'https://fcm.googleapis.com/abc',
      });
      expect(result).toEqual({ removed: 1 });
    });

    it('returns 0 when delete.affected is null', async () => {
      subRepo.delete.mockResolvedValue({ affected: null } as any);
      const result = await service.removeSubscription('user-x', 'nope');
      expect(result).toEqual({ removed: 0 });
    });
  });

  describe('getSubscriptionsByTenant', () => {
    beforeEach(() => {
      service = new WebPushService(subRepo);
    });

    it('queries by congregationId only when no excludeUserId given', async () => {
      await service.getSubscriptionsByTenant('cong-1');
      expect(subRepo.find).toHaveBeenCalledTimes(1);
      const call = subRepo.find.mock.calls[0][0] as any;
      expect(call.where.congregationId).toBe('cong-1');
      expect(call.where.userId).toBeUndefined();
    });

    it('applies Not(excludeUserId) when provided', async () => {
      await service.getSubscriptionsByTenant('cong-1', 'user-self');
      const call = subRepo.find.mock.calls[0][0] as any;
      expect(call.where.congregationId).toBe('cong-1');
      expect(call.where.userId).toBeDefined();
    });
  });

  describe('sendToSubscription', () => {
    const sampleSub = {
      id: 'sub-1',
      endpoint: 'https://fcm.googleapis.com/abc',
      p256dh: 'pub',
      auth: 'auth1',
      userId: 'user-1',
      congregationId: 'cong-1',
      role: UserRole.PUBLISHER,
      userAgent: null,
      createdAt: new Date(),
      lastUsedAt: null,
      lastFailedAt: null,
    } as WebPushSubscription;

    beforeEach(() => {
      process.env.VAPID_PUBLIC_KEY = 'public';
      process.env.VAPID_PRIVATE_KEY = 'private';
      service = new WebPushService(subRepo);
      subRepo.save.mockImplementation(async (x: any) => x);
    });

    it('returns ok and updates lastUsedAt on successful send', async () => {
      (webpush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 });

      const result = await service.sendToSubscription(sampleSub, {
        title: 'Hello',
        body: 'World',
      });

      expect(result).toEqual({ ok: true, errorCode: null });
      expect(subRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sub-1',
          lastUsedAt: expect.any(Date),
          lastFailedAt: null,
        }),
      );
    });

    it('deletes the subscription on HTTP 410 Gone', async () => {
      (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 410 });

      const result = await service.sendToSubscription(sampleSub, { title: 't', body: 'b' });

      expect(result).toEqual({ ok: false, errorCode: 'SubscriptionGone' });
      expect(subRepo.delete).toHaveBeenCalledWith({ id: 'sub-1' });
    });

    it('deletes on HTTP 404 Not Found', async () => {
      (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 404 });

      const result = await service.sendToSubscription(sampleSub, { title: 't', body: 'b' });

      expect(result.errorCode).toBe('SubscriptionGone');
      expect(subRepo.delete).toHaveBeenCalled();
    });

    it('marks lastFailedAt and returns MessageRateExceeded on HTTP 429', async () => {
      (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 429 });

      const result = await service.sendToSubscription(sampleSub, { title: 't', body: 'b' });

      expect(result.errorCode).toBe('MessageRateExceeded');
      expect(subRepo.delete).not.toHaveBeenCalled();
      expect(subRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ lastFailedAt: expect.any(Date) }),
      );
    });

    it('returns PushServiceError on 5xx', async () => {
      (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 503 });
      const result = await service.sendToSubscription(sampleSub, { title: 't', body: 'b' });
      expect(result.errorCode).toBe('PushServiceError');
    });

    it('no-ops when VAPID is not configured', async () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      const unconfigured = new WebPushService(subRepo);

      const result = await unconfigured.sendToSubscription(sampleSub, { title: 't', body: 'b' });

      expect(result).toEqual({ ok: false, errorCode: 'VapidNotConfigured' });
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });
  });
});
