import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HallsService } from './halls.service';
import { CreateHallDto } from './dto/create-hall.dto';
import { UpdateHallDto } from './dto/update-hall.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * Kingdom Hall reference list. Reading is open to any authenticated member
 * (pickers need it); changes are admin-only.
 */
@Controller('halls')
@UseGuards(RolesGuard)
export class HallsController {
  constructor(private readonly service: HallsService) {}

  @Get()
  list(@TenantId() congregationId: string) {
    return this.service.list(congregationId);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@TenantId() congregationId: string, @Body() dto: CreateHallDto) {
    return this.service.create(congregationId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHallDto,
  ) {
    return this.service.update(congregationId, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(congregationId, id);
  }
}
