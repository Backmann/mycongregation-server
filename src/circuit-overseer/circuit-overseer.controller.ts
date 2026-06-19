import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CircuitOverseerService } from './circuit-overseer.service';
import { UpsertCircuitOverseerDto } from './dto/upsert-circuit-overseer.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * The congregation's current circuit overseer. Reading is open to any member
 * (the name surfaces on the visit banner); only an admin edits the default.
 */
@Controller('circuit-overseer')
@UseGuards(RolesGuard)
export class CircuitOverseerController {
  constructor(private readonly service: CircuitOverseerService) {}

  @Get()
  get(@TenantId() tenantId: string) {
    return this.service.get(tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  upsert(@TenantId() tenantId: string, @Body() dto: UpsertCircuitOverseerDto) {
    return this.service.upsert(tenantId, dto);
  }
}
