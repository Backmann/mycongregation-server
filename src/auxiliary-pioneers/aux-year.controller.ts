import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { refusal } from '../common/errors/refusal';
import { AuxiliaryPioneersService } from './auxiliary-pioneers.service';
import { AuxYearService } from './aux-year.service';

/**
 * The history of auxiliary service by service years (29 October 2026).
 * Readings only. The whole congregation's year is for those who keep the
 * list; one man's years are for the elders, as the rest of his card is.
 */
@Controller('auxiliary-pioneers')
@UseGuards(JwtAuthGuard)
export class AuxYearController {
  constructor(
    private readonly service: AuxYearService,
    private readonly aux: AuxiliaryPioneersService,
  ) {}

  /** ?year=2026 — September 2026 to August 2027; the current one by default. */
  @Get('year')
  async year(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') yearRaw?: string,
  ) {
    await this.aux.assertCanManage(congregationId, user);
    let year: number | undefined;
    if (yearRaw !== undefined && yearRaw !== '') {
      if (!/^\d{4}$/.test(yearRaw)) {
        throw new BadRequestException(
          refusal('INVALID_FIELD', 'year is a four-digit year.', {
            fields: [{ field: 'year', rules: ['isInt'] }],
          }),
        );
      }
      year = Number(yearRaw);
    }
    return this.service.year(congregationId, year);
  }

  /** One publisher's years of auxiliary service — for his card. */
  @Get('publisher/:publisherId')
  card(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('publisherId', ParseUUIDPipe) publisherId: string,
  ) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.ELDER) {
      throw new ForbiddenException(
        refusal('NEEDS_ROLE', 'Elders and admins.', {
          roles: [UserRole.ELDER, UserRole.ADMIN],
        }),
      );
    }
    return this.service.card(congregationId, publisherId);
  }
}
