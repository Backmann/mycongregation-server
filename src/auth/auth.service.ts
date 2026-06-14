import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { MailService } from '../mail/mail.service';
import { User } from '../entities/user.entity';
import { Congregation } from '../entities/congregation.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { UsersService } from '../users/users.service';
import { BootstrapDto } from './dto/bootstrap.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import type { AuthenticatedUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';

interface RefreshTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  congregationId: string;
  tokenType: 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  /**
   * One-time setup: creates the first Congregation + first admin User.
   * Refuses if any user already exists in the database.
   */
  async bootstrap(dto: BootstrapDto) {
    const existing = await this.usersService.count();
    if (existing > 0) {
      throw new ConflictException(
        'Bootstrap already performed. Use invitation flow instead.',
      );
    }

    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const result = await this.dataSource.transaction(async (manager) => {
      const congregation = manager.create(Congregation, {
        name: dto.congregationName,
        country: dto.country,
        language: dto.language,
        timezone: dto.timezone ?? null,
      });
      await manager.save(congregation);

      const user = manager.create(User, {
        congregationId: congregation.id,
        email: dto.email,
        passwordHash,
        role: UserRole.ADMIN,
        isActive: true,
        uiLanguage: dto.language,
      });
      await manager.save(user);

      return { congregation, user };
    });

    return this.issueTokens(result.user);
  }

  /** Sliding-window in-memory limiter for login; key -> recent times. */
  private readonly loginAttempts = new Map<string, number[]>();
  private allowLogin(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.loginAttempts.get(key) ?? []).filter(
      (t) => now - t < windowMs,
    );
    if (recent.length >= limit) {
      this.loginAttempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.loginAttempts.set(key, recent);
    return true;
  }

  async login(dto: LoginDto, ip = 'unknown') {
    const FIFTEEN_MIN = 15 * 60 * 1000;
    const email = dto.email.toLowerCase().trim();
    // 6 attempts / 15 min, by email and by IP.
    if (
      !this.allowLogin(`login:email:${email}`, 6, FIFTEEN_MIN) ||
      !this.allowLogin(`login:ip:${ip}`, 6, FIFTEEN_MIN)
    ) {
      throw new HttpException(
        'Too many login attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Successful login clears the email counter.
    this.loginAttempts.delete(`login:email:${email}`);
    await this.usersService.touchLastLogin(user.id);
    return this.issueTokens(user);
  }

  // ---- Password reset (forgot password) ----

  /** Sliding-window in-memory limiter; key -> recent request times. */
  private readonly resetRequests = new Map<string, number[]>();

  private allowReset(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.resetRequests.get(key) ?? []).filter(
      (t) => now - t < windowMs,
    );
    if (recent.length >= limit) {
      this.resetRequests.set(key, recent);
      return false;
    }
    recent.push(now);
    this.resetRequests.set(key, recent);
    return true;
  }

  /**
   * Always resolves to the same generic OK — never reveals whether the
   * email exists. Over-limit and unknown-email requests are dropped
   * silently for the same reason.
   */
  async forgotPassword(rawEmail: string, ip: string): Promise<{ ok: true }> {
    const email = rawEmail.trim().toLowerCase();
    const HOUR = 60 * 60 * 1000;
    if (
      !this.allowReset(`fp:ip:${ip}`, 10, HOUR) ||
      !this.allowReset(`fp:email:${email}`, 3, HOUR)
    ) {
      return { ok: true };
    }
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.isActive) {
      return { ok: true };
    }
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + HOUR);
    await this.usersService.setPasswordResetToken(
      user.id,
      tokenHash,
      expiresAt,
    );
    const base =
      this.config.get<string>('PUBLIC_APP_URL') ?? 'https://mycongregation.org';
    const link = `${base}/reset-password?token=${token}`;
    await this.mailService.sendPasswordReset(user.email, user.uiLanguage, link);
    return { ok: true };
  }

  async resetPassword(token: string, password: string): Promise<{ ok: true }> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const user = await this.usersService.findByValidResetToken(tokenHash);
    if (!user) {
      throw new BadRequestException('Invalid or expired reset link');
    }
    const rounds = this.config.get<number>('bcrypt.rounds') ?? 12;
    const passwordHash = await bcrypt.hash(password, rounds);
    await this.usersService.completePasswordReset(user.id, passwordHash);
    return { ok: true };
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<AuthenticatedUser> {
    if (dto.uiLanguage !== undefined) {
      await this.usersService.updateUiLanguage(userId, dto.uiLanguage);
    }
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      congregationId: user.congregationId,
      uiLanguage: user.uiLanguage,
    };
  }

  /**
   * Exchanges a valid refresh token for a fresh access token.
   * Trusts the JWT signature; no DB lookup on the hot path.
   * Throws UnauthorizedException if token is invalid, expired, or wrong type.
   */
  async refresh(refreshToken: string) {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Token is not a refresh token');
    }

    const accessPayload = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      congregationId: payload.congregationId,
    };
    const accessToken = this.jwtService.sign(accessPayload);
    return { accessToken };
  }

  private signAccessToken(user: User): string {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      congregationId: user.congregationId,
    };
    return this.jwtService.sign(payload);
  }

  private signRefreshToken(user: User): string {
    const payload: RefreshTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      congregationId: user.congregationId,
      tokenType: 'refresh',
    };
    return this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: (this.config.get<string>('jwt.refreshExpiresIn') ??
        '30d') as never,
    });
  }

  private issueTokens(user: User) {
    return {
      accessToken: this.signAccessToken(user),
      refreshToken: this.signRefreshToken(user),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        congregationId: user.congregationId,
        canViewPrivateData: user.canViewPrivateData,
      },
    };
  }
}
