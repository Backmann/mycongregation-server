import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { AnnouncementSuggestionsService } from './announcement-suggestions.service';
import {
  RefreshSuggestionDto,
  SuggestionKeyDto,
  TakeSuggestionDto,
} from './dto/suggestion.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * What the app suggests announcing (announcements R-09). Writers only: the
 * service refuses everyone else, as for the announcements themselves.
 *
 * No route here has the shape «:id/<word>», so none can be taken for one of
 * the announcement routes next door («/announcements/:id/dismiss»).
 */
@Controller('announcements/suggestions')
export class AnnouncementSuggestionsController {
  constructor(private readonly service: AnnouncementSuggestionsService) {}

  /** One week: what is offered, what comes next, what has gone stale. */
  @Get()
  forWeek(@CurrentUser() user: AuthenticatedUser, @Query('week') week: string) {
    return this.service.forWeek(user, week);
  }

  /** The counts for the line on Home. */
  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.summary(user);
  }

  @Post('take')
  take(@CurrentUser() user: AuthenticatedUser, @Body() dto: TakeSuggestionDto) {
    return this.service.take(user, dto);
  }

  @Post('not-needed')
  @HttpCode(HttpStatus.NO_CONTENT)
  notNeeded(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SuggestionKeyDto,
  ) {
    return this.service.dismiss(user, dto.key);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RefreshSuggestionDto,
  ) {
    return this.service.refresh(user, dto.announcementId);
  }
}
