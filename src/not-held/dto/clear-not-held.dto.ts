import { IsBoolean, IsIn, Matches } from 'class-validator';

export class ClearNotHeldDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  weekStartDate!: string;

  @IsIn(['midweek', 'weekend'])
  eventType!: 'midweek' | 'weekend';

  /** Take off the programme's parts. */
  @IsBoolean()
  parts!: boolean;

  /** Take off the duties. */
  @IsBoolean()
  duties!: boolean;
}
