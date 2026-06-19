import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PresenceService } from './presence.service';

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
    const req = ctx.switchToHttp().getRequest<{ user?: { id?: string } }>();
    const userId = req?.user?.id;
    if (userId) this.presence.touch(userId);
    return next.handle();
  }
}
