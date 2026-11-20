import { countProgramme } from './readiness.service';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';

/**
 * What counts as a part of the programme (programme audit, 20 November
 * 2026): the hospitality line does not — a weekend whose hospitality sister
 * was taken away stayed «not ready» for good, and the duties' month waited.
 */
describe('countProgramme', () => {
  const row = (partKey: string, publisherId: string | null = null) => ({
    partKey,
    status: AssignmentStatus.PUBLISHED,
    publisherId,
    speakerName: null,
  });

  it('the hospitality line is no part of the programme', () => {
    expect(
      countProgramme([
        row('weekend_chairman', 'p1'),
        row('weekend_hospitality'),
      ]),
    ).toEqual({ loaded: true, assigned: 1, total: 1, missing: [] });
  });

  it('songs and the overseer’s service talk are not counted either', () => {
    expect(
      countProgramme([
        row('mid_song'),
        row('co_service_talk'),
        row('midweek_chairman'),
      ]),
    ).toEqual({
      loaded: true,
      assigned: 0,
      total: 1,
      missing: ['midweek_chairman'],
    });
  });

  it('in the overseer’s visit the closing prayer is his, not to assign (п. 21)', () => {
    expect(
      countProgramme([
        row('midweek_chairman', 'p1'),
        row('co_service_talk'),
        row('midweek_closing_prayer'),
      ]),
    ).toEqual({ loaded: true, assigned: 1, total: 1, missing: [] });
    // A brother named for it all the same still counts.
    expect(
      countProgramme([
        row('co_service_talk'),
        row('midweek_closing_prayer', 'p2'),
      ]),
    ).toEqual({ loaded: true, assigned: 1, total: 1, missing: [] });
    // Any other week: the prayer is a part like the others.
    expect(countProgramme([row('midweek_closing_prayer')]).missing).toEqual([
      'midweek_closing_prayer',
    ]);
  });
});
