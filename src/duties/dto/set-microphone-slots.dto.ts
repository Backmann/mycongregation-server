import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SetMicrophoneSlotsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  microphoneSlots!: number;
}
