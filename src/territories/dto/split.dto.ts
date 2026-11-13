import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Divide a territory between groups (13 November 2026). */
export class DivideDto {
  @IsInt()
  @Min(2)
  @Max(8)
  parts!: number;

  /** Replace today's division (the one who made it, holder, conductor, keepers). */
  @IsOptional()
  @IsBoolean()
  again?: boolean;
}

/** One street (or piece of one) to another part. */
export class MoveStreetDto {
  @IsString()
  @MaxLength(220)
  key!: string;

  @IsInt()
  @Min(1)
  @Max(8)
  to!: number;
}

/** «Street walked», or undone. */
export class MarkStreetDto {
  @IsString()
  @MaxLength(220)
  key!: string;

  @IsBoolean()
  walked!: boolean;
}
