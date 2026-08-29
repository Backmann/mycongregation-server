import { ArrayMaxSize, IsArray, IsIn, IsUUID } from 'class-validator';
import { MEMORIAL_SECTION } from '../memorial-template';

export class ReorderMemorialDto {
  @IsIn(Object.values(MEMORIAL_SECTION))
  section!: string;

  /**
   * The lines of that group in their new order. Anything left out keeps its
   * place at the end — a partial list must not silently drop lines.
   */
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}
