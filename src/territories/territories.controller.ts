import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { TerritoryLinksService } from './territory-links.service';
import { TerritoryNoCallsService } from './territory-no-calls.service';
import { CreateNoCallDto, UpdateNoCallDto } from './dto/no-call.dto';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { TerritoriesService } from './territories.service';
import { TerritoryAssignmentsService } from './territory-assignments.service';
import {
  AssignTerritoryDto,
  CampaignDto,
  PrintLinksDto,
  MeetingTerritoryDto,
  SummaryQueryDto,
  TransferAssignmentDto,
  CompleteAssignmentDto,
  EditAssignmentDto,
  ExtendAssignmentDto,
  ReturnAssignmentDto,
} from './dto/assignment.dto';
import {
  ImportAssignmentsDto,
  ImportBoundaryDto,
  ImportNoCallsDto,
  ImportTerritoriesDto,
} from './dto/import.dto';

/**
 * The territory section (11 November 2026). Who may do what is decided in
 * TerritoryAccessService, not by a guard: whether the service committee
 * sees the section depends on the records having been confirmed, which a
 * guard reading responsibilities alone cannot know.
 */
@Controller('territories')
export class TerritoriesController {
  constructor(
    private readonly service: TerritoriesService,
    private readonly given: TerritoryAssignmentsService,
    private readonly links: TerritoryLinksService,
    private readonly noCalls: TerritoryNoCallsService,
  ) {}

  /** The door: what the user may open, and the territories he has a part in. */
  @Get('access')
  async access(@CurrentUser() user: AuthenticatedUser) {
    const [a, mine] = await Promise.all([
      this.service.accessOf(user),
      this.given.mine(user),
    ]);
    return {
      ...a,
      mine: mine.map((t) => ({
        id: t.id,
        number: t.number,
        dueOn: t.assignment.dueOn,
        mine: t.assignment.mine,
        forGroupName: t.assignment.forGroupName,
      })),
    };
  }

  /** The holder's and his group's territories, with their shapes. */
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.given.mine(user);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Get('boundary')
  boundary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.boundary(user);
  }

  /** The S-13 of a kept service year, for printing. */
  @Get('s13')
  s13(
    @CurrentUser() user: AuthenticatedUser,
    @Query('serviceYear') serviceYear?: string,
  ) {
    const y = serviceYear ? Number(serviceYear) : undefined;
    return this.service.s13(
      user,
      y !== undefined && Number.isInteger(y) ? y : undefined,
    );
  }

  /** A month of the territories, for the service committee. */
  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser, @Query() q: SummaryQueryDto) {
    return this.service.summary(user, q.month);
  }

  /** The meetings for field service the user conducts, with what they may go to. */
  @Get('my-meetings')
  myMeetings(@CurrentUser() user: AuthenticatedUser) {
    return this.given.myMeetings(user);
  }

  @Put('meetings/:meetingId')
  setMeetingTerritory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: MeetingTerritoryDto,
  ) {
    return this.given.setMeetingTerritory(
      user,
      meetingId,
      dto.territoryId ?? null,
    );
  }

  /** Links (and, if asked, addresses) for printed territory maps. */
  @Post('print-links')
  @HttpCode(HttpStatus.OK)
  printLinks(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PrintLinksDto,
  ) {
    return this.links.printLinks(user, dto.assignmentIds, !!dto.withNoCalls);
  }

  /** «Обработаны в кампанию». */
  @Post('campaign')
  campaign(@CurrentUser() user: AuthenticatedUser, @Body() dto: CampaignDto) {
    return this.given.campaign(user, dto.territoryIds, dto.workedOn);
  }

  @Get('checks')
  checks(@CurrentUser() user: AuthenticatedUser) {
    return this.service.checks(user);
  }

  @Post('import/boundary')
  importBoundary(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportBoundaryDto,
  ) {
    return this.service.importBoundary(user, dto);
  }

  @Post('import/territories')
  importTerritories(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportTerritoriesDto,
  ) {
    return this.service.importTerritories(user, dto);
  }

  @Post('import/assignments')
  importAssignments(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportAssignmentsDto,
  ) {
    return this.service.importAssignments(user, dto);
  }

  @Post('import/no-calls')
  importNoCalls(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportNoCallsDto,
  ) {
    return this.service.importNoCalls(user, dto);
  }

  @Post('import/reset')
  @HttpCode(HttpStatus.OK)
  reset(@CurrentUser() user: AuthenticatedUser) {
    return this.service.reset(user);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@CurrentUser() user: AuthenticatedUser) {
    return this.service.verify(user);
  }

  // ---- giving out and taking back ----

  @Get(':id/candidates')
  candidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.given.candidates(user, id);
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTerritoryDto,
  ) {
    return this.given.assign(user, id, dto);
  }

  @Post('assignments/:id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteAssignmentDto,
  ) {
    return this.given.complete(user, id, dto);
  }

  @Post('assignments/:id/return')
  @HttpCode(HttpStatus.OK)
  giveBack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnAssignmentDto,
  ) {
    return this.given.giveBack(user, id, dto);
  }

  @Post('assignments/:id/extend')
  @HttpCode(HttpStatus.OK)
  extend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendAssignmentDto,
  ) {
    return this.given.extend(user, id, dto);
  }

  /** A two-hour link to open the map in the phone's browser. */
  @Post('assignments/:id/view-link')
  @HttpCode(HttpStatus.OK)
  viewLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.links.viewLink(user, id);
  }

  /** A link without login until the day it is due; replaces the last one. */
  @Post('assignments/:id/share-link')
  @HttpCode(HttpStatus.OK)
  shareLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.links.shareLink(user, id);
  }

  @Delete('assignments/:id/share-link')
  revokeShare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.links.revokeShare(user, id);
  }

  /** A group's territory to the group's new overseer. */
  @Post('assignments/:id/transfer')
  transfer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferAssignmentDto,
  ) {
    return this.given.transfer(user, id, dto);
  }

  @Patch('assignments/:id')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditAssignmentDto,
  ) {
    return this.given.edit(user, id, dto);
  }

  @Delete('assignments/:id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.given.remove(user, id);
  }

  // «Не посещать» kept by hand (12 November 2026).
  @Get('no-calls/review')
  noCallsReview(@CurrentUser() user: AuthenticatedUser) {
    return this.noCalls.review(user);
  }

  @Post(':id/no-calls')
  addNoCall(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoCallDto,
  ) {
    return this.noCalls.create(user, id, dto);
  }

  @Patch('no-calls/:id')
  editNoCall(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoCallDto,
  ) {
    return this.noCalls.update(user, id, dto);
  }

  @Post('no-calls/:id/keep')
  @HttpCode(200)
  keepNoCall(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.noCalls.keep(user, id);
  }

  @Delete('no-calls/:id')
  removeNoCall(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.noCalls.remove(user, id);
  }

  // Last: a fixed path above must win over the id.
  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(user, id);
  }
}

/**
 * The page behind a link without login (11 November 2026): one territory's
 * outline and street map. Every link that does not work gets the same plain
 * 404; the answer is never kept by a proxy, sent on as a referrer or indexed.
 */
@Controller('territory-links')
export class TerritoryLinksController {
  constructor(private readonly links: TerritoryLinksService) {}

  @Public()
  @Get(':token')
  async shared(@Param('token') token: string, @Res() res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const out = await this.links.shared(token);
    if (!out) throw new NotFoundException();
    res.status(200).json(out);
  }
}
