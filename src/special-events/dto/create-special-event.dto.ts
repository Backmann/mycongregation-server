import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  IsUUID,
  Matches,
} from 'class-validator';
import {
  MEETING_MODES,
  type MeetingMode,
} from '../../entities/special-event.entity';

export class CreateSpecialEventDto {
  @IsString()
  @Length(1, 255)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  type?: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  time?: string;

  @IsOptional()
  @IsString()
  @Length(0, 5)
  timeEnd?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  mapUrl?: string;

  @IsOptional()
  @IsString()
  programUrl?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  coFirstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  coLastName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  coWifeName?: string;

  @IsOptional()
  @IsIn(['overseer', 'substitute'])
  coRole?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  coAccommodationAddress?: string;

  @IsOptional()
  @IsUUID()
  coAccommodationPublisherId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  coMidweekDow?: number;

  @IsOptional()
  @IsBoolean()
  replacesMeeting?: boolean;

  /** Как идёт встреча в день события; см. SpecialEvent.meetingMode. */
  @IsOptional()
  @IsIn(MEETING_MODES)
  meetingMode?: MeetingMode;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  meetingNote?: string | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  meetingTime?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  meetingAddress?: string | null;
}
