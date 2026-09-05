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
import type { MyAuxPioneerStatus } from './auxiliary-pioneers.service';
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

  /** Everyone serving in a given month (?month=YYYY-MM-DD), with hour goal. */
  @Get()
  async list(
    @TenantId() congregationId: string,
    @Query('month') month: string,
  ) {
    const monthIso = month || (await this.clock.todayFor(congregationId));
    return this.service.listForMonth(congregationId, monthIso);
  }

  /** Full history journal. */
  /**
   * Permanent pioneers whose card has no date of appointment and no start of
   * ministry — the ones a spell of pioneer service could not be given a
   * beginning for. Shown so the dates can be filled in by hand before anything
   * starts reading history from spells.
   */
  @Get('pioneers-missing-date')
  pioneersMissingDate(@TenantId() congregationId: string) {
    return this.service.pioneersMissingDate(congregationId);
  }

  @Get('journal')
  journal(@TenantId() congregationId: string) {
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
