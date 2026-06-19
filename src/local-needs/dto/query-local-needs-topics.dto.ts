import { IsOptional, IsString } from 'class-validator';

export class QueryLocalNeedsTopicsDto {
  // string flags ('true') to match query-string semantics used elsewhere
  @IsOptional()
  @IsString()
  onlyPlanned?: string;

  @IsOptional()
  @IsString()
  includeRemoved?: string;
}
