import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { STAGE_ALLOWED_KEY } from '../../common/stage';
import { UserRole } from '../../common/enums/user-role.enum';
import { refusal } from '../../common/errors/refusal';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;
    // The screen on the stage: refused everything it does not show
    // (common/stage.ts). Here, once, rather than in each of the controllers
    // that would otherwise answer it like any member.
    const user = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>().user;
    if (user?.role === UserRole.STAGE) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        STAGE_ALLOWED_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException(
          refusal(
            'STAGE_SCREEN_ONLY',
            'The stage screen shows the meeting as it runs, and nothing else.',
          ),
        );
      }
    }
    return true;
  }
}
