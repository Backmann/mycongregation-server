import { Body, Controller, Get, Logger, Param, Patch } from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AnnouncementTemplatesService } from './announcement-templates.service';
import { ConventionRulesService } from './convention-rules.service';
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
  private readonly logger = new Logger(AnnouncementTemplatesController.name);
  constructor(
    private readonly service: AnnouncementTemplatesService,
    private readonly conventionRules: ConventionRulesService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Patch(':key')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    const view = await this.service.update(user, key, dto);
    // A rule the daily run places: turned back on, it is placed now, not
    // tomorrow morning (independent check).
    if (key === 'assembly_screens' || key === 'campaign_part')
      try {
        await this.conventionRules.forCongregation(user.congregationId);
      } catch (e) {
        // The change is saved; the daily run places it in the morning.
        this.logger.error(`Convention rules after a template change: ${e}`);
      }
    return view;
  }
}
