import { IsIn } from 'class-validator';

export class AttentionAckDto {
  @IsIn(['absence', 'departed'])
  reason!: 'absence' | 'departed';
}
