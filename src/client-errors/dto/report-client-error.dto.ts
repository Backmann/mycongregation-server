import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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

  /** Which event caught it (15 November 2026). */
  @IsOptional()
  @IsIn(['error', 'rejection', 'handler', 'screen'])
  event?: 'error' | 'rejection' | 'handler' | 'screen';

  /** Whether the device thought it was online. */
  @IsOptional()
  @IsBoolean()
  online?: boolean;

  /** The file and line the browser names. */
  @IsOptional()
  @IsString()
  @MaxLength(600)
  place?: string;

  /** Seconds from the app's start. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  sinceStartS?: number;
}
