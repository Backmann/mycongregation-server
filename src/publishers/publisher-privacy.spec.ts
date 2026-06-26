import {
  redactPrivateFields,
  PRIVATE_PUBLISHER_FIELDS,
} from './publisher-privacy';

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
});
