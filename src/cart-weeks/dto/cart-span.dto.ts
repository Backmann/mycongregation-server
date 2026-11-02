import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):(00|30)$/;

/** A span of a day at the stand, on the half-hour. */
export class CartSpanDto {
  @Matches(HHMM, { message: 'startTime must be "HH:MM" on the half-hour' })
  startTime!: string;

  @Matches(HHMM, { message: 'endTime must be "HH:MM" on the half-hour' })
  endTime!: string;
}

/** «Записаться»: the span he can stand, and — optionally — with whom. */
export class CreateCartRequestDto extends CartSpanDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  withWhomNote?: string;
}

/** A day, or part of it, called off. Without times: the whole day. */
export class CancelCartDayDto {
  @IsOptional()
  @Matches(HHMM, { message: 'startTime must be "HH:MM" on the half-hour' })
  startTime?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'endTime must be "HH:MM" on the half-hour' })
  endTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
