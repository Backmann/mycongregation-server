import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Shifts of one week called off, or put back. */
export class CartSlotsChangeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  slotIds!: string[];

  /** Optional and short — «непогода». Ignored when putting shifts back. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
