import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ServiceGroupsService } from './service-groups.service';
import { ServiceGroup } from '../entities/service-group.entity';
import { PublishersService } from '../publishers/publishers.service';

describe('ServiceGroupsService', () => {
  let service: ServiceGroupsService;
  let serviceGroupsRepo: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
    restore: jest.Mock;
  };
  let publishersService: { findOne: jest.Mock; findAll: jest.Mock };

  beforeEach(async () => {
    serviceGroupsRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
    };
    publishersService = {
      findOne: jest.fn(),
      findAll: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ServiceGroupsService,
        {
          provide: getRepositoryToken(ServiceGroup),
          useValue: serviceGroupsRepo,
        },
        { provide: PublishersService, useValue: publishersService },
      ],
    }).compile();

    service = moduleRef.get(ServiceGroupsService);
  });

  describe('findOne leader resolution', () => {
    it('resolves overseer and assistant even when they are not group members', async () => {
      serviceGroupsRepo.findOne.mockResolvedValue({
        id: 'g1',
        congregationId: 't1',
        name: 'Group 1',
        overseerPublisherId: 'p-over',
        assistantPublisherId: 'p-asst',
        deletedAt: null,
      });
      publishersService.findOne.mockImplementation(
        (_tenantId: string, pid: string) =>
          Promise.resolve({
            id: pid,
            displayName: pid === 'p-over' ? 'Overseer Bob' : 'Assistant Sam',
          }),
      );

      const result = await service.findOne('t1', 'g1');

      expect(result.overseer).toEqual({
        id: 'p-over',
        displayName: 'Overseer Bob',
      });
      expect(result.assistant).toEqual({
        id: 'p-asst',
        displayName: 'Assistant Sam',
      });
      expect(publishersService.findOne).toHaveBeenCalledWith('t1', 'p-over');
      expect(publishersService.findOne).toHaveBeenCalledWith('t1', 'p-asst');
    });

    it('returns null leaders when the ids are null and does not query publishers', async () => {
      serviceGroupsRepo.findOne.mockResolvedValue({
        id: 'g2',
        congregationId: 't1',
        name: 'Group 2',
        overseerPublisherId: null,
        assistantPublisherId: null,
        deletedAt: null,
      });

      const result = await service.findOne('t1', 'g2');

      expect(result.overseer).toBeNull();
      expect(result.assistant).toBeNull();
      expect(publishersService.findOne).not.toHaveBeenCalled();
    });

    it('tolerates a missing or removed leader publisher by resolving to null', async () => {
      serviceGroupsRepo.findOne.mockResolvedValue({
        id: 'g3',
        congregationId: 't1',
        name: 'Group 3',
        overseerPublisherId: 'p-gone',
        assistantPublisherId: null,
        deletedAt: null,
      });
      publishersService.findOne.mockRejectedValue(
        new NotFoundException('Publisher not found'),
      );

      const result = await service.findOne('t1', 'g3');

      expect(result.overseer).toBeNull();
      expect(result.assistant).toBeNull();
    });

    it('throws NotFound when the group does not exist', async () => {
      serviceGroupsRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('t1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(publishersService.findOne).not.toHaveBeenCalled();
    });
  });
});
