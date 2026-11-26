import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ANNOUNCEMENT_KINDS } from '../announcement-rights';
import { ANNOUNCEMENT_MAX } from './create-announcement.dto';

/**
 * A suggestion's key: «memorial:ahead:<uuid>», «accounts_month:2026-11»,
 * «accounts_audit:2026-Q1» — the period as the calendar task names it, with a
 * capital Q (found by the independent check, 26 November 2026).
 */
export const SUGGESTION_KEY = /^[a-z_]{1,40}(:[A-Za-z0-9_-]{1,40}){1,2}$/;
const KEY = SUGGESTION_KEY;

export class TakeSuggestionDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStartDate!: string;

  @IsString()
  @Matches(KEY)
  key!: string;

  /** The meetings of that week it goes to: one or both. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsIn(ANNOUNCEMENT_KINDS, { each: true })
  kinds!: string[];

  /** The words as the writer left them. */
  @IsString()
  @MinLength(1)
  @MaxLength(ANNOUNCEMENT_MAX)
  text!: string;
}

export class SuggestionKeyDto {
  @IsString()
  @Matches(KEY)
  key!: string;
}

export class RefreshSuggestionDto {
  @IsUUID()
  announcementId!: string;
}
