import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdateLocalNeedsTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsUUID()
  speakerPublisherId?: string | null;

  /** Set to a Monday to mark used, or null to move it back to planned. */
  @IsOptional()
  @IsDateString()
  usedWeek?: string | null;
}
