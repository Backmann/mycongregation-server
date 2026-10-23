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
import { TalkAttentionService } from './talk-attention.service';
import { AttentionAckDto } from './dto/attention-ack.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RebuildFromProgrammeDto } from './dto/rebuild-from-programme.dto';
import { CreateTalkExchangeDto } from './dto/create-talk-exchange.dto';
import { UpdateTalkExchangeDto } from './dto/update-talk-exchange.dto';
import { ReplaceSpeakerDto } from './dto/replace-speaker.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';

/**
 * Unified public-talk exchange log (incoming + outgoing). Reading is open to
 * any authenticated member; writing is limited to admins and the
 * public_talk_coordinator (enforced in the service).
 */
@Controller('talk-exchange')
export class TalkExchangeController {
  constructor(
    private readonly service: TalkExchangeService,
    private readonly attention: TalkAttentionService,
  ) {}

  /**
   * Our trips that need someone: no brother yet, or the brother away that day
   * or departed (23 October 2026). Read by the journal and its banner.
   */
  @Get('attention')
  attentionList(@TenantId() tenantId: string) {
    return this.attention.attentionFor(tenantId);
  }

  /** «He goes»: lift the in-question mark for this reason. */
  @Post(':id/attention-ack')
  @HttpCode(200)
  async attentionAck(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttentionAckDto,
  ) {
    await this.service.assertWriter(user);
    await this.attention.acknowledge(tenantId, id, dto.reason);
    return { ok: true };
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listFor(user);
  }

  /** Special talks — date, theme, speaker — for the events screen. */
  @Get('special-talks')
  specialTalks(@TenantId() tenantId: string) {
    return this.service.specialTalks(tenantId);
  }

  /**
   * Rebuild the journal from the weekend programme, from a date onwards.
   *
   * For the years before the two-way sync existed: the programme knows who
   * came, the journal does not, and only one of them can be believed.
   */
  @Post('rebuild-from-programme')
  rebuildFromProgramme(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RebuildFromProgrammeDto,
  ) {
    return this.service.rebuildFromProgramme(tenantId, dto.from, user);
  }

  /**
   * Приехал другой брат. Одно действие вместо правки в двух местах — делается
   * со сцены, когда программа обязана стать верной сразу.
   */
  @Post('replace-speaker')
  replaceSpeaker(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReplaceSpeakerDto,
  ) {
    return this.service.replaceSpeaker(tenantId, user, dto);
  }

  /**
   * Он всё-таки приехал — или нажали по ошибке. Возвращает закрытый визит и
   * убирает запись, заведённую заменой.
   */
  @Post(':id/undo-replacement')
  undoReplacement(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.undoReplacement(tenantId, user, id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getFor(user, id);
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
