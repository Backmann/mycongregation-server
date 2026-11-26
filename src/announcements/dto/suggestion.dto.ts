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

/** A suggestion's key: «memorial:ahead:<uuid>», «accounts_month:2026-11». */
const KEY = /^[a-z_]{1,40}(:[a-z0-9_-]{1,40}){1,2}$/;

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
