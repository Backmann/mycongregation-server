import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { TalkExchangeService } from './talk-exchange.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateTalkExchangeDto } from './dto/create-talk-exchange.dto';
import { UpdateTalkExchangeDto } from './dto/update-talk-exchange.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';

/**
 * Unified public-talk exchange log (incoming + outgoing). Reading is open to
 * any authenticated member; writing is limited to admins and the
 * public_talk_coordinator (enforced in the service).
 */
@Controller('talk-exchange')
export class TalkExchangeController {
  constructor(private readonly service: TalkExchangeService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateTalkExchangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(tenantId, dto, user);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTalkExchangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(tenantId, id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(tenantId, id, user);
  }
}
