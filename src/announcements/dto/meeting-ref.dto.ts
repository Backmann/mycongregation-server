import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsUUID,
  Matches,
} from 'class-validator';
import { ANNOUNCEMENT_KINDS } from '../announcement-rights';

/** A meeting, named by its week and kind — where an announcement moves to. */
export class MeetingRefDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStartDate!: string;

  @IsIn(ANNOUNCEMENT_KINDS)
  eventType!: string;
}

/** The order of reading of one meeting's announcements. */
export class OrderAnnouncementsDto extends MeetingRefDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids!: string[];
}

export class MarkAnnouncementDto {
  @IsBoolean()
  read!: boolean;
}
