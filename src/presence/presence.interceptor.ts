import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PresenceService } from './presence.service';
import { CLIENT_HEADER, readClient } from '../auth/read-client';

/**
 * Bumps the signed-in user's "last active" timestamp on each request.
 *
 * Runs after the global auth guard, so `req.user` is populated for
 * authenticated routes; unauthenticated requests are ignored. The write
 * itself is throttled inside PresenceService.
 */
@Injectable()
export class PresenceInterceptor implements NestInterceptor {
  constructor(private readonly presence: PresenceService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{
      user?: { id?: string };
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const userId = req?.user?.id;
    if (userId) {
      // Every authenticated request carries the description, so the picture is
      // right within a minute of somebody opening the app — instead of waiting
      // for a new session, which is what made the list lag by a day.
      this.presence.touch(
        userId,
        Date.now(),
        readClient(
          req.headers?.['user-agent'] as string | undefined,
          req.headers?.[CLIENT_HEADER],
        ),
      );
    }
    return next.handle();
  }
}
