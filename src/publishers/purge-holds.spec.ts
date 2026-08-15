jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { BadRequestException } from '@nestjs/common';
import { PublishersService } from './publishers.service';
import { clockStub } from '../common/testing/clock-stub';

/**
 * Purging a publisher card.
 *
 * The old check counted five kinds of history and let five CASCADE relations
 * through, so the tests here are about the shape of the rule rather than any
 * one table: whatever the schema says points at a publisher must be asked
 * about, and anything found must be named in the refusal.
 */
describe('PublishersService.purge — what holds the card', () => {
  const fks = [
    { table_name: 'service_reports', column_name: 'publisher_id' },
    { table_name: 'auxiliary_pioneers', column_name: 'publisher_id' },
    { table_name: 'cart_assignments', column_name: 'publisher_id' },
  ];

  const build = (counts: Record<string, number>) => {
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('information_schema')) return fks;
      const table = /FROM "([a-z_]+)"/.exec(sql)?.[1] ?? '';
      void params;
      return [{ n: String(counts[table] ?? 0) }];
    });
    const publishersRepo = {
      manager: { query },
      findOne: jest.fn(async () => ({ id: 'pub-1', congregationId: 'c1' })),
      delete: jest.fn(async () => undefined),
    };
    const service = new PublishersService(
      publishersRepo as never,
      { count: jest.fn(async () => 0) } as never,
      clockStub(),
      {} as never,
      { logEvent: jest.fn(async () => undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 'pub-1', congregationId: 'c1' } as never);
    return { service, publishersRepo, query };
  };

  it('refuses on a CASCADE relation the old check never asked about', async () => {
    const { service, publishersRepo } = build({ auxiliary_pioneers: 1 });

    await expect(service.purge('c1', 'pub-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // The card is still there. This is the whole point.
    expect(publishersRepo.delete).not.toHaveBeenCalled();
  });

  it('names what holds the card, so the refusal can be acted on', async () => {
    const { service } = build({ cart_assignments: 2, auxiliary_pioneers: 1 });

    await expect(service.purge('c1', 'pub-1')).rejects.toThrow(
      /publisher_has_history:.*cart_assignments=2.*auxiliary_pioneers=1/,
    );
  });

  it('refuses on an absence too — strict was the decision', async () => {
    const { service } = build({});
    const { service: withAbsence } = build({ absences: 1 });
    // absences is not in the stubbed schema, so this proves the rule follows
    // the schema rather than a list in the code: add the table, it is asked.
    fks.push({ table_name: 'absences', column_name: 'publisher_id' });
    await expect(withAbsence.purge('c1', 'pub-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    fks.pop();
    void service;
  });

  it('deletes when nothing at all points at the card', async () => {
    const { service, publishersRepo } = build({});

    await service.purge('c1', 'pub-1');

    expect(publishersRepo.delete).toHaveBeenCalled();
  });
});
