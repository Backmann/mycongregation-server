import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PublicTalk } from '../entities/public-talk.entity';
import { Publisher } from '../entities/publisher.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { TalkExchangeDirection } from '../common/enums/talk-exchange.enum';
import { CongregationClock } from '../common/congregation-clock.service';
import { PublicTalksService, ScheduledUse } from './public-talks.service';
import { talkAvailability, TalkAvailability } from './talk-availability';

/** One promise of a talk that may not be given on its day. */
export interface RestrictedUse extends ScheduledUse {
  talkNumber: number;
  talkTitle: string;
  restriction: Exclude<TalkAvailability, { state: 'available' }>;
  /** Outgoing: our brother who travels, and where to. */
  publisherName: string | null;
  hostCongregationName: string | null;
}

/**
 * Where a talk that is no longer given is still promised (28 September).
 *
 * The Android pass found «Едет 25 октября в Unna-Russisch, речь №87» on «Наши
 * докладчики» while №87 is withdrawn from 1 September — and nothing on any
 * screen said so. The preview before retiring already knew how to look (the
 * programme and both directions of the log); this asks the same question the
 * other way round, for every restricted talk, from today on, and keeps only
 * the dates the talk is actually unavailable on: a talk withdrawn from
 * December is fine in November.
 *
 * Nothing is changed. Arranging a different talk is the coordinator's
 * conversation with the speaker; the app only makes sure it is not missed.
 */
@Injectable()
export class RestrictedScheduleService {
  constructor(
    private readonly talks: PublicTalksService,
    @InjectRepository(PublicTalk)
    private readonly talkRepo: Repository<PublicTalk>,
    @InjectRepository(TalkExchange)
    private readonly exchangeRepo: Repository<TalkExchange>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(ExternalCongregation)
    private readonly congregationsRepo: Repository<ExternalCongregation>,
    private readonly clock: CongregationClock,
  ) {}

  async find(congregationId: string): Promise<RestrictedUse[]> {
    const today = await this.clock.todayFor(congregationId);
    // Restricted in any way: struck out by hand, or carrying dates.
    const restricted = (await this.talkRepo.find()).filter(
      (t) => !t.isActive || !!t.retiredFrom,
    );
    if (restricted.length === 0) return [];
    const byId = new Map(restricted.map((t) => [t.id, t]));

    const uses = await this.talks.scheduledAfter(
      congregationId,
      restricted.map((t) => t.id),
      today,
    );

    // The log is copied into the programme for incoming talks; one promise,
    // said once — the log's line, which knows the speaker.
    const fromLog = new Set(
      uses
        .filter((u) => u.source !== 'programme')
        .map((u) => `${u.meetingDate}|${u.publicTalkId}`),
    );
    const kept = uses.filter(
      (u) =>
        u.source !== 'programme' ||
        !fromLog.has(`${u.meetingDate}|${u.publicTalkId}`),
    );

    // Our brothers and where they go, for the outgoing lines.
    const outgoing = kept.some((u) => u.source === 'outgoing')
      ? await this.exchangeRepo.find({
          where: {
            congregationId,
            direction: TalkExchangeDirection.OUTGOING,
            publicTalkId: In([...byId.keys()]),
          },
        })
      : [];
    const exKey = (date: string, talkId: string | null) => `${date}|${talkId}`;
    const exByKey = new Map(
      outgoing.map((e) => [exKey(e.date, e.publicTalkId), e]),
    );
    const pubIds = [
      ...new Set(outgoing.map((e) => e.publisherId).filter(Boolean)),
    ] as string[];
    const congIds = [
      ...new Set(outgoing.map((e) => e.hostCongregationId).filter(Boolean)),
    ] as string[];
    const [pubs, congs] = await Promise.all([
      pubIds.length
        ? this.publishersRepo.find({
            where: { congregationId, id: In(pubIds) },
          })
        : Promise.resolve([] as Publisher[]),
      congIds.length
        ? this.congregationsRepo.find({
            where: { congregationId, id: In(congIds) },
            withDeleted: true,
          })
        : Promise.resolve([] as ExternalCongregation[]),
    ]);
    const pubName = new Map(pubs.map((p) => [p.id, p.displayName]));
    const congName = new Map(congs.map((c) => [c.id, c.name]));

    const out: RestrictedUse[] = [];
    for (const u of kept) {
      const talk = byId.get(u.publicTalkId);
      if (!talk) continue;
      const restriction = talkAvailability(talk, u.meetingDate);
      if (restriction.state === 'available') continue;
      const ex =
        u.source === 'outgoing'
          ? exByKey.get(exKey(u.meetingDate, u.publicTalkId))
          : undefined;
      out.push({
        ...u,
        talkNumber: talk.number,
        talkTitle: talk.title,
        restriction,
        publisherName: ex?.publisherId
          ? (pubName.get(ex.publisherId) ?? null)
          : null,
        hostCongregationName: ex?.hostCongregationId
          ? (congName.get(ex.hostCongregationId) ?? null)
          : null,
      });
    }
    return out;
  }
}
