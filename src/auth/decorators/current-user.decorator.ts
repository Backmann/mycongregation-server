import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  congregationId: string;
  uiLanguage: string;
  /**
   * Runs the platform, not a congregation. Set only in the database. It gates
   * the platform endpoints and widens nothing else — see PlatformOwnerGuard.
   *
   * Optional on purpose: where it is absent the answer is "no", so a context
   * that forgets to set it fails closed rather than open.
   */
  isOwner?: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
