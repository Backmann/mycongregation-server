import { IsDateString, IsOptional } from 'class-validator';

export class QueryFieldServiceMeetingsDto {
  /** Monday (ISO) of the week to list. When omitted, all weeks are returned. */
  @IsOptional()
  @IsDateString()
  weekStart?: string;
}
