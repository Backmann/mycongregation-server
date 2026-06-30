import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpsertFieldServiceMonthThemeDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  /** Empty/blank clears the theme for that month. */
  @IsString()
  @MaxLength(2000)
  theme!: string;
}
