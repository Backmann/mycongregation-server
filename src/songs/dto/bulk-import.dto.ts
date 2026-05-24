import { IsString, MaxLength, MinLength } from 'class-validator';

export class BulkImportDto {
  @IsString()
  @MinLength(5)
  @MaxLength(100_000)
  text!: string;
}
