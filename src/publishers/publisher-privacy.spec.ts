import { join } from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import {
  redactPrivateFields,
  PRIVATE_PUBLISHER_FIELDS,
  publicRosterView,
  ROSTER_PUBLISHER_FIELDS,
} from './publisher-privacy';

/**
 * Every field of a publisher's card is either private or part of the roster —
 * decided, not left to chance.
 *
 * The private list was a list of exceptions: whatever nobody thought to put on
 * it went to every signed-in member. Seven fields travelled that way until
 * 6 October, «anointed or of the other sheep» among them. Now a field that is
 * on neither list fails here, on the day it is added.
 */
describe('a publisher’s card: every field has a side', () => {
  let fields: string[];

  beforeAll(async () => {
    const db = new DataSource({
      type: 'postgres',
      entities: [join(__dirname, '..', 'entities', '*.entity.{ts,js}')],
      namingStrategy: new SnakeNamingStrategy(),
    });
    // Reads the decorators; opens no connection.
    await (
      db as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const card = db.entityMetadatas.find((m) => m.tableName === 'publishers');
    fields = (card?.columns ?? []).map((c) => c.propertyName);
  });

  it('sees the card at all', () => {
    expect(fields.length).toBeGreaterThan(30);
    expect(fields).toContain('mobilePhone');
  });

  it('has no field that nobody decided about', () => {
    const decided = new Set<string>([
      ...PRIVATE_PUBLISHER_FIELDS,
      ...ROSTER_PUBLISHER_FIELDS,
    ]);
    expect(fields.filter((f) => !decided.has(f))).toEqual([]);
  });

  it('has no decision about a field that is gone, and none made twice', () => {
    const all = [...PRIVATE_PUBLISHER_FIELDS, ...ROSTER_PUBLISHER_FIELDS];
    expect(all.filter((f) => !fields.includes(f))).toEqual([]);
    expect(all.filter((f, i) => all.indexOf(f) !== i)).toEqual([]);
  });

  it('sends a fellow publisher the roster fields and nothing else', () => {
    const card: Record<string, unknown> = {};
    for (const f of fields) card[f] = `значение-${f}`;
    const sent = Object.keys(publicRosterView(card)).sort();
    // pioneerActive is worked out for the roster from two private dates.
    expect(sent).toEqual([...ROSTER_PUBLISHER_FIELDS, 'pioneerActive'].sort());
  });

  it('keeps to itself what was found travelling on 6 October', () => {
    const out = publicRosterView({
      id: 'p1',
      firstName: 'Иван',
      spiritualStatus: 'anointed',
      contactsConfirmedByUserId: 'u9',
      lastEditedById: 'u9',
      statusOverriddenById: 'u9',
      statusOverriddenAt: '2026-01-01',
      restoredAt: '2026-01-01',
      anonymizedAt: null,
    });
    expect(out).toEqual({ id: 'p1', firstName: 'Иван', pioneerActive: false });
  });
});

describe('redactPrivateFields', () => {
  const full = {
    id: 'p1',
    firstName: 'Иван',
    lastName: 'Петров',
    displayName: 'Иван Петров',
    gender: 'male',
    pioneerType: 'none',
    status: 'active',
    serviceGroupId: 'g1',
    capabilities: { microphone: true },
    mobilePhone: '+49 111',
    email: 'i@x.org',
    address: 'Street 1',
    notes: 'note',
    removedNote: 'why',
    birthDate: '1990-01-01',
    baptismDate: '2005-01-01',
    ministryStartDate: '2004-01-01',
    pioneerSince: null,
    removalReason: 'disfellowshipped',
    removedAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('removes every private field', () => {
    const redacted = redactPrivateFields(full);
    for (const field of PRIVATE_PUBLISHER_FIELDS) {
      expect(redacted).not.toHaveProperty(field);
    }
  });

  it('keeps name and scheduling fields', () => {
    const redacted = redactPrivateFields(full) as Record<string, unknown>;
    expect(redacted.firstName).toBe('Иван');
    expect(redacted.displayName).toBe('Иван Петров');
    expect(redacted.pioneerType).toBe('none');
    expect(redacted.status).toBe('active');
    expect(redacted.serviceGroupId).toBe('g1');
    expect(redacted.capabilities).toEqual({ microphone: true });
  });

  it('does not mutate the original publisher', () => {
    const redacted = redactPrivateFields(full);
    expect(full.mobilePhone).toBe('+49 111');
    expect(full.removalReason).toBe('disfellowshipped');
    expect(redacted).not.toBe(full);
  });
  it('hides the circumstances the annual report asks about', () => {
    // Whether someone is deaf, blind or in prison is more personal than a
    // phone number, and the roster must not become a way to find out.
    const out = redactPrivateFields({
      id: 'p1',
      firstName: 'Иван',
      isDeaf: true,
      isBlind: false,
      isImprisoned: true,
    } as never) as Record<string, unknown>;

    expect(out.firstName).toBe('Иван');
    expect('isDeaf' in out).toBe(false);
    expect('isBlind' in out).toBe(false);
    expect('isImprisoned' in out).toBe(false);
  });
});
