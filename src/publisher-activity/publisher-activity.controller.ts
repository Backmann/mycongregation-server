import { Controller, Get, Query } from '@nestjs/common';
import { PublisherActivityService } from './publisher-activity.service';
import { QueryActivityDto } from './dto/query-activity.dto';
import { QuerySuggestionsDto } from './dto/query-suggestions.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { canSeeProgrammeDrafts } from '../assignments/programme-drafts';

/**
 * Read-only activity feed used to give context when assigning publishers
 * (their recent parts + duties). Open to any authenticated member.
 */
@Controller('publisher-activity')
export class PublisherActivityController {
  constructor(
    private readonly service: PublisherActivityService,
    @InjectEntityManager() private readonly manager: EntityManager,
  ) {}

  @Get()
  async getActivity(
    @TenantId() congregationId: string,
    @Query() query: QueryActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getActivity(
      congregationId,
      query.weekStart,
      query.weeks ?? 4,
      query.ahead ?? 0,
      await canSeeProgrammeDrafts(this.manager, user),
    );
  }

  @Get('suggestions')
  getSuggestions(
    @TenantId() congregationId: string,
    @Query() query: QuerySuggestionsDto,
  ) {
    const partKeys = query.partKeys
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.service.getSuggestions(
      congregationId,
      query.weekStart,
      partKeys,
      query.weeks ?? 26,
    );
  }
}
