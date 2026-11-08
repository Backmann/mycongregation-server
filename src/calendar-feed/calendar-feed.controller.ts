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
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CalendarFeedService, requestBase } from './calendar-feed.service';
import { FeedOptionsDto } from './dto/feed-options.dto';

/** The person's own subscription: connect, change what is in it, a new link, off. */
@Controller('me/calendar-feed')
export class CalendarFeedSettingsController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.feeds.get(user.id, requestBase(req.headers));
  }

  @Post()
  @HttpCode(200)
  connect(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.feeds.connect(tenantId, user.id, requestBase(req.headers));
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
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ) {
    const token = file.endsWith('.ics') ? file.slice(0, -4) : file;
    const out = await this.feeds.read(token, userAgent);
    // Never stored by a proxy or a CDN, never sent on as a referrer, never indexed.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!out) throw new NotFoundException();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="mycongregation.ics"',
    );
    // end(), not send(): send() adds its own ETag and answers 304 to a
    // calendar that already has the same text — with the old «as of» in it.
    const body = Buffer.from(out.body, 'utf8');
    res.setHeader('Content-Length', String(body.length));
    res.status(200).end(body);
  }
}
