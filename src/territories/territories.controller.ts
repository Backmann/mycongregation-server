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
import { EditTerritoryDto } from './dto/card.dto';
import { OutlineDto } from './dto/outline.dto';
import type { TerritoryCategory } from '../entities/territory.entity';
import { TerritoryOutlineService } from './territory-outline.service';
import { TerritoryReshapeService } from './territory-reshape.service';
import { TerritoryBusinessesService } from './territory-businesses.service';
import { PaperDto } from './dto/assignment.dto';
import { TerritorySplitsService } from './territory-splits.service';
import {
  DivideDto,
  MarkStreetDto,
  MoveStreetDto,
  PreviewDivisionDto,
  TakeStreetDto,
} from './dto/split.dto';
import { Throttle } from '@nestjs/throttler';
import {
  AddBusinessesDto,
  EditBusinessDto,
  MarkBusinessDto,
} from './dto/business.dto';
import {
  CreateTerritoryDto,
  MergeCheckDto,
  MergeDto,
  NewCheckDto,
  SplitDto,
  SplitLineDto,
} from './dto/reshape.dto';
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
    private readonly outline: TerritoryOutlineService,
    private readonly reshape: TerritoryReshapeService,
    private readonly businesses: TerritoryBusinessesService,
    private readonly splits: TerritorySplitsService,
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
    @Query('category') category?: string,
  ) {
    const y = serviceYear ? Number(serviceYear) : undefined;
    return this.service.s13(
      user,
      y !== undefined && Number.isInteger(y) ? y : undefined,
      category === 'business' ? 'business' : 'residential',
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

  /** Out of use (12 November 2026). */
  /**
   * The next free number like the given one («Hamm42» → «Hamm74»); for a
   * business territory with no example, in the congregation's language's
   * own pattern («Д-1», «G-1»).
   */
  @Get('next-number')
  nextNumber(
    @CurrentUser() user: AuthenticatedUser,
    @Query('like') like?: string,
    @Query('category') category?: string,
  ) {
    return this.reshape.suggestNumber(
      user,
      like,
      category === 'business' ? 'business' : 'residential',
    );
  }

  /** A new territory drawn by hand: what it would hold (12 November 2026). */
  @Post('new/check')
  @HttpCode(HttpStatus.OK)
  newCheck(@CurrentUser() user: AuthenticatedUser, @Body() dto: NewCheckDto) {
    return this.reshape.createCheck(
      user,
      dto.geometry,
      (dto.category ?? 'residential') as TerritoryCategory,
    );
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTerritoryDto,
  ) {
    return this.reshape.create(user, dto);
  }

  /** Houses no territory holds, grouped into spots (12 November 2026). */
  @Get('gaps')
  gaps(@CurrentUser() user: AuthenticatedUser) {
    return this.service.gaps(user);
  }

  /** The register of houses in a box, for the editor (12 November 2026). */
  @Get('houses')
  houses(@CurrentUser() user: AuthenticatedUser, @Query('box') box?: string) {
    return this.outline.housesIn(user, box);
  }

  @Get('archived')
  archived(@CurrentUser() user: AuthenticatedUser) {
    return this.service.archived(user);
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

  /** The card corrected by hand (12 November 2026). */
  @Patch(':id')
  editCard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditTerritoryDto,
  ) {
    return this.service.editCard(user, id, dto);
  }

  /** What a boundary drawn again would do, without saving (12 November 2026). */
  @Post(':id/outline/check')
  @HttpCode(HttpStatus.OK)
  checkOutline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OutlineDto,
  ) {
    return this.outline.check(user, id, dto);
  }

  @Put(':id/outline')
  saveOutline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OutlineDto,
  ) {
    return this.outline.save(user, id, dto);
  }

  @Post(':id/outline/undo')
  @HttpCode(HttpStatus.OK)
  undoOutline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.outline.undo(user, id);
  }

  /** Cutting a free territory in two along a line (12 November 2026). */
  @Post(':id/split/check')
  @HttpCode(HttpStatus.OK)
  splitCheck(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SplitLineDto,
  ) {
    return this.reshape.splitCheck(user, id, dto.line);
  }

  @Post(':id/split')
  @HttpCode(HttpStatus.OK)
  split(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SplitDto,
  ) {
    return this.reshape.split(user, id, dto);
  }

  /** Joining two free neighbours of the same kind (12 November 2026). */
  @Post(':id/merge/check')
  @HttpCode(HttpStatus.OK)
  mergeCheck(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeCheckDto,
  ) {
    return this.reshape.mergeCheck(user, id, dto.otherId);
  }

  @Post(':id/merge')
  @HttpCode(HttpStatus.OK)
  merge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeDto,
  ) {
    return this.reshape.merge(user, id, dto);
  }

  /** Undoes the last cut, join or new territory, while nothing happened since. */
  @Post(':id/reshape/undo')
  @HttpCode(HttpStatus.OK)
  undoReshape(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reshape.undo(user, id);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.archive(user, id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.restore(user, id);
  }

  /** «Выдача и приём»: people, what is out, who had what (13 November 2026). */
  @Get('desk')
  async desk(@CurrentUser() user: AuthenticatedUser) {
    const desk = await this.given.desk(user);
    return { ...desk, ...(await this.service.sizes(user)) };
  }

  /** Into the queue of paper maps, or out of it once printed. */
  @Put('assignments/:id/paper')
  paper(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PaperDto,
  ) {
    return this.given.paper(user, id, dto.wanted);
  }

  // ------------------------ a territory divided between groups ---------
  // (13 November 2026). Not «split»: that is cutting a territory in two.

  /** Today's division of the territory, its marks, who may do what. */
  @Get(':id/division')
  division(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.splits.ofToday(user, id);
  }

  @Post(':id/division')
  divide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DivideDto,
  ) {
    return this.splits.divide(
      user,
      id,
      { parts: dto.parts, mode: dto.mode, smaller: dto.smaller },
      !!dto.again,
    );
  }

  /** A division to look at before handing out: saved nowhere. */
  @Post(':id/division/preview')
  @HttpCode(200)
  previewDivision(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewDivisionDto,
  ) {
    return this.splits.preview(user, id, dto);
  }

  /** Today's division taken away: its links stop; the marks stay. */
  @Delete('divisions/:id')
  removeDivision(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.splits.remove(user, id);
  }

  /** A street of a pair that has not started, taken into another part. */
  @Put('divisions/:id/take')
  takeStreet(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveStreetDto,
  ) {
    return this.splits.take(user, id, dto.key, dto.to);
  }

  @Put('divisions/:id/move')
  moveStreet(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveStreetDto,
  ) {
    return this.splits.move(user, id, dto.key, dto.to);
  }

  @Put('divisions/:id/mark')
  markStreet(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkStreetDto,
  ) {
    return this.splits.mark(user, id, dto.key, dto.walked);
  }

  /** A link without login to one part, good today only. */
  @Post('divisions/:id/parts/:n/link')
  partLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('n') n: string,
  ) {
    return this.splits.partLink(user, id, Number(n));
  }

  // ----------------------------- the list of a business territory --------
  // (13 November 2026)

  @Get(':id/businesses')
  businessList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.businesses.list(user, id);
  }

  @Get(':id/businesses/suggest')
  businessSuggest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.businesses.suggest(user, id);
  }

  @Post(':id/businesses')
  businessAdd(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddBusinessesDto,
  ) {
    return this.businesses.add(user, id, dto);
  }

  @Patch('businesses/:id')
  businessEdit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditBusinessDto,
  ) {
    return this.businesses.edit(user, id, dto);
  }

  @Delete('businesses/:id')
  businessRemove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.businesses.remove(user, id);
  }

  @Put('businesses/:id/mark')
  businessMark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkBusinessDto,
  ) {
    return this.businesses.mark(user, id, dto.state ?? null);
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

/**
 * One part of a territory divided between groups, behind a link without
 * login (13 November 2026): its streets, «walked» marks and how many
 * «не посещать» addresses it has — never which. Good on the day of the
 * division only; every link that does not work gets the same plain 404.
 */
@Controller('territory-parts')
export class TerritoryPartsController {
  constructor(private readonly splits: TerritorySplitsService) {}

  private headers(res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  @Public()
  @Get(':token')
  async shared(@Param('token') token: string, @Res() res: Response) {
    this.headers(res);
    const out = await this.splits.shared(token);
    if (!out) throw new NotFoundException();
    res.status(200).json(out);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 600000 } })
  @Put(':token/take')
  async take(
    @Param('token') token: string,
    @Body() dto: TakeStreetDto,
    @Res() res: Response,
  ) {
    this.headers(res);
    const out = await this.splits.takeShared(token, dto.key);
    if (!out) throw new NotFoundException();
    res.status(200).json(out);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 600000 } })
  @Put(':token/mark')
  async mark(
    @Param('token') token: string,
    @Body() dto: MarkStreetDto,
    @Res() res: Response,
  ) {
    this.headers(res);
    const out = await this.splits.markShared(token, dto.key, dto.walked);
    if (!out) throw new NotFoundException();
    res.status(200).json(out);
  }
}
