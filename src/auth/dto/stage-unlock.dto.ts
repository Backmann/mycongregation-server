import { IsString, MaxLength } from 'class-validator';

export class StageUnlockDto {
  @IsString()
  @MaxLength(8)
  pin!: string;
}
