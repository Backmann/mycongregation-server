import { IsBoolean, IsOptional } from 'class-validator';

/** Bringing a removed part back — see CreateAssignmentDto.retroactive. */
export class RestoreAssignmentDto {
  @IsOptional()
  @IsBoolean()
  retroactive?: boolean;
}
