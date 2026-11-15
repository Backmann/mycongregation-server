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
