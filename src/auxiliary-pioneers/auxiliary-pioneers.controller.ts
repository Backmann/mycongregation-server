import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuxiliaryPioneersService } from './auxiliary-pioneers.service';
import type {
  AuxPioneersServingNow,
  MyAuxPioneerStatus,
} from './auxiliary-pioneers.service';
import { CreateAuxiliaryPioneerDto } from './dto/create-auxiliary-pioneer.dto';
import { StopAuxiliaryPioneerDto } from './dto/stop-auxiliary-pioneer.dto';
import { UpdateAuxiliaryPioneerDto } from './dto/update-auxiliary-pioneer.dto';
import { CongregationClock } from '../common/congregation-clock.service';

@Controller('auxiliary-pioneers')
@UseGuards(JwtAuthGuard)
export class AuxiliaryPioneersController {
  constructor(
    private readonly service: AuxiliaryPioneersService,
    private readonly clock: CongregationClock,
  ) {}

  /**
   * THE WORKING LIST belongs to those who keep it.
   *
   * Until 6 October the three readings below — any month with its hour goal,
   * the whole journal, the pioneers without a date — were given to anybody
   * signed in: only the changes asked who was asking. The app showed the
   * door to the managers alone, but an address or a request needed no door.
   * What everybody is meant to see is `serving-now`, and only that.
   */

  /** Everyone serving in a given month (?month=YYYY-MM-DD), with hour goal. */
  @Get()
  async list(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('month') month: string,
  ) {
    await this.service.assertCanManage(congregationId, user);
    const monthIso = month || (await this.clock.todayFor(congregationId));
    return this.service.listForMonth(congregationId, monthIso);
  }

  /** This month's auxiliary pioneers by name — for everybody. */
  @Get('serving-now')
  servingNow(
    @TenantId() congregationId: string,
  ): Promise<AuxPioneersServingNow> {
    return this.service.servingNow(congregationId);
  }

  /**
   * Permanent pioneers whose card has no date of appointment and no start of
   * ministry — the ones a spell of pioneer service could not be given a
   * beginning for. Shown so the dates can be filled in by hand before anything
   * starts reading history from spells.
   */
  @Get('pioneers-missing-date')
  async pioneersMissingDate(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertCanManage(congregationId, user);
    return this.service.pioneersMissingDate(congregationId);
  }

  /** Full history journal. */
  @Get('journal')
  async journal(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.assertCanManage(congregationId, user);
    return this.service.journal(congregationId);
  }

  /**
   * The CURRENT user's own auxiliary-pioneer standing around a given month:
   * whether they serve in it, the period covering it, and the next period that
   * has not started yet. Available to the publisher themselves (drives the
   * report form and the home badge); never the roster.
   */
  @Get('mine')
  async mine(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('month') month: string,
  ): Promise<MyAuxPioneerStatus> {
    const monthIso = month || (await this.clock.todayFor(congregationId));
    return this.service.myAuxiliaryPioneerStatus(
      congregationId,
      user,
      monthIso,
    );
  }

  @Post()
  create(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAuxiliaryPioneerDto,
  ) {
    return this.service.create(congregationId, user, dto);
  }

  @Patch(':id/stop')
  stop(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StopAuxiliaryPioneerDto,
  ) {
    return this.service.stop(congregationId, user, id, dto);
  }

  @Patch(':id')
  update(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAuxiliaryPioneerDto,
  ) {
    return this.service.update(congregationId, user, id, dto);
  }

  @Delete(':id')
  remove(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(congregationId, user, id);
  }
}
