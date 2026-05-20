import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { REQUIRE_RESPONSIBILITY_KEY } from '../decorators/require-responsibility.decorator';
import { ResponsibilityType } from '../enums/responsibility-type.enum';
import { UserRole } from '../enums/user-role.enum';
import { Responsibility } from '../../entities/responsibility.entity';
import type { AuthenticatedUser } from '../../auth/decorators/current-user.decorator';

/**
 * Enforces @RequireResponsibility. Semantics follow the authoritative
 * permission matrix in roles-and-permissions.md:
 *
 *   - no @RequireResponsibility metadata -> allow
 *   - admin role -> allow (admins have full access in every matrix row)
 *   - user holds one of the required responsibilities in their congregation
 *     -> allow
 *   - otherwise -> 403
 *
 * Note: this is "admin OR holds-responsibility", NOT "role AND responsibility".
 * The `elder` role alone does not grant a responsibility-gated action; the
 * specific responsibility (or admin) is required.
 */
@Injectable()
export class ResponsibilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ResponsibilityType[]>(
      REQUIRE_RESPONSIBILITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user) {
      throw new ForbiddenException('No user context');
    }

    if (user.role === UserRole.ADMIN) {
      return true;
    }

    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(required),
      },
    });
    if (held > 0) {
      return true;
    }

    throw new ForbiddenException(
      `Requires responsibility: ${required.join(', ')}`,
    );
  }
}
