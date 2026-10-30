import { IsEnum, Matches } from 'class-validator';
import { PioneerType } from '../../common/enums/pioneer-type.enum';

/**
 * A past spell of permanent pioneering, copied in from the paper S-21
 * (30 October 2026). Months as YYYY-MM; the service checks the rest — that
 * the kind is a permanent one, the order, and that no month is taken twice.
 */
export class PastPioneerSpellDto {
  @IsEnum(PioneerType)
  kind!: PioneerType;

  @Matches(/^\d{4}-\d{2}$/)
  start!: string;

  @Matches(/^\d{4}-\d{2}$/)
  end!: string;
}
