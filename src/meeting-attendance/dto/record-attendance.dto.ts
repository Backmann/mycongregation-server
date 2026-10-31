import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { EventType } from '../../common/enums/event-type.enum';
import {
  NOT_HELD_REASONS,
  type NotHeldReason,
} from '../../entities/meeting-attendance.entity';

export class RecordAttendanceDto {
  /** The meeting's own date. */
  @IsISO8601()
  date!: string;

  @IsEnum(EventType)
  eventType!: EventType;

  /** Everyone present, in the hall and by video. Omitted only when not held. */
  @IsOptional()
  @IsInt()
  @Min(0)
  count?: number;

  /** The part of `count` that joined by video — never more than it. */
  @IsOptional()
  @IsInt()
  @Min(0)
  onlineCount?: number | null;

  /** The meeting did not take place. */
  @IsOptional()
  @IsBoolean()
  notHeld?: boolean;

  /** Why not, when it was not held. */
  @IsOptional()
  @IsIn([...NOT_HELD_REASONS])
  notHeldReason?: NotHeldReason | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  /**
   * What the person saw before saving (31 October 2026): `true` — nothing was
   * recorded yet. Three people may enter the figure; when two do at once, the
   * second is told who was first instead of quietly writing over him.
   */
  @IsOptional()
  @IsBoolean()
  expectNew?: boolean;

  /** …or the stamp of the figure he was correcting. */
  @IsOptional()
  @IsISO8601()
  expectedRecordedAt?: string;
}

/** A figure entered on the wrong day, moved to the meeting it belongs to. */
export class MoveAttendanceDto {
  @IsISO8601()
  date!: string;

  @IsEnum(EventType)
  eventType!: EventType;

  @IsISO8601()
  toDate!: string;
}

/** Which figure to take away. */
export class RemoveAttendanceDto {
  @IsISO8601()
  date!: string;

  @IsEnum(EventType)
  eventType!: EventType;
}
