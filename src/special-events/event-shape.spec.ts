import { assertEventShape, serviceYearOf } from './event-shape';

const code = (fn: () => void) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { response?: { code?: string } }).response?.code ?? 'other';
  }
};

describe('what an event must look like', () => {
  it('an hour is HH:mm, and the end comes after the start', () => {
    expect(code(() => assertEventShape({ time: '9 утра' }, null))).toBe(
      'EVENT_TIME_INVALID',
    );
    expect(
      code(() => assertEventShape({ time: '10:00', timeEnd: '09:00' }, null)),
    ).toBe('EVENT_TIME_ORDER');
    expect(code(() => assertEventShape({ timeEnd: '12:00' }, null))).toBe(
      'EVENT_TIME_ORDER',
    );
    expect(
      code(() => assertEventShape({ time: '09:40', timeEnd: '16:00' }, null)),
    ).toBeNull();
  });

  it('a link is a web address', () => {
    expect(
      code(() => assertEventShape({ mapUrl: 'javascript:alert(1)' }, null)),
    ).toBe('EVENT_LINK_INVALID');
    expect(
      code(() =>
        assertEventShape({ programUrl: 'https://jw.org/p.pdf' }, null),
      ),
    ).toBeNull();
  });

  it('a kind is one of ours; a special talk is sent to the talk log', () => {
    expect(code(() => assertEventShape({ type: 'party' }, null))).toBe(
      'EVENT_TYPE_UNKNOWN',
    );
    expect(code(() => assertEventShape({ type: 'special_talk' }, null))).toBe(
      'EVENT_SPECIAL_TALK_IN_JOURNAL',
    );
    expect(code(() => assertEventShape({ type: null }, null))).toBeNull();
  });

  it('only what the save changes is checked', () => {
    const old = { type: 'special_talk', time: '13 Uhr', mapUrl: 'maps' };
    // An old record keeps its odd values while its note is put right.
    expect(code(() => assertEventShape({ ...old }, old))).toBeNull();
    expect(code(() => assertEventShape({ ...old, time: '13 Uhr!' }, old))).toBe(
      'EVENT_TIME_INVALID',
    );
  });

  it('the service year runs September to August', () => {
    expect(serviceYearOf('2027-03-22')).toBe(2026);
    expect(serviceYearOf('2026-09-01')).toBe(2026);
    expect(serviceYearOf('2026-08-31')).toBe(2025);
  });
});
