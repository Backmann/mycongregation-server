import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { Matches } from 'class-validator';
import { ConventionRulesService } from './convention-rules.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { BadRequestException } from '@nestjs/common';
import { refusal } from '../common/errors/refusal';

class AssemblyDateDto {
  /** The assembly's date — the period of the overseer's task. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}

function assertDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    throw new BadRequestException(
      refusal('INVALID_FIELD', 'A date is needed.', { field: 'date' }),
    );
  }
  return date;
}

/**
 * The programme on the screens before a circuit assembly (announcements R-05):
 * where the chairman's item stands, and taking it off or putting it back.
 * For the writers and the overseer of the Life and Ministry meeting — the
 * service checks.
 */
@Controller('announcements/screens')
export class ConventionRulesController {
  constructor(private readonly service: ConventionRulesService) {}

  @Get()
  state(@CurrentUser() user: AuthenticatedUser, @Query('date') date: string) {
    return this.service.screensState(user, assertDate(date));
  }

  @Post('remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Body() dto: AssemblyDateDto) {
    return this.service.removeScreens(user, dto.date);
  }

  @Post('restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssemblyDateDto,
  ) {
    return this.service.restoreScreens(user, dto.date);
  }
}
