import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * All fields optional. weekStartDate is intentionally NOT editable — an entry
 * belongs to the week it was created under; to move it, delete and recreate.
 */
export class UpdateFieldServiceMeetingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be "HH:MM" 24h',
  })
  startTime?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsUUID()
  conductorPublisherId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  topic?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  isGeneral?: boolean;
}
