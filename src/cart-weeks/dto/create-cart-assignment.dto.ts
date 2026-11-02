import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CartSpanDto } from './cart-span.dto';

/** A place on the plan: one of ours, or a guest by name — from, to. */
export class CreateCartAssignmentDto extends CartSpanDto {
  @IsOptional()
  @IsUUID()
  publisherId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  externalName?: string;
}
