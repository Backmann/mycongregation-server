import { IsUUID } from 'class-validator';

/** The visit whose empty week is filled from the last one. */
export class ApplyCoVisitTemplateDto {
  @IsUUID()
  specialEventId!: string;
}
