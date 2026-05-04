import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

/**
 * Extracts the current user's congregationId from the request.
 * Throws ForbiddenException if no tenant context exists (e.g. on a route
 * mistakenly marked @Public() that still uses this decorator).
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const tenantId = request.user?.congregationId;
    if (!tenantId) {
      throw new ForbiddenException('No tenant context');
    }
    return tenantId;
  },
);
