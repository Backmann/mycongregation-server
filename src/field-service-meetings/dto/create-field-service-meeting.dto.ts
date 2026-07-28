import {
  IsBoolean,
  IsDateString,
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

export class CreateFieldServiceMeetingDto {
  @IsDateString()
  weekStartDate!: string;

  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be "HH:MM" 24h',
  })
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address!: string;

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

  /** Whose meeting this is. Omitted or null means it belongs to no one group. */
  @IsOptional()
  @IsUUID()
  serviceGroupId?: string | null;

  /** The service overseer is visiting this group's meeting. */
  @IsOptional()
  @IsBoolean()
  serviceOverseerVisit?: boolean;

  /** Who went. Stored rather than looked up, so the history stays true when
   * the appointment passes to someone else. */
  @IsOptional()
  @IsUUID()
  serviceOverseerPublisherId?: string | null;

  /** His assistant, when one came. */
  @IsOptional()
  @IsUUID()
  serviceOverseerAssistantId?: string | null;

  /** When false, the conductor is not push-notified about this change. */
  @IsOptional()
  @IsBoolean()
  notifyConductor?: boolean;
}
