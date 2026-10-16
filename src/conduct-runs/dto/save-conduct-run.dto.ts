import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** One part as the chairman's screen walked it. */
export class ConductRunSegmentDto {
  @IsString()
  @Length(1, 64)
  key!: string;

  @IsOptional()
  @IsUUID()
  assignmentId?: string | null;

  /** Who took the part at the time: the speaker, and his assistant. */
  @IsArray()
  @ArrayMaxSize(2)
  @IsUUID('all', { each: true })
  publisherIds!: string[];

  /** The programme's minutes for the part, in seconds (no counsel minute). */
  @IsInt()
  @Min(0)
  @Max(2 * 60 * 60)
  plannedSec!: number;

  @IsInt()
  @Min(0)
  @Max(4 * 60 * 60)
  actualSec!: number;

  /** After a student part: how long until the next part began. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 60)
  counselSec?: number | null;

  /**
   * When the part began, seconds from the meeting's start (16 October 2026):
   * where the pauses between parts fell. Absent from older apps.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6 * 60 * 60)
  startSec?: number | null;
}

export class SaveConductRunDto {
  /** The Monday of the meeting's week. */
  @IsISO8601()
  weekStartDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ConductRunSegmentDto)
  segments!: ConductRunSegmentDto[];

  /** Wall-clock seconds, first part to the end, pauses included. */
  @IsInt()
  @Min(0)
  @Max(6 * 60 * 60)
  totalSec!: number;

  @IsInt()
  @Min(0)
  @Max(6 * 60 * 60)
  plannedSec!: number;

  /** When the first part began (16 October 2026). Absent from older apps. */
  @IsOptional()
  @IsISO8601()
  startedAt?: string | null;
}
