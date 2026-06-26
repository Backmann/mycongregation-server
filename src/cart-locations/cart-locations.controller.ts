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
  UseGuards,
} from '@nestjs/common';
import { CartLocationsService } from './cart-locations.service';
import { CreateCartLocationDto } from './dto/create-cart-location.dto';
import { UpdateCartLocationDto } from './dto/update-cart-location.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';

/**
 * Public-witnessing points (carts / stands). Anyone in the congregation may
 * view the active list; only admins and holders of PUBLIC_WITNESSING or
 * SERVICE_OVERSEER may manage it.
 */
@Controller('cart-locations')
export class CartLocationsController {
  constructor(private readonly service: CartLocationsService) {}

  @Get()
  list(
    @TenantId() congregationId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.service.list(congregationId, includeInactive === 'true');
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
  )
  create(
    @TenantId() congregationId: string,
    @Body() dto: CreateCartLocationDto,
  ) {
    return this.service.create(congregationId, dto);
  }

  @Patch(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
  )
  update(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartLocationDto,
  ) {
    return this.service.update(congregationId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.PUBLIC_WITNESSING,
    ResponsibilityType.SERVICE_OVERSEER,
  )
  async remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.remove(congregationId, id);
  }
}
