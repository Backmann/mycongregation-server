import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { CreateAssignmentDto } from './create-assignment.dto';

export class BulkCreateAssignmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateAssignmentDto)
  assignments!: CreateAssignmentDto[];
}
