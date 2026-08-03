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
} from '@nestjs/common';
import { PioneerSchoolService } from './pioneer-school.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import {
  AssignPioneerSchoolDutyDto,
  CreatePioneerSchoolDto,
  CreatePioneerSchoolDutyDto,
  CreatePioneerSchoolHelperDto,
  UpdatePioneerSchoolDayDto,
  UpdatePioneerSchoolDto,
  UpdatePioneerSchoolHelperDto,
} from './dto/pioneer-school.dto';

/**
 * The Pioneer Service School the congregation hosts: its days, the roles of
 * each day and the brothers who fill them. Editing is an administrator's;
 * reading is open to elders — both enforced in the service.
 */
@Controller('pioneer-school')
export class PioneerSchoolController {
  constructor(private readonly service: PioneerSchoolService) {}

  // Helpers first: 'helpers' must not be eaten by the ':id' route below.
  @Get('helpers')
  listHelpers(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listHelpers(tenantId, user);
  }

  @Post('helpers')
  createHelper(
    @TenantId() tenantId: string,
    @Body() dto: CreatePioneerSchoolHelperDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createHelper(tenantId, dto, user);
  }

  @Patch('helpers/:id')
  updateHelper(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePioneerSchoolHelperDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateHelper(tenantId, id, dto, user);
  }

  @Delete('helpers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeHelper(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeHelper(tenantId, id, user);
  }

  @Get()
  list(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(tenantId, user);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreatePioneerSchoolDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(tenantId, dto, user);
  }

  @Get(':id')
  getFull(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getFull(tenantId, id, user);
  }

  @Get(':id/load')
  load(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.helperLoad(tenantId, id, user);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePioneerSchoolDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(tenantId, id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(tenantId, id, user);
  }

  @Patch(':id/days/:dayId')
  updateDay(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Body() dto: UpdatePioneerSchoolDayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateDay(tenantId, id, dayId, dto, user);
  }

  @Patch(':id/duties/:dutyId')
  assignDuty(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dutyId', ParseUUIDPipe) dutyId: string,
    @Body() dto: AssignPioneerSchoolDutyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.assignDuty(tenantId, id, dutyId, dto, user);
  }

  @Post(':id/duties')
  addCustomDuty(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePioneerSchoolDutyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addCustomDuty(tenantId, id, dto, user);
  }

  @Delete(':id/duties/:dutyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCustomDuty(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dutyId', ParseUUIDPipe) dutyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeCustomDuty(tenantId, id, dutyId, user);
  }
}
