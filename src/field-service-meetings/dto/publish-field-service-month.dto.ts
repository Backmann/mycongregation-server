import { IsInt, Max, Min } from 'class-validator';

/** The month whose drafts are announced — by the meetings' own dates. */
export class PublishFieldServiceMonthDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}
