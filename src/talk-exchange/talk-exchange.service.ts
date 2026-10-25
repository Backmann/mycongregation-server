import {
  exchangeWithoutPrivate,
  readsDirectoryContacts,
} from '../common/directory-privacy';
import { versionForWeek } from '../common/week-rules';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ProgrammeFreezeService } from '../assignments/programme-freeze.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Between, IsNull, MoreThanOrEqual, In, Not, Repository } from 'typeorm';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Assignment } from '../entities/assignment.entity';
import { Absence } from '../entities/absence.entity';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../common/enums/talk-exchange.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateTalkExchangeDto } from './dto/create-talk-exchange.dto';
import { UpdateTalkExchangeDto } from './dto/update-talk-exchange.dto';
import { ReplaceSpeakerDto } from './dto/replace-speaker.dto';
import { mondayOf } from '../common/week';
import { SpecialTalkNotificationsService } from './special-talk-notifications.service';
import {
  OutgoingTalkNotificationsService,
  outgoingFacts,
} from './outgoing-talk-notifications.service';
import { TalkAttentionService } from './talk-attention.service';
import { refusal } from '../common/errors/refusal';
import { CongregationClock } from '../common/congregation-clock.service';
import {
  DEFAULT_CONGREGATION_TIMEZONE,
  todayIn,
} from '../common/congregation-clock';
import { speakerOf } from '../special-events/co-visit-speaker';

const PUBLIC_TALK_PART_KEY = 'public_talk_speaker';
const CIRCUIT_OVERSEER_VISIT_TYPE = 'circuit_overseer_visit';

/** A name as it is compared: case and stray spaces do not make two brothers. */
function normalName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The overseer's name as the visit gives it, or null. */
function visitName(visit: SpecialEvent): string | null {
  return (
    [visit.coFirstName, visit.coLastName]
      .filter((p) => p && p.trim())
      .join(' ')
      .trim() || null
  );
}

/** The refusal for a second live entry «К нам» in one week. */
function weekTaken(): BadRequestException {
  return new BadRequestException(
    refusal(
      'TALK_WEEK_TAKEN',
      'That weekend already has a speaker in the journal',
    ),
  );
}

/** The unique index «one live entry «К нам» a week» refused a write. */
function isWeekTaken(err: unknown): boolean {
  const e = err as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = e.code ?? e.driverError?.code;
  const constraint = e.constraint ?? e.driverError?.constraint;
  return code === '23505' && constraint === 'UQ_talk_exchange_incoming_week';
}

/** dateStr + n days, as YYYY-MM-DD (UTC). */
function addDaysISO(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function speakerFullName(s: {
  firstName: string;
  lastName: string | null;
}): string {
  return [s.firstName, s.lastName].filter(Boolean).join(' ');
}

export type TalkExchangeResult = TalkExchange & {
  programConflict?: boolean;
  /**
   * The week's programme is already the record (a week after the meeting):
   * the entry was saved, the programme was not touched (13 October 2026).
   */
  programmeFrozen?: boolean;
};

/**
 * The fields of a talk-exchange entry worth remembering in the journal — who
 * speaks, when, on what, who hosts, and how it stands. Deliberately not the
 * whole row: linked ids and timestamps say nothing to a reader.
 */
function snapshot(row: TalkExchange): Record<string, unknown> {
  return {
    direction: row.direction,
    date: row.date,
    status: row.status,
    publicTalkId: row.publicTalkId,
    specialTheme: row.specialTheme,
    visitingSpeakerId: row.visitingSpeakerId,
    speakerName: row.speakerName,
    speakerCongregation: row.speakerCongregation,
    hospitalityPublisherId: row.hospitalityPublisherId,
    publisherId: row.publisherId,
    hostCongregationId: row.hostCongregationId,
    note: row.note,
  };
}

/**
 * Как выглядит слот программы в журнале изменений.
 *
 * Те же поля, что записывает обычная правка назначения, плюс речь и связь со
 * справочником — их меняет именно замена, и без них запись в журнале не
 * позволила бы понять, что произошло.
 */
function slotSnapshot(row: Assignment): Record<string, unknown> {
  return {
    publisherId: row.publisherId ?? null,
    speakerName: row.speakerName ?? null,
    speakerCongregation: row.speakerCongregation ?? null,
    visitingSpeakerId: row.visitingSpeakerId ?? null,
    publicTalkId: row.publicTalkId ?? null,
    partTitle: row.partTitle ?? null,
    specialTalk: row.specialTalk ?? false,
  };
}

const SLOT_FIELDS = [
  'publisherId',
  'speakerName',
  'speakerCongregation',
  'visitingSpeakerId',
  'publicTalkId',
  'partTitle',
  'specialTalk',
];

/**
 * Тема специальной речи и номер из каталога исключают друг друга.
 *
 * Тема выигрывает, если она есть; номер, выбранный без слова о теме, её
 * снимает — так координатор, передумавший и выбравший речь из каталога, не
 * оставляет за собой невидимую тему.
 */
function settleSpecialTheme(
  row: TalkExchange,
  fields: { publicTalkId?: string | null; specialTheme?: string | null },
): void {
  if (fields.publicTalkId && fields.specialTheme === undefined) {
    row.specialTheme = null;
  }
  const theme = row.specialTheme?.trim() || null;
  row.specialTheme = theme;
  if (theme) row.publicTalkId = null;
}

/** Есть ли в слоте хоть что-то, что поставил человек. */
function slotOccupied(slot: Assignment): boolean {
  return !!(
    slot.publisherId ||
    slot.publicTalkId ||
    slot.speakerName?.trim() ||
    slot.specialTalk
  );
}

@Injectable()
export class TalkExchangeService {
  private readonly logger = new Logger(TalkExchangeService.name);

  constructor(
    @InjectRepository(TalkExchange)
    private readonly repo: Repository<TalkExchange>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(Absence)
    private readonly absenceRepo: Repository<Absence>,
    @InjectRepository(VisitingSpeaker)
    private readonly speakerRepo: Repository<VisitingSpeaker>,
    @InjectRepository(ExternalCongregation)
    private readonly congregationRepo: Repository<ExternalCongregation>,
    @InjectRepository(PublicTalk)
    private readonly publicTalkRepo: Repository<PublicTalk>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    @InjectRepository(MeetingSettings)
    private readonly meetingSettingsRepo: Repository<MeetingSettings>,
    private readonly auditLog: AuditLogService,
    private readonly specialTalkNotifications: SpecialTalkNotificationsService,
    private readonly outgoingTalkNotifications: OutgoingTalkNotificationsService,
    /** For the circuit visits: whose name in the slot is the overseer's. */
    @InjectRepository(SpecialEvent)
    private readonly eventRepo: Repository<SpecialEvent>,
    /**
     * The programme's freeze (13 October 2026). Optional only because a few
     * specs build this service from its prototype; the module always
     * provides it, and the «wiring» test in programme-freeze.spec.ts holds
     * the module to that.
     */
    @Optional()
    private readonly freeze?: ProgrammeFreezeService,
    /** Trips that need a brother or came into question (23 October 2026). */
    @Optional()
    private readonly attention?: TalkAttentionService,
    /** The congregation's own day, for moving a guest set aside. */
    @Optional()
    private readonly clock?: CongregationClock,
  ) {}

  private today(tenantId: string): Promise<string> {
    return this.clock
      ? this.clock.todayFor(tenantId)
      : Promise.resolve(todayIn(new Date(), DEFAULT_CONGREGATION_TIMEZONE));
  }

  /**
   * May the journal write into this week's weekend programme? Not once it
   * is the record: the journal keeps its own history, the programme its own.
   */
  private async programmeOpen(
    tenantId: string,
    weekStartDate: string,
  ): Promise<boolean> {
    if (!this.freeze) return true;
    return !(await this.freeze.isFrozen(tenantId, {
      weekStartDate,
      eventType: 'weekend',
    }));
  }

  private static readonly MANAGER_RESPONSIBILITIES = [
    // The coordinator of the body of elders answers for the exchange of
    // talks (Lionel, 23 October 2026): the same access as the coordinator.
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.PUBLIC_TALK_COORDINATOR,
    // У помощника те же права: замену делают перед встречей, и координатора
    // может не быть рядом.
    ResponsibilityType.PUBLIC_TALK_COORDINATOR_ASSISTANT,
  ];

  /** The same door as every write to the journal, for the controller. */
  assertWriter(user: AuthenticatedUser): Promise<void> {
    return this.assertCanWrite(user);
  }

  private async assertCanWrite(user: AuthenticatedUser): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(TalkExchangeService.MANAGER_RESPONSIBILITIES),
      },
    });
    if (held === 0) {
      throw new ForbiddenException(
        refusal(
          'NEEDS_RESPONSIBILITY',
          'Only the public talk coordinator or his assistant may edit the talk exchange',
          { responsibilities: TalkExchangeService.MANAGER_RESPONSIBILITIES },
        ),
      );
    }
  }

  /** As THIS person may read them — see common/directory-privacy.ts. */
  async listFor(user: AuthenticatedUser): Promise<TalkExchange[]> {
    const rows = await this.findAll(user.congregationId);
    if (await readsDirectoryContacts(user, this.responsibilitiesRepo)) {
      return rows;
    }
    return rows.map(exchangeWithoutPrivate);
  }

  async getFor(user: AuthenticatedUser, id: string): Promise<TalkExchange> {
    const row = await this.findOne(user.congregationId, id);
    if (await readsDirectoryContacts(user, this.responsibilitiesRepo)) {
      return row;
    }
    return exchangeWithoutPrivate(row);
  }

  findAll(tenantId: string): Promise<TalkExchange[]> {
    return this.repo.find({
      where: { congregationId: tenantId },
      order: { date: 'DESC' },
    });
  }

  /**
   * The congregation's special talks, for the events screen (27 September).
   *
   * A special talk is an occasion the whole congregation looks forward to,
   * and it lives in this journal, not among the events — so the events screen
   * asks here. Only what a member needs to see it coming: the day, the theme
   * and who gives it; not the hospitality or the coordinator's notes.
   */
  async specialTalks(tenantId: string): Promise<
    {
      id: string;
      date: string;
      theme: string;
      speaker: string | null;
      speakerCongregation: string | null;
    }[]
  > {
    const rows = await this.repo.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        specialTheme: Not(IsNull()),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
      relations: {
        publisher: true,
        visitingSpeaker: { externalCongregation: true },
      },
      order: { date: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      theme: r.specialTheme!,
      speaker: r.publisher
        ? r.publisher.displayName ||
          [r.publisher.lastName, r.publisher.firstName].join(' ')
        : r.visitingSpeaker
          ? speakerFullName(r.visitingSpeaker)
          : r.speakerName?.trim() || null,
      speakerCongregation: r.publisher
        ? null
        : (r.visitingSpeaker?.externalCongregation?.name ??
          (r.speakerCongregation?.trim() || null)),
    }));
  }

  async findOne(tenantId: string, id: string): Promise<TalkExchange> {
    const row = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!row) throw new NotFoundException('Talk exchange entry not found');
    return row;
  }

  async create(
    tenantId: string,
    dto: CreateTalkExchangeDto,
    user: AuthenticatedUser,
  ): Promise<TalkExchangeResult> {
    await this.assertCanWrite(user);
    const { overwriteProgram, ...fields } = dto;
    const row = this.repo.create({
      ...fields,
      congregationId: tenantId,
      origin: 'journal',
    });
    settleSpecialTheme(row, fields);
    if (row.direction === TalkExchangeDirection.INCOMING) {
      await this.assertWeekFree(tenantId, row);
      row.meetingCancelled = await this.weekCancelled(
        tenantId,
        mondayOf(row.date),
      );
    }
    const saved = await this.saveEntry(row);
    await this.specialTalkNotifications.announceIfNew(saved, null);
    await this.outgoingTalkNotifications?.announce(
      tenantId,
      saved.id,
      outgoingFacts(saved),
      null,
    );
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'talk_exchange',
      entityId: saved.id,
      // Whom the entry concerns: our own speaker going out, or the publisher
      // hosting a visitor.
      subjectId: saved.publisherId ?? saved.hospitalityPublisherId,
      after: snapshot(saved),
    });
    return this.applySideEffects(tenantId, saved, overwriteProgram);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTalkExchangeDto,
    user: AuthenticatedUser,
  ): Promise<TalkExchangeResult> {
    await this.assertCanWrite(user);
    const { overwriteProgram, ...fields } = dto;
    const row = await this.findOne(tenantId, id);
    // Snapshot BEFORE Object.assign — the row is mutated in place.
    const before = snapshot(row);
    const was = { specialTheme: row.specialTheme, date: row.date };
    // What the travelling brother knew, read BEFORE the row is mutated.
    const wasOutgoing = outgoingFacts(row);
    const wasWeek =
      row.direction === TalkExchangeDirection.INCOMING &&
      row.status !== TalkExchangeStatus.DID_NOT_HAPPEN
        ? mondayOf(row.date)
        : null;
    Object.assign(row, fields);
    settleSpecialTheme(row, fields);
    // «He goes» was said about this brother; another brother starts clean.
    if ((row.publisherId ?? null) !== wasOutgoing.publisherId) {
      row.riskAckReason = null;
    }
    const nowWeek =
      row.direction === TalkExchangeDirection.INCOMING &&
      row.status !== TalkExchangeStatus.DID_NOT_HAPPEN
        ? mondayOf(row.date)
        : null;
    if (nowWeek && nowWeek !== wasWeek) {
      await this.assertWeekFree(tenantId, row);
      row.meetingCancelled = await this.weekCancelled(tenantId, nowWeek);
    }
    const saved = await this.saveEntry(row);
    // The week it left — another date, or «did not happen» — no longer shows
    // it (sync audit L2, H3).
    if (wasWeek && wasWeek !== nowWeek) {
      await this.releaseLine(tenantId, wasWeek, saved.id);
    }
    await this.specialTalkNotifications.announceIfNew(saved, was);
    await this.outgoingTalkNotifications?.announce(
      tenantId,
      saved.id,
      outgoingFacts(saved),
      wasOutgoing,
    );
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'talk_exchange',
      entityId: saved.id,
      subjectId: saved.publisherId ?? saved.hospitalityPublisherId,
      before,
      after: snapshot(saved),
      fields: Object.keys(before),
    });
    // The brother taken off a trip that still stands: the congregation over
    // there still expects a speaker from us (Lionel, 23 October 2026).
    if (
      saved.direction === TalkExchangeDirection.OUTGOING &&
      wasOutgoing.publisherId &&
      !saved.publisherId &&
      saved.status !== TalkExchangeStatus.DID_NOT_HAPPEN
    ) {
      await this.attention?.brotherTakenOff(tenantId, saved);
    }
    return this.applySideEffects(tenantId, saved, overwriteProgram);
  }

  async remove(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.assertCanWrite(user);
    const row = await this.findOne(tenantId, id);
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'talk_exchange',
      entityId: id,
      action: 'DELETE',
      subjectId: row.publisherId ?? row.hospitalityPublisherId,
      detail: snapshot(row),
    });
    // Remove the auto-created outgoing absence.
    if (row.linkedAbsenceId) {
      await this.absenceRepo.softDelete(row.linkedAbsenceId);
    }
    // Incoming is kept in sync with the program's public-talk slot: removing the
    // journal entry clears that slot (when it still reflects this visitor).
    if (row.direction === TalkExchangeDirection.INCOMING) {
      await this.clearProgramSlot(tenantId, row);
    }
    await this.repo.softDelete(row.id);
    // The brother who was going is told not to prepare.
    await this.outgoingTalkNotifications?.announce(
      tenantId,
      row.id,
      null,
      outgoingFacts(row),
    );
  }

  /** Clear the weekend public-talk slot if it still reflects an invited speaker. */
  /**
   * Кто это, если известно только имя.
   *
   * Имя — не личность. Один и тот же брат, записанный «Walter Getko»,
   * «Вальтер Гетко» и «Getko W.», для любого подсчёта три разных человека, и
   * история, собранная по написанию, врёт именно тогда, когда она нужна — в
   * минуту, когда решают, кого звать. Поэтому у каждого визита должна быть
   * карточка, даже если координатор просто напечатал имя в программе.
   *
   * Сопоставление СТРОГОЕ и только по двум признакам: то же имя без учёта
   * регистра и лишних пробелов И то же собрание (или у обоих собрания нет).
   * Совпало — берём существующую карточку. Не совпало — заводим новую, а не
   * приклеиваем визит к похожему: тёзки в собраниях обычны, и склеить двух
   * братьев молча хуже, чем завести лишнюю карточку, которую видно и можно
   * слить.
   *
   * Собрание ищется по названию и НЕ заводится само: список собраний — это
   * решение координатора, а не побочный итог опечатки в имени. Не нашли —
   * карточка живёт без собрания, название остаётся текстом в записи журнала.
   */
  private async speakerCardFor(
    tenantId: string,
    fullName: string,
    congregationName: string | null,
  ): Promise<string | null> {
    const name = fullName.trim().replace(/\s+/g, ' ');
    if (name === '') return null;

    const congName = congregationName?.trim() || null;
    // Сравнение в памяти, а не запросом: собраний у одного собрания десятки, а
    // не тысячи, зато правило совпадения — одно и то же и для имени, и для
    // названия, и его видно рядом.
    const externalId = congName
      ? ((
          await this.congregationRepo.find({
            where: { congregationId: tenantId },
          })
        ).find((c) => c.name.trim().toLowerCase() === congName.toLowerCase())
          ?.id ?? null)
      : null;

    const candidates = await this.speakerRepo.find({
      where: { congregationId: tenantId },
    });
    // A card merged into another is that other brother now: matching it
    // would hang a new visit on a card the directory no longer shows.
    const same = candidates.find(
      (c) =>
        !c.mergedIntoId &&
        speakerFullName(c).trim().replace(/\s+/g, ' ').toLowerCase() ===
          name.toLowerCase() &&
        (c.externalCongregationId ?? null) === externalId,
    );
    if (same) return same.id;

    // Разделение имени на первое слово и остаток — то же, что делает
    // speakerFullName в обратную сторону, поэтому обратный проход по этой
    // карточке даст ровно исходную строку.
    const space = name.indexOf(' ');
    const firstName = space === -1 ? name : name.slice(0, space);
    const lastName = space === -1 ? null : name.slice(space + 1);

    const created = await this.speakerRepo.save(
      this.speakerRepo.create({
        congregationId: tenantId,
        firstName,
        lastName,
        externalCongregationId: externalId,
        /**
         * Заведена приложением, а не человеком. Признак нужен не для порядка:
         * у такой карточки нет ни телефона, ни репертуара, и на экране её
         * стоит показывать так, чтобы было видно — сюда можно дописать
         * сведения.
         */
        autoCreated: true,
      }),
    );
    return created.id;
  }

  /** A directory card's name and congregation, as the programme shows them. */
  async cardName(
    tenantId: string,
    id: string,
  ): Promise<{ name: string; congregation: string | null } | null> {
    const card = await this.speakerRepo.findOne({
      where: { id, congregationId: tenantId },
      relations: { externalCongregation: true },
    });
    if (!card || card.mergedIntoId) return null;
    return {
      name: speakerFullName(card),
      congregation: card.externalCongregation?.name ?? null,
    };
  }

  /**
   * The card a programme slot with an invited guest belongs to.
   *
   * The form saves while the name is being typed, and the first few letters
   * used to become a card of their own that the slot then kept: «Ив» stood in
   * the brother's history instead of him (live data, 23 October 2026). So the
   * link the slot carries is kept only while it still names this guest:
   *
   * - a card a person keeps (made or edited by hand) stays while its name is
   *   the slot's — or while the slot's text has not been touched since the
   *   journal last read it: then the card was renamed in the directory, and
   *   the old spelling in the programme is the same brother;
   * - a card the application made follows the text: the name the slot now
   *   holds is looked up again, and the card made from a half-typed name is
   *   left for retireLeftoverCards.
   */
  private async slotCard(
    tenantId: string,
    linkedId: string | null,
    speakerName: string,
    speakerCongregation: string | null,
    journalName: string | null,
  ): Promise<string | null> {
    const linked = linkedId
      ? await this.speakerRepo.findOne({
          where: { id: linkedId, congregationId: tenantId },
        })
      : null;
    // A link to a card this congregation cannot see is not second-guessed.
    if (linkedId && !linked) return linkedId;
    if (linked) {
      const names = (c: VisitingSpeaker) => [
        normalName(speakerFullName(c)),
        normalName([c.lastName, c.firstName].filter(Boolean).join(' ')),
      ];
      const named = names(linked).includes(normalName(speakerName));
      const textUntouched =
        journalName !== null &&
        normalName(journalName) === normalName(speakerName);
      if (named || (!linked.autoCreated && textUntouched)) return linked.id;
    }
    return this.speakerCardFor(tenantId, speakerName, speakerCongregation);
  }

  /**
   * A card the application made, that nothing points at any more, goes.
   *
   * Only such a card: one a person made, or added a phone, a note or a talk
   * to, is the coordinator's and stays whatever happens to its visits. «Nothing
   * points at it» counts removed rows too — a visit set aside for the circuit
   * overseer comes back with its card, and must find it there. Soft-deleted,
   * so a mistake here is put right by a restore, not by a backup.
   */
  private async retireLeftoverCards(
    tenantId: string,
    ids: Array<string | null | undefined>,
  ): Promise<void> {
    for (const id of new Set(ids.filter((x): x is string => !!x))) {
      const card = await this.speakerRepo.findOne({
        where: { id, congregationId: tenantId },
      });
      if (
        !card ||
        !card.autoCreated ||
        card.circuitOverseer ||
        card.mergedIntoId ||
        card.phone ||
        card.note ||
        (card.talkNumbers ?? []).length > 0
      ) {
        continue;
      }
      const used =
        (await this.repo.count({
          where: { congregationId: tenantId, visitingSpeakerId: id },
          withDeleted: true,
        })) +
        (await this.assignmentRepo.count({
          where: { congregationId: tenantId, visitingSpeakerId: id },
          withDeleted: true,
        })) +
        (await this.speakerRepo.count({
          where: { congregationId: tenantId, mergedIntoId: id },
          withDeleted: true,
        }));
      if (used === 0) await this.speakerRepo.softDelete(id);
    }
  }

  // ───────────────────────── The circuit overseer ─────────────────────────
  //
  // A circuit visit is a speaker coming too: the overseer gives the public
  // talk, and that talk belongs in the journal and in his history. It used to
  // get there by accident — only once somebody touched the talk slot of the
  // week — and then on an ordinary visiting speaker's card with no
  // congregation, which the directory offered among the brothers to invite.
  // And taking the visit away left the journal saying he was coming (seen on
  // the stand, 5 October).
  //
  // Now the journal follows the visit: the entry appears when the visit has a
  // weekend programme, moves when the visit moves, goes when the visit goes
  // and comes back with it. His card is marked, so that the lists by which
  // somebody is invited pass it over.

  /** The circuit visit standing in that week, or null. */
  private async visitOfWeek(
    tenantId: string,
    weekStartDate: string,
  ): Promise<SpecialEvent | null> {
    const visits = await this.eventRepo.find({
      where: {
        congregationId: tenantId,
        type: CIRCUIT_OVERSEER_VISIT_TYPE,
        deletedAt: IsNull(),
      },
    });
    return visits.find((v) => mondayOf(v.date) === weekStartDate) ?? null;
  }

  /** The name the visit puts into the talk slot of that week, or null. */
  private async overseerOfWeek(
    tenantId: string,
    weekStartDate: string,
  ): Promise<string | null> {
    const visit = await this.visitOfWeek(tenantId, weekStartDate);
    return visit ? visitName(visit) : null;
  }

  /**
   * The overseer's own card — found, or made.
   *
   * A card already marked as an overseer's and carrying this name is his,
   * whatever else it says. Otherwise the ordinary strict match applies — the
   * same name AND no congregation — and that card becomes marked: it is the
   * one the application made for him before the mark existed. A namesake who
   * has a congregation is another brother and is left alone; if he IS the
   * overseer, the mark is set on his card by hand.
   */
  private async overseerCard(
    tenantId: string,
    fullName: string,
  ): Promise<string | null> {
    const name = normalName(fullName);
    if (name === '') return null;
    const candidates = (
      await this.speakerRepo.find({ where: { congregationId: tenantId } })
    ).filter((c) => !c.mergedIntoId && normalName(speakerFullName(c)) === name);
    const marked = candidates.find((c) => c.circuitOverseer);
    if (marked) return marked.id;
    const plain = candidates.find((c) => !c.externalCongregationId);
    if (plain) {
      plain.circuitOverseer = true;
      await this.speakerRepo.save(plain);
      return plain.id;
    }
    const shown = fullName.trim().replace(/\s+/g, ' ');
    const space = shown.indexOf(' ');
    const created = await this.speakerRepo.save(
      this.speakerRepo.create({
        congregationId: tenantId,
        firstName: space === -1 ? shown : shown.slice(0, space),
        lastName: space === -1 ? null : shown.slice(space + 1),
        externalCongregationId: null,
        autoCreated: true,
        circuitOverseer: true,
      }),
    );
    return created.id;
  }

  /**
   * The journal entries of a week that are this visit's own — by the visit's
   * id (25 October 2026). By the overseer's name only for an entry nobody has
   * linked yet: one the mirror wrote from the programme, or one from before
   * the link existed; it is linked the moment it is found.
   */
  private async overseerEntries(
    tenantId: string,
    weekStartDate: string,
    visitId: string | null,
    fullName: string | null,
    withDeleted = false,
  ): Promise<TalkExchange[]> {
    const name = normalName(fullName ?? '');
    const rows = await this.repo.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(weekStartDate, addDaysISO(weekStartDate, 6)),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
      withDeleted,
    });
    return rows.filter(
      (r) =>
        !r.setAsideBy &&
        ((!!visitId && r.circuitVisitId === visitId) ||
          (!r.circuitVisitId &&
            !r.publisherId &&
            name !== '' &&
            normalName(r.speakerName ?? '') === name)),
    );
  }

  /**
   * A visit stands in this week and its programme may have just appeared or
   * changed: the journal is brought in step. Does nothing in a week without a
   * visit, so anything that touches a weekend may call it.
   */
  async circuitVisitApplied(
    tenantId: string,
    weekStartDate: string,
    /** The name the visit carried before this change, when it was another. */
    previousName: string | null = null,
  ): Promise<void> {
    const visit = await this.visitOfWeek(tenantId, weekStartDate);
    const name = visit ? visitName(visit) : null;
    if (!visit || !name) return;
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    const live = await this.repo.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(weekStartDate, addDaysISO(weekStartDate, 6)),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });
    // His by the link; by the name only an entry nobody has linked.
    const isHis = (e: TalkExchange) =>
      e.circuitVisitId === visit.id ||
      (!e.circuitVisitId &&
        !e.publisherId &&
        [name, previousName].some(
          (n) => !!n && normalName(e.speakerName ?? '') === normalName(n),
        ));
    /**
     * Whoever was to speak that weekend steps aside WHOLE.
     *
     * The mirror keeps one entry a week and used to rewrite it: a visiting
     * speaker's entry became the overseer's, and the coordinator's note about
     * the guest — «обед у семьи» — then stood on the overseer's visit. Now his
     * entry is set aside untouched, marked with the visit that did it
     * (25 October 2026): the journal shows him under the overseer, he can be
     * moved to another week, and he comes back by that mark when the visit
     * goes. Those who answer for the talks are told — the guest may still be
     * on his way.
     *
     * Only once the weekend has a programme: until then the slot has not been
     * given to the overseer, and the coordinator's arrangement stands.
     */
    if (slot) {
      for (const e of live) {
        if (!isHis(e)) await this.setAside(tenantId, e, visit);
      }
    }
    for (const e of live) {
      if (isHis(e) && e.circuitVisitId !== visit.id) {
        e.circuitVisitId = visit.id;
        await this.repo.update({ id: e.id }, { circuitVisitId: visit.id });
      }
    }
    // A visit taken away and put back: its entry comes back with whatever
    // the coordinator had added to it, rather than a bare new one.
    const othersStand = !slot && live.some((e) => !isHis(e));
    if (!live.some(isHis) && !othersStand) {
      const gone = (
        await this.overseerEntries(
          tenantId,
          weekStartDate,
          visit.id,
          name,
          true,
        )
      )
        .filter((r) => !!r.deletedAt)
        .sort((a, b) => +b.deletedAt! - +a.deletedAt!)[0];
      if (gone) {
        await this.repo.restore(gone.id);
        if (gone.circuitVisitId !== visit.id) {
          await this.repo.update({ id: gone.id }, { circuitVisitId: visit.id });
        }
      }
    }
    /**
     * A visit whose weekend has no programme yet.
     *
     * The mirror reads the talk slot, and a visit entered months ahead has no
     * slot to read — the Watchtower for that week is not out. So the overseer
     * who comes in February was nowhere in the journal in October, while the
     * substitute who had already been was (live data, 6 October). The visit
     * itself is enough to know who is coming: the entry is written from it,
     * and the programme, when it is loaded, finds the entry already there.
     */
    if (slot) {
      await this.syncProgramToJournal(tenantId, weekStartDate);
      // The mirror wrote the entry from the slot, by the name: it is his.
      const entry = await this.weekEntry(tenantId, weekStartDate);
      if (
        entry &&
        !entry.publisherId &&
        !entry.circuitVisitId &&
        normalName(entry.speakerName ?? '') === normalName(name)
      ) {
        await this.repo.update({ id: entry.id }, { circuitVisitId: visit.id });
      }
      return;
    }
    const cardId = await this.overseerCard(tenantId, name);
    const entries = await this.repo.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(weekStartDate, addDaysISO(weekStartDate, 6)),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });
    const mine = entries.find(isHis);
    if (mine) {
      if (
        mine.speakerName === name &&
        mine.visitingSpeakerId === cardId &&
        mine.circuitVisitId === visit.id
      ) {
        return;
      }
      mine.speakerName = name;
      mine.speakerCongregation = null;
      mine.visitingSpeakerId = cardId;
      mine.circuitVisitId = visit.id;
      await this.repo.save(mine);
      return;
    }
    // Somebody else is already entered for that weekend: the coordinator's
    // arrangement stands until the programme says otherwise.
    if (entries.length > 0) return;
    await this.repo.save(
      this.repo.create({
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: await this.weekendDateFor(tenantId, weekStartDate),
        visitingSpeakerId: cardId,
        speakerName: name,
        speakerCongregation: null,
        circuitVisitId: visit.id,
      }),
    );
  }

  /**
   * One entry steps aside for the visit: out of the live journal, marked with
   * the visit, written in the journal of changes, and — a guest from another
   * congregation — told to those who answer for the talks. One of ours is
   * told by his own evening digest that the part is no longer his.
   */
  private async setAside(
    tenantId: string,
    entry: TalkExchange,
    visit: SpecialEvent,
  ): Promise<void> {
    await this.repo.update({ id: entry.id }, { setAsideBy: visit.id });
    await this.repo.softDelete(entry.id);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'talk_exchange',
      entityId: entry.id,
      subjectId: entry.publisherId ?? entry.hospitalityPublisherId,
      before: { setAsideBy: null },
      after: { setAsideBy: visit.id },
      fields: ['setAsideBy'],
    });
    if (!entry.publisherId) {
      await this.attention?.guestSetAside(tenantId, entry);
    }
  }

  /**
   * The talk slot of a week the visit has left no longer points at his card.
   *
   * Giving the week back restores the name the slot had before — the link to
   * the overseer's card was put there by the mirror and nothing else takes
   * it off. Left behind, it makes an empty slot count as filled.
   */
  private async releaseSlot(
    tenantId: string,
    weekStartDate: string,
  ): Promise<void> {
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot || !slot.visitingSpeakerId) return;
    if (!(await this.programmeOpen(tenantId, weekStartDate))) return;
    // A name still in the slot is somebody's — a guest entered since. One of
    // ours beneath the visit carries no card: the link was the overseer's.
    if (slot.speakerName?.trim()) return;
    slot.visitingSpeakerId = null;
    await this.assignmentRepo.save(slot);
  }

  /**
   * The visit was taken out of this week: its entry goes with it — also when
   * the coordinator had added a note or a host family to it. There is no
   * visit; an entry saying the overseer is coming would be the application
   * telling the congregation something untrue.
   */
  async circuitVisitRemoved(
    tenantId: string,
    weekStartDate: string,
    fullName: string | null,
    visitId: string | null = null,
  ): Promise<void> {
    await this.releaseSlot(tenantId, weekStartDate);
    for (const e of await this.overseerEntries(
      tenantId,
      weekStartDate,
      visitId,
      fullName,
    )) {
      await this.repo.softDelete(e.id);
    }
    // The week is itself again: whoever was to speak before the visit is the
    // speaker now, and his entry comes back as it was set aside.
    await this.returnEntry(tenantId, weekStartDate, visitId);
    await this.syncProgramToJournal(tenantId, weekStartDate);
  }

  /**
   * Brings back the journal entry of whoever the talk slot holds again after
   * a visit has left the week — the entry set aside when the visit came, with
   * the coordinator's note and the host family still on it. Without one, the
   * mirror writes a new entry from the slot, as for any week.
   *
   * By the visit's mark (25 October 2026): the entry it set aside, and no
   * other. A guest set aside before the mark existed is still found the old
   * way — the latest removed entry with the name the slot holds again.
   */
  private async returnEntry(
    tenantId: string,
    weekStartDate: string,
    visitId: string | null = null,
  ): Promise<void> {
    if (visitId) {
      const marked = await this.repo.find({
        where: { congregationId: tenantId, setAsideBy: visitId },
        withDeleted: true,
      });
      const inWeek = marked.filter(
        (e) => !!e.deletedAt && mondayOf(e.date) === weekStartDate,
      );
      if (inWeek.length > 0) {
        if (await this.weekEntry(tenantId, weekStartDate)) return;
        const back = inWeek.sort((x, y) => +y.deletedAt! - +x.deletedAt!)[0];
        await this.repo.update({ id: back.id }, { setAsideBy: null });
        await this.repo.restore(back.id);
        await this.auditLog.logUpdate({
          tenantId,
          entityType: 'talk_exchange',
          entityId: back.id,
          subjectId: back.publisherId ?? back.hospitalityPublisherId,
          before: { setAsideBy: visitId },
          after: { setAsideBy: null },
          fields: ['setAsideBy'],
        });
        return;
      }
    }
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot) return;
    const name = normalName(slot.speakerName ?? '');
    if (!slot.publisherId && name === '') return;
    const all = await this.repo.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(weekStartDate, addDaysISO(weekStartDate, 6)),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
      withDeleted: true,
    });
    if (all.some((e) => !e.deletedAt)) return;
    // An entry made in the journal may carry only the card: its name is the
    // card's, and the guest set aside must be found by it too.
    const cardNames = new Map<string, string>();
    for (const e of all) {
      if (!e.visitingSpeakerId || cardNames.has(e.visitingSpeakerId)) continue;
      const c = await this.speakerRepo.findOne({
        where: { id: e.visitingSpeakerId, congregationId: tenantId },
        withDeleted: true,
      });
      if (c) cardNames.set(c.id, normalName(speakerFullName(c)));
    }
    const his = all
      .filter((e) =>
        slot.publisherId
          ? e.publisherId === slot.publisherId
          : !e.publisherId &&
            (normalName(e.speakerName ?? '') === name ||
              (!!e.visitingSpeakerId &&
                cardNames.get(e.visitingSpeakerId) === name)),
      )
      .sort((a, b) => +b.deletedAt! - +a.deletedAt!)[0];
    if (his) await this.repo.restore(his.id);
  }

  /**
   * The visit moved to another week: its entry moves too, keeping what was
   * added to it. Where the new week already has an entry of its own, the old
   * one simply goes — the mirror will write the overseer into the new week.
   */
  async circuitVisitMoved(
    tenantId: string,
    fromWeek: string,
    toWeek: string,
    fullName: string | null,
    visitId: string | null = null,
  ): Promise<void> {
    if (fromWeek === toWeek) return;
    await this.releaseSlot(tenantId, fromWeek);
    const mine = await this.overseerEntries(
      tenantId,
      fromWeek,
      visitId,
      fullName,
    );
    if (mine.length > 0) {
      const taken = await this.repo.count({
        where: {
          congregationId: tenantId,
          direction: TalkExchangeDirection.INCOMING,
          date: Between(toWeek, addDaysISO(toWeek, 6)),
          status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
        },
      });
      const [first, ...rest] = mine;
      for (const e of rest) await this.repo.softDelete(e.id);
      if (taken > 0) {
        await this.repo.softDelete(first.id);
      } else {
        first.date = await this.weekendDateFor(tenantId, toWeek);
        await this.repo.save(first);
      }
    }
    // The week left behind is itself again — see circuitVisitRemoved.
    await this.returnEntry(tenantId, fromWeek, visitId);
    await this.syncProgramToJournal(tenantId, fromWeek);
  }

  private async clearProgramSlot(
    tenantId: string,
    entry: TalkExchange,
  ): Promise<void> {
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate: mondayOf(entry.date),
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot) return;
    // The record stays as it was: the journal says what happened.
    if (!(await this.programmeOpen(tenantId, slot.weekStartDate))) return;
    if (!slotOccupied(slot)) return;

    /**
     * Whose line is it. A line that knows its entry is cleared only by that
     * entry: removing the visit marked «did not happen» after a replacement
     * used to wipe the brother who came instead (sync audit M2). A line from
     * before the link existed is judged as before, by the speaker in it — and
     * for a guest too, not only for one of ours.
     */
    if (slot.talkExchangeId) {
      if (slot.talkExchangeId !== entry.id) return;
    } else {
      const sameGuest =
        !entry.publisherId &&
        !slot.publisherId &&
        ((!!entry.visitingSpeakerId &&
          slot.visitingSpeakerId === entry.visitingSpeakerId) ||
          normalName(slot.speakerName ?? '') ===
            normalName(entry.speakerName ?? ''));
      const sameBrother =
        entry.publisherId != null && slot.publisherId === entry.publisherId;
      if (!sameGuest && !sameBrother) return;
    }

    slot.publisherId = null;
    slot.speakerName = null;
    slot.speakerCongregation = null;
    slot.visitingSpeakerId = null;
    slot.talkExchangeId = null;
    slot.publicTalkId = null;
    slot.partTitle = null;
    slot.specialTalk = false;
    if (slot.status === AssignmentStatus.PUBLISHED)
      slot.changedSincePublish = true;
    await this.assignmentRepo.save(slot);
  }

  /** The weekend line of a week an entry has left: emptied, if it was its. */
  private async releaseLine(
    tenantId: string,
    weekStartDate: string,
    entryId: string,
  ): Promise<void> {
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot || slot.talkExchangeId !== entryId) return;
    const entry = await this.repo.findOne({
      where: { id: entryId, congregationId: tenantId },
      withDeleted: true,
    });
    if (entry) {
      await this.clearProgramSlot(tenantId, {
        ...entry,
        date: addDaysISO(weekStartDate, 6),
      } as TalkExchange);
    }
  }

  /**
   * The one live entry «К нам» of a week — the database holds there is at
   * most one (migration 1913).
   */
  async weekEntry(
    tenantId: string,
    weekStartDate: string,
  ): Promise<TalkExchange | null> {
    return this.repo.findOne({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(weekStartDate, addDaysISO(weekStartDate, 6)),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });
  }

  /** A second guest for a weekend that has one is refused, in words. */
  private async assertWeekFree(
    tenantId: string,
    entry: TalkExchange,
  ): Promise<void> {
    if (
      entry.direction !== TalkExchangeDirection.INCOMING ||
      entry.status === TalkExchangeStatus.DID_NOT_HAPPEN
    ) {
      return;
    }
    const other = await this.weekEntry(tenantId, mondayOf(entry.date));
    if (other && other.id !== entry.id) throw weekTaken();
  }

  /** Saved — and the database's «one a week» said in words, not as a 500. */
  private async saveEntry(row: TalkExchange): Promise<TalkExchange> {
    try {
      return await this.repo.save(row);
    } catch (err) {
      if (isWeekTaken(err)) throw weekTaken();
      throw err;
    }
  }

  /** Is the weekend meeting of that week cancelled in the programme? */
  private async weekCancelled(
    tenantId: string,
    weekStartDate: string,
  ): Promise<boolean> {
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    return slot?.status === AssignmentStatus.CANCELLED;
  }

  /**
   * Entries that change weeks together — the programme's «swap» and «move».
   *
   * The entry itself goes, note, host family and all; it used to stay where
   * it was while the mirror rewrote whatever entry the other week had into
   * this guest (sync audit H2). The weeks are freed first and filled after,
   * so the database's «one a week» holds at every step.
   */
  async moveWeekEntries(
    tenantId: string,
    moves: Array<{ entry: TalkExchange; toWeek: string }>,
  ): Promise<void> {
    if (moves.length === 0) return;
    const dates = new Map<string, string>();
    for (const mv of moves) {
      dates.set(mv.entry.id, await this.weekendDateFor(tenantId, mv.toWeek));
    }
    await this.repo.manager.transaction(async (m) => {
      const r = m.getRepository(TalkExchange);
      for (const mv of moves) await r.softDelete(mv.entry.id);
      for (const mv of moves) {
        await r
          .createQueryBuilder()
          .update()
          .set({ date: dates.get(mv.entry.id)! })
          .where('id = :id', { id: mv.entry.id })
          .execute();
      }
      for (const mv of moves) await r.restore(mv.entry.id);
    });
    for (const mv of moves) {
      await this.auditLog.logUpdate({
        tenantId,
        entityType: 'talk_exchange',
        entityId: mv.entry.id,
        subjectId: mv.entry.publisherId ?? mv.entry.hospitalityPublisherId,
        before: { date: String(mv.entry.date).slice(0, 10) },
        after: { date: dates.get(mv.entry.id)! },
        fields: ['date'],
      });
    }
  }

  /**
   * The guests set aside by circuit visits still standing (25 October 2026):
   * the journal shows each under the overseer of his week, with «Перенести».
   * A visit removed has given its guests back; one whose week is over keeps
   * them as the record of who did not speak, and they are not listed.
   */
  async setAsideFor(
    user: AuthenticatedUser,
  ): Promise<Array<TalkExchange & { name: string | null }>> {
    const tenantId = user.congregationId;
    const today = await this.today(tenantId);
    const rows = await this.repo.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        setAsideBy: Not(IsNull()),
        date: MoreThanOrEqual(addDaysISO(today, -6)),
      },
      withDeleted: true,
      relations: { publisher: true, visitingSpeaker: true },
      order: { date: 'ASC' },
    });
    const visits = new Set(
      (
        await this.eventRepo.find({
          where: {
            congregationId: tenantId,
            id: In([...new Set(rows.map((r) => r.setAsideBy!))]),
          },
        })
      ).map((v) => v.id),
    );
    const out = rows.filter(
      (r) =>
        !!r.deletedAt &&
        visits.has(r.setAsideBy!) &&
        addDaysISO(mondayOf(r.date), 6) >= today,
    );
    // Who he is, as the journal names him: the page of the visit shows it
    // without the directory at hand.
    const named = (r: TalkExchange) =>
      r.publisher
        ? r.publisher.displayName ||
          [r.publisher.lastName, r.publisher.firstName].join(' ')
        : r.visitingSpeaker
          ? speakerFullName(r.visitingSpeaker)
          : r.speakerName?.trim() || null;
    const open = await readsDirectoryContacts(user, this.responsibilitiesRepo);
    return out.map((r) => {
      const name = named(r);
      const row: TalkExchange = { ...(open ? r : exchangeWithoutPrivate(r)) };
      // The relations were for the name; the list carries the entry alone.
      delete (row as Partial<TalkExchange>).publisher;
      delete (row as Partial<TalkExchange>).visitingSpeaker;
      return { ...row, name };
    });
  }

  /**
   * «Перенести»: a guest set aside by a visit goes to another weekend, whole —
   * his talk, the note, the host family (25 October 2026). Only into a week
   * still ahead, with no circuit visit and nobody «К нам» yet; the week he
   * left keeps the overseer, and taking the visit away later no longer puts
   * the guest back there.
   */
  async moveSetAside(
    tenantId: string,
    id: string,
    toWeek: string,
    user: AuthenticatedUser,
  ): Promise<TalkExchangeResult> {
    await this.assertCanWrite(user);
    const row = await this.repo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (
      !row ||
      !row.deletedAt ||
      !row.setAsideBy ||
      row.direction !== TalkExchangeDirection.INCOMING
    ) {
      throw new NotFoundException('No guest set aside by a visit here');
    }
    const week = mondayOf(toWeek);
    if (addDaysISO(week, 6) < (await this.today(tenantId))) {
      throw new BadRequestException({
        code: 'WEEK_ALREADY_PAST',
        message: 'A week that has already happened cannot take a guest',
      });
    }
    if (await this.visitOfWeek(tenantId, week)) {
      throw new BadRequestException(
        refusal(
          'TALK_MOVE_VISIT_WEEK',
          "The circuit overseer's visit week has no place for a guest",
        ),
      );
    }
    if (await this.weekEntry(tenantId, week)) throw weekTaken();

    const visitId = row.setAsideBy;
    const before: Record<string, string | null> = {
      date: String(row.date).slice(0, 10),
      setAsideBy: visitId,
    };
    const date = await this.weekendDateFor(tenantId, week);
    try {
      await this.repo
        .createQueryBuilder()
        .update()
        .set({
          date,
          setAsideBy: null,
          deletedAt: null,
          meetingCancelled: await this.weekCancelled(tenantId, week),
        })
        .where('id = :id', { id: row.id })
        .execute();
    } catch (err) {
      if (isWeekTaken(err)) throw weekTaken();
      throw err;
    }
    // The visit no longer gives the slot back to him: he speaks elsewhere.
    const visit = await this.eventRepo.findOne({
      where: { id: visitId, congregationId: tenantId },
    });
    const ops =
      (visit?.coRevertData as Array<Record<string, unknown>> | null) ?? [];
    if (visit && ops.some((o) => o.op === 'speaker')) {
      visit.coRevertData = ops.map((o) =>
        o.op === 'speaker' ? { ...o, prev: speakerOf({}) } : o,
      );
      await this.eventRepo.save(visit);
    }
    const saved = await this.findOne(tenantId, row.id);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'talk_exchange',
      entityId: saved.id,
      subjectId: saved.publisherId ?? saved.hospitalityPublisherId,
      before,
      after: { date, setAsideBy: null },
      fields: ['date', 'setAsideBy'],
    });
    await this.specialTalkNotifications.announceIfNew(saved, {
      specialTheme: saved.specialTheme,
      date: String(row.date).slice(0, 10),
    });
    return this.applySideEffects(tenantId, saved, false);
  }

  // ---- Side effects -------------------------------------------------------

  private async applySideEffects(
    tenantId: string,
    entry: TalkExchange,
    overwriteProgram?: boolean,
  ): Promise<TalkExchangeResult> {
    // An entry turned from a trip into a visit keeps no trip absence
    // (24 October 2026, events audit M4): it stayed, and nobody could remove
    // it — the absences screen refuses one that comes from a trip.
    if (
      entry.direction !== TalkExchangeDirection.OUTGOING &&
      entry.linkedAbsenceId
    ) {
      await this.absenceRepo.softDelete(entry.linkedAbsenceId);
      entry.linkedAbsenceId = null;
      await this.repo.save(entry);
    }
    if (entry.direction === TalkExchangeDirection.INCOMING) {
      return this.applyIncomingToProgram(
        tenantId,
        entry,
        overwriteProgram ?? false,
      );
    }
    if (entry.direction === TalkExchangeDirection.OUTGOING) {
      await this.syncOutgoingAbsence(tenantId, entry);
    }
    return entry;
  }

  /**
   * Fill the weekend public-talk slot for the entry's week with the visiting
   * speaker + talk. If the slot is already filled with something else and
   * overwrite is false, leave it and flag a conflict for the app to confirm.
   *
   * Что именно переносится (27 сентября): докладчик, если он есть, и речь —
   * номер из каталога или тема специальной речи. Раньше без номера не
   * переносилось ничего, и специальная речь, у которой номера нет по природе,
   * до программы не доходила. Запись, в которой нет ни докладчика, ни речи,
   * по-прежнему ничего не трогает.
   */
  private async applyIncomingToProgram(
    tenantId: string,
    entry: TalkExchange,
    overwrite: boolean,
  ): Promise<TalkExchangeResult> {
    // A visit that did not happen, or whose weekend is cancelled, is not in
    // the programme (sync audit H3).
    if (entry.status === TalkExchangeStatus.DID_NOT_HAPPEN) return entry;
    if (entry.meetingCancelled) return entry;
    const theme = entry.specialTheme?.trim() || null;

    const localPublisherId = entry.publisherId ?? null;
    let name: string | null = null;
    let congName: string | null = null;
    if (!localPublisherId) {
      if (entry.visitingSpeakerId) {
        const speaker = await this.speakerRepo.findOne({
          where: { id: entry.visitingSpeakerId, congregationId: tenantId },
          relations: { externalCongregation: true },
        });
        if (speaker) {
          name = speakerFullName(speaker);
          congName = speaker.externalCongregation?.name ?? null;
        }
      }
      if (!name && entry.speakerName?.trim()) {
        name = entry.speakerName.trim();
        congName = entry.speakerCongregation?.trim() || null;
      }
    }
    const hasSpeaker = !!localPublisherId || !!name;
    const hasTalk = !!entry.publicTalkId || !!theme;
    /**
     * A speaker whose talk is not chosen yet goes to the programme too
     * (23 October 2026).
     *
     * He used to stay in the journal on an ordinary save and reach the
     * programme only when the week was created after him (fillEmptySlot). A
     * week already in the programme kept an empty line while the coordinator
     * saw the visit arranged — Lionel: «у координатора докладчики есть, а в
     * программе нет». Now the speaker alone decides only the speaker: the
     * talk in the slot, if somebody put one there, stays as it is.
     */
    if (!hasTalk && !hasSpeaker) return entry;
    const keepTalk = !hasTalk;

    const weekStartDate = mondayOf(entry.date);
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot) return entry; // no weekend programme for that week yet
    // The weekend is cancelled: the entry waits, marked, out of the
    // programme — and comes back with the meeting.
    if (slot.status === AssignmentStatus.CANCELLED) {
      if (!entry.meetingCancelled) {
        entry.meetingCancelled = true;
        await this.repo.save(entry);
        await this.attention?.meetingCancelled(tenantId, entry);
      }
      return entry;
    }

    // The circuit overseer's week: his name stands over the brother of ours
    // put there before the visit, who comes back when the visit goes. The
    // overseer's own entry leaves that brother where he is (sync audit M3).
    // Asked only where it matters: a guest over a line holding one of ours.
    const overseer =
      !localPublisherId && name && slot.publisherId
        ? await this.overseerOfWeek(tenantId, weekStartDate)
        : null;
    const overseersEntry =
      !!name && !!overseer && normalName(overseer) === normalName(name);

    const linkedHere = slot.talkExchangeId === entry.id;
    const talkSame = keepTalk
      ? true
      : theme
        ? slot.specialTalk && (slot.partTitle ?? '').trim() === theme
        : !slot.specialTalk &&
          slot.publicTalkId === (entry.publicTalkId ?? null);
    /**
     * The same man — by his card first. A card renamed or merged in the
     * directory used to make every later save of the entry ask «replace?»
     * about the same brother, because only the spelling was compared (sync
     * audit M4).
     */
    const speakerSame = localPublisherId
      ? slot.publisherId === localPublisherId
      : name
        ? (overseersEntry || !slot.publisherId) &&
          ((!!entry.visitingSpeakerId &&
            slot.visitingSpeakerId === entry.visitingSpeakerId) ||
            normalName(slot.speakerName ?? '') === normalName(name))
        : !slot.publisherId && !slot.speakerName?.trim();
    const spelled = !name || slot.speakerName === name;
    const alreadyThis = talkSame && speakerSame;
    if (alreadyThis && linkedHere && spelled) return entry;
    // A week already the record keeps its programme; the entry is saved and
    // the coordinator told so (13 October 2026). Asked only now, when the
    // programme WOULD change — not on every save of an old entry's notes.
    if (!(await this.programmeOpen(tenantId, weekStartDate))) {
      return alreadyThis ? entry : { ...entry, programmeFrozen: true };
    }
    if (alreadyThis) {
      // The same visit: the line learns its entry, and the card's spelling.
      slot.talkExchangeId = entry.id;
      if (name) slot.speakerName = name;
      await this.assignmentRepo.save(slot);
      return entry;
    }

    /**
     * Someone else's decision is asked about; the entry's own line is not.
     * The journal owns who speaks: a line that shows this entry follows it
     * without a question (23 October 2026). Only a line holding a speaker of
     * its own — typed in before the two were linked — still asks.
     */
    const slotHasSpeaker = !!(slot.publisherId || slot.speakerName?.trim());
    const conflict =
      !linkedHere && (slotHasSpeaker ? true : slotOccupied(slot) && !talkSame);
    if (conflict && !overwrite) {
      const result = entry as TalkExchangeResult;
      result.programConflict = true;
      return result;
    }

    if (localPublisherId) {
      slot.publisherId = localPublisherId;
      slot.speakerName = null;
      slot.speakerCongregation = null;
      slot.visitingSpeakerId = null;
    } else if (name) {
      if (!overseersEntry) slot.publisherId = null;
      slot.speakerName = name;
      slot.speakerCongregation = congName;
      // Связь едет вместе с именем. Без неё обратное зеркало прочитает только
      // текст, не узнает записи журнала и сотрёт её привязку к карточке — как
      // и было до сих пор.
      slot.visitingSpeakerId = entry.visitingSpeakerId ?? null;
    } else {
      // Тема без докладчика (его ещё не назначили): в слоте никого.
      slot.publisherId = null;
      slot.speakerName = null;
      slot.speakerCongregation = null;
      slot.visitingSpeakerId = null;
    }
    if (theme) {
      slot.publicTalkId = null;
      slot.partTitle = theme;
      slot.specialTalk = true;
    } else if (entry.publicTalkId) {
      slot.publicTalkId = entry.publicTalkId;
      const talk = await this.publicTalkRepo.findOne({
        where: { id: entry.publicTalkId },
      });
      slot.partTitle = talk ? `№${talk.number}. ${talk.title}` : slot.partTitle;
      slot.specialTalk = false;
    } else if (slotHasSpeaker && !speakerSame) {
      // Replacing another speaker (the coordinator confirmed it): his talk
      // goes with him rather than staying on the new man's name.
      slot.publicTalkId = null;
      slot.partTitle = null;
      slot.specialTalk = false;
    }
    // Otherwise, no talk in the entry: the slot's talk is left alone.
    slot.talkExchangeId = entry.id;
    if (slot.status === AssignmentStatus.PUBLISHED) {
      slot.changedSincePublish = true;
    }
    await this.assignmentRepo.save(slot);
    return entry;
  }

  /**
   * Программа подхватывает журнал — только в ПУСТУЮ строку (27 сентября).
   *
   * Координатор договаривается о речах на месяцы вперёд, а программа недели
   * появляется позже — импортом «Сторожевой башни» или вручную. До сих пор
   * такая неделя приходила пустой, и докладчика приходилось вписывать второй
   * раз; хуже того, зеркало видело пустой слот и убирало запись нашего брата
   * из журнала как «снятую».
   *
   * Теперь новая неделя сразу получает то, что записано в журнале. Занятый
   * слот не трогается никогда: там решение уже принято, и принимал его
   * человек.
   */
  async fillEmptySlot(tenantId: string, weekStartDate: string): Promise<void> {
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot || slot.status === AssignmentStatus.CANCELLED) return;
    if (slotOccupied(slot)) return;

    const entry = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(weekStartDate, addDaysISO(weekStartDate, 6)),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
      order: { date: 'ASC' },
    });
    if (!entry) return;

    await this.applyIncomingToProgram(tenantId, entry, false);
  }

  /**
   * Keep an absence in sync for an outgoing brother (he is away that day).
   * Creates on first sync, updates on change, removes if the brother is
   * cleared.
   */
  private async syncOutgoingAbsence(
    tenantId: string,
    entry: TalkExchange,
  ): Promise<void> {
    // A trip that did not happen keeps no absence: the brother was here
    // after all. It used to stay, and nobody could remove it — the absences
    // screen refuses one that comes from a trip (sync audit, 23 October 2026).
    if (
      !entry.publisherId ||
      entry.status === TalkExchangeStatus.DID_NOT_HAPPEN
    ) {
      if (entry.linkedAbsenceId) {
        await this.absenceRepo.softDelete(entry.linkedAbsenceId);
        entry.linkedAbsenceId = null;
        await this.repo.save(entry);
      }
      return;
    }

    const note = await this.buildOutgoingNote(tenantId, entry);

    if (entry.linkedAbsenceId) {
      /**
       * Удалённое отсутствие ВОССТАНАВЛИВАЕТСЯ, а не заводится заново.
       *
       * Обычный поиск не видит удалённых, и прежде это означало: не нашли —
       * создали новое. Брат убирал отсутствие, приложение возвращало другое,
       * и спор шёл по кругу, потому что ни один из двоих не видел другого.
       * Теперь возвращается та же самая запись — с её историей и её номером.
       */
      const abs = await this.absenceRepo.findOne({
        where: { id: entry.linkedAbsenceId, congregationId: tenantId },
        withDeleted: true,
      });
      if (abs) {
        if (abs.deletedAt) await this.absenceRepo.restore(abs.id);
        abs.publisherId = entry.publisherId;
        abs.startDate = entry.date;
        abs.endDate = null;
        abs.note = note;
        abs.talkExchangeId = entry.id;
        abs.deletedAt = null;
        await this.absenceRepo.save(abs);
        return;
      }
    }

    const abs = this.absenceRepo.create({
      congregationId: tenantId,
      publisherId: entry.publisherId,
      startDate: entry.date,
      note: note ?? undefined,
      // Обратная ссылка: по ней экран объясняет, откуда взялось отсутствие, и
      // не даёт убрать его в обход поездки.
      talkExchangeId: entry.id,
    });
    const savedAbs = await this.absenceRepo.save(abs);
    entry.linkedAbsenceId = savedAbs.id;
    await this.repo.save(entry);
  }

  private async buildOutgoingNote(
    tenantId: string,
    entry: TalkExchange,
  ): Promise<string | null> {
    const parts: string[] = [];
    if (entry.publicTalkId) {
      const talk = await this.publicTalkRepo.findOne({
        where: { id: entry.publicTalkId },
      });
      if (talk) parts.push(`№${talk.number}`);
    }
    if (entry.hostCongregationId) {
      const cong = await this.congregationRepo.findOne({
        where: { id: entry.hostCongregationId, congregationId: tenantId },
      });
      if (cong) parts.push(cong.name);
    }
    return parts.length ? parts.join(' · ') : null;
  }

  // ---- Program -> Journal sync -------------------------------------------

  /** The weekend meeting date for a week, per the meeting-settings version in force. */
  private async weekendDateFor(
    tenantId: string,
    weekStartDate: string,
  ): Promise<string> {
    // The version in force THAT week — not the latest of all. The latest was
    // taken, so a change planned for January moved this autumn's journal
    // entries to January's weekday (26 September).
    const version = versionForWeek(
      await this.meetingSettingsRepo.find({
        where: { congregationId: tenantId },
      }),
      weekStartDate,
    );
    const dow = version?.weekendDow ?? 7; // default Sunday
    return addDaysISO(weekStartDate, dow - 1);
  }

  /**
   * Build the journal from the programme, for every week from a date onwards.
   *
   * The two-way sync began on 23 June 2026. Weekend speakers entered BEFORE
   * that day never produced a journal entry — nothing was deleted, the mirror
   * simply did not exist yet. From the coordinator's chair that reads as data
   * lost, and it is worse than lost: the programme says a brother came and the
   * journal says nobody did.
   *
   * Idempotent by construction: it calls the same one-week sync used
   * everywhere else, so a week that already agrees is left exactly as it is.
   */
  async rebuildFromProgramme(
    tenantId: string,
    from: string,
    user: AuthenticatedUser,
  ): Promise<{ weeks: number; created: number; linked: number }> {
    // It writes the journal. It was the one way to write it that asked
    // nobody who was asking (6 October): any signed-in member could run it.
    await this.assertCanWrite(user);
    const slots = await this.assignmentRepo.find({
      where: {
        congregationId: tenantId,
        partKey: PUBLIC_TALK_PART_KEY,
        weekStartDate: MoreThanOrEqual(from),
      },
      order: { weekStartDate: 'ASC' },
    });

    /**
     * Считаем ДВА разных исхода, потому что раньше считали ни одного.
     *
     * Прежняя мерка была разницей количеств до и после, а под ней стояла
     * подпись «если ничего не добавилось — значит журнал и программа уже
     * совпадают». В первый же настоящий прогон это оказалось неправдой:
     * записей не прибавилось ни одной, зато четыре визита впервые обрели
     * хозяина — связь со справочником проставилась там, где её не было. Про
     * это человеку не сказали ничего.
     *
     * Разница количеств не умеет отличить «ничего не произошло» от «поровну
     * появилось и исчезло» и вовсе слепа к изменениям внутри записи. Поэтому
     * теперь смотрим на состояние записей: сколько было и у скольких была
     * связь.
     */
    const whereIncoming = {
      congregationId: tenantId,
      direction: TalkExchangeDirection.INCOMING,
      date: MoreThanOrEqual(from),
    };
    const before = await this.repo.find({ where: whereIncoming });
    const linkedBefore = new Set(
      before.filter((e) => e.visitingSpeakerId).map((e) => e.id),
    );

    const weeks = [...new Set(slots.map((a) => a.weekStartDate))];
    // Never removes: a run over months must not take away what the
    // coordinator arranged because a line is still empty (sync audit M6).
    for (const week of weeks) {
      await this.syncProgramToJournal(tenantId, week, { rebuild: true });
    }

    const after = await this.repo.find({ where: whereIncoming });
    const created = Math.max(0, after.length - before.length);
    // Связанные заново — те, у кого связь появилась, а запись существовала и
    // раньше. Новые записи со связью считаются в `created`, дважды одно и то
    // же событие называть незачем.
    const linked = after.filter(
      (e) =>
        e.visitingSpeakerId &&
        linkedBefore.has(e.id) === false &&
        before.some((b) => b.id === e.id),
    ).length;

    return { weeks: weeks.length, created, linked };
  }

  /**
   * Приехал другой брат.
   *
   * Это не правка записи, а два факта: визит того, кого ждали, НЕ СОСТОЯЛСЯ, а
   * визит того, кто приехал, состоялся. Раньше оба умещались в одну строку —
   * имя переписывали, и первый брат исчезал бесследно: ни следа, что его звали
   * и он не приехал. А по этому следу и решают, звать ли снова.
   *
   * Делается одним действием, потому что делается со сцены. Председатель
   * объявляет то, что написано в программе, и правка в двух местах подряд в
   * эту минуту невозможна: программа должна стать верной сразу.
   *
   * Порядок важен: сперва закрываем прежнюю запись, и только потом зеркало
   * заводит новую. Иначе оно нашло бы старую и переписало её именем нового —
   * ровно та потеря истории, ради которой всё делалось.
   */
  async replaceSpeaker(
    tenantId: string,
    user: AuthenticatedUser,
    dto: ReplaceSpeakerDto,
  ): Promise<{ closed: string | null; entry: TalkExchange | null }> {
    await this.assertCanWrite(user);

    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate: dto.weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot) {
      throw new NotFoundException('That week has no public-talk slot');
    }
    // Замена переписывает программу недели — нельзя, если она уже запись.
    await this.freeze?.assertWritable(tenantId, [
      { weekStartDate: dto.weekStartDate, eventType: 'weekend' },
    ]);
    // Снимок до правки: снимается здесь, пока слот ещё не тронут.
    const slotWas = { ...slot } as Assignment;

    const weekEnd = addDaysISO(dto.weekStartDate, 6);
    const previous = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(dto.weekStartDate, weekEnd),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });

    /**
     * Замена на того же самого — не замена.
     *
     * Нажать можно случайно, а последствие тяжёлое: живой визит закрылся бы
     * как несостоявшийся и тут же завёлся заново, оставив в истории брата
     * ложную отметку «не приехал».
     */
    const sameSpeaker =
      (dto.visitingSpeakerId &&
        dto.visitingSpeakerId === slot.visitingSpeakerId) ||
      (dto.publisherId && dto.publisherId === slot.publisherId);
    if (sameSpeaker) {
      throw new BadRequestException({
        code: 'SAME_SPEAKER',
        message: 'That speaker already has this week',
      });
    }

    /**
     * Everything that can refuse is settled BEFORE anything is written
     * (24 October 2026, sync audit L3): who comes, his card, his talk. Until
     * then the old visit was closed first, and a refusal after it — an
     * unknown card, nobody named — left him «не приехал» while the
     * programme still named him.
     */
    const slotFields = (a: Assignment) => ({
      publisherId: a.publisherId,
      visitingSpeakerId: a.visitingSpeakerId,
      speakerName: a.speakerName,
      speakerCongregation: a.speakerCongregation,
      publicTalkId: a.publicTalkId,
      specialTalk: a.specialTalk,
      partTitle: a.partTitle,
      changedSincePublish: a.changedSincePublish,
      talkExchangeId: a.talkExchangeId,
    });
    const slotOriginal = slotFields(slot);
    // Новый докладчик занимает слот программы — с этой секунды председатель
    // читает верное имя.
    const name = dto.speakerName?.trim() || null;
    if (dto.visitingSpeakerId) {
      const speaker = await this.speakerRepo.findOne({
        where: { id: dto.visitingSpeakerId, congregationId: tenantId },
        relations: { externalCongregation: true },
      });
      if (!speaker) throw new NotFoundException('Speaker not found');
      slot.publisherId = null;
      slot.visitingSpeakerId = speaker.id;
      slot.speakerName = speakerFullName(speaker);
      slot.speakerCongregation = speaker.externalCongregation?.name ?? null;
    } else if (dto.publisherId) {
      slot.publisherId = dto.publisherId;
      slot.visitingSpeakerId = null;
      slot.speakerName = null;
      slot.speakerCongregation = null;
    } else if (name) {
      slot.publisherId = null;
      // Карточка заводится или находится здесь же: визит нового брата обязан
      // попасть в его историю так же, как и любой другой.
      slot.visitingSpeakerId = await this.speakerCardFor(
        tenantId,
        name,
        dto.speakerCongregation ?? null,
      );
      slot.speakerName = name;
      slot.speakerCongregation = dto.speakerCongregation?.trim() || null;
    } else {
      throw new BadRequestException(
        refusal('TALK_SLOT_NOBODY', 'Nobody to put in the slot'),
      );
    }
    /**
     * Речь меняется вместе с докладчиком — если её назвали.
     *
     * Приезжает другой брат со своей речью, и до сих пор слот молча сохранял
     * прежний номер: новому записывалось то, чего он не говорил, а подсказка
     * «эта речь у нас уже была» начинала отговаривать от темы, которую никто
     * не слышал. Не назвали — оставляем как есть: тот же доклад может читать
     * другой, и это законный случай.
     */
    if (dto.publicTalkId) {
      slot.publicTalkId = dto.publicTalkId;
      slot.specialTalk = false;
      const talk = await this.publicTalkRepo.findOne({
        where: { id: dto.publicTalkId },
      });
      if (talk) slot.partTitle = `№${talk.number}. ${talk.title}`;
    }
    const slotPlanned = slotFields(slot);
    Object.assign(slot, slotOriginal);

    let closed: string | null = null;
    const previousStatus = previous?.status;
    const previousNote = previous?.note;
    let entry: TalkExchange | null;
    try {
      /**
       * Закрываем визит любого — и приезжего, и НАШЕГО брата.
       *
       * Сначала было иначе: считалось, что про своего «не состоялось» говорить
       * нечего, он ведь никуда не ездил. Это оказалось неверно дважды. По сути:
       * «наш брат не смог, вместо него другой» бывает не реже приезда гостя, и
       * это ровно тот же факт — назначен и не выступил. По последствиям хуже:
       * без закрытой записи нечего возвращать, и замена на такой неделе
       * становилась необратимой. Именно так 7 сентября одна неделя
       * потеряла и докладчика, и тему, и восстанавливать пришлось из резервной
       * копии.
       */
      if (previous) {
        const beforeState = snapshot(previous);
        previous.status = TalkExchangeStatus.DID_NOT_HAPPEN;
        if (dto.reason?.trim()) {
          previous.note = [previous.note, dto.reason.trim()]
            .filter(Boolean)
            .join(' · ');
        }
        await this.repo.save(previous);
        closed = previous.id;
        await this.auditLog.logUpdate({
          tenantId,
          entityType: 'talk_exchange',
          entityId: previous.id,
          subjectId: previous.publisherId ?? previous.hospitalityPublisherId,
          before: beforeState,
          after: snapshot(previous),
          fields: ['status', 'note'],
        });
      }

      /**
       * The rest goes through whole or not at all. «Приехал другой докладчик»
       * is pressed in the minutes before the meeting; a failure halfway (the
       * old visit closed, the new man not yet in the programme) is put back
       * as it was, and the person sees the error and presses again.
       */
      Object.assign(slot, slotPlanned);
      if (slot.status === AssignmentStatus.PUBLISHED) {
        slot.changedSincePublish = true;
      }
      const slotBefore = slotSnapshot(slotWas);
      await this.assignmentRepo.save(slot);
      /**
       * След в журнале изменений.
       *
       * Обычная правка назначения его оставляет, а замена правила слот напрямую
       * и молча — поэтому у испорченной недели не нашлось ни следа, ни
       * возможности вернуть как было. Действие, меняющее программу, обязано
       * говорить, кто и что изменил.
       */
      await this.auditLog.logUpdate({
        tenantId: tenantId,
        entityType: 'assignment',
        entityId: slot.id,
        subjectId: slot.publisherId ?? null,
        before: slotBefore,
        after: slotSnapshot(slot),
        fields: SLOT_FIELDS,
      });

      // Зеркало заводит запись нового визита. Прежняя ему уже не видна.
      // The line still points at the visit just closed: that link goes, so
      // the new visit gets an entry of its own.
      slot.talkExchangeId = null;
      await this.assignmentRepo.save(slot);
      await this.syncProgramToJournal(tenantId, dto.weekStartDate);

      entry = await this.weekEntry(tenantId, dto.weekStartDate);
      // A person decided it, from the coordinator's side: it is his entry.
      if (entry && entry.origin !== 'journal') {
        entry.origin = 'journal';
        await this.repo.save(entry);
      }

      /**
       * Гостеприимство переезжает к тому, кто приехал.
       *
       * Решение Лионеля: семье всё равно, какого докладчика принимать — она
       * принимает ГОСТЯ ЭТОЙ НЕДЕЛИ. Оставить приём у несостоявшегося визита
       * значило бы, что приехавшего никто не встречает, а семья об этом узнаёт
       * в лучшем случае в зале.
       */
      if (
        previous?.hospitalityPublisherId &&
        entry &&
        !entry.hospitalityPublisherId
      ) {
        entry.hospitalityPublisherId = previous.hospitalityPublisherId;
        await this.repo.save(entry);
        previous.hospitalityPublisherId = null;
        await this.repo.save(previous);
      }
    } catch (err) {
      try {
        Object.assign(slot, slotOriginal);
        await this.assignmentRepo.save(slot);
        if (previous && closed) {
          const fresh = await this.weekEntry(tenantId, dto.weekStartDate);
          if (fresh && fresh.id !== previous.id) {
            await this.repo.softDelete(fresh.id);
          }
          previous.status = previousStatus!;
          previous.note = previousNote ?? null;
          await this.repo.save(previous);
        }
      } catch (undoErr) {
        this.logger.error(
          `replaceSpeaker: could not put the week back: ${String(undoErr)}`,
        );
      }
      throw err;
    }

    return { closed, entry };
  }

  /**
   * Он всё-таки приехал — или на кнопку нажали по ошибке.
   *
   * Замена оставляет в истории отметку «назначался, не приехал», и это верно
   * ровно до тех пор, пока она правда. Ошибиться легко: замену делают в спешке
   * перед встречей, иногда с чужого телефона, иногда не с тем братом в списке.
   * Без возврата у человека остаётся ложное пятно, стереть которое нечем — а
   * по нему решают, звать ли его снова.
   *
   * Возвращаем ровно то, что замена изменила: закрытая запись снова
   * состоявшаяся, слот программы снова его, а запись заменившего убирается —
   * НО только если она пуста от собственной работы координатора. Если к ней
   * успели приписать гостеприимство, заметку или назначить своего докладчика,
   * решать за него нельзя: тогда обе записи остаются, и человек разбирается
   * сам, видя обе.
   */
  async undoReplacement(
    tenantId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ restored: string; removed: string | null }> {
    await this.assertCanWrite(user);

    const closed = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!closed) throw new NotFoundException('Entry not found');
    if (closed.status !== TalkExchangeStatus.DID_NOT_HAPPEN) {
      throw new BadRequestException({
        code: 'NOT_A_MISSED_VISIT',
        message: 'Only a visit marked as not happened can be undone',
      });
    }

    const weekStartDate = mondayOf(closed.date);
    const weekEnd = addDaysISO(weekStartDate, 6);
    // Отмена замены тоже переписывает программу недели.
    await this.freeze?.assertWritable(tenantId, [
      { weekStartDate, eventType: 'weekend' },
    ]);

    // Запись, которая сейчас занимает неделю: её завела замена.
    const live = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(weekStartDate, weekEnd),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });
    /**
     * Своя работа координатора — только заметка.
     *
     * Гостеприимство сюда не входит намеренно: оно принадлежит НЕДЕЛЕ, а не
     * человеку (семья принимает гостя, кем бы он ни был), и при замене
     * переезжает вместе с ней. Значит при возврате оно едет обратно, а не
     * держит запись заменившего на месте.
     */
    const liveHasOwnWork = !!live && !!live.note;

    /**
     * The week is freed BEFORE the closed visit stands again: one live entry
     * a week. The replacing visit with a note of its own is no longer kept
     * live beside it — two live entries in one week left every reader to
     * pick one (sync audit M1). It stays, with its note, marked as not held:
     * by this undo, it did not happen.
     */
    let removed: string | null = null;
    // Put back as it was if anything below fails (24 October 2026, sync
    // audit L3): the undo, too, is pressed in a hurry, and half of it — the
    // replacing visit gone, the first one not yet standing — is a week with
    // nobody.
    const liveWas = live ? { status: live.status } : null;
    const closedHospitality = closed.hospitalityPublisherId;
    let slotWas: Partial<Assignment> | null = null;
    let slotRow: Assignment | null = null;
    try {
      if (live && liveHasOwnWork) {
        live.status = TalkExchangeStatus.DID_NOT_HAPPEN;
        await this.repo.save(live);
      } else if (live) {
        if (live.hospitalityPublisherId && !closed.hospitalityPublisherId) {
          closed.hospitalityPublisherId = live.hospitalityPublisherId;
        }
        await this.repo.softDelete(live.id);
        removed = live.id;
      }

      const before = snapshot(closed);
      closed.status = TalkExchangeStatus.CONFIRMED;
      await this.saveEntry(closed);
      await this.auditLog.logUpdate({
        tenantId,
        entityType: 'talk_exchange',
        entityId: closed.id,
        subjectId: closed.publisherId ?? closed.hospitalityPublisherId,
        before,
        after: snapshot(closed),
        fields: ['status'],
      });

      // Программа возвращается к нему: председатель снова прочитает верное имя.
      const slot = await this.assignmentRepo.findOne({
        where: {
          congregationId: tenantId,
          weekStartDate,
          partKey: PUBLIC_TALK_PART_KEY,
        },
      });
      slotRow = slot;
      if (slot) {
        slotWas = {
          talkExchangeId: slot.talkExchangeId,
          publisherId: slot.publisherId,
          visitingSpeakerId: slot.visitingSpeakerId,
          speakerName: slot.speakerName,
          speakerCongregation: slot.speakerCongregation,
          publicTalkId: slot.publicTalkId,
          partTitle: slot.partTitle,
          specialTalk: slot.specialTalk,
          changedSincePublish: slot.changedSincePublish,
        };
        const slotBefore = slotSnapshot(slot);
        slot.talkExchangeId = closed.id;
        slot.publisherId = closed.publisherId ?? null;
        slot.visitingSpeakerId = closed.visitingSpeakerId ?? null;
        // The name from his card — an entry made in the journal may carry the
        // card alone, and the line came back empty.
        const card = closed.visitingSpeakerId
          ? await this.speakerRepo.findOne({
              where: { id: closed.visitingSpeakerId, congregationId: tenantId },
              relations: { externalCongregation: true },
            })
          : null;
        slot.speakerName = closed.publisherId
          ? null
          : card
            ? speakerFullName(card)
            : closed.speakerName;
        slot.speakerCongregation = closed.publisherId
          ? null
          : card
            ? (card.externalCongregation?.name ?? null)
            : closed.speakerCongregation;
        if (closed.specialTheme) {
          slot.publicTalkId = null;
          slot.partTitle = closed.specialTheme;
          slot.specialTalk = true;
        } else if (closed.publicTalkId) {
          slot.publicTalkId = closed.publicTalkId;
          slot.specialTalk = false;
          const talk = await this.publicTalkRepo.findOne({
            where: { id: closed.publicTalkId },
          });
          if (talk) slot.partTitle = `№${talk.number}. ${talk.title}`;
        }
        if (slot.status === AssignmentStatus.PUBLISHED) {
          slot.changedSincePublish = true;
        }
        await this.assignmentRepo.save(slot);
        await this.auditLog.logUpdate({
          tenantId,
          entityType: 'assignment',
          entityId: slot.id,
          subjectId: slot.publisherId ?? null,
          before: slotBefore,
          after: slotSnapshot(slot),
          fields: SLOT_FIELDS,
        });
      }
    } catch (err) {
      try {
        if (slotRow && slotWas) {
          Object.assign(slotRow, slotWas);
          await this.assignmentRepo.save(slotRow);
        }
        if (closed.status !== TalkExchangeStatus.DID_NOT_HAPPEN) {
          closed.status = TalkExchangeStatus.DID_NOT_HAPPEN;
          closed.hospitalityPublisherId = closedHospitality;
          await this.repo.save(closed);
        }
        if (live && liveWas) {
          if (removed) await this.repo.restore(live.id);
          live.status = liveWas.status;
          await this.repo.save(live);
        }
      } catch (undoErr) {
        this.logger.error(
          `undoReplacement: could not put the week back: ${String(undoErr)}`,
        );
      }
      throw err;
    }

    return { restored: closed.id, removed };
  }

  /**
   * The programme line was saved: what the journal learns from it.
   *
   * The journal owns who speaks at a weekend (23 October 2026); the line
   * shows its entry. So the line writes into the journal only what a person
   * changed IN THE LINE — the speaker, his congregation, the talk. Before,
   * any save of the line — its duration, its status — rewrote the week's
   * entry from it, and a «replace?» the coordinator had declined was undone
   * by the next unrelated save (sync audit M2).
   *
   * What it does, in order:
   * - a cancelled weekend marks its entry and tells those who answer for the
   *   talks; lifting the cancellation gives the entry back to the line whole
   *   (H3, M7). Nothing is deleted;
   * - an unchanged speaker: the line only learns its entry, and an empty line
   *   — restored, just created — takes it;
   * - a changed speaker: the week's entry (the line's own one first) is
   *   rewritten, or made. A line emptied by hand removes only an entry the
   *   application made from a typed name; an entry the coordinator made stays
   *   — it is his arrangement — and he is told (H2). `rebuild` never removes.
   */
  async syncProgramToJournal(
    tenantId: string,
    weekStartDate: string,
    opts: {
      speakerChanged?: boolean;
      rebuild?: boolean;
      /** The line itself was just brought back from removal. */
      lineRestored?: boolean;
    } = {},
  ): Promise<void> {
    const speakerChanged = opts.speakerChanged ?? true;
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });

    /**
     * Запись, которую зеркало ведёт, — только СОСТОЯВШАЯСЯ, и прежде всего
     * та, которую строка знает. После замены в неделе лежат две:
     * несостоявшийся визит первого брата и визит второго.
     */
    let existing = await this.weekEntry(tenantId, weekStartDate);
    if (!existing && opts.lineRestored && slot?.talkExchangeId) {
      // The line's own entry, removed with the line: it comes back with it.
      const own = await this.repo.findOne({
        where: { id: slot.talkExchangeId, congregationId: tenantId },
        withDeleted: true,
      });
      if (
        own?.deletedAt &&
        own.direction === TalkExchangeDirection.INCOMING &&
        own.status !== TalkExchangeStatus.DID_NOT_HAPPEN &&
        mondayOf(own.date) === weekStartDate
      ) {
        await this.repo.restore(own.id);
        own.deletedAt = null;
        existing = own;
      }
    }

    // A cancelled weekend: the entry waits, marked, and its people are told.
    if (slot && slot.status === AssignmentStatus.CANCELLED) {
      if (existing && !existing.meetingCancelled) {
        existing.meetingCancelled = true;
        await this.repo.save(existing);
        await this.attention?.meetingCancelled(tenantId, existing);
      }
      return;
    }
    if (existing?.meetingCancelled) {
      existing.meetingCancelled = false;
      await this.repo.save(existing);
      if (slot) await this.applyIncomingToProgram(tenantId, existing, false);
      return;
    }

    if (!speakerChanged) {
      if (slot && existing && slot.talkExchangeId !== existing.id) {
        await this.applyIncomingToProgram(tenantId, existing, false);
      } else if (slot && existing && !slotOccupied(slot)) {
        await this.applyIncomingToProgram(tenantId, existing, false);
      }
      return;
    }

    const active = !!slot;
    /**
     * Районный в слоте — приезжий, даже если под ним остался наш брат.
     *
     * Визит ставит в слот имя районного и не снимает брата, назначенного
     * раньше: уберут визит — брат вернётся. Пока визит стоит, речь произносит
     * районный, это и показывает программа; журнал читал такой слот как
     * «выступает наш брат» и записывал визит на него.
     */
    const overseer = active
      ? await this.overseerOfWeek(tenantId, weekStartDate)
      : null;
    const isOverseer =
      !!slot &&
      !!overseer &&
      normalName(overseer) === normalName(slot.speakerName ?? '');
    const hasLocal = !!(slot && slot.publisherId && !isOverseer);
    const hasInvited = !!(
      slot &&
      (!slot.publisherId || isOverseer) &&
      slot.speakerName?.trim()
    );

    if (!hasLocal && !hasInvited) {
      if (!existing || opts.rebuild) return;
      const coordinatorsOwn =
        existing.origin === 'journal' ||
        !!existing.hospitalityPublisherId ||
        !!existing.note ||
        !!existing.specialTheme;
      if (!coordinatorsOwn) {
        await this.mirrorRemoved(tenantId, existing);
        await this.repo.softDelete(existing.id);
        await this.retireLeftoverCards(tenantId, [
          existing.visitingSpeakerId,
          slot?.visitingSpeakerId,
        ]);
        return;
      }
      if (slot?.talkExchangeId === existing.id) {
        slot.talkExchangeId = null;
        slot.visitingSpeakerId = null;
        if (await this.programmeOpen(tenantId, weekStartDate)) {
          await this.assignmentRepo.save(slot);
        }
      }
      await this.attention?.droppedFromProgramme(tenantId, existing);
      return;
    }
    const line = slot!;

    const publicTalkId = line.publicTalkId ?? null;
    /**
     * Тема специальной речи идёт из программы, как и докладчик: у недели с
     * докладчиком тема — ровно то, что стоит в слоте. Иначе при обмене
     * неделями тема оставалась у недели, а не у речи, и доставалась гостю,
     * который приехал с каталожной речью.
     */
    const specialTheme = line.specialTalk
      ? line.partTitle?.trim() || null
      : null;

    let entry: TalkExchange;
    const leftBehind: Array<string | null | undefined> = [];
    if (hasLocal) {
      const publisherId = line.publisherId!;
      if (existing) {
        const same =
          existing.publisherId === publisherId &&
          existing.visitingSpeakerId == null &&
          existing.speakerName == null &&
          existing.publicTalkId === publicTalkId &&
          (existing.specialTheme ?? null) === specialTheme;
        if (!same) {
          const before = snapshot(existing);
          const was = {
            specialTheme: existing.specialTheme,
            date: existing.date,
          };
          leftBehind.push(existing.visitingSpeakerId, line.visitingSpeakerId);
          existing.publisherId = publisherId;
          // Наш брат — не приезжий: связь со справочником снимается намеренно.
          existing.visitingSpeakerId = null;
          existing.speakerName = null;
          existing.speakerCongregation = null;
          existing.publicTalkId = publicTalkId;
          existing.specialTheme = specialTheme;
          await this.repo.save(existing);
          await this.mirrorChanged(tenantId, before, was, existing);
        }
        entry = existing;
      } else {
        entry = await this.repo.save(
          this.repo.create({
            congregationId: tenantId,
            direction: TalkExchangeDirection.INCOMING,
            date: await this.weekendDateFor(tenantId, weekStartDate),
            publisherId,
            publicTalkId,
            specialTheme,
            origin: 'programme',
          }),
        );
        await this.mirrorCreated(tenantId, entry);
      }
      if (line.visitingSpeakerId) {
        leftBehind.push(line.visitingSpeakerId);
        line.visitingSpeakerId = null;
      }
    } else {
      const speakerName = line.speakerName!.trim();
      const speakerCongregation = line.speakerCongregation?.trim() || null;
      // Cards that may have lost their last visit by this sync: looked at
      // once the slot and the entry point where they now should.
      leftBehind.push(line.visitingSpeakerId, existing?.visitingSpeakerId);
      //
      // Районный в неделю своего визита — особый случай: имя в слот ставит
      // сам визит, и карточка у него своя, помеченная.
      const visitingSpeakerId = isOverseer
        ? await this.overseerCard(tenantId, speakerName)
        : await this.slotCard(
            tenantId,
            line.visitingSpeakerId ?? null,
            speakerName,
            speakerCongregation,
            existing?.speakerName ?? null,
          );
      line.visitingSpeakerId = visitingSpeakerId;
      if (existing) {
        const same =
          existing.publisherId == null &&
          existing.visitingSpeakerId === visitingSpeakerId &&
          existing.speakerName === speakerName &&
          existing.speakerCongregation === speakerCongregation &&
          existing.publicTalkId === publicTalkId &&
          (existing.specialTheme ?? null) === specialTheme;
        if (!same) {
          const before = snapshot(existing);
          const was = {
            specialTheme: existing.specialTheme,
            date: existing.date,
          };
          existing.publisherId = null;
          existing.visitingSpeakerId = visitingSpeakerId;
          existing.speakerName = speakerName;
          existing.speakerCongregation = speakerCongregation;
          existing.publicTalkId = publicTalkId;
          existing.specialTheme = specialTheme;
          await this.repo.save(existing);
          await this.mirrorChanged(tenantId, before, was, existing);
        }
        entry = existing;
      } else {
        entry = await this.repo.save(
          this.repo.create({
            congregationId: tenantId,
            direction: TalkExchangeDirection.INCOMING,
            date: await this.weekendDateFor(tenantId, weekStartDate),
            visitingSpeakerId,
            speakerName,
            speakerCongregation,
            publicTalkId,
            specialTheme,
            origin: 'programme',
          }),
        );
        await this.mirrorCreated(tenantId, entry);
      }
    }

    // The line knows its entry from now on. The link is bookkeeping, but it
    // is the programme's row: left as it is once the week is the record.
    if (await this.programmeOpen(tenantId, weekStartDate)) {
      line.talkExchangeId = entry.id;
      await this.assignmentRepo.save(line);
    }
    await this.retireLeftoverCards(tenantId, leftBehind);
  }

  /**
   * What the programme itself does to «К нам» is written down and told like
   * what the coordinator does there (24 October 2026, sync audit L5): one
   * line in the journal of changes, by whoever saved the programme, and a
   * special talk put in through the programme is announced to the
   * congregation as one written in the journal is — once per theme and day,
   * so the two ways never say it twice.
   */
  private async mirrorCreated(tenantId: string, saved: TalkExchange) {
    await this.specialTalkNotifications.announceIfNew(saved, null);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'talk_exchange',
      entityId: saved.id,
      subjectId: saved.publisherId ?? saved.hospitalityPublisherId,
      after: snapshot(saved),
    });
  }

  private async mirrorChanged(
    tenantId: string,
    before: Record<string, unknown>,
    was: { specialTheme: string | null; date: string },
    saved: TalkExchange,
  ) {
    await this.specialTalkNotifications.announceIfNew(saved, was);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'talk_exchange',
      entityId: saved.id,
      subjectId: saved.publisherId ?? saved.hospitalityPublisherId,
      before,
      after: snapshot(saved),
      fields: Object.keys(before),
    });
  }

  private async mirrorRemoved(tenantId: string, row: TalkExchange) {
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'talk_exchange',
      entityId: row.id,
      action: 'DELETE',
      subjectId: row.publisherId ?? row.hospitalityPublisherId,
      detail: snapshot(row),
    });
  }
}
