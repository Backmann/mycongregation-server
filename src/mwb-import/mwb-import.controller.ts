import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { MwbImportService } from './mwb-import.service';
import { ApplyParsedDto } from './dto/apply-parsed.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

@Controller('mwb-import')
export class MwbImportController {
  constructor(private readonly service: MwbImportService) {}

  /**
   * What the congregation already has, so the screen can say so before
   * anybody picks a file. Elders read it; only admins and elders get here.
   */
  @Get('coverage')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  coverage(@TenantId() congregationId: string) {
    return this.service.coverage(congregationId);
  }

  /**
   * Accepts a workbook parsed on the client. No publication file is
   * uploaded — the payload contains only derived schedule metadata
   * (part keys, titles, durations).
   */
  @Post('apply')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  apply(@TenantId() congregationId: string, @Body() dto: ApplyParsedDto) {
    return this.service.applyParsed(congregationId, dto);
  }
}
