import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpsertMeetingSettingsDto {
  @IsDateString()
  effectiveFrom!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  midweekDow!: number;

  @Matches(HHMM, { message: 'midweekTime must be HH:mm (00:00-23:59)' })
  midweekTime!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  weekendDow!: number;

  @Matches(HHMM, { message: 'weekendTime must be HH:mm (00:00-23:59)' })
  weekendTime!: string;

  @IsString()
  @MaxLength(500)
  address!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  microphoneSlots?: number;
}
