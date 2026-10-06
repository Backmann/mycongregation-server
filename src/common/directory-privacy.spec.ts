import type { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Responsibility } from '../entities/responsibility.entity';
import { ExternalCongregationsService } from '../external-congregations/external-congregations.service';
import { TalkExchangeService } from '../talk-exchange/talk-exchange.service';
import { VisitingSpeakersService } from '../visiting-speakers/visiting-speakers.service';
import {
  congregationWithoutContacts,
  exchangeWithoutPrivate,
  readsDirectoryContacts,
  speakerWithoutContacts,
} from './directory-privacy';

jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

const member = (role: string): AuthenticatedUser =>
  ({
    id: 'u1',
    email: null,
    role,
    congregationId: 'c1',
    uiLanguage: 'ru',
  }) as unknown as AuthenticatedUser;
const holders = (held: number) =>
  ({
    count: jest.fn(async () => held),
  }) as unknown as Repository<Responsibility>;

const congregation = {
  id: 'g1',
  name: 'Северное',
  city: 'Город',
  meetingDow: 7,
  meetingTime: '10:00',
  address: 'Зал, ул. Садовая, 1',
  contactName: 'ЛИЧНОЕ-контакт',
  contactPhone: 'ЛИЧНОЕ-телефон-собрания',
  note: 'ЛИЧНОЕ-заметка-собрания',
};
const speaker = {
  id: 's1',
  firstName: 'Марк',
  lastName: 'Вебер',
  talkNumbers: [12, 61],
  externalCongregationId: 'g1',
  externalCongregation: congregation,
  phone: 'ЛИЧНОЕ-телефон',
  note: 'ЛИЧНОЕ-заметка',
  mergeRecord: { byUserId: 'ЛИЧНОЕ-кто-объединил' },
};
const entry = {
  id: 'e1',
  date: '2026-11-08',
  direction: 'incoming',
  publicTalkId: 't1',
  visitingSpeakerId: 's1',
  speakerName: null,
  note: 'ЛИЧНОЕ-заметка-журнала',
  hospitalityPublisherId: 'ЛИЧНОЕ-кто-принимает',
  linkedAbsenceId: 'ЛИЧНОЕ-отсутствие',
};

describe('the speakers’ directory, for somebody who does not keep it', () => {
  describe('who reads it whole', () => {
    it.each(['admin', 'elder'])(
      'an %s, without asking further',
      async (role) => {
        const repo = holders(0);
        expect(await readsDirectoryContacts(member(role), repo)).toBe(true);
        expect(repo.count).not.toHaveBeenCalled();
      },
    );

    it.each(['ministerial_servant', 'publisher'])(
      'a %s only when he keeps the public talks',
      async (role) => {
        expect(await readsDirectoryContacts(member(role), holders(1))).toBe(
          true,
        );
        expect(await readsDirectoryContacts(member(role), holders(0))).toBe(
          false,
        );
      },
    );

    it('asks about the two responsibilities of this person in this congregation', async () => {
      const repo = holders(0);
      await readsDirectoryContacts(member('publisher'), repo);
      const where = (repo.count as jest.Mock).mock.calls[0][0].where;
      expect(where).toMatchObject({ congregationId: 'c1', userId: 'u1' });
      expect(JSON.stringify(where.type)).toContain('public_talk_coordinator');
      expect(JSON.stringify(where.type)).toContain(
        'public_talk_coordinator_assistant',
      );
    });
  });

  describe('what is left for everybody else', () => {
    it('keeps who the speaker is and what he gives', () => {
      expect(speakerWithoutContacts(speaker)).toMatchObject({
        id: 's1',
        firstName: 'Марк',
        lastName: 'Вебер',
        talkNumbers: [12, 61],
        externalCongregationId: 'g1',
      });
    });

    it('keeps where and when the other congregation meets', () => {
      expect(congregationWithoutContacts(congregation)).toMatchObject({
        name: 'Северное',
        city: 'Город',
        meetingDow: 7,
        meetingTime: '10:00',
        address: 'Зал, ул. Садовая, 1',
      });
    });

    it('keeps who speaks where and when', () => {
      expect(exchangeWithoutPrivate(entry)).toMatchObject({
        id: 'e1',
        date: '2026-11-08',
        direction: 'incoming',
        publicTalkId: 't1',
        visitingSpeakerId: 's1',
      });
    });

    it('carries nothing personal — the speaker, his congregation inside him, the entry', () => {
      const out = JSON.stringify([
        speakerWithoutContacts(speaker),
        congregationWithoutContacts(congregation),
        exchangeWithoutPrivate(entry),
      ]);
      expect(out).not.toContain('ЛИЧНОЕ');
    });

    it('does not change the row it was given', () => {
      speakerWithoutContacts(speaker);
      expect(speaker.phone).toBe('ЛИЧНОЕ-телефон');
      expect(speaker.externalCongregation.contactPhone).toBe(
        'ЛИЧНОЕ-телефон-собрания',
      );
    });

    it('leaves a speaker without a congregation as he is', () => {
      const lone = { ...speaker, externalCongregation: null };
      expect(speakerWithoutContacts(lone).externalCongregation).toBeNull();
    });
  });

  /** The services themselves: what the controller answers with. */
  describe('through the services', () => {
    const speakers = (held: number) => {
      const service = Object.create(
        VisitingSpeakersService.prototype,
      ) as VisitingSpeakersService;
      Object.assign(service, {
        repo: {
          find: jest.fn(async () => [{ ...speaker }]),
          findOne: jest.fn(async () => ({ ...speaker })),
        },
        responsibilitiesRepo: holders(held),
        eventRepo: { find: jest.fn(async () => []) },
      });
      return service;
    };
    const congregations = (held: number) => {
      const service = Object.create(
        ExternalCongregationsService.prototype,
      ) as ExternalCongregationsService;
      Object.assign(service, {
        repo: {
          find: jest.fn(async () => [{ ...congregation }]),
          findOne: jest.fn(async () => ({ ...congregation })),
        },
        responsibilitiesRepo: holders(held),
      });
      return service;
    };

    it('sends a publisher the list and the card without anything personal', async () => {
      const out = JSON.stringify([
        await speakers(0).listFor(member('publisher')),
        await speakers(0).getFor(member('publisher'), 's1'),
        await congregations(0).listFor(member('publisher')),
        await congregations(0).getFor(member('publisher'), 'g1'),
      ]);
      expect(out).toContain('Вебер');
      expect(out).toContain('Северное');
      expect(out).not.toContain('ЛИЧНОЕ');
    });

    it('sends the coordinator, an elder and an administrator everything', async () => {
      for (const [role, held] of [
        ['publisher', 1],
        ['elder', 0],
        ['admin', 0],
      ] as const) {
        const [s] = await speakers(held).listFor(member(role));
        expect(s.phone).toBe('ЛИЧНОЕ-телефон');
        expect((await speakers(held).getFor(member(role), 's1')).note).toBe(
          'ЛИЧНОЕ-заметка',
        );
        const [g] = await congregations(held).listFor(member(role));
        expect(g.contactPhone).toBe('ЛИЧНОЕ-телефон-собрания');
      }
    });

    it('sends a publisher the journal without the note and the host', async () => {
      const journal = (held: number) => {
        const service = Object.create(
          TalkExchangeService.prototype,
        ) as TalkExchangeService;
        Object.assign(service, {
          repo: {
            find: jest.fn(async () => [{ ...entry }]),
            findOne: jest.fn(async () => ({ ...entry })),
          },
          responsibilitiesRepo: holders(held),
        });
        return service;
      };
      const out = JSON.stringify([
        await journal(0).listFor(member('publisher')),
        await journal(0).getFor(member('ministerial_servant'), 'e1'),
      ]);
      expect(out).toContain('2026-11-08');
      expect(out).not.toContain('ЛИЧНОЕ');
      const [whole] = await journal(1).listFor(member('publisher'));
      expect(whole.note).toBe('ЛИЧНОЕ-заметка-журнала');
      expect((await journal(0).getFor(member('elder'), 'e1')).note).toBe(
        'ЛИЧНОЕ-заметка-журнала',
      );
    });

    it('keeps the server’s own reading whole', async () => {
      const [s] = await speakers(0).findAll('c1');
      expect(s.phone).toBe('ЛИЧНОЕ-телефон');
    });
  });
});
