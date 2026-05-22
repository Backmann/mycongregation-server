import { IsDateString } from 'class-validator';

export class QueryCleaningDto {
  @IsDateString()
  weekStart!: string;
}
