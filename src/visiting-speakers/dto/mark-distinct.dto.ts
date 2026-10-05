import { IsUUID } from 'class-validator';

/** Two cards of visiting speakers that are NOT the same man. */
export class MarkDistinctDto {
  @IsUUID()
  firstId!: string;

  @IsUUID()
  secondId!: string;
}
