import { IsDateString } from 'class-validator';

/** The week whose meetings' standing is asked. */
export class ProgrammeLocksQueryDto {
  @IsDateString()
  weekStart!: string;
}
