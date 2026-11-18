import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/** What «clear the wife out of the week» touched — to put it back. */
export class UndoClearWifeDto {
  @IsUUID()
  specialEventId!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  removed!: string[];

  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  unjoined!: string[];
}
