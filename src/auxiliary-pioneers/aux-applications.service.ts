import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import {
  AuxPioneerApplication,
  AuxPioneerApplicationSeat,
  COMMITTEE_SEATS,
  type CommitteeSeat,
} from '../entities/aux-pioneer-application.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Absence } from '../entities/absence.entity';
import { Congregation } from '../entities/congregation.entity';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { refusal } from '../common/errors/refusal';
import type { SupportedLanguage } from '../common/i18n/supported-languages';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuxYearService } from './aux-year.service';
import { AuxiliaryPioneersService } from './auxiliary-pioneers.service';

/** Days a place waits for its brother before it is reminded — and may be opened. */
export const AUX_SEAT_WAIT_DAYS = 3;

const MONTH = /^\d{4}-\d{2}$/;

/** A place of the committee, as the screens read it. */
export interface SeatView {
  seat: CommitteeSeat;
  /** The brothers who hold the responsibility now. */
  holders: { userId: string; name: string }[];
  open: boolean;
  openReason: AuxPioneerApplicationSeat['openReason'];
  openedAt: string | null;
  approved: boolean;
  approvedAt: string | null;
  approverName: string | null;
  /** The place cannot be filled: open, and no elder left who could answer. */
  unfillable: boolean;
}

export interface ApplicationView {
  id: string;
  publisherId: string;
  publisherName: string;
  groupName: string | null;
  months: string[];
  untilCancelled: boolean;
  reducedMonths: string[];
  status: 'pending' | 'approved';
  source: 'app' | 'paper';
  paperDate: string | null;
  createdAt: string;
  approvedAt: string | null;
  seats: SeatView[];
  /** What the reader may do with it. */
  can: {
    approveSeat: CommitteeSeat | null;
    approveOpenSeats: CommitteeSeat[];
    pass: boolean;
    openSeats: CommitteeSeat[];
    withdraw: boolean;
  };
}

/** The applicant's own view: no names of the brothers, no places. */
export interface MyApplicationView {
  id: string;
  months: string[];
  untilCancelled: boolean;
  reducedMonths: string[];
  status: 'pending' | 'approved';
  createdAt: string;
  approvedAt: string | null;
  /** Some brother has already answered — it can no longer be changed. */
  answered: boolean;
}

export interface ApplyInput {
  months: string[];
  untilCancelled?: boolean;
  reducedMonths?: string[];
  confirmed: boolean;
}

export interface PaperInput extends Omit<ApplyInput, 'confirmed'> {
  publisherId: string;
  paperDate: string;
  /** The brothers who signed — at least two, at most three. */
  signers: { seat: CommitteeSeat; userId?: string; name?: string }[];
}

const SEAT_RESP: Record<CommitteeSeat, ResponsibilityType> = {
  body_coordinator: ResponsibilityType.BODY_COORDINATOR,
  secretary: ResponsibilityType.SECRETARY,
  service_overseer: ResponsibilityType.SERVICE_OVERSEER,
};

const STR: Record<
  SupportedLanguage,
  {
    title: string;
    newApp: string;
    seatOpen: string;
    reminder: string;
    withdrawn: string;
    approved: string;
    stopped: string;
    reportHours: string;
  }
> = {
  ru: {
    title: 'Подсобное служение',
    newApp: 'Новое заявление — нужен ваш ответ',
    seatOpen: 'Заявление ждёт ответа старейшины',
    reminder: 'Заявление всё ещё ждёт вашего ответа',
    withdrawn: 'Одно из заявлений отозвано',
    approved: 'Ваше заявление одобрено',
    stopped: 'Подсобный пионер прекратил служение «до отмены»',
    reportHours: 'Месяц стал подсобным — впишите часы в отчёт',
  },
  de: {
    title: 'Hilfspionierdienst',
    newApp: 'Neue Bewerbung — Ihre Antwort wird gebraucht',
    seatOpen: 'Eine Bewerbung wartet auf die Antwort eines Ältesten',
    reminder: 'Eine Bewerbung wartet noch auf Ihre Antwort',
    withdrawn: 'Eine Bewerbung wurde zurückgezogen',
    approved: 'Ihre Bewerbung wurde genehmigt',
    stopped: 'Ein Hilfspionier hat «bis auf Widerruf» beendet',
    reportHours:
      'Der Monat ist jetzt Hilfspionierdienst — bitte die Stunden im Bericht nachtragen',
  },
  en: {
    title: 'Auxiliary pioneering',
    newApp: 'A new application needs your answer',
    seatOpen: 'An application is waiting for an elder’s answer',
    reminder: 'An application is still waiting for your answer',
    withdrawn: 'An application has been withdrawn',
    approved: 'Your application has been approved',
    stopped: 'An auxiliary pioneer has ended «until canceled»',
    reportHours:
      'The month is now auxiliary pioneering — please add the hours to your report',
  },
};

/**
 * THE APPLICATION AND THE COMMITTEE'S THREE PLACES (Lionel, 29 October 2026).
 *
 *   • A baptized publisher who is not a permanent pioneer applies for some
 *     months, or «until cancelled», choosing 15 hours where a month allows
 *     it, and confirms the form's words. Only while the committee is whole:
 *     with a place nobody holds, the application is not taken — the admin is
 *     told whom the committee lacks.
 *   • Each place — coordinator, secretary, service overseer — approves. Its
 *     holder answers; a place is OPEN to any other elder when its holder is
 *     the applicant, passes it on, or is away (no answer for three days and
 *     an absence written for today — or opened by another of the committee
 *     after three days). The first elder to answer takes it; nobody answers
 *     in two places.
 *   • When no elder is left who could fill an open place, two approvals are
 *     enough.
 *   • Approved: the periods are made, the applicant is told, and the
 *     application is kept for good — in the card. Taken back — by the
 *     applicant, or quietly by one of the committee — it is deleted: no
 *     reason anywhere, a bare line in the journal.
 *   • Pushes name nobody: they fall on a locked screen.
 */
@Injectable()
export class AuxApplicationsService {
  private readonly logger = new Logger(AuxApplicationsService.name);

  constructor(
    @InjectRepository(AuxPioneerApplication)
    private readonly apps: Repository<AuxPioneerApplication>,
    @InjectRepository(AuxPioneerApplicationSeat)
    private readonly seats: Repository<AuxPioneerApplicationSeat>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Absence)
    private readonly absences: Repository<Absence>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly aux: AuxiliaryPioneersService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
    private readonly clock: CongregationClock,
    private readonly year: AuxYearService,
  ) {}

  // ---------------------------------------------------------------- who

  /** The holders of each place, by user. */
  private async holders(
    congregationId: string,
  ): Promise<Record<CommitteeSeat, string[]>> {
    const rows = await this.responsibilities.find({
      where: {
        congregationId,
        type: In(Object.values(SEAT_RESP)),
      },
      select: ['type', 'userId'],
    });
    const out = {} as Record<CommitteeSeat, string[]>;
    for (const s of COMMITTEE_SEATS) {
      out[s] = [
        ...new Set(
          rows
            .filter((r) => r.type === SEAT_RESP[s] && r.userId)
            .map((r) => r.userId),
        ),
      ];
    }
    return out;
  }

  /** The congregation's elders who can sign in: user id → their card. */
  private async elders(
    congregationId: string,
  ): Promise<Map<string, Publisher>> {
    const rows = await this.publishers.find({
      where: {
        congregationId,
        appointment: PublisherAppointment.ELDER,
        removedAt: IsNull(),
      },
    });
    return new Map(
      rows.filter((p) => !!p.userId).map((p) => [p.userId as string, p]),
    );
  }

  private async nameOfUser(
    congregationId: string,
    userId: string,
  ): Promise<string> {
    const p = await this.publishers.findOne({
      where: { congregationId, userId },
      withDeleted: true,
    });
    return p?.displayName ?? '—';
  }

  /** Whether the committee is whole — and, for an admin, whom it lacks. */
  async committeeState(
    congregationId: string,
  ): Promise<{ complete: boolean; missing: CommitteeSeat[] }> {
    const h = await this.holders(congregationId);
    const missing = COMMITTEE_SEATS.filter((s) => h[s].length === 0);
    return { complete: missing.length === 0, missing };
  }

  private async isCommittee(
    congregationId: string,
    userId: string,
  ): Promise<boolean> {
    const h = await this.holders(congregationId);
    return COMMITTEE_SEATS.some((s) => h[s].includes(userId));
  }

  // ---------------------------------------------------------------- months

  private async currentMonth(congregationId: string): Promise<string> {
    return (await this.clock.todayFor(congregationId)).slice(0, 7);
  }

  /** The months of an application, checked; the 15-hour ones among them. */
  private async settleMonths(
    congregationId: string,
    publisherId: string,
    input: {
      months: string[];
      untilCancelled?: boolean;
      reducedMonths?: string[];
    },
    opts: { allowPast: boolean },
  ): Promise<{ months: string[]; reduced: string[]; untilCancelled: boolean }> {
    const untilCancelled = input.untilCancelled === true;
    const months = [...new Set((input.months ?? []).map((m) => m.slice(0, 7)))]
      .filter((m) => MONTH.test(m))
      .sort();
    if (months.length === 0 || (untilCancelled && months.length !== 1)) {
      throw new BadRequestException(
        refusal(
          'AUX_APP_MONTHS',
          'Choose the months, or one month to begin with.',
        ),
      );
    }
    const now = await this.currentMonth(congregationId);
    if (!opts.allowPast && months[0] < now) {
      throw new BadRequestException(
        refusal('AUX_APP_MONTH_PAST', 'That month is over.', {
          month: months[0],
        }),
      );
    }
    await this.aux.assertMonthsServable(
      congregationId,
      publisherId,
      months,
      untilCancelled,
    );
    const reduced: string[] = [];
    for (const m of [...new Set(input.reducedMonths ?? [])].sort()) {
      const inside = untilCancelled ? m >= months[0] : months.includes(m);
      if (!inside || !(await this.aux.allowsReduced(congregationId, m))) {
        throw new BadRequestException(
          refusal(
            'AUX_NORM_NOT_ALLOWED',
            'That month does not allow 15 hours.',
            { month: m },
          ),
        );
      }
      reduced.push(m);
    }
    return { months, reduced, untilCancelled };
  }

  // ---------------------------------------------------------------- apply

  /** The applicant's card — refused when there is none, or he is not baptized. */
  private async ownCard(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<Publisher> {
    const card = await this.publishers.findOne({
      where: { congregationId, userId: user.id, removedAt: IsNull() },
    });
    if (!card) {
      throw new BadRequestException(
        refusal(
          'NO_OWN_CARD',
          'Your account is not linked to a publisher card.',
        ),
      );
    }
    if (
      card.appointment === PublisherAppointment.UNBAPTIZED_PUBLISHER ||
      card.appointment === PublisherAppointment.STUDENT
    ) {
      throw new BadRequestException(
        refusal(
          'PIONEER_NOT_BAPTIZED',
          'Only baptized publishers can serve as auxiliary pioneers.',
        ),
      );
    }
    return card;
  }

  async apply(
    congregationId: string,
    user: AuthenticatedUser,
    input: ApplyInput,
  ): Promise<MyApplicationView> {
    if (input.confirmed !== true) {
      throw new BadRequestException(
        refusal('AUX_APP_CONFIRM', 'Confirm the application first.'),
      );
    }
    const card = await this.ownCard(congregationId, user);
    const state = await this.committeeState(congregationId);
    if (!state.complete) {
      throw new ConflictException(
        refusal(
          'AUX_APP_COMMITTEE_INCOMPLETE',
          'The service committee is not complete yet.',
        ),
      );
    }
    const pending = await this.apps.count({
      where: { congregationId, publisherId: card.id, status: 'pending' },
    });
    if (pending > 0) {
      throw new ConflictException(
        refusal(
          'AUX_APP_PENDING_EXISTS',
          'You already have an application waiting.',
        ),
      );
    }
    const settled = await this.settleMonths(congregationId, card.id, input, {
      allowPast: false,
    });
    const app = await this.apps.save(
      this.apps.create({
        congregationId,
        publisherId: card.id,
        months: settled.months,
        untilCancelled: settled.untilCancelled,
        reducedMonths: settled.reduced,
        status: 'pending',
        source: 'app',
        createdBy: user.id,
      }),
    );
    const h = await this.holders(congregationId);
    const now = new Date();
    for (const seat of COMMITTEE_SEATS) {
      // The applicant's own place is another elder's from the start.
      const own = h[seat].includes(user.id);
      await this.seats.save(
        this.seats.create({
          congregationId,
          applicationId: app.id,
          seat,
          openReason: own ? 'applicant' : null,
          openedAt: own ? now : null,
        }),
      );
    }
    await this.audit.logCreate({
      tenantId: congregationId,
      entityType: 'aux_application',
      entityId: app.id,
      actorUserId: user.id,
      subjectId: card.id,
      after: {
        months: app.months,
        untilCancelled: app.untilCancelled,
        reducedMonths: app.reducedMonths,
      },
    });
    const holderIds = COMMITTEE_SEATS.flatMap((s) => h[s]).filter(
      (u) => u !== user.id,
    );
    await this.tell(congregationId, holderIds, 'newApp', app.id, `new`);
    if (COMMITTEE_SEATS.some((s) => h[s].includes(user.id))) {
      await this.tellOpenSeat(congregationId, app.id);
    }
    return this.myView(app, false);
  }

  /** Change it — only while nobody has answered yet. */
  async change(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
    input: ApplyInput,
  ): Promise<MyApplicationView> {
    const card = await this.ownCard(congregationId, user);
    const app = await this.pendingOf(congregationId, id);
    if (app.publisherId !== card.id) throw new NotFoundException();
    const answered = await this.seats.count({
      where: { applicationId: app.id, approvedBy: Not(IsNull()) },
    });
    if (answered > 0) {
      throw new ConflictException(
        refusal(
          'AUX_APP_ANSWERED',
          'The committee has begun to answer; take it back and apply again.',
        ),
      );
    }
    const settled = await this.settleMonths(congregationId, card.id, input, {
      allowPast: false,
    });
    const before = {
      months: app.months,
      untilCancelled: app.untilCancelled,
      reducedMonths: app.reducedMonths,
    };
    app.months = settled.months;
    app.untilCancelled = settled.untilCancelled;
    app.reducedMonths = settled.reduced;
    await this.apps.save(app);
    await this.audit.logUpdate({
      tenantId: congregationId,
      entityType: 'aux_application',
      entityId: app.id,
      actorUserId: user.id,
      subjectId: card.id,
      before,
      after: {
        months: app.months,
        untilCancelled: app.untilCancelled,
        reducedMonths: app.reducedMonths,
      },
      fields: ['months', 'untilCancelled', 'reducedMonths'],
    });
    return this.myView(app, false);
  }

  /** The applicant takes it back: it is gone. */
  async takeBack(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<void> {
    const card = await this.ownCard(congregationId, user);
    const app = await this.pendingOf(congregationId, id);
    if (app.publisherId !== card.id) throw new NotFoundException();
    await this.erase(congregationId, app, user.id);
  }

  /**
   * A brother of the committee takes it back, quietly (Lionel, 29 October
   * 2026): the applicant is not told — the conversation is the committee's,
   * not the app's. The other brothers are, so nobody answers it in vain.
   */
  async withdraw(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<void> {
    const app = await this.pendingOf(congregationId, id);
    if (!(await this.isCommittee(congregationId, user.id))) {
      throw new ForbiddenException(
        refusal(
          'AUX_APP_COMMITTEE_ONLY',
          'Only the service committee may do this.',
        ),
      );
    }
    const h = await this.holders(congregationId);
    const answered = (
      await this.seats.find({ where: { applicationId: app.id } })
    )
      .map((s) => s.approvedBy)
      .filter((u): u is string => !!u);
    const told = [
      ...new Set([...COMMITTEE_SEATS.flatMap((s) => h[s]), ...answered]),
    ].filter((u) => u !== user.id);
    const applicantUser = await this.applicantUser(app);
    await this.erase(congregationId, app, user.id);
    await this.tell(
      congregationId,
      told.filter((u) => u !== applicantUser),
      'withdrawn',
      null,
      `withdrawn:${app.id}`,
    );
  }

  private async erase(
    congregationId: string,
    app: AuxPioneerApplication,
    actorUserId: string | null,
  ): Promise<void> {
    await this.audit.logEvent({
      tenantId: congregationId,
      entityType: 'aux_application',
      entityId: app.id,
      action: 'DELETE',
      actorUserId,
      subjectId: app.publisherId,
      // A bare line: who did it is the actor (none when the night cleared
      // it); why is nobody's business here.
    });
    await this.apps.delete({ id: app.id, congregationId });
  }

  private async pendingOf(
    congregationId: string,
    id: string,
  ): Promise<AuxPioneerApplication> {
    const app = await this.apps.findOne({ where: { id, congregationId } });
    if (!app) throw new NotFoundException();
    if (app.status !== 'pending') {
      throw new ConflictException(
        refusal(
          'AUX_APP_DECIDED',
          'This application has already been approved.',
        ),
      );
    }
    return app;
  }

  private async applicantUser(
    app: AuxPioneerApplication,
  ): Promise<string | null> {
    const p = await this.publishers.findOne({
      where: { id: app.publisherId },
      withDeleted: true,
      select: ['id', 'userId'],
    });
    return p?.userId ?? null;
  }

  // ---------------------------------------------------------------- answer

  /**
   * Who could still answer in an open place: an elder who can sign in, is
   * not the applicant and holds no other place of this application — by his
   * answer or by his responsibility.
   */
  private substitutesFor(
    elders: Map<string, Publisher>,
    applicantUser: string | null,
    seats: AuxPioneerApplicationSeat[],
    holders: Record<CommitteeSeat, string[]>,
    seat: CommitteeSeat,
  ): string[] {
    const answeredBy = new Set(
      seats.filter((s) => s.approvedBy).map((s) => s.approvedBy as string),
    );
    // A holder of a place that is still his to answer keeps to that place.
    const holdingOther = new Set(
      seats
        .filter((s) => s.seat !== seat && !s.openReason && !s.approvedBy)
        .flatMap((s) => holders[s.seat]),
    );
    // A brother who passed his place on, or is away, does not answer in it.
    const own = seats.find((s) => s.seat === seat);
    const stepsAside = new Set(
      own && (own.openReason === 'passed' || own.openReason === 'absent')
        ? [...holders[seat], ...(own.openedBy ? [own.openedBy] : [])]
        : [],
    );
    return [...elders.keys()].filter(
      (u) =>
        u !== applicantUser &&
        !answeredBy.has(u) &&
        !holdingOther.has(u) &&
        !stepsAside.has(u),
    );
  }

  /**
   * His own place to answer: held by him and not yet answered — also when it
   * was opened because he is away, for he may still answer from afar.
   */
  private isHisToAnswer(
    s: AuxPioneerApplicationSeat,
    holders: Record<CommitteeSeat, string[]>,
    userId: string,
  ): boolean {
    return (
      !s.approvedBy &&
      holders[s.seat].includes(userId) &&
      (!this.isOpen(s, holders) || s.openReason === 'absent')
    );
  }

  /** Open: by reason, or because nobody holds it any more. */
  private isOpen(
    s: AuxPioneerApplicationSeat,
    holders: Record<CommitteeSeat, string[]>,
  ): boolean {
    return !!s.openReason || holders[s.seat].length === 0;
  }

  async approve(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
    seatAsked?: CommitteeSeat,
  ): Promise<ApplicationView> {
    const app = await this.pendingOf(congregationId, id);
    const seats = await this.seats.find({ where: { applicationId: app.id } });
    const h = await this.holders(congregationId);
    const elders = await this.elders(congregationId);
    const applicantUser = await this.applicantUser(app);
    if (user.id === applicantUser) {
      throw new ForbiddenException(
        refusal('AUX_APP_OWN', 'Your own application is answered by others.'),
      );
    }
    if (seats.some((s) => s.approvedBy === user.id)) {
      throw new ConflictException(
        refusal('AUX_APP_ALREADY_ANSWERED', 'You have already answered it.'),
      );
    }
    // His own place first, then the open one he chose.
    const mine = seats.find((s) => this.isHisToAnswer(s, h, user.id));
    let target = mine;
    if (!target) {
      const open = seats.filter((s) => !s.approvedBy && this.isOpen(s, h));
      target = seatAsked
        ? open.find((s) => s.seat === seatAsked)
        : open.length === 1
          ? open[0]
          : undefined;
      if (
        target &&
        !this.substitutesFor(
          elders,
          applicantUser,
          seats,
          h,
          target.seat,
        ).includes(user.id)
      ) {
        target = undefined;
      }
    }
    if (!target) {
      throw new ForbiddenException(
        refusal(
          'AUX_APP_NO_SEAT',
          'There is no place here for you to answer in.',
        ),
      );
    }
    target.approvedBy = user.id;
    target.approvedAt = new Date();
    target.approverName = await this.nameOfUser(congregationId, user.id);
    try {
      await this.seats.save(target);
    } catch {
      // Two at once for the same place, or the same brother twice: the
      // database lets one through.
      throw new ConflictException(
        refusal(
          'AUX_APP_ALREADY_ANSWERED',
          'This place has just been answered.',
        ),
      );
    }
    await this.audit.logRawUpdate({
      tenantId: congregationId,
      entityType: 'aux_application',
      entityId: app.id,
      actorUserId: user.id,
      subjectId: app.publisherId,
      changedFields: ['approvedSeat'],
      before: { approvedSeat: null },
      after: { approvedSeat: target.seat },
    });
    await this.settleIfDone(congregationId, app, user.id);
    return this.view(congregationId, user, app.id);
  }

  /** The holder passes his place on to the other elders. */
  async pass(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<ApplicationView> {
    const app = await this.pendingOf(congregationId, id);
    const seats = await this.seats.find({ where: { applicationId: app.id } });
    const h = await this.holders(congregationId);
    const mine = seats.find((s) => this.isHisToAnswer(s, h, user.id));
    if (!mine) {
      throw new ForbiddenException(
        refusal(
          'AUX_APP_NO_SEAT',
          'There is no place here for you to answer in.',
        ),
      );
    }
    await this.openSeat(congregationId, app, mine, 'passed', user.id);
    return this.view(congregationId, user, app.id);
  }

  /**
   * Another brother of the committee opens a place that has waited three
   * days — its holder may be the one who is away.
   */
  async openOther(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
    seat: CommitteeSeat,
  ): Promise<ApplicationView> {
    const app = await this.pendingOf(congregationId, id);
    const seats = await this.seats.find({ where: { applicationId: app.id } });
    const h = await this.holders(congregationId);
    const target = seats.find((s) => s.seat === seat);
    const otherOfCommittee = COMMITTEE_SEATS.some(
      (s) => s !== seat && h[s].includes(user.id),
    );
    if (
      !target ||
      target.approvedBy ||
      this.isOpen(target, h) ||
      !otherOfCommittee
    ) {
      throw new ForbiddenException(
        refusal('AUX_APP_NO_SEAT', 'There is no place here for you to open.'),
      );
    }
    if (
      Date.now() - app.createdAt.getTime() <
      AUX_SEAT_WAIT_DAYS * 86_400_000
    ) {
      throw new ConflictException(
        refusal(
          'AUX_APP_TOO_EARLY',
          'A place may be opened after three days without an answer.',
          { days: AUX_SEAT_WAIT_DAYS },
        ),
      );
    }
    await this.openSeat(congregationId, app, target, 'opened', user.id);
    return this.view(congregationId, user, app.id);
  }

  private async openSeat(
    congregationId: string,
    app: AuxPioneerApplication,
    seat: AuxPioneerApplicationSeat,
    reason: 'passed' | 'absent' | 'opened',
    by: string | null,
  ): Promise<void> {
    seat.openReason = reason;
    seat.openedAt = new Date();
    seat.openedBy = by;
    await this.seats.save(seat);
    await this.audit.logRawUpdate({
      tenantId: congregationId,
      entityType: 'aux_application',
      entityId: app.id,
      actorUserId: by,
      subjectId: app.publisherId,
      changedFields: ['openedSeat'],
      before: { openedSeat: null },
      after: { openedSeat: seat.seat },
    });
    await this.tellOpenSeat(congregationId, app.id);
    // An open place nobody can fill: two answers may already be enough.
    await this.settleIfDone(congregationId, app, by);
  }

  /** Every place answered — or the rest cannot be filled and two have been. */
  private async settleIfDone(
    congregationId: string,
    app: AuxPioneerApplication,
    actorUserId: string | null,
  ): Promise<void> {
    const seats = await this.seats.find({ where: { applicationId: app.id } });
    const h = await this.holders(congregationId);
    const elders = await this.elders(congregationId);
    const applicantUser = await this.applicantUser(app);
    const answered = seats.filter((s) => s.approvedBy).length;
    const left = seats.filter((s) => !s.approvedBy);
    const done =
      left.length === 0 ||
      (answered >= 2 &&
        left.every(
          (s) =>
            this.isOpen(s, h) &&
            this.substitutesFor(elders, applicantUser, seats, h, s.seat)
              .length === 0,
        ));
    if (done) await this.approveApplication(congregationId, app, actorUserId);
  }

  /**
   * Approved: the periods are made — each run of months one after another a
   * period, «until cancelled» one open period — leaving out a month already
   * closed for the branch or covered meanwhile. The applicant is told.
   */
  private async approveApplication(
    congregationId: string,
    app: AuxPioneerApplication,
    actorUserId: string | null,
  ): Promise<void> {
    const closed = await this.aux.closedAmong(congregationId, app.months);
    const months = app.months.filter((m) => !closed.has(m));
    const periodIds: string[] = [];
    const runs = app.untilCancelled
      ? months.length
        ? [{ start: months[0], end: null as string | null }]
        : []
      : toRuns(months);
    for (const r of runs) {
      try {
        const p = await this.aux.createFromApplication(
          congregationId,
          actorUserId,
          app.publisherId,
          { start: r.start, end: r.end, untilCancelled: app.untilCancelled },
          app.reducedMonths,
        );
        periodIds.push(p.id);
      } catch (err) {
        // A month covered meanwhile by a period entered by hand: that run is
        // already served; the rest still are.
        this.logger.warn(
          `application ${app.id}: run ${r.start}–${r.end ?? '∞'} not made: ${String(err)}`,
        );
      }
    }
    app.status = 'approved';
    app.approvedAt = new Date();
    app.periodIds = periodIds;
    await this.apps.save(app);
    await this.audit.logRawUpdate({
      tenantId: congregationId,
      entityType: 'aux_application',
      entityId: app.id,
      actorUserId,
      subjectId: app.publisherId,
      changedFields: ['status'],
      before: { status: 'pending' },
      after: { status: 'approved' },
    });
    const u = await this.applicantUser(app);
    if (app.source === 'app' && u) {
      await this.tell(congregationId, [u], 'approved', app.id, 'approved');
    }
    // A report already in for one of these months, without hours: he is
    // asked to add them — the month now wants them.
    if (u) {
      const missing = (
        await this.year.reportsWithoutHours(congregationId, app.publisherId)
      ).filter((r) => months.includes(r.month));
      for (const r of missing) {
        await this.askHours(congregationId, u, r.reportId, r.month);
      }
    }
  }

  private async askHours(
    congregationId: string,
    userId: string,
    reportId: string,
    month: string,
  ): Promise<void> {
    try {
      await this.notifications.notify({
        tenantId: congregationId,
        userIds: [userId],
        text: (l) => ({ title: STR[l].title, body: STR[l].reportHours }),
        kind: 'aux_application_approved',
        key: `aux-hours:${reportId}`,
        data: {
          type: 'aux_report_hours',
          reportId,
          reportMonth: `${month}-01`,
        },
      });
    } catch (err) {
      this.logger.warn(`aux hours notice not sent: ${String(err)}`);
    }
  }

  // ---------------------------------------------------------------- paper

  /**
   * A signed paper form, entered by the secretary or an admin: approved as
   * it is, with the brothers who signed it — no answering in the app.
   */
  async enterPaper(
    congregationId: string,
    user: AuthenticatedUser,
    input: PaperInput,
  ): Promise<ApplicationView> {
    const may =
      user.role === UserRole.ADMIN ||
      (await this.holders(congregationId)).secretary.includes(user.id);
    if (!may) {
      throw new ForbiddenException(
        refusal(
          'AUX_APP_PAPER_SECRETARY',
          'Only the secretary or an admin enters a paper.',
        ),
      );
    }
    const card = await this.publishers.findOne({
      where: { id: input.publisherId, congregationId, removedAt: IsNull() },
    });
    if (!card) throw new NotFoundException();
    if (
      card.appointment === PublisherAppointment.UNBAPTIZED_PUBLISHER ||
      card.appointment === PublisherAppointment.STUDENT
    ) {
      throw new BadRequestException(
        refusal(
          'PIONEER_NOT_BAPTIZED',
          'Only baptized publishers can serve as auxiliary pioneers.',
        ),
      );
    }
    const signers = (input.signers ?? []).filter(
      (s) => COMMITTEE_SEATS.includes(s.seat) && (s.userId || s.name?.trim()),
    );
    const seatsNamed = new Set(signers.map((s) => s.seat));
    const usersNamed = signers.filter((s) => s.userId).map((s) => s.userId);
    if (
      signers.length < 2 ||
      seatsNamed.size !== signers.length ||
      new Set(usersNamed).size !== usersNamed.length
    ) {
      throw new BadRequestException(
        refusal(
          'AUX_APP_SIGNERS',
          'Name at least two brothers who signed, each once.',
        ),
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paperDate ?? '')) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'The date the paper was signed.', {
          fields: [{ field: 'paperDate', rules: ['isISO8601'] }],
        }),
      );
    }
    const settled = await this.settleMonths(congregationId, card.id, input, {
      allowPast: true,
    });
    const app = await this.apps.save(
      this.apps.create({
        congregationId,
        publisherId: card.id,
        months: settled.months,
        untilCancelled: settled.untilCancelled,
        reducedMonths: settled.reduced,
        status: 'pending',
        source: 'paper',
        createdBy: user.id,
        paperDate: input.paperDate,
      }),
    );
    for (const seat of COMMITTEE_SEATS) {
      const sg = signers.find((s) => s.seat === seat);
      await this.seats.save(
        this.seats.create({
          congregationId,
          applicationId: app.id,
          seat,
          approvedBy: sg?.userId ?? null,
          approvedAt: sg ? new Date(`${input.paperDate}T12:00:00Z`) : null,
          approverName: sg
            ? sg.userId
              ? await this.nameOfUser(congregationId, sg.userId)
              : sg.name!.trim()
            : null,
          // A place the paper has no signature in: two signed.
          openReason: sg ? null : 'opened',
        }),
      );
    }
    await this.audit.logCreate({
      tenantId: congregationId,
      entityType: 'aux_application',
      entityId: app.id,
      actorUserId: user.id,
      subjectId: card.id,
      after: {
        months: app.months,
        untilCancelled: app.untilCancelled,
        reducedMonths: app.reducedMonths,
        paperDate: app.paperDate,
      },
    });
    await this.approveApplication(congregationId, app, user.id);
    return this.view(congregationId, user, app.id);
  }

  // ---------------------------------------------------------------- read

  private myView(
    app: AuxPioneerApplication,
    answered: boolean,
  ): MyApplicationView {
    return {
      id: app.id,
      months: app.months,
      untilCancelled: app.untilCancelled,
      reducedMonths: app.reducedMonths,
      status: app.status,
      createdAt: app.createdAt.toISOString(),
      approvedAt: app.approvedAt ? app.approvedAt.toISOString() : null,
      answered,
    };
  }

  /** The applicant's own applications, newest first. */
  async mine(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<{
    applications: MyApplicationView[];
    committeeComplete: boolean;
    /** His reports for months now of auxiliary service, without hours. */
    reportsWithoutHours: { reportId: string; month: string }[];
  }> {
    const card = await this.publishers.findOne({
      where: { congregationId, userId: user.id, removedAt: IsNull() },
    });
    const state = await this.committeeState(congregationId);
    if (!card)
      return {
        applications: [],
        committeeComplete: state.complete,
        reportsWithoutHours: [],
      };
    const rows = await this.apps.find({
      where: { congregationId, publisherId: card.id },
      order: { createdAt: 'DESC' },
    });
    const answeredIds = new Set(
      rows.length
        ? (
            await this.seats.find({
              where: {
                applicationId: In(rows.map((r) => r.id)),
                approvedBy: Not(IsNull()),
              },
              select: ['applicationId'],
            })
          ).map((s) => s.applicationId)
        : [],
    );
    return {
      applications: rows.map((r) => this.myView(r, answeredIds.has(r.id))),
      committeeComplete: state.complete,
      reportsWithoutHours: await this.year.reportsWithoutHours(
        congregationId,
        card.id,
      ),
    };
  }

  /** Who may read an application: the committee, an elder for an open place, an admin. */
  private async readable(
    congregationId: string,
    user: AuthenticatedUser,
    app: AuxPioneerApplication,
    seats: AuxPioneerApplicationSeat[],
    h: Record<CommitteeSeat, string[]>,
    elders: Map<string, Publisher>,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    if (COMMITTEE_SEATS.some((s) => h[s].includes(user.id))) return true;
    if (seats.some((s) => s.approvedBy === user.id)) return true;
    if (app.status !== 'pending' || !elders.has(user.id)) return false;
    const applicantUser = await this.applicantUser(app);
    return seats.some(
      (s) =>
        !s.approvedBy &&
        this.isOpen(s, h) &&
        this.substitutesFor(elders, applicantUser, seats, h, s.seat).includes(
          user.id,
        ),
    );
  }

  async view(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<ApplicationView> {
    const app = await this.apps.findOne({ where: { id, congregationId } });
    if (!app) throw new NotFoundException();
    const seats = await this.seats.find({ where: { applicationId: app.id } });
    const h = await this.holders(congregationId);
    const elders = await this.elders(congregationId);
    if (!(await this.readable(congregationId, user, app, seats, h, elders))) {
      throw new NotFoundException();
    }
    return this.shape(congregationId, user, app, seats, h, elders);
  }

  private async shape(
    congregationId: string,
    user: AuthenticatedUser,
    app: AuxPioneerApplication,
    seats: AuxPioneerApplicationSeat[],
    h: Record<CommitteeSeat, string[]>,
    elders: Map<string, Publisher>,
  ): Promise<ApplicationView> {
    const card = await this.publishers.findOne({
      where: { id: app.publisherId },
      withDeleted: true,
      relations: { serviceGroup: true },
    });
    const applicantUser = card?.userId ?? null;
    const names = new Map<string, string>();
    for (const p of elders.values())
      names.set(p.userId as string, p.displayName);
    const pending = app.status === 'pending';
    const isCommittee = COMMITTEE_SEATS.some((s) => h[s].includes(user.id));
    const answeredByMe = seats.some((s) => s.approvedBy === user.id);
    const ordered = COMMITTEE_SEATS.map(
      (s) => seats.find((x) => x.seat === s)!,
    ).filter(Boolean);
    const mine = ordered.find((s) => this.isHisToAnswer(s, h, user.id));
    const openForMe =
      pending && !answeredByMe && user.id !== applicantUser
        ? ordered
            .filter(
              (s) =>
                !s.approvedBy &&
                this.isOpen(s, h) &&
                this.substitutesFor(
                  elders,
                  applicantUser,
                  seats,
                  h,
                  s.seat,
                ).includes(user.id),
            )
            .map((s) => s.seat)
        : [];
    const waitedLong =
      Date.now() - app.createdAt.getTime() >= AUX_SEAT_WAIT_DAYS * 86_400_000;
    return {
      id: app.id,
      publisherId: app.publisherId,
      publisherName: card?.displayName ?? '—',
      groupName:
        (card as unknown as { serviceGroup?: { name?: string } } | null)
          ?.serviceGroup?.name ?? null,
      months: app.months,
      untilCancelled: app.untilCancelled,
      reducedMonths: app.reducedMonths,
      status: app.status,
      source: app.source,
      paperDate: app.paperDate,
      createdAt: app.createdAt.toISOString(),
      approvedAt: app.approvedAt ? app.approvedAt.toISOString() : null,
      seats: ordered.map((s) => ({
        seat: s.seat,
        holders: h[s.seat].map((u) => ({
          userId: u,
          name: names.get(u) ?? '—',
        })),
        open: this.isOpen(s, h),
        openReason: s.openReason,
        openedAt: s.openedAt ? s.openedAt.toISOString() : null,
        approved:
          !!s.approvedBy || (!!s.approverName && app.source === 'paper'),
        approvedAt: s.approvedAt ? s.approvedAt.toISOString() : null,
        approverName: s.approverName,
        unfillable:
          !s.approvedBy &&
          this.isOpen(s, h) &&
          this.substitutesFor(elders, applicantUser, seats, h, s.seat)
            .length === 0,
      })),
      can: {
        approveSeat:
          pending && mine && user.id !== applicantUser ? mine.seat : null,
        approveOpenSeats: mine ? [] : openForMe,
        pass: pending && !!mine,
        openSeats:
          pending && isCommittee && waitedLong
            ? ordered
                .filter(
                  (s) =>
                    !s.approvedBy &&
                    !this.isOpen(s, h) &&
                    !h[s.seat].includes(user.id),
                )
                .map((s) => s.seat)
            : [],
        withdraw: pending && isCommittee,
      },
    };
  }

  /**
   * The applications this reader is to see: for the committee, every one
   * waiting and those approved in the last two months; for another elder,
   * only those with a place he could answer in.
   */
  async list(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<ApplicationView[]> {
    const since = new Date(Date.now() - 62 * 86_400_000);
    const rows = await this.apps.find({
      where: [
        { congregationId, status: 'pending' },
        { congregationId, status: 'approved', approvedAt: MoreThan(since) },
      ],
      order: { createdAt: 'ASC' },
    });
    if (rows.length === 0) return [];
    const allSeats = await this.seats.find({
      where: { applicationId: In(rows.map((r) => r.id)) },
    });
    const h = await this.holders(congregationId);
    const elders = await this.elders(congregationId);
    const out: ApplicationView[] = [];
    for (const app of rows) {
      const seats = allSeats.filter((s) => s.applicationId === app.id);
      if (!(await this.readable(congregationId, user, app, seats, h, elders)))
        continue;
      out.push(await this.shape(congregationId, user, app, seats, h, elders));
    }
    return out;
  }

  /** How many wait for THIS reader's answer — for «Нужно сделать». */
  async waitingFor(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<{ id: string; name: string; firstMonth: string }[]> {
    const list = (await this.list(congregationId, user)).filter(
      (a) =>
        a.status === 'pending' &&
        (a.can.approveSeat !== null || a.can.approveOpenSeats.length > 0),
    );
    return list.map((a) => ({
      id: a.id,
      name: a.publisherName,
      firstMonth: a.months[0],
    }));
  }

  /** A publisher's approved applications — for his card. */
  async approvedFor(
    congregationId: string,
    publisherId: string,
  ): Promise<
    {
      id: string;
      months: string[];
      untilCancelled: boolean;
      reducedMonths: string[];
      source: 'app' | 'paper';
      paperDate: string | null;
      approvedAt: string | null;
      signers: string[];
    }[]
  > {
    const rows = await this.apps.find({
      where: { congregationId, publisherId, status: 'approved' },
      order: { approvedAt: 'DESC' },
    });
    if (rows.length === 0) return [];
    const seats = await this.seats.find({
      where: { applicationId: In(rows.map((r) => r.id)) },
    });
    return rows.map((r) => ({
      id: r.id,
      months: r.months,
      untilCancelled: r.untilCancelled,
      reducedMonths: r.reducedMonths,
      source: r.source,
      paperDate: r.paperDate,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      signers: COMMITTEE_SEATS.map(
        (s) =>
          seats.find((x) => x.applicationId === r.id && x.seat === s)
            ?.approverName,
      ).filter((n): n is string => !!n),
    }));
  }

  // ---------------------------------------------------------------- night

  async runDaily(): Promise<void> {
    const all = await this.congregations.find({ select: { id: true } });
    for (const c of all) {
      try {
        await this.runFor(c.id);
      } catch (err) {
        this.logger.error(`aux applications ${c.id}: ${String(err)}`);
      }
    }
  }

  /**
   * Each night: an application whose months are all over leaves quietly; a
   * place three days without an answer is reminded once — and opened to the
   * other elders when its holder is written away today.
   */
  async runFor(congregationId: string, now = new Date()): Promise<void> {
    const pending = await this.apps.find({
      where: { congregationId, status: 'pending' },
    });
    if (pending.length === 0) return;
    const today = await this.clock.todayFor(congregationId);
    const month = today.slice(0, 7);
    const h = await this.holders(congregationId);
    const cutoff = new Date(now.getTime() - AUX_SEAT_WAIT_DAYS * 86_400_000);
    for (const app of pending) {
      const last = app.untilCancelled
        ? app.months[0]
        : app.months[app.months.length - 1];
      if (last < month) {
        await this.erase(congregationId, app, null);
        continue;
      }
      if (app.createdAt > cutoff) continue;
      const seats = await this.seats.find({
        where: { applicationId: app.id, approvedBy: IsNull() },
      });
      for (const s of seats) {
        if (this.isOpen(s, h)) continue;
        const holders = h[s.seat];
        if (await this.allAway(congregationId, holders, today)) {
          await this.openSeat(congregationId, app, s, 'absent', null);
          continue;
        }
        if (!s.remindedAt) {
          s.remindedAt = now;
          await this.seats.save(s);
          await this.tell(
            congregationId,
            holders,
            'reminder',
            app.id,
            `reminder:${s.seat}`,
          );
        }
      }
    }
  }

  private async allAway(
    congregationId: string,
    userIds: string[],
    today: string,
  ): Promise<boolean> {
    if (userIds.length === 0) return false;
    const cards = await this.publishers.find({
      where: { congregationId, userId: In(userIds) },
      select: ['id'],
    });
    if (cards.length === 0) return false;
    for (const c of cards) {
      const away = await this.absences.count({
        where: [
          {
            publisherId: c.id,
            startDate: LessThanOrEqual(today),
            endDate: MoreThanOrEqual(today),
          },
          { publisherId: c.id, startDate: today, endDate: IsNull() },
        ],
      });
      if (away === 0) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- stop

  /**
   * He ends his own «until cancelled» — no approval; the three brothers of
   * the committee are told, without his name on a locked screen.
   */
  async stopOwn(
    congregationId: string,
    user: AuthenticatedUser,
    endMonth: string,
  ): Promise<{ endMonth: string | null }> {
    const { period } = await this.aux.stopOwn(congregationId, user, endMonth);
    const h = await this.holders(congregationId);
    await this.tell(
      congregationId,
      COMMITTEE_SEATS.flatMap((s) => h[s]).filter((u) => u !== user.id),
      'stopped',
      null,
      `stop:${period.id}:${String(period.endMonth).slice(0, 7)}`,
    );
    return { endMonth: period.endMonth };
  }

  // ---------------------------------------------------------------- tell

  private async tellOpenSeat(
    congregationId: string,
    appId: string,
  ): Promise<void> {
    const app = await this.apps.findOne({ where: { id: appId } });
    if (!app) return;
    const seats = await this.seats.find({ where: { applicationId: appId } });
    const h = await this.holders(congregationId);
    const elders = await this.elders(congregationId);
    const applicantUser = await this.applicantUser(app);
    const who = new Set<string>();
    for (const s of seats) {
      if (s.approvedBy || !this.isOpen(s, h)) continue;
      for (const u of this.substitutesFor(
        elders,
        applicantUser,
        seats,
        h,
        s.seat,
      )) {
        who.add(u);
      }
    }
    await this.tell(congregationId, [...who], 'seatOpen', appId, 'open');
  }

  private async tell(
    congregationId: string,
    userIds: string[],
    what:
      | 'newApp'
      | 'seatOpen'
      | 'reminder'
      | 'withdrawn'
      | 'approved'
      | 'stopped',
    appId: string | null,
    keyPart: string,
  ): Promise<void> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return;
    try {
      await this.notifications.notify({
        tenantId: congregationId,
        userIds: ids,
        text: (l) => ({ title: STR[l].title, body: STR[l][what] }),
        kind:
          what === 'approved' ? 'aux_application_approved' : 'aux_application',
        key: `aux-app:${appId ?? keyPart}:${keyPart}`,
        data: {
          type:
            what === 'approved'
              ? 'aux_application_approved'
              : what === 'stopped'
                ? 'aux_stopped'
                : 'aux_application',
          ...(appId && what !== 'withdrawn' && what !== 'stopped'
            ? { applicationId: appId }
            : {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `aux application notice (${what}) not sent: ${String(err)}`,
      );
    }
  }
}

/** Months one after another, as runs: ['2027-03','2027-04','2027-06'] → two. */
export function toRuns(months: string[]): { start: string; end: string }[] {
  const sorted = [...new Set(months)].sort();
  const out: { start: string; end: string }[] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && nextMonth(last.end) === m) last.end = m;
    else out.push({ start: m, end: m });
  }
  return out;
}

function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
