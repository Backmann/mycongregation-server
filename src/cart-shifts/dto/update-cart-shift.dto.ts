import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsDateString,
  Matches,
  IsOptional,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateCartShiftDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'startTime must be "HH:MM"' })
  startTime?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'endTime must be "HH:MM"' })
  endTime?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  location?: string;
}
