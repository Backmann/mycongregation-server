import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AnnouncementTemplatesService } from './announcement-templates.service';
import { WORDS_MAX } from './announcement-templates';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

class UpdateTemplateDto {
  /** null is not «on» or «off»: refused (it was a 500 — independent check). */
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  enabled?: boolean;

  /** Null or empty: back to the app's own words. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(WORDS_MAX)
  words?: string | null;

  /** Null: back to the app's own number of weeks. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  weeksAhead?: number | null;
}

/**
 * The «Templates» screen of the announcements (R-09 step 4). The writers
 * only — the service checks, as for the announcements themselves.
 */
@Controller('announcements/templates')
export class AnnouncementTemplatesController {
  constructor(private readonly service: AnnouncementTemplatesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Patch(':key')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.service.update(user, key, dto);
  }
}
