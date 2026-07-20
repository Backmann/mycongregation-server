import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { BootstrapDto } from './dto/bootstrap.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Post('bootstrap')
  bootstrap(@Body() dto: BootstrapDto) {
    return this.authService.bootstrap(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip ?? 'unknown');
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto.email, req.ip ?? 'unknown');
  }

  /**
   * Public on purpose: the access token may already be dead when a person
   * signs out, and they must still be able to end the session.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const account = await this.usersService.findByIdInCongregation(
      user.id,
      user.congregationId,
    );
    return { ...user, canViewPrivateData: account.canViewPrivateData };
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.authService.updateMe(user.id, dto);
  }

  /**
   * Self-service password change — available to every authenticated user
   * regardless of role (per the canonical permission matrix in
   * roles-and-permissions.md). Requires the current password as proof of
   * identity; this is what distinguishes a self-change from an admin
   * reset (which lives under POST /users/:id/reset-password).
   *
   * On incorrect current password we return 400 (not 401) so that the
   * client-side response interceptor does not interpret the failure as
   * a token expiry and trigger a refresh/logout cycle — the user is
   * still validly authenticated, they just typed the wrong password.
   */
  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeMyPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.usersService.changePasswordSelfService(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
