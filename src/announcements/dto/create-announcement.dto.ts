import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ANNOUNCEMENT_KINDS } from '../announcement-rights';

/** A letter is pasted whole; 20 000 characters is several pages. */
export const ANNOUNCEMENT_MAX = 20000;

export class CreateAnnouncementDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStartDate!: string;

  @IsIn(ANNOUNCEMENT_KINDS)
  eventType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(ANNOUNCEMENT_MAX)
  text!: string;

  @IsOptional()
  @IsBoolean()
  isLetter?: boolean;

  /** Where it came from, for the mark under it. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z_]{1,40}$/)
  source?: string;

  /** What it was raised from, so a suggestion is taken only once. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_:.-]{1,120}$/)
  sourceKey?: string;
}
