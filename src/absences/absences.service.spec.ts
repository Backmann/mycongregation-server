import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AbsencesService } from './absences.service';
import { Absence } from '../entities/absence.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

const TENANT = 'cong-1';
const MY_PUBLISHER = 'pub-mine';
const OTHER_PUBLISHER = 'pub-other';

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'me@example.org',
    role: UserRole.PUBLISHER,
    congregationId: TENANT,
    uiLanguage: 'en',
    ...overrides,
  };
}

describe('AbsencesService — self-absence authorization', () => {
  let service: AbsencesService;
  let absenceRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    softDelete: jest.Mock;
    restore: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let publisherRepo: { findOne: jest.Mock };
  let responsibilityRepo: { count: jest.Mock };

  beforeEach(async () => {
    absenceRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'abs-1', ...x })),
      findOne: jest.fn(),
      softDelete: jest.fn().mockResolvedValue({}),
      restore: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn(),
    };
    publisherRepo = { findOne: jest.fn() };
    responsibilityRepo = { count: jest.fn().mockResolvedValue(0) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AbsencesService,
        { provide: getRepositoryToken(Absence), useValue: absenceRepo },
        { provide: getRepositoryToken(Publisher), useValue: publisherRepo },
        {
          provide: getRepositoryToken(Responsibility),
          useValue: responsibilityRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(AbsencesService);
  });

  // ---- create ----

  it('lets a publisher create their OWN absence', async () => {
    publisherRepo.findOne.mockResolvedValue({ id: MY_PUBLISHER });
    const dto = { publisherId: MY_PUBLISHER, startDate: '2026-07-01' };
    await expect(service.create(TENANT, dto, user())).resolves.toMatchObject({
      publisherId: MY_PUBLISHER,
    });
    expect(absenceRepo.save).toHaveBeenCalled();
  });

  it("forbids a publisher creating someone else's absence", async () => {
    publisherRepo.findOne.mockResolvedValue({ id: MY_PUBLISHER });
    const dto = { publisherId: OTHER_PUBLISHER, startDate: '2026-07-01' };
    await expect(service.create(TENANT, dto, user())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(absenceRepo.save).not.toHaveBeenCalled();
  });

  it('lets an admin create any absence', async () => {
    const dto = { publisherId: OTHER_PUBLISHER, startDate: '2026-07-01' };
    await expect(
      service.create(TENANT, dto, user({ role: UserRole.ADMIN })),
    ).resolves.toBeDefined();
    // admin shortcut: never needs to resolve own publisher
    expect(publisherRepo.findOne).not.toHaveBeenCalled();
  });

  it('lets a held responsibility create any absence', async () => {
    responsibilityRepo.count.mockResolvedValue(1); // holds a manager role
    const dto = { publisherId: OTHER_PUBLISHER, startDate: '2026-07-01' };
    await expect(service.create(TENANT, dto, user())).resolves.toBeDefined();
    expect(publisherRepo.findOne).not.toHaveBeenCalled();
  });

  it('forbids a publisher with no linked publisher record', async () => {
    publisherRepo.findOne.mockResolvedValue(null);
    const dto = { publisherId: MY_PUBLISHER, startDate: '2026-07-01' };
    await expect(service.create(TENANT, dto, user())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // ---- update ----

  it('lets a publisher update their own absence', async () => {
    absenceRepo.findOne.mockResolvedValue({
      id: 'abs-1',
      publisherId: MY_PUBLISHER,
      congregationId: TENANT,
    });
    publisherRepo.findOne.mockResolvedValue({ id: MY_PUBLISHER });
    await expect(
      service.update(TENANT, 'abs-1', { note: 'updated' }, user()),
    ).resolves.toBeDefined();
  });

  it("forbids a publisher updating someone else's absence", async () => {
    absenceRepo.findOne.mockResolvedValue({
      id: 'abs-1',
      publisherId: OTHER_PUBLISHER,
      congregationId: TENANT,
    });
    publisherRepo.findOne.mockResolvedValue({ id: MY_PUBLISHER });
    await expect(
      service.update(TENANT, 'abs-1', { note: 'hack' }, user()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids a publisher reassigning their absence to someone else', async () => {
    absenceRepo.findOne.mockResolvedValue({
      id: 'abs-1',
      publisherId: MY_PUBLISHER,
      congregationId: TENANT,
    });
    publisherRepo.findOne.mockResolvedValue({ id: MY_PUBLISHER });
    await expect(
      service.update(TENANT, 'abs-1', { publisherId: OTHER_PUBLISHER }, user()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFound when updating a missing absence', async () => {
    absenceRepo.findOne.mockResolvedValue(null);
    await expect(
      service.update(TENANT, 'missing', { note: 'x' }, user()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ---- remove ----

  it('lets a publisher delete their own absence', async () => {
    absenceRepo.findOne.mockResolvedValue({
      id: 'abs-1',
      publisherId: MY_PUBLISHER,
      congregationId: TENANT,
    });
    publisherRepo.findOne.mockResolvedValue({ id: MY_PUBLISHER });
    await service.remove(TENANT, 'abs-1', user());
    expect(absenceRepo.softDelete).toHaveBeenCalledWith('abs-1');
  });

  it("forbids a publisher deleting someone else's absence", async () => {
    absenceRepo.findOne.mockResolvedValue({
      id: 'abs-1',
      publisherId: OTHER_PUBLISHER,
      congregationId: TENANT,
    });
    publisherRepo.findOne.mockResolvedValue({ id: MY_PUBLISHER });
    await expect(
      service.remove(TENANT, 'abs-1', user()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(absenceRepo.softDelete).not.toHaveBeenCalled();
  });
});
