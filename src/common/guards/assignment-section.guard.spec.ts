import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentSectionGuard } from './assignment-section.guard';
import { EventType } from '../enums/event-type.enum';
import { ResponsibilityType } from '../enums/responsibility-type.enum';
import { UserRole } from '../enums/user-role.enum';

type AnyRepo = { find: jest.Mock; findOne: jest.Mock };

function makeContext(req: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const PUBLISHER = {
  id: 'u1',
  email: 'b@x.org',
  role: UserRole.PUBLISHER,
  congregationId: 'c1',
  uiLanguage: 'ru',
};

describe('AssignmentSectionGuard', () => {
  let assignmentsRepo: AnyRepo;
  let responsibilitiesRepo: AnyRepo;
  let guard: AssignmentSectionGuard;

  beforeEach(() => {
    assignmentsRepo = { find: jest.fn(), findOne: jest.fn() };
    responsibilitiesRepo = { find: jest.fn(), findOne: jest.fn() };
    guard = new AssignmentSectionGuard(
      assignmentsRepo as never,
      responsibilitiesRepo as never,
    );
  });

  it('allows admins without touching the database', async () => {
    const ctx = makeContext({
      user: { ...PUBLISHER, role: UserRole.ADMIN },
      params: {},
      body: { eventType: EventType.MIDWEEK },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(responsibilitiesRepo.find).not.toHaveBeenCalled();
  });

  it('rejects when there is no authenticated user', async () => {
    const ctx = makeContext({ params: {}, body: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows the midweek overseer to create a midweek part', async () => {
    responsibilitiesRepo.find.mockResolvedValue([
      { type: ResponsibilityType.LIFE_MINISTRY_OVERSEER },
    ]);
    const ctx = makeContext({
      user: PUBLISHER,
      params: {},
      body: { eventType: EventType.MIDWEEK },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects a non-holder creating a midweek part', async () => {
    responsibilitiesRepo.find.mockResolvedValue([]);
    const ctx = makeContext({
      user: PUBLISHER,
      params: {},
      body: { eventType: EventType.MIDWEEK },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('rejects the midweek overseer touching the weekend program', async () => {
    responsibilitiesRepo.find.mockResolvedValue([]);
    const ctx = makeContext({
      user: PUBLISHER,
      params: {},
      body: { eventType: EventType.WEEKEND },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('reads the section from the stored record on :id routes', async () => {
    assignmentsRepo.findOne.mockResolvedValue({
      id: 'a1',
      eventType: EventType.WEEKEND,
    });
    responsibilitiesRepo.find.mockResolvedValue([
      { type: ResponsibilityType.BODY_COORDINATOR },
    ]);
    const ctx = makeContext({
      user: PUBLISHER,
      params: { id: 'a1' },
      body: {},
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(assignmentsRepo.findOne).toHaveBeenCalled();
  });

  it('returns 404 when the :id record is not in the congregation', async () => {
    assignmentsRepo.findOne.mockResolvedValue(null);
    const ctx = makeContext({
      user: PUBLISHER,
      params: { id: 'missing' },
      body: {},
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
  });

  it('requires every section a bulk write spans', async () => {
    // Holds midweek only; bulk spans midweek + weekend -> rejected.
    responsibilitiesRepo.find.mockResolvedValue([
      { type: ResponsibilityType.LIFE_MINISTRY_OVERSEER },
    ]);
    const ctx = makeContext({
      user: PUBLISHER,
      params: {},
      body: {
        assignments: [
          { eventType: EventType.MIDWEEK },
          { eventType: EventType.WEEKEND },
        ],
      },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
