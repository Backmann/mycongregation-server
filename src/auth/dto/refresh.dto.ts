import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  /**
   * Optional since browsers send the token in an httpOnly cookie instead.
   * Native clients still put it here — see readRefreshToken in
   * ../refresh-cookie.ts, which accepts either source.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}
