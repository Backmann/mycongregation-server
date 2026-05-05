import { IsString, MaxLength, MinLength } from 'class-validator';

export class BulkImportDto {
  @IsString()
  @MinLength(10)
  @MaxLength(100_000)
  text!: string;
}
