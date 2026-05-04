import { PartialType } from '@nestjs/mapped-types';
import { CreateServiceGroupDto } from './create-service-group.dto';

export class UpdateServiceGroupDto extends PartialType(CreateServiceGroupDto) {}
