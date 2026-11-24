import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import {
  MarkAnnouncementDto,
  MeetingRefDto,
  OrderAnnouncementsDto,
} from './dto/meeting-ref.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * Announcements read aloud at the meetings (R-01…R-03, 24 November 2026).
 *
 * Who may call what is decided in the service, for every route: the writers
 * (the coordinator of the body of elders, his assistant, the administrators)
 * do everything; the chairman of a meeting reads that meeting's list and ticks
 * it off. Nobody else gets anything — not even a count.
 */
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  /** Whether the signed-in person writes announcements (for the menu). */
  @Get('rights')
  async rights(@CurrentUser() user: AuthenticatedUser) {
    return { write: await this.service.mayWrite(user) };
  }

  /** The writers' weeks: `from` a Monday, `count` weeks (at most 8). */
  @Get('weeks')
  weeks(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from: string,
    @Query('count') count?: string,
  ) {
    return this.service.weeks(user, from, Number(count ?? 2));
  }

  /** One meeting — for its chairman and the conduct mode. */
  @Get('meeting')
  meeting(
    @CurrentUser() user: AuthenticatedUser,
    @Query('week') week: string,
    @Query('kind') kind: string,
  ) {
    return this.service.meeting(user, week, kind);
  }

  /** The signed-in person's coming meetings as chairman. */
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.mine(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.service.create(user, dto);
  }

  @Post('order')
  @HttpCode(HttpStatus.OK)
  order(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OrderAnnouncementsDto,
  ) {
    return this.service.order(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(user, id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  mark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkAnnouncementDto,
  ) {
    return this.service.mark(user, id, dto.read);
  }

  @Post(':id/carry')
  @HttpCode(HttpStatus.OK)
  carry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MeetingRefDto,
  ) {
    return this.service.carry(user, id, dto);
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.dismiss(user, id);
  }
}
