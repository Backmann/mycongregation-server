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

/**
 * All fields optional.
 *
 * `weekStartDate` moves the meeting to another week (13 October 2026). It
 * used to be fixed — «to move it, delete and recreate» — and a Saturday moved
 * by a week came back as a new meeting: its journal began again, and the
 * conductor heard «cancelled» and «you conduct» about one morning. The week
 * and the day together are the new date; both are checked as one.
 */
export class UpdateFieldServiceMeetingDto {
  /** Monday (ISO) of the week the meeting moves to. */
  @IsOptional()
  @IsDateString()
  weekStartDate?: string;

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

  /** A short word for everyone about what is different this time. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notice?: string | null;

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

  /**
   * When the day, the time or the place of an announced meeting changes:
   * false keeps it from everyone the meeting concerns (the group, or the
   * whole congregation). Those assigned to it are told regardless, unless
   * `notifyConductor` is false. Omitted — everyone is told.
   */
  @IsOptional()
  @IsBoolean()
  notifyAudience?: boolean;

  /**
   * The planner saw the conflicts (16 October 2026) — the same meeting
   * already there, or the conductor already conducting that day — and saves
   * anyway. Without it such a save is refused with FS_CONFLICT and the list.
   */
  @IsOptional()
  @IsBoolean()
  confirmConflicts?: boolean;
}
