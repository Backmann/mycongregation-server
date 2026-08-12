import { TaskAddresseesService } from './task-addressees.service';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * The membership is READ, never stored — replace the secretary and a task
 * addressed to the committee moves with the office.
 */
describe('TaskAddresseesService', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const responsibilities = {
      find: jest.fn(async () => []),
      ...(over.responsibilities as object),
    };
    const publishers = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      ...(over.publishers as object),
    };
    const tasks = {
      findOne: jest.fn(async () => null),
      ...(over.tasks as object),
    };
    return {
      service: new TaskAddresseesService(
        responsibilities as never,
        publishers as never,
        tasks as never,
      ),
      responsibilities,
      publishers,
      tasks,
    };
  };

  it('reads the committee from current responsibilities, not from stored names', async () => {
    const { service, responsibilities, publishers } = build({
      responsibilities: {
        find: jest.fn(async () => [
          { userId: 'u-coord', type: ResponsibilityType.BODY_COORDINATOR },
          { userId: 'u-sec', type: ResponsibilityType.SECRETARY },
          { userId: 'u-serv', type: ResponsibilityType.SERVICE_OVERSEER },
        ]),
      },
      publishers: {
        find: jest.fn(async () => [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]),
      },
    });

    const members = await service.membersOf({
      congregationId: 'c1',
      assigneeKind: 'service_committee',
    } as never);

    expect(members).toHaveLength(3);
    expect(responsibilities.find).toHaveBeenCalled();
    expect(publishers.find).toHaveBeenCalled();
  });

  it('takes the named brothers as they are when the task names them', async () => {
    const { service, responsibilities } = build();

    const members = await service.membersOf({
      congregationId: 'c1',
      assigneeKind: 'people',
      assignees: [{ id: 'p9' }],
    } as never);

    expect(members).toEqual([{ id: 'p9' }]);
    // No lookup at all: names mean names.
    expect(responsibilities.find).not.toHaveBeenCalled();
  });

  it('bars the secretary from auditing the accounts', async () => {
    const { service } = build({
      publishers: {
        findOne: jest.fn(async () => ({ id: 'p1', userId: 'u1' })),
      },
      responsibilities: {
        find: jest.fn(async () => [{ type: ResponsibilityType.SECRETARY }]),
      },
    });

    expect(await service.auditObjection('c1', 'p1')).toBe('isSecretary');
  });

  it('bars the brother who keeps the accounts', async () => {
    const { service } = build({
      publishers: {
        findOne: jest.fn(async () => ({ id: 'p1', userId: 'u1' })),
      },
      responsibilities: {
        find: jest.fn(async () => [
          { type: ResponsibilityType.ACCOUNTS_SERVANT },
        ]),
      },
    });

    expect(await service.auditObjection('c1', 'p1')).toBe('keepsAccounts');
  });

  it('cautions — but does not bar — the brother who did the previous one', async () => {
    // Sometimes there is nobody else to ask, so this is advice and the body
    // decides. One previous check, not two: the rule speaks of consecutive.
    const { service } = build({
      publishers: {
        findOne: jest.fn(async () => ({ id: 'p1', userId: 'u1' })),
      },
      tasks: {
        findOne: jest.fn(async () => ({ assignees: [{ id: 'p1' }] })),
      },
    });

    expect(await service.auditObjection('c1', 'p1')).toBe('didPrevious');
  });

  it('says nothing about a brother with no objection to him', async () => {
    const { service } = build({
      publishers: {
        findOne: jest.fn(async () => ({ id: 'p2', userId: 'u2' })),
      },
      tasks: { findOne: jest.fn(async () => ({ assignees: [{ id: 'p1' }] })) },
    });

    expect(await service.auditObjection('c1', 'p2')).toBeNull();
  });
});
