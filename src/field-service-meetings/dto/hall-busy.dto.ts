import { IsDateString } from 'class-validator';

/** A span of days, both included — what else is on in them. */
export class HallBusyQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
