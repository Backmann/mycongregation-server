import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Call an announced meeting off — it stays in sight, crossed out. */
export class CancelFieldServiceMeetingDto {
  /** The short word drawn under the crossed-out line, and sent with the news. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string | null;

  /** False keeps the news from everyone the meeting concerns; those assigned
   * to it are told regardless. Omitted — everyone is told. */
  @IsOptional()
  @IsBoolean()
  notifyAudience?: boolean;
}

/** Bring a cancelled meeting back. */
export class RestoreFieldServiceMeetingDto {
  @IsOptional()
  @IsBoolean()
  notifyAudience?: boolean;
}
