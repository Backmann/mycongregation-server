import { meUser } from './session-user';
import { Throttle } from '@nestjs/throttler';
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
import {
  ResetPasswordDto,
  RedeemInviteDto,
  ResendInviteDto,
} from './dto/reset-password.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './decorators/current-user.decorator';
import {
  clearRefreshCookie,
  readRefreshToken,
  setRefreshCookie,
  wantsCookieAuth,
} from './refresh-cookie';
import { CLIENT_HEADER, readClient } from './read-client';
import { clientIp } from '../common/client-ip';

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
    const result = await this.authService.login(
      dto,
      clientIp(req),
      readClient(req.headers['user-agent'], req.headers[CLIENT_HEADER]),
    );
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
    const result = await this.authService.refresh(
      token,
      readClient(req.headers['user-agent'], req.headers[CLIENT_HEADER]),
    );
    return this.deliverTokens(req, res, result);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(
      dto.login ?? dto.email ?? '',
      clientIp(req),
    );
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
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.resetPassword(
      dto.token,
      dto.password,
      readClient(req.headers['user-agent'], req.headers[CLIENT_HEADER]),
    );
    // A SESSION IS HANDED OUT HERE, so it leaves the way every session does.
    // Until 7 October 2026 this door and the code below answered with the
    // tokens in the body and set no cookie — and a browser keeps nothing but
    // the cookie. So on the website a person set a password, was let in, and
    // was asked to sign in again the moment the page was closed or reloaded:
    // every iPhone and every computer, on the very first visit.
    return this.deliverTokens(req, res, result);
  }

  /**
   * The invitation, finished where the person already is.
   *
   * Public by necessity — nobody has a session yet, that is the point of it —
   * and rate-limited hard for the same reason. The code alone says who this
   * is, so no address is asked for: the people this door was built for have
   * none. Guessing is limited per source, here and in the service.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @Post('invite/redeem')
  async redeemInvite(
    @Body() dto: RedeemInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // dto.email is deliberately not passed on: the code identifies the
    // account by itself, and older app builds still send an address.
    const result = await this.authService.redeemInvite(
      dto.code,
      dto.password,
      clientIp(req),
      readClient(req.headers['user-agent'], req.headers[CLIENT_HEADER]),
    );
    // See resetPassword above: without this a browser was let in for as long
    // as the page stayed open, and not a minute longer.
    return this.deliverTokens(req, res, result);
  }

  /**
   * A fresh invitation code, asked for by the person who needs it.
   *
   * Answers 200 and the same body no matter what happened — see
   * AuthService.resendInvite. Throttled harder than redeeming: sending mail on
   * a stranger's behalf deserves a tighter leash than guessing a code, which
   * dies on its own after five tries.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @Post('invite/resend')
  async resendInvite(@Body() dto: ResendInviteDto, @Req() req: Request) {
    // Either field, whichever the app in this person's pocket sends.
    await this.authService.resendInvite(
      dto.login ?? dto.email ?? '',
      clientIp(req),
    );
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const account = await this.usersService.findByIdInCongregation(
      user.id,
      user.congregationId,
    );
    return meUser(user, account);
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
