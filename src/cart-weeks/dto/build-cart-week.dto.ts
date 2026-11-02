import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):(00|30)$/;

/** Days of a week at the stand: which weekdays, which places, which hours. */
export class BuildCartWeekDto {
  @IsDateString()
  weekStartDate!: string;

  @Matches(HHMM, { message: 'startTime must be "HH:MM" on the half-hour' })
  startTime!: string;

  @Matches(HHMM, { message: 'endTime must be "HH:MM" on the half-hour' })
  endTime!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek!: number[];

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  locationIds!: string[];
}
