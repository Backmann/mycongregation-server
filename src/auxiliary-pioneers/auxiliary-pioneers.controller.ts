import {
  BadRequestException,
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
import { SetAuxNormDto } from './dto/set-norm.dto';
import { CongregationClock } from '../common/congregation-clock.service';
import { refusal } from '../common/errors/refusal';

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

  /**
   * Which months in a range allow 15 hours, and why. Calendar facts, not
   * anybody's data — open to everybody signed in: the publisher's own
   * application will ask it too.
   */
  @Get('reducible')
  reducible(
    @TenantId() congregationId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const iso = /^\d{4}-\d{2}(-\d{2})?$/;
    if (!iso.test(from ?? '') || !iso.test(to ?? '')) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'from and to are months, YYYY-MM.', {
          fields: [{ field: 'month', rules: ['isISO8601'] }],
        }),
      );
    }
    return this.service.reducibleMonths(congregationId, from, to);
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

  /** One month's goal — 15 or 30 — where the month allows 15. */
  @Patch(':id/norm')
  setNorm(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAuxNormDto,
  ) {
    return this.service.setNorm(congregationId, user, id, dto.month, dto.hours);
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
