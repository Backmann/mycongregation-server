import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MeService } from './me.service';
import { Publisher } from '../entities/publisher.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { CartShiftParticipant } from '../entities/cart-shift-participant.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';

describe('MeService.myPublisher', () => {
  let service: MeService;
  let publishersRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    publishersRepo = { findOne: jest.fn() };
    const stub = {};
    const moduleRef = await Test.createTestingModule({
      providers: [
        MeService,
        { provide: getRepositoryToken(Publisher), useValue: publishersRepo },
        { provide: getRepositoryToken(Assignment), useValue: stub },
        { provide: getRepositoryToken(Duty), useValue: stub },
        { provide: getRepositoryToken(CleaningAssignment), useValue: stub },
        { provide: getRepositoryToken(CartShiftParticipant), useValue: stub },
        { provide: getRepositoryToken(FieldServiceMeeting), useValue: stub },
      ],
    }).compile();
    service = moduleRef.get(MeService);
  });

  it('returns null when no publisher is linked to the user', async () => {
    publishersRepo.findOne.mockResolvedValue(null);
    const res = await service.myPublisher('c1', 'u1');
    expect(res).toEqual({ publisher: null });
    expect(publishersRepo.findOne).toHaveBeenCalledWith({
      where: { congregationId: 'c1', userId: 'u1' },
    });
  });

  it('returns only the light identity fields when linked', async () => {
    publishersRepo.findOne.mockResolvedValue({
      id: 'p1',
      displayName: 'Adele B.',
      firstName: 'Adele',
      lastName: 'Backmann',
      pioneerType: 'none',
      serviceGroupId: 'g1',
      // Fields below must NOT leak into the response.
      email: 'private@example.org',
      notes: 'sensitive',
    });
    const res = await service.myPublisher('c1', 'u1');
    expect(res).toEqual({
      publisher: {
        id: 'p1',
        displayName: 'Adele B.',
        firstName: 'Adele',
        lastName: 'Backmann',
        pioneerType: 'none',
        serviceGroupId: 'g1',
      },
    });
  });

  it('normalizes a missing pioneerType to null', async () => {
    publishersRepo.findOne.mockResolvedValue({
      id: 'p2',
      displayName: 'X',
      firstName: 'X',
      lastName: 'Y',
      pioneerType: undefined,
    });
    const res = await service.myPublisher('c1', 'u2');
    expect(res.publisher?.pioneerType).toBeNull();
  });
});
