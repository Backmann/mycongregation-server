import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { EventType } from '../../common/enums/event-type.enum';

export class RecordAttendanceDto {
  /** The meeting's own date. */
  @IsISO8601()
  date!: string;

  @IsEnum(EventType)
  eventType!: EventType;

  /** Everyone present. Omitted only when the meeting was not held. */
  @IsOptional()
  @IsInt()
  @Min(0)
  count?: number;

  /** The meeting did not take place — assembly, convention, Memorial. */
  @IsOptional()
  @IsBoolean()
  notHeld?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
