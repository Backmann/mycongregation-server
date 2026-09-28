import { RestrictedScheduleService } from './restricted-schedule.service';

/**
 * «Едет 25 октября в Unna-Russisch, речь №87» while №87 is withdrawn from
 * 1 September — the Android pass of 28 September. Found, and only on the
 * dates the talk is really unavailable.
 */
describe('RestrictedScheduleService', () => {
  const talk87 = {
    id: 't87',
    number: 87,
    title: 'Речь 87',
    isActive: false,
    retiredFrom: '2026-09-01',
    retiredUntil: null,
  };
  const talk90 = {
    id: 't90',
    number: 90,
    title: 'Речь 90',
    isActive: false,
    retiredFrom: '2026-12-01',
    retiredUntil: null,
  };
  const build = (uses: unknown[], exchange: unknown[] = []) => {
    const talks = { scheduledAfter: jest.fn().mockResolvedValue(uses) };
    const talkRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          talk87,
          talk90,
          { id: 't1', number: 1, isActive: true, retiredFrom: null },
        ]),
    };
    const exchangeRepo = { find: jest.fn().mockResolvedValue(exchange) };
    const publishersRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 'p1', displayName: 'Бакманн Лионель' }]),
    };
    const congregationsRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'c1', name: 'Unna-Russisch' }]),
    };
    const clock = { todayFor: jest.fn().mockResolvedValue('2026-09-28') };
    const svc = new RestrictedScheduleService(
      talks as never,
      talkRepo as never,
      exchangeRepo as never,
      publishersRepo as never,
      congregationsRepo as never,
      clock as never,
    );
    return { svc, talks, publishersRepo, congregationsRepo };
  };

  it('finds our brother travelling with a withdrawn talk, and names him', async () => {
    const { svc, talks, publishersRepo } = build(
      [
        {
          publicTalkId: 't87',
          weekStartDate: '2026-10-19',
          meetingDate: '2026-10-25',
          speakerName: null,
          speakerCongregation: null,
          source: 'outgoing',
        },
      ],
      [
        {
          date: '2026-10-25',
          publicTalkId: 't87',
          publisherId: 'p1',
          hostCongregationId: 'c1',
        },
      ],
    );
    const out = await svc.find('cong-1');
    // Only restricted talks are asked about, from today.
    expect(talks.scheduledAfter).toHaveBeenCalledWith(
      'cong-1',
      ['t87', 't90'],
      '2026-09-28',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      talkNumber: 87,
      restriction: { state: 'withdrawn', from: '2026-09-01' },
      publisherName: 'Бакманн Лионель',
      hostCongregationName: 'Unna-Russisch',
    });
    expect(publishersRepo.find.mock.calls[0][0].where.congregationId).toBe(
      'cong-1',
    );
  });

  it('keeps quiet about a talk withdrawn only from a later date', async () => {
    const { svc } = build([
      {
        publicTalkId: 't90',
        weekStartDate: '2026-11-02',
        meetingDate: '2026-11-08',
        speakerName: 'Гость',
        speakerCongregation: 'Hamm',
        source: 'incoming',
      },
    ]);
    expect(await svc.find('cong-1')).toEqual([]);
  });

  it('says a promise once when the log is copied into the programme', async () => {
    const same = {
      publicTalkId: 't87',
      weekStartDate: '2026-11-09',
      meetingDate: '2026-11-15',
      speakerName: 'Гость',
      speakerCongregation: 'Hamm',
    };
    const { svc } = build([
      { ...same, source: 'programme' },
      { ...same, source: 'incoming' },
    ]);
    const out = await svc.find('cong-1');
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('incoming');
  });
});
