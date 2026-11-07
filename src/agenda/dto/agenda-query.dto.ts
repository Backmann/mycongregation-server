import { IsOptional, Matches } from 'class-validator';

/** A span of days, both ends included; the service keeps it within two years. */
export class AgendaQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  to?: string;
}
