import { IsDateString, IsOptional } from 'class-validator';

export class QueryCartShiftsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
