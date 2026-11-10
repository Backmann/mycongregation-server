import { IsISO8601 } from 'class-validator';

/** The span asked for, both days included, `YYYY-MM-DD`. */
export class QueryBusyDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}
