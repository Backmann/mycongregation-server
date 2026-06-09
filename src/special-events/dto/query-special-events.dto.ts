import { IsOptional, IsString } from 'class-validator';

export class QuerySpecialEventsDto {
  /** 'true' to include past events (default: only upcoming). */
  @IsOptional()
  @IsString()
  all?: string;

  /** 'true' to include soft-deleted events. */
  @IsOptional()
  @IsString()
  includeRemoved?: string;
}
