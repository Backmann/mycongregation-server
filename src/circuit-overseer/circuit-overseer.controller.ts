import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CircuitOverseerService } from './circuit-overseer.service';
import {
  CreateCircuitOverseerDto,
  UpdateCircuitOverseerDto,
} from './dto/upsert-circuit-overseer.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * Circuit overseers the congregation may host. Reading is open to any member
 * (names surface on the visit banner); only an admin adds, edits, or removes.
 */
@Controller('circuit-overseers')
@UseGuards(RolesGuard)
export class CircuitOverseerController {
  constructor(private readonly service: CircuitOverseerService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.service.list(tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateCircuitOverseerDto) {
    return this.service.create(tenantId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCircuitOverseerDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}
