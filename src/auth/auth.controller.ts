import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService, durationToMs } from './auth.service';
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
import {
  clearRefreshCookie,
  readRefreshToken,
  setRefreshCookie,
  wantsCookieAuth,
} from './refresh-cookie';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  private get cookieOpts() {
    return {
      apiPrefix: this.config.get<string>('app.apiPrefix') ?? 'api',
      isProduction: this.config.get<string>('app.nodeEnv') === 'production',
    };
  }

  /**
   * In cookie mode the refresh token is put in an httpOnly cookie and taken
   * OUT of the response body. Leaving it in the body would defeat the whole
   * exercise: a script could simply read the login or refresh response instead
   * of reading localStorage.
   */
  private deliverTokens<T extends { refreshToken: string }>(
    req: Request,
    res: Response,
    result: T,
  ): T | Omit<T, 'refreshToken'> {
    if (!wantsCookieAuth(req)) return result;

    setRefreshCookie(res, result.refreshToken, {
      ...this.cookieOpts,
      maxAgeMs: durationToMs(this.config.get<string>('jwt.refreshExpiresIn')),
    });
    const { refreshToken: _omitted, ...rest } = result;
    return rest;
  }

  @Public()
  @Post('bootstrap')
  bootstrap(@Body() dto: BootstrapDto) {
    return this.authService.bootstrap(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, req.ip ?? 'unknown');
    return this.deliverTokens(req, res, result);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = readRefreshToken(req, dto.refreshToken);
    if (!token) throw new UnauthorizedException('No refresh token');
    const result = await this.authService.refresh(token);
    return this.deliverTokens(req, res, result);
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
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = readRefreshToken(req, dto.refreshToken);
    // Clear the cookie whatever happens: someone who asked to sign out must
    // end up signed out, even if the token was already dead.
    clearRefreshCookie(res, this.cookieOpts);
    return token ? this.authService.logout(token) : { ok: true as const };
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
    // A capability, not the flag. The owner marker is deliberately invisible
    // everywhere; what the interface actually needs is whether to show the
    // backups row, and that can be answered without telling anyone that a
    // notion of platform owner exists at all.
    const { isOwner, ...rest } = user;
    return {
      ...rest,
      canViewPrivateData: account.canViewPrivateData,
      canManageBackups: isOwner === true,
    };
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
