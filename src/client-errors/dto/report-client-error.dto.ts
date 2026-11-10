import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** One failure as the app reports it. Every field is bounded. */
export class ReportClientErrorDto {
  @IsIn(['web', 'android', 'ios'])
  platform!: 'web' | 'android' | 'ios';

  @IsIn(['screen', 'uncaught'])
  source!: 'screen' | 'uncaught';

  @IsString()
  @MaxLength(400)
  route!: string;

  @IsString()
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  appCommit?: string;

  @IsOptional()
  @IsIn(['admin', 'elder', 'ministerial_servant', 'publisher', 'stage'])
  role?: string;
}
