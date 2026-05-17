import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';

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

  // Subscribe / unsubscribe handlers come in M.2.
  // Actual send method comes in M.3.
}
