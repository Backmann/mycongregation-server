import {
  IsIn,
  Matches,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/** A device's own id, as the app makes it (lib/device-id.ts). */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** A tap of the one who runs the meeting: its whole run, as the screen keeps it. */
export class WriteConductLiveDto {
  /** The Monday of the meeting's week. */
  @IsISO8601({ strict: true })
  weekStartDate!: string;

  /** The epoch the writer last heard; 0 before the meeting has a row. */
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  epoch!: number;

  @IsObject()
  state!: Record<string, unknown>;

  /** Which meeting (18 October 2026); none — the midweek one, as before. */
  @IsOptional()
  @IsIn(['midweek', 'weekend'])
  eventType?: 'midweek' | 'weekend';

  /** The device that taps (18 October 2026); none — an app from before. */
  @IsOptional()
  @Matches(DEVICE_ID_RE)
  deviceId?: string;
}

/** Take the meeting over — optionally with the taker's own run. */
export class TakeConductLiveDto {
  @IsISO8601({ strict: true })
  weekStartDate!: string;

  @IsOptional()
  @IsObject()
  state?: Record<string, unknown>;

  /** Which meeting (18 October 2026); none — the midweek one, as before. */
  @IsOptional()
  @IsIn(['midweek', 'weekend'])
  eventType?: 'midweek' | 'weekend';

  /** The device that taps (18 October 2026); none — an app from before. */
  @IsOptional()
  @Matches(DEVICE_ID_RE)
  deviceId?: string;
}
