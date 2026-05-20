import { SetMetadata } from '@nestjs/common';
import { ResponsibilityType } from '../enums/responsibility-type.enum';

export const REQUIRE_RESPONSIBILITY_KEY = 'requireResponsibility';

/**
 * Marks a route as requiring one of the given Layer 2 responsibilities.
 * Enforced by ResponsibilityGuard. Admins bypass this check (they have full
 * access per the permission matrix); any other user must hold one of the
 * listed responsibilities in their congregation.
 *
 * Mirrors the @Roles decorator. Use alongside @UseGuards(ResponsibilityGuard).
 */
export const RequireResponsibility = (...types: ResponsibilityType[]) =>
  SetMetadata(REQUIRE_RESPONSIBILITY_KEY, types);
