import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Between, MoreThanOrEqual } from 'typeorm';
import {
  CartShiftsService,
  CART_MAX_PARTICIPANTS,
} from './cart-shifts.service';

const CONG = 'cong-1';

function makeService() {
  const shifts = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x: any) => x),
    save: jest.fn(),
    remove: jest.fn(),
  };
  const participants = {
    create: jest.fn((x: any) => x),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const service = new CartShiftsService(shifts as any, participants as any);
  return { service, shifts, participants };
}

function shiftWith(n: number) {
  return {
    id: 's1',
    congregationId: CONG,
    date: '2026-05-25',
    startTime: '10:00',
    endTime: '12:00',
    location: 'Markt',
    participants: Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      cartShiftId: 's1',
      publisherId: `pub${i}`,
    })),
  };
}

describe('CartShiftsService', () => {
  it('createShift saves with congregationId and returns the reloaded shift', async () => {
    const { service, shifts } = makeService();
    shifts.save.mockResolvedValue({ id: 's1' });
    shifts.findOne.mockResolvedValue(shiftWith(0));
    const out = await service.createShift(CONG, {
      date: '2026-05-25',
      startTime: '10:00',
      endTime: '12:00',
      location: 'Markt',
    });
    expect(shifts.save).toHaveBeenCalledWith(
      expect.objectContaining({ congregationId: CONG, location: 'Markt' }),
    );
    expect(out.id).toBe('s1');
  });

  it('listShifts with from+to filters Between and orders by date/time', async () => {
    const { service, shifts } = makeService();
    shifts.find.mockResolvedValue([]);
    await service.listShifts(CONG, { from: '2026-05-01', to: '2026-05-31' });
    const arg = shifts.find.mock.calls[0][0];
    expect(arg.where.congregationId).toBe(CONG);
    expect(arg.where.date).toEqual(Between('2026-05-01', '2026-05-31'));
    expect(arg.order).toEqual({
      date: 'ASC',
      startTime: 'ASC',
      createdAt: 'ASC',
    });
  });

  it('listShifts with only from uses MoreThanOrEqual', async () => {
    const { service, shifts } = makeService();
    shifts.find.mockResolvedValue([]);
    await service.listShifts(CONG, { from: '2026-05-10' });
    expect(shifts.find.mock.calls[0][0].where.date).toEqual(
      MoreThanOrEqual('2026-05-10'),
    );
  });

  it('addParticipant adds when under the cap', async () => {
    const { service, shifts, participants } = makeService();
    shifts.findOne
      .mockResolvedValueOnce(shiftWith(2)) // getOwned in add
      .mockResolvedValueOnce(shiftWith(3)); // reload
    participants.save.mockResolvedValue({});
    await service.addParticipant(CONG, 's1', 'pubX');
    expect(participants.save).toHaveBeenCalledTimes(1);
  });

  it('addParticipant is idempotent for an already-assigned publisher', async () => {
    const { service, shifts, participants } = makeService();
    const shift = shiftWith(2); // publishers pub0, pub1
    shifts.findOne.mockResolvedValue(shift);
    const out = await service.addParticipant(CONG, 's1', 'pub0');
    expect(participants.save).not.toHaveBeenCalled();
    expect(out).toBe(shift);
  });

  it(`addParticipant throws once ${CART_MAX_PARTICIPANTS} are assigned`, async () => {
    const { service, shifts, participants } = makeService();
    shifts.findOne.mockResolvedValue(shiftWith(CART_MAX_PARTICIPANTS));
    await expect(service.addParticipant(CONG, 's1', 'pubX')).rejects.toThrow(
      BadRequestException,
    );
    expect(participants.save).not.toHaveBeenCalled();
  });

  it('removeParticipant deletes by shift + publisher', async () => {
    const { service, shifts, participants } = makeService();
    shifts.findOne.mockResolvedValue(shiftWith(2));
    participants.delete.mockResolvedValue({});
    await service.removeParticipant(CONG, 's1', 'pub0');
    expect(participants.delete).toHaveBeenCalledWith({
      cartShiftId: 's1',
      publisherId: 'pub0',
    });
  });

  it('updateShift throws NotFound for a shift in another congregation', async () => {
    const { service, shifts } = makeService();
    shifts.findOne.mockResolvedValue(null);
    await expect(
      service.updateShift(CONG, 'nope', { location: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('removeShift throws NotFound when missing', async () => {
    const { service, shifts } = makeService();
    shifts.findOne.mockResolvedValue(null);
    await expect(service.removeShift(CONG, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});
