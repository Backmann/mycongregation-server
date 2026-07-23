import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CartLocation } from '../entities/cart-location.entity';
import { CartLocationsService } from './cart-locations.service';

const auditMock = {
  logCreate: jest.fn(),
  logUpdate: jest.fn(),
  logEvent: jest.fn(),
} as any;

describe('CartLocationsService', () => {
  let svc: CartLocationsService;
  let repo: jest.Mocked<
    Pick<
      Repository<CartLocation>,
      'find' | 'findOne' | 'create' | 'save' | 'remove'
    >
  >;

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((x) => x as CartLocation),
      save: jest.fn((x) =>
        Promise.resolve({ id: 'loc-1', ...x } as CartLocation),
      ),
      remove: jest.fn(() => Promise.resolve({} as CartLocation)),
    } as never;
    svc = new CartLocationsService(repo as never, auditMock);
  });

  it('lists active points by default', async () => {
    repo.find.mockResolvedValue([]);
    await svc.list('cong-1');
    expect(repo.find).toHaveBeenCalledWith({
      where: { congregationId: 'cong-1', isActive: true },
      order: { isActive: 'DESC', name: 'ASC' },
    });
  });

  it('includes inactive when asked', async () => {
    repo.find.mockResolvedValue([]);
    await svc.list('cong-1', true);
    expect(repo.find).toHaveBeenCalledWith({
      where: { congregationId: 'cong-1' },
      order: { isActive: 'DESC', name: 'ASC' },
    });
  });

  it('create applies defaults: kind=cart, active, no address', async () => {
    await svc.create('cong-1', { name: 'ТЦ Центр' });
    expect(repo.create).toHaveBeenCalledWith({
      congregationId: 'cong-1',
      name: 'ТЦ Центр',
      address: null,
      kind: 'cart',
      isActive: true,
    });
  });

  it('getById throws NotFound when missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(svc.getById('cong-1', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update changes only provided fields', async () => {
    repo.findOne.mockResolvedValue({
      id: 'loc-1',
      congregationId: 'cong-1',
      name: 'Old',
      address: null,
      kind: 'cart',
      isActive: true,
    } as CartLocation);
    await svc.update('cong-1', 'loc-1', { isActive: false, kind: 'stand' });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Old', kind: 'stand', isActive: false }),
    );
  });
});
