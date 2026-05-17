import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { Congregation } from '../entities/congregation.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { UsersService } from '../users/users.service';
import { BootstrapDto } from './dto/bootstrap.dto';
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

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.usersService.touchLastLogin(user.id);
    return this.issueTokens(user);
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
      },
    };
  }
}
