import { IsDateString } from 'class-validator';

/** «Перенести»: the week a guest set aside by a visit goes to. */
export class MoveSetAsideDto {
  /** Any day of that week; the entry takes the week's weekend day. */
  @IsDateString({ strict: true })
  weekStartDate!: string;
}
