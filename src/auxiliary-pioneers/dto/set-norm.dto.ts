import { IsIn, Matches } from 'class-validator';

/** One month's goal of an auxiliary period: 15 or 30 hours. */
export class SetAuxNormDto {
  @Matches(/^\d{4}-\d{2}(-\d{2})?$/)
  month!: string;

  @IsIn([15, 30])
  hours!: 15 | 30;
}
