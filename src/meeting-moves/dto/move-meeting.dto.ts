import { IsOptional, IsString, Length, Matches } from 'class-validator';

/** Where and when a meeting is held instead, this one week. */
export class MoveMeetingDto {
  /** The day it is held instead — inside the same week. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time!: string;

  /** Empty or absent: at the Kingdom Hall, as the settings give it. */
  @IsOptional()
  @IsString()
  @Length(0, 300)
  address?: string | null;
}
