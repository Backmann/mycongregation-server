import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { ConductAverage } from '../entities/conduct-average.entity';
import type { ConductRunSegment } from '../entities/conduct-run.entity';
import { Song } from '../entities/song.entity';
import type { ConductKind } from '../common/conduct-kind';
import { songNumber } from '../talk-exchange/week-songs';
import {
  MEASURES,
  type Measure,
  measuresOf,
  median,
  sealWeek,
  withWeek,
} from './conduct-averages';

export type ConductAverages = Record<Measure, number | null> & {
  /** How many meetings the numbers come from. */
  meetings: number;
};

/**
 * The numbers the forecast learns from finished meetings (R-76). Written when
 * a meeting's result is saved, taken back with «Это была проба».
 */
@Injectable()
export class ConductAveragesService {
  constructor(
    @InjectRepository(ConductAverage)
    private readonly averages: Repository<ConductAverage>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(Song)
    private readonly songs: Repository<Song>,
  ) {}

  /** The recording's length of each segment's song, by its programme row. */
  private async songSecOf(
    congregationId: string,
    segments: ConductRunSegment[],
  ): Promise<(s: ConductRunSegment) => number | null> {
    const ids = segments
      .map((s) => s.assignmentId)
      .filter((x): x is string => !!x);
    const rows = ids.length
      ? await this.assignments.find({
          where: { id: In(ids), congregationId },
          select: { id: true, partTitle: true },
        })
      : [];
    const numberOf = new Map(rows.map((r) => [r.id, songNumber(r.partTitle)]));
    const numbers = [...numberOf.values()].filter(
      (n): n is number => n !== null,
    );
    const songs = numbers.length
      ? await this.songs.find({
          where: { number: In(numbers) },
          select: { number: true, durationSec: true },
        })
      : [];
    const secOf = new Map(songs.map((s) => [s.number, s.durationSec]));
    return (s) => {
      const n = s.assignmentId ? numberOf.get(s.assignmentId) : null;
      return n ? (secOf.get(n) ?? null) : null;
    };
  }

  /** A finished meeting's numbers in; that week's earlier ones out. */
  async record(
    congregationId: string,
    week: string,
    kind: ConductKind,
    segments: ConductRunSegment[],
  ): Promise<void> {
    const got = measuresOf(
      segments,
      await this.songSecOf(congregationId, segments),
    );
    await this.change(congregationId, kind, true, (values, measure) =>
      withWeek(values, week, got[measure] ?? null),
    );
  }

  /** «Это была проба»: that week teaches nothing. */
  async forget(
    congregationId: string,
    week: string,
    kind: ConductKind,
  ): Promise<void> {
    await this.change(congregationId, kind, false, (values) =>
      withWeek(values, week, null),
    );
  }

  /** The meeting's result is gone (its 4th day): its numbers lose their week. */
  async seal(
    congregationId: string,
    week: string,
    kind: ConductKind,
  ): Promise<void> {
    await this.change(congregationId, kind, false, (values) =>
      sealWeek(values, week),
    );
  }

  /**
   * Every measure changed in one transaction, each row locked while it is read
   * and written: a result and its resend arriving together (conduct-resend)
   * must neither collide on the unique key nor lose one another's numbers.
   */
  private async change(
    congregationId: string,
    kind: ConductKind,
    create: boolean,
    next: (
      values: ConductAverage['values'],
      m: Measure,
    ) => ConductAverage['values'],
  ): Promise<void> {
    await this.averages.manager.transaction(async (m: EntityManager) => {
      const repo = m.getRepository(ConductAverage);
      for (const measure of MEASURES) {
        if (create) {
          await m.query(
            `INSERT INTO conduct_averages (congregation_id, event_type, measure, "values")
             VALUES ($1, $2, $3, '[]'::jsonb)
             ON CONFLICT (congregation_id, event_type, measure) DO NOTHING`,
            [congregationId, kind, measure],
          );
        }
        const row = await repo.findOne({
          where: { congregationId, eventType: kind, measure },
          lock: { mode: 'pessimistic_write' },
        });
        if (!row) continue;
        const values = next(row.values, measure);
        if (JSON.stringify(values) === JSON.stringify(row.values)) continue;
        row.values = values;
        await repo.save(row);
      }
    });
  }

  /** The middle number of each measure, and how many meetings stand behind. */
  async read(
    congregationId: string,
    kind: ConductKind,
  ): Promise<ConductAverages> {
    const rows = await this.averages.find({
      where: { congregationId, eventType: kind },
    });
    const out = { meetings: 0 } as ConductAverages;
    for (const m of MEASURES) {
      const row = rows.find((r) => r.measure === m);
      out[m] = median(row?.values ?? []);
      out.meetings = Math.max(out.meetings, row?.values.length ?? 0);
    }
    return out;
  }
}
