import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/decorators/current-user.decorator';

/**
 * Guards the handful of endpoints that belong to whoever runs the platform
 * rather than to any one congregation.
 *
 * The marker is the `isOwner` column, which the codebase already describes as
 * set only through the database and never exposed in any API or UI. Reusing it
 * rather than inventing a second mechanism matters: two answers to "who runs
 * the platform" would eventually disagree, and they would disagree quietly.
 *
 * WHAT THIS MUST NEVER BECOME
 * Being the owner does not widen the congregation boundary anywhere. It does
 * not grant sight of another congregation's publishers, schedules or journal.
 * It gates platform endpoints and nothing else. The moment it becomes a master
 * key, every congregation's data sits one compromised account away, which is a
 * worse position than the one this was meant to improve.
 */
@Injectable()
export class PlatformOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();
    const user = request.user;

    if (!user?.isOwner) {
      // Deliberately says nothing about owners existing. Someone probing this
      // endpoint learns only that they may not use it.
      throw new ForbiddenException('Not available');
    }
    return true;
  }
}
