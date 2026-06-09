import { IsOptional, IsString, IsUUID } from 'class-validator';

export class QueryAbsencesDto {
  @IsOptional()
  @IsUUID()
  publisherId?: string;

  // string flags ('true') to match query-string semantics used elsewhere
  @IsOptional()
  @IsString()
  all?: string;

  @IsOptional()
  @IsString()
  includeRemoved?: string;
}
