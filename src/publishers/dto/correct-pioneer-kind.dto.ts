import { IsEnum } from 'class-validator';
import { PioneerType } from '../../common/enums/pioneer-type.enum';

export class CorrectPioneerKindDto {
  @IsEnum(PioneerType)
  pioneerType!: PioneerType;
}
