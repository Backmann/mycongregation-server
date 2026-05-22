import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { CartShiftsService } from './cart-shifts.service';
import { CreateCartShiftDto } from './dto/create-cart-shift.dto';
import { UpdateCartShiftDto } from './dto/update-cart-shift.dto';
import { QueryCartShiftsDto } from './dto/query-cart-shifts.dto';
import { AddParticipantDto } from './dto/add-participant.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UseGuards } from '@nestjs/common';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

@Controller('cart-shifts')
export class CartShiftsController {
  constructor(private readonly service: CartShiftsService) {}

  /** Anyone in the congregation can view the cart schedule. */
  @Get()
  list(@TenantId() congregationId: string, @Query() query: QueryCartShiftsDto) {
    return this.service.listShifts(congregationId, query);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.PUBLIC_WITNESSING)
  create(@TenantId() congregationId: string, @Body() dto: CreateCartShiftDto) {
    return this.service.createShift(congregationId, dto);
  }

  @Patch(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.PUBLIC_WITNESSING)
  update(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartShiftDto,
  ) {
    return this.service.updateShift(congregationId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.PUBLIC_WITNESSING)
  async remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.removeShift(congregationId, id);
  }

  @Post(':id/participants')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.PUBLIC_WITNESSING)
  addParticipant(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddParticipantDto,
  ) {
    return this.service.addParticipant(congregationId, id, dto.publisherId);
  }

  @Delete(':id/participants/:publisherId')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.PUBLIC_WITNESSING)
  removeParticipant(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('publisherId', ParseUUIDPipe) publisherId: string,
  ) {
    return this.service.removeParticipant(congregationId, id, publisherId);
  }
}
