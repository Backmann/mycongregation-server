import {
  IsDateString,
  IsInt,
  Max,
  Min,
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

  /**
   * The week the body of elders chose, while its programme is not imported
   * yet — any date in it; null takes the plan off.
   */
  @IsOptional()
  @IsDateString()
  plannedWeek?: string | null;

  /** Minutes the topic is meant for; null clears it. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  durationMin?: number | null;
}
