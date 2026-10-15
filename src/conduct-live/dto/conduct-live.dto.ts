import {
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

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
}

/** Take the meeting over — optionally with the taker's own run. */
export class TakeConductLiveDto {
  @IsISO8601({ strict: true })
  weekStartDate!: string;

  @IsOptional()
  @IsObject()
  state?: Record<string, unknown>;
}
