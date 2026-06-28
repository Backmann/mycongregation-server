import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * Admin-only user management endpoints (Phase 1 of roles-and-permissions.md).
 *
 * All endpoints are gated by:
 *   - JwtAuthGuard (global APP_GUARD)
 *   - RolesGuard + @Roles(ADMIN) on the class
 *   - @TenantId() scoping every operation to the caller's congregation
 *
 * Business-logic invariants (enforced in UsersService):
 *   - cannot change your own role
 *   - cannot deactivate yourself
 *   - cannot demote / deactivate the last active admin in a congregation
 */
@Controller('users')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(
    @TenantId() congregationId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    return this.usersService.findAllInCongregation(congregationId, current.id);
  }

  @Post()
  create(
    @Body() dto: CreateUserDto,
    @TenantId() congregationId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    return this.usersService.createUserByAdmin(dto, congregationId, current.id);
  }

  @Patch(':id/role')
  updateRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserRoleDto,
    @TenantId() congregationId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    return this.usersService.updateRoleByAdmin(
      id,
      dto.role,
      congregationId,
      current.id,
    );
  }

  @Patch(':id/deactivate')
  deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @TenantId() congregationId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    return this.usersService.setActiveByAdmin(
      id,
      false,
      congregationId,
      current.id,
    );
  }

  @Patch(':id/activate')
  activate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @TenantId() congregationId: string,
    @CurrentUser() current: AuthenticatedUser,
  ) {
    return this.usersService.setActiveByAdmin(
      id,
      true,
      congregationId,
      current.id,
    );
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResetPasswordDto,
    @TenantId() congregationId: string,
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<void> {
    await this.usersService.resetPasswordByAdmin(
      id,
      dto.password,
      congregationId,
      current.id,
    );
  }
}
