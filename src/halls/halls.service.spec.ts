import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { HallsService } from './halls.service';
import { Hall } from '../entities/hall.entity';

describe('HallsService', () => {
  let service: HallsService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'h-new', ...x })),
      remove: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        HallsService,
        { provide: getRepositoryToken(Hall), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(HallsService);
  });

  it('makes the very first hall the default automatically', async () => {
    repo.count.mockResolvedValue(0);
    const hall = await service.create('c1', {
      name: 'Зал Ален',
      address: 'Bunsenstr. 46, 59229 Ahlen',
    });
    expect(hall.isDefault).toBe(true);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('keeps a second hall non-default unless asked', async () => {
    repo.count.mockResolvedValue(1);
    const hall = await service.create('c1', {
      name: 'Зал Хамм',
      address: 'Lange Str. 114A, 59067 Hamm',
    });
    expect(hall.isDefault).toBe(false);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('clears the previous default when a new hall is created as default', async () => {
    repo.count.mockResolvedValue(1);
    await service.create('c1', {
      name: 'Зал Хамм',
      address: 'Lange Str. 114A, 59067 Hamm',
      isDefault: true,
    });
    expect(repo.update).toHaveBeenCalledWith(
      { congregationId: 'c1' },
      { isDefault: false },
    );
  });

  it('promotes a hall to default on update, demoting the others', async () => {
    repo.findOne.mockResolvedValue({
      id: 'h2',
      congregationId: 'c1',
      name: 'Зал Хамм',
      address: 'Lange Str. 114A, 59067 Hamm',
      isDefault: false,
    });
    const hall = await service.update('c1', 'h2', { isDefault: true });
    expect(repo.update).toHaveBeenCalledWith(
      { congregationId: 'c1' },
      { isDefault: false },
    );
    expect(hall.isDefault).toBe(true);
  });

  it('trims name and address on update', async () => {
    repo.findOne.mockResolvedValue({
      id: 'h1',
      congregationId: 'c1',
      name: 'Old',
      address: 'Old addr',
      isDefault: true,
    });
    const hall = await service.update('c1', 'h1', {
      name: '  Зал Ален  ',
      address: '  Bunsenstr. 46, 59229 Ahlen  ',
    });
    expect(hall.name).toBe('Зал Ален');
    expect(hall.address).toBe('Bunsenstr. 46, 59229 Ahlen');
  });

  it('throws NotFound for an unknown hall', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.remove('c1', 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});
