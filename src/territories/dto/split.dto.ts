import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
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

  /** «near»: pairs start together and stay neighbours (the default); «own»: apart. */
  @IsOptional()
  @IsIn(['near', 'own'])
  mode?: 'near' | 'own';

  /** Parts (1-based) that asked to be smaller. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(8, { each: true })
  smaller?: number[];
}

/** A division to look at, saved nowhere. */
export class PreviewDivisionDto {
  @IsInt()
  @Min(2)
  @Max(8)
  parts!: number;

  @IsOptional()
  @IsIn(['near', 'own'])
  mode?: 'near' | 'own';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(8, { each: true })
  smaller?: number[];
}

/** A street taken from another pair. */
export class TakeStreetDto {
  @IsString()
  @MaxLength(220)
  key!: string;
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
