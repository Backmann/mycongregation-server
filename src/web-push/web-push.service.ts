import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  // Send method comes in M.3.
}
