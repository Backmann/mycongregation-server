import { ReadinessController } from './readiness.controller';
import { UserRole } from '../common/enums/user-role.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import type { WeekReadiness } from './readiness.service';

/**
 * WHO IS TOLD WHAT.
 *
 * The guard lets three responsibilities in; this is the second half of the
 * rule — what each of them is handed once inside.
 */
const WEEKS: WeekReadiness[] = [
  {
    weekStart: '2026-10-05',
    meetings: [
      {
        date: '2026-10-07',
        kind: 'midweek',
        programme: {
          loaded: true,
          assigned: 9,
          total: 12,
          missing: ['prayer_closing', 'cbs_reader', 'student_1'],
        },
        duties: { created: true, assigned: 5, total: 8 },
      },
    ],
  },
];

function build(holds: ResponsibilityType[]) {
  const service = { forRange: jest.fn().mockResolvedValue(WEEKS) };
  const responsibilities = {
    count: jest.fn((q: { where: { type: { value: string[] } } }) =>
      Promise.resolve(
        holds.filter((h) => q.where.type.value.includes(h)).length,
      ),
    ),
  };
  return new ReadinessController(service as never, responsibilities as never);
}

const who = (role: UserRole) =>
  ({ id: 'u1', role, congregationId: 'c1' }) as unknown as AuthenticatedUser;
const QUERY = { weekStart: '2026-10-05', weekEnd: '2026-10-12' };

describe('ReadinessController — what each reader is handed', () => {
  it('the duties coordinator: his duty figures, nothing about the programme', async () => {
    const out = await build([ResponsibilityType.DUTIES_COORDINATOR]).list(
      'c1',
      QUERY,
      who(UserRole.ELDER),
    );
    const m = out[0].meetings[0];
    expect(m.duties).toEqual({ created: true, assigned: 5, total: 8 });
    expect(m.programme).toEqual({
      loaded: false,
      assigned: 0,
      total: 0,
      missing: [],
      withheld: true,
    });
    // Not a word of the programme left anywhere in the answer.
    expect(JSON.stringify(out)).not.toContain('cbs_reader');
    // The date and the kind are his to know — he staffs that meeting.
    expect(m.date).toBe('2026-10-07');
    expect(m.kind).toBe('midweek');
  });

  it.each([
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ResponsibilityType.BODY_COORDINATOR,
  ])('%s reads the programme in full', async (type) => {
    const out = await build([type]).list('c1', QUERY, who(UserRole.ELDER));
    expect(out).toEqual(WEEKS);
  });

  it('who holds both duties and the programme reads the programme', async () => {
    const out = await build([
      ResponsibilityType.DUTIES_COORDINATOR,
      ResponsibilityType.BODY_COORDINATOR,
    ]).list('c1', QUERY, who(UserRole.MINISTERIAL_SERVANT));
    expect(out).toEqual(WEEKS);
  });

  it('an administrator reads everything without holding anything', async () => {
    const out = await build([]).list('c1', QUERY, who(UserRole.ADMIN));
    expect(out).toEqual(WEEKS);
  });

  it('withholding does not touch the answer the service keeps', async () => {
    await build([ResponsibilityType.DUTIES_COORDINATOR]).list(
      'c1',
      QUERY,
      who(UserRole.ELDER),
    );
    expect(WEEKS[0].meetings[0].programme.missing).toHaveLength(3);
  });
});
