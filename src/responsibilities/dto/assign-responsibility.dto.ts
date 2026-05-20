import { IsEnum, IsUUID } from 'class-validator';
import { ResponsibilityType } from '../../common/enums/responsibility-type.enum';

export class AssignResponsibilityDto {
  @IsEnum(ResponsibilityType)
  type!: ResponsibilityType;

  /** The user (login account) who will hold this responsibility. */
  @IsUUID()
  userId!: string;
}
