import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import {
  RecutClassDto,
  RecutMeasureDto,
  RecutProposalDto,
  RecutRemarkDto,
} from './dto/recut.dto';
import { TerritoryRecutService } from './territory-recut.service';

/**
 * The draft of re-cutting the territories (15 November 2026). Who may do
 * what is the service's to check (TerritoryAccessService): the territory
 * servant and his assistant draw, the service committee looks and decides.
 */
@Controller('territory-recut')
export class TerritoryRecutController {
  constructor(private readonly recut: TerritoryRecutService) {}

  @Get()
  view(@CurrentUser() user: AuthenticatedUser) {
    return this.recut.view(user);
  }

  @Put('measure')
  setMeasure(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecutMeasureDto,
  ) {
    return this.recut.setMeasure(user, dto);
  }

  /** Works out every territory's walk, homes and minutes from the halls. */
  @Post('figures')
  figures(@CurrentUser() user: AuthenticatedUser) {
    return this.recut.computeMetrics(user);
  }

  @Put('classes/:territoryId')
  setClass(
    @CurrentUser() user: AuthenticatedUser,
    @Param('territoryId', ParseUUIDPipe) territoryId: string,
    @Body() dto: RecutClassDto,
  ) {
    return this.recut.setClass(user, territoryId, dto.cls ?? null);
  }

  /** A first draft by the measure: cuts and joins, never applied. */
  @Post('suggest')
  suggest(@CurrentUser() user: AuthenticatedUser) {
    return this.recut.suggest(user);
  }

  @Post('proposals')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecutProposalDto,
  ) {
    return this.recut.create(user, dto);
  }

  @Put('proposals/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecutProposalDto,
  ) {
    return this.recut.update(user, id, dto);
  }

  @Delete('proposals/:id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recut.remove(user, id);
  }

  @Put('proposals/:id/remark')
  remark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecutRemarkDto,
  ) {
    return this.recut.remark(user, id, dto);
  }

  @Delete('proposals/:id/remark')
  unremark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recut.unremark(user, id);
  }

  @Post('approve')
  approve(@CurrentUser() user: AuthenticatedUser) {
    return this.recut.approve(user);
  }
}
