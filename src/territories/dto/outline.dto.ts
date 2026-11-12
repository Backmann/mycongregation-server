import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** A neighbour whose shared border moved with the territory's. */
export class NeighbourOutlineDto {
  @IsUUID()
  id!: string;

  @IsObject()
  geometry!: Record<string, unknown>;

  /** As the editor read it: someone else's change in between is refused. */
  @IsISO8601()
  updatedAt!: string;
}

/**
 * A boundary drawn again by hand (12 November 2026): the territory's new
 * outline and those of the neighbours that share the moved border.
 */
export class OutlineDto {
  @IsObject()
  geometry!: Record<string, unknown>;

  @IsISO8601()
  updatedAt!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => NeighbourOutlineDto)
  neighbours?: NeighbourOutlineDto[];
}
