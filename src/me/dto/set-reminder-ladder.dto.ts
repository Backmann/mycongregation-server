import { IsIn, IsString } from 'class-validator';

/** Every step of the ladder, or only a week before and the evening before. */
export class SetReminderLadderDto {
  @IsString()
  @IsIn(['full', 'short'])
  ladder!: string;
}
