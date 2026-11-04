import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublicTalksService } from './public-talks.service';
import { PublicTalksModule } from './public-talks.module';
import { PublicTalk } from '../entities/public-talk.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * The weekend meeting's date on the talk catalogue comes from the week rules
 * (4 November 2026), not from a copy reading the settings day itself.
 */
describe('public talks: the weekend meeting day comes from the week rules', () => {
  const talk = { id: 't1', number: 1, title: 'Речь', isActive: true };
  const build = (versions: unknown[], events?: unknown[]) =>
    new PublicTalksService(
      {
        find: jest.fn(async () => [talk]),
      } as unknown as Repository<PublicTalk>,
      {
        find: jest.fn(async () => [
          {
            publicTalkId: 't1',
            weekStartDate: '2026-11-09',
            partKey: 'public_talk',
          },
        ]),
      } as never,
      { find: jest.fn(async () => []) } as never,
      { find: jest.fn(async () => versions) } as never,
      { logEvent: jest.fn() } as unknown as AuditLogService,
      events
        ? ({
            find: jest.fn(async () => events),
          } as unknown as Repository<SpecialEvent>)
        : undefined,
    );

  it('a Saturday congregation: the date is the Saturday of that week', async () => {
    const [use] = await build(
      [{ effectiveFrom: '2026-01-05', weekendDow: 6 }],
      [],
    ).scheduledAfter('c1', ['t1'], '2026-11-01');
    expect(use.meetingDate).toBe('2026-11-14');
  });

  it('a week before the first version reads the first version, as everywhere else', async () => {
    const [use] = await build(
      [{ effectiveFrom: '2027-01-04', weekendDow: 6 }],
      [],
    ).scheduledAfter('c1', ['t1'], '2026-11-01');
    expect(use.meetingDate).toBe('2026-11-14');
  });

  it('with no settings at all, Sunday', async () => {
    const [use] = await build([], []).scheduledAfter(
      'c1',
      ['t1'],
      '2026-11-01',
    );
    expect(use.meetingDate).toBe('2026-11-15');
  });

  it('the module provides the events table the rules read', () => {
    const imports: unknown[] =
      Reflect.getMetadata('imports', PublicTalksModule) ?? [];
    const tokens = imports.flatMap((m) =>
      ((m as { providers?: { provide?: unknown }[] }).providers ?? []).map(
        (p) => p.provide,
      ),
    );
    expect(tokens).toContain(getRepositoryToken(SpecialEvent));
  });
});
