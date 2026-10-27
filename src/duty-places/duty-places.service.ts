import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DutyPlace } from '../entities/duty-place.entity';
import { PlaceKind, PlaceSpec, defaultPlaces } from '../duties/duty-places';

/**
 * The congregation's kept places, read and written. Small and on its own so
 * that the readiness count (which says «0 из 8» for a meeting nobody opened)
 * and the duties themselves read ONE template.
 */
@Injectable()
export class DutyPlacesService {
  constructor(
    @InjectRepository(DutyPlace)
    private readonly repo: Repository<DutyPlace>,
    private readonly dataSource: DataSource,
  ) {}

  /** The kept places of one kind, in order — empty when none are kept. */
  async stored(congregationId: string, kind: PlaceKind): Promise<PlaceSpec[]> {
    const rows = await this.repo.find({
      where: { congregationId, meetingKind: kind },
      order: { sortOrder: 'ASC' },
    });
    return rows.map(toSpec);
  }

  /** Both kinds at once, for readers that look at many weeks. */
  async storedAll(
    congregationId: string,
  ): Promise<Record<PlaceKind, PlaceSpec[]>> {
    const rows = await this.repo.find({
      where: { congregationId },
      order: { sortOrder: 'ASC' },
    });
    return {
      midweek: rows.filter((r) => r.meetingKind === 'midweek').map(toSpec),
      weekend: rows.filter((r) => r.meetingKind === 'weekend').map(toSpec),
    };
  }

  /** Replace the kept places of one kind, as one transaction. */
  async replace(
    congregationId: string,
    kind: PlaceKind,
    places: PlaceSpec[],
  ): Promise<PlaceSpec[]> {
    await this.dataSource.transaction(async (m) => {
      await m.delete(DutyPlace, { congregationId, meetingKind: kind });
      await m.insert(
        DutyPlace,
        places.map((p, i) => ({
          congregationId,
          meetingKind: kind,
          dutyType: p.dutyType,
          customLabel: p.customLabel,
          count: p.count,
          sortOrder: i + 1,
          notes: p.notes,
          capability: p.capability,
        })),
      );
    });
    return this.stored(congregationId, kind);
  }
}

/**
 * The places a sheet is cut from: the kept ones, or — while none are kept —
 * the code's list with the microphones of the settings in force.
 */
export function effectivePlaces(
  stored: PlaceSpec[],
  microphones: number | null | undefined,
): PlaceSpec[] {
  return stored.length > 0 ? stored : defaultPlaces(microphones);
}

function toSpec(r: DutyPlace): PlaceSpec {
  return {
    id: r.id,
    dutyType: r.dutyType,
    customLabel: r.customLabel,
    count: r.count,
    notes: r.notes,
    capability: r.capability,
  };
}
