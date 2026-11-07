import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CalendarFeedService } from './calendar-feed.service';
import { FeedOptionsDto } from './dto/feed-options.dto';

/** The person's own subscription: connect, change what is in it, a new link, off. */
@Controller('me/calendar-feed')
export class CalendarFeedSettingsController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.feeds.get(user.id);
  }

  @Post()
  @HttpCode(200)
  connect(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.feeds.connect(tenantId, user.id);
  }

  @Post('rotate')
  @HttpCode(200)
  rotate(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.feeds.rotate(tenantId, user.id);
  }

  @Patch()
  options(@CurrentUser() user: AuthenticatedUser, @Body() dto: FeedOptionsDto) {
    return this.feeds.setOptions(user.id, dto);
  }

  @Delete()
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.feeds.disconnect(user.id);
  }
}

/**
 * The feed itself: `GET /calendar/<token>.ics`, read by Google, Apple,
 * Outlook — without a login, so the link IS the key. Every link that is not
 * live gets the same plain 404, with nothing to tell a wrong token from one
 * switched off.
 */
@Controller('calendar')
export class CalendarFeedController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Public()
  @Get(':file')
  // Keyed by the link (throttler.guard.ts): a calendar asks every few hours;
  // this is room for a person pressing «refresh» and nothing more.
  @Throttle({
    short: { ttl: 60_000, limit: 10 },
    long: { ttl: 3_600_000, limit: 60 },
  })
  async feed(
    @Param('file') file: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ) {
    const token = file.endsWith('.ics') ? file.slice(0, -4) : file;
    const out = await this.feeds.read(token, ifNoneMatch, userAgent);
    // Never stored by a proxy or a CDN, never sent on as a referrer, never indexed.
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!out) throw new NotFoundException();
    res.setHeader('ETag', out.etag);
    if (out.status === 304) {
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="mycongregation.ics"',
    );
    res.status(200).send(out.body);
  }
}
