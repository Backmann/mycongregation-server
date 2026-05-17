import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { RegisterWebPushSubscriptionDto } from './dto/register-web-push-subscription.dto';

/**
 * Web Push delivery for PWA clients (native Android/iOS use Expo Push via
 * PushNotificationsService instead).
 *
 * VAPID keys live in env vars:
 *   - VAPID_PUBLIC_KEY    — also exposed to client at build time as EXPO_PUBLIC_VAPID_KEY
 *   - VAPID_PRIVATE_KEY   — server-only, never exposed
 *   - VAPID_SUBJECT       — mailto:… or https://… contact for push services
 *
 * If keys are missing the service still constructs (so tests and local dev
 * work fine) but logs a warning and refuses to send.
 */
@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private readonly vapidConfigured: boolean;

  constructor(
    @InjectRepository(WebPushSubscription)
    private readonly subRepo: Repository<WebPushSubscription>,
  ) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject =
      process.env.VAPID_SUBJECT || 'mailto:lionel@mycongregation.org';

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidConfigured = true;
      this.logger.log('Web Push: VAPID configured');
    } else {
      this.vapidConfigured = false;
      this.logger.warn(
        'Web Push: VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY missing — web push sends will be skipped',
      );
    }
  }

  isConfigured(): boolean {
    return this.vapidConfigured;
  }

  /**
   * Upsert by endpoint (UNIQUE column). On re-subscribe from the same
   * device, the row's user/keys/userAgent are refreshed and lastFailedAt
   * cleared so the subscription is "back in good standing".
   */
  async registerSubscription(
    userId: string,
    congregationId: string,
    role: UserRole,
    dto: RegisterWebPushSubscriptionDto,
  ): Promise<WebPushSubscription> {
    const existing = await this.subRepo.findOne({ where: { endpoint: dto.endpoint } });
    if (existing) {
      existing.userId = userId;
      existing.congregationId = congregationId;
      existing.role = role;
      existing.p256dh = dto.keys.p256dh;
      existing.auth = dto.keys.auth;
      existing.userAgent = dto.userAgent ?? null;
      existing.lastFailedAt = null;
      return this.subRepo.save(existing);
    }

    const sub = this.subRepo.create({
      userId,
      congregationId,
      role,
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: dto.userAgent ?? null,
    });
    return this.subRepo.save(sub);
  }

  /**
   * Scoped to (userId, endpoint) — a user can only remove their own subs.
   */
  async removeSubscription(userId: string, endpoint: string): Promise<{ removed: number }> {
    const result = await this.subRepo.delete({ userId, endpoint });
    return { removed: result.affected ?? 0 };
  }

  /**
   * Fetch all subscriptions for a tenant, optionally excluding one user
   * (the actor, who does not need to be notified about their own action).
   */
  async getSubscriptionsByTenant(
    tenantId: string,
    excludeUserId?: string,
  ): Promise<WebPushSubscription[]> {
    const where: Record<string, unknown> = { congregationId: tenantId };
    if (excludeUserId) {
      where.userId = Not(excludeUserId);
    }
    return this.subRepo.find({ where });
  }

  /**
   * Send a single push to one subscription. Synchronous-ish: the push
   * service responds with an HTTP status code directly (unlike Expo which
   * uses a 2-phase ticket/receipt flow), so we react inline:
   *
   *   - 201/200 → ok, bump lastUsedAt
   *   - 410 Gone / 404 Not Found → subscription dead, delete it
   *   - 413 / 429 / 5xx → log + record lastFailedAt
   *
   * If VAPID is not configured the call is a no-op (returns errorCode).
   */
  async sendToSubscription(
    sub: WebPushSubscription,
    payload: { title: string; body: string; data?: Record<string, any> },
  ): Promise<{ ok: boolean; errorCode: string | null }> {
    if (!this.vapidConfigured) {
      return { ok: false, errorCode: 'VapidNotConfigured' };
    }

    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 },
      );

      sub.lastUsedAt = new Date();
      sub.lastFailedAt = null;
      await this.subRepo.save(sub);

      return { ok: true, errorCode: null };
    } catch (err: any) {
      const status = err?.statusCode ?? 0;

      if (status === 410 || status === 404) {
        await this.subRepo.delete({ id: sub.id });
        this.logger.log(
          `Web Push: deleted stale subscription ${sub.id} (HTTP ${status})`,
        );
        return { ok: false, errorCode: 'SubscriptionGone' };
      }

      sub.lastFailedAt = new Date();
      await this.subRepo.save(sub);

      let errorCode = 'SendError';
      if (status === 413) errorCode = 'MessageTooBig';
      else if (status === 429) errorCode = 'MessageRateExceeded';
      else if (status >= 500) errorCode = 'PushServiceError';

      this.logger.warn(
        `Web Push send failed for ${sub.id}: ${errorCode} (HTTP ${status})`,
      );
      return { ok: false, errorCode };
    }
  }
}
