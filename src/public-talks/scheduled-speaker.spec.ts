import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PublicTalk } from '../entities/public-talk.entity';
import { PublicTalksService } from './public-talks.service';
import {
  scheduledSpeakerCongregation,
  scheduledSpeakerName,
} from './scheduled-speaker';

describe('who gives a scheduled talk', () => {
  const card = {
    firstName: 'Марк',
    lastName: 'Вебер',
    externalCongregation: { name: 'Северное' },
  };
  const brother = { displayName: 'Кох Давид', firstName: 'Давид' };

  it('reads the name the coordinator typed', () => {
    expect(scheduledSpeakerName({ speakerName: ' Петров ' })).toBe('Петров');
  });

  it('reads it from the visiting speaker’s card when nothing was typed', () => {
    expect(scheduledSpeakerName({ visitingSpeaker: card })).toBe('Марк Вебер');
    expect(
      scheduledSpeakerName({ speakerName: '  ', visitingSpeaker: card }),
    ).toBe('Марк Вебер');
    expect(
      scheduledSpeakerName({ visitingSpeaker: { firstName: 'Марк' } }),
    ).toBe('Марк');
  });

  it('reads it from our own brother’s card', () => {
    expect(scheduledSpeakerName({ publisher: brother })).toBe('Кох Давид');
    expect(
      scheduledSpeakerName({
        publisher: { displayName: '', firstName: 'Давид', lastName: 'Кох' },
      }),
    ).toBe('Давид Кох');
  });

  it('keeps the typed name over any card', () => {
    expect(
      scheduledSpeakerName({
        speakerName: 'Петров',
        visitingSpeaker: card,
        publisher: brother,
      }),
    ).toBe('Петров');
  });

  it('says nothing when nobody is named', () => {
    expect(scheduledSpeakerName({})).toBeNull();
    expect(
      scheduledSpeakerName({ visitingSpeaker: null, publisher: null }),
    ).toBeNull();
    expect(scheduledSpeakerCongregation({})).toBeNull();
  });

  it('reads the congregation the same way', () => {
    expect(scheduledSpeakerCongregation({ speakerCongregation: 'Юг' })).toBe(
      'Юг',
    );
    expect(scheduledSpeakerCongregation({ visitingSpeaker: card })).toBe(
      'Северное',
    );
  });
});

/**
 * The same through the service — the list a coordinator actually reads. On
 * the live data every incoming line pointed at a card and none carried typed
 * text, so every one of them came out without a name.
 */
describe('PublicTalksService.scheduledAfter — the speaker', () => {
  const talk = { id: 't157', number: 157, title: 'Речь', isActive: true };
  const build = (assignments: unknown[], exchange: unknown[]) => {
    const exchangeRepo = { find: jest.fn(async () => exchange) };
    const assignmentsRepo = { find: jest.fn(async () => assignments) };
    const service = new PublicTalksService(
      {
        find: jest.fn(async () => [talk]),
      } as unknown as Repository<PublicTalk>,
      assignmentsRepo as never,
      exchangeRepo as never,
      {
        find: jest.fn(async () => [
          { effectiveFrom: '2000-01-01', weekendDow: 7 },
        ]),
      } as never,
      { logEvent: jest.fn() } as unknown as AuditLogService,
    );
    return { service, exchangeRepo, assignmentsRepo };
  };

  it('names a visiting speaker chosen by his card', async () => {
    const { service } = build(
      [],
      [
        {
          publicTalkId: 't157',
          date: '2026-11-08',
          direction: 'incoming',
          speakerName: null,
          speakerCongregation: null,
          visitingSpeaker: {
            firstName: 'Марк',
            lastName: 'Вебер',
            externalCongregation: { name: 'Северное' },
          },
          publisher: null,
        },
      ],
    );
    const [use] = await service.scheduledAfter('c1', ['t157'], '2026-10-06');
    expect(use).toMatchObject({
      source: 'incoming',
      speakerName: 'Марк Вебер',
      speakerCongregation: 'Северное',
    });
  });

  it('names our own brother giving it at home', async () => {
    const { service } = build(
      [],
      [
        {
          publicTalkId: 't157',
          date: '2026-11-01',
          direction: 'incoming',
          speakerName: null,
          visitingSpeaker: null,
          publisher: { displayName: 'Кох Давид' },
        },
      ],
    );
    const [use] = await service.scheduledAfter('c1', ['t157'], '2026-10-06');
    expect(use.speakerName).toBe('Кох Давид');
  });

  it('names the brother in a programme slot the log does not have', async () => {
    const { service } = build(
      [
        {
          publicTalkId: 't157',
          weekStartDate: '2026-11-02',
          speakerName: null,
          publisher: { displayName: 'Кох Давид' },
          visitingSpeaker: null,
        },
      ],
      [],
    );
    const [use] = await service.scheduledAfter('c1', ['t157'], '2026-10-06');
    expect(use).toMatchObject({
      source: 'programme',
      speakerName: 'Кох Давид',
    });
  });

  it('asks the database for the cards, not only for the rows', async () => {
    const { service, exchangeRepo, assignmentsRepo } = build([], []);
    await service.scheduledAfter('c1', ['t157'], '2026-10-06');
    for (const repo of [exchangeRepo, assignmentsRepo]) {
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: {
            publisher: true,
            visitingSpeaker: { externalCongregation: true },
          },
        }),
      );
    }
  });
});
