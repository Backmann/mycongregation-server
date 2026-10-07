import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';

export interface AuthenticatedUser {
  id: string;
  /** Null for an account with no address of its own — see User.email. */
  email: string | null;
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
  /**
   * Which sign-in this request belongs to — see RefreshSession.familyId.
   * Absent for a token issued before it was written in; then nothing is
   * marked «это устройство», which is the honest answer.
   */
  sessionFamilyId?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
