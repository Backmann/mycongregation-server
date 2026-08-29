import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class SetMemorialThemeDto {
  /** As the yearly letter gives it. Changes without a release. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  theme?: string | null;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  themeUrl?: string | null;
}
