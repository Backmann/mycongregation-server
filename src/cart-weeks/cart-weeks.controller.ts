import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { CartWeeksService } from './cart-weeks.service';
import { BuildCartWeekDto } from './dto/build-cart-week.dto';
import { CopyCartWeekDto } from './dto/copy-cart-week.dto';
import { CartMemoDto, OpenCartWeekDto } from './dto/open-cart-week.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

const Arranges = () =>
  RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  );

@Controller('cart-weeks')
export class CartWeeksController {
  constructor(private readonly service: CartWeeksService) {}

  @Get()
  getWeek(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('weekStart') weekStart: string,
  ) {
    return this.service.getWeek(congregationId, weekStart, user);
  }

  @Get('pairings')
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  pairings(@TenantId() congregationId: string, @Query('weeks') weeks?: string) {
    // 1 to 52 weeks; anything else is the usual eight — a bad query string
    // used to reach the database as NaN and come back a 500.
    const n = Number(weeks);
    return this.service.recentPairings(
      congregationId,
      Number.isInteger(n) && n >= 1 && n <= 52 ? n : 8,
    );
  }

  /** What was really served, for the circuit overseer's visit. */
  @Get('archive')
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  archive(
    @TenantId() congregationId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.archive(congregationId, from, to);
  }

  @Put('memo')
  @HttpCode(204)
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  async memo(@TenantId() congregationId: string, @Body() dto: CartMemoDto) {
    await this.service.setMemo(congregationId, dto.memo ?? null);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  build(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BuildCartWeekDto,
  ) {
    return this.service.buildWeek(congregationId, user.id, dto);
  }

  @Post('copy')
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  copy(
    @TenantId() congregationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CopyCartWeekDto,
  ) {
    return this.service.copyWeek(
      congregationId,
      user.id,
      dto.weekStartDate,
      dto.fromWeekStartDate,
    );
  }

  /** For each person who asked this week: what the proposal goes by. */
  @Get(':id/standing')
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  async standing(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const week = await this.service.weekById(congregationId, id);
    const ids = await this.service.askingIn(congregationId, id);
    const map = await this.service.standingOf(
      congregationId,
      week.weekStartDate,
      ids,
    );
    return Object.fromEntries(map);
  }

  @Post(':id/open')
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  open(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenCartWeekDto,
  ) {
    return this.service.openWeek(congregationId, id, dto.signupUntil);
  }

  @Post(':id/publish')
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  publish(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.publishWeek(congregationId, id);
  }

  @Post(':id/suggest')
  @HttpCode(200)
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  suggest(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.suggestWeek(congregationId, id, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(ResponsibilityGuard)
  @Arranges()
  async remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deleteWeek(congregationId, id);
  }
}
