import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';
import { AuditLogService } from '../audit-log/audit-log.service';

describe('UsersService.changeEmailByAdmin', () => {
  let service: UsersService;
  let repo: { findOne: jest.Mock; save: jest.Mock };

  const baseUser = {
    id: 'u1',
    congregationId: 'cong-1',
    email: 'kvachekd@gmaul.com',
  };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation(async (x) => x),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        {
          provide: MailService,
          useValue: {
            sendInvite: jest.fn().mockResolvedValue(undefined),
            sendPasswordReset: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: AuditLogService,
          useValue: {
            logUpdate: jest.fn().mockResolvedValue(undefined),
            logCreate: jest.fn().mockResolvedValue(undefined),
            logRawUpdate: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('trims, lowercases and saves the new email', async () => {
    repo.findOne
      .mockResolvedValueOnce({ ...baseUser }) // findByIdInCongregation
      .mockResolvedValueOnce(null); // uniqueness check
    await service.changeEmailByAdmin('u1', '  KVACHEKD@GMAIL.COM ', 'cong-1');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'kvachekd@gmail.com' }),
    );
  });

  it('is a no-op when the email is unchanged', async () => {
    repo.findOne.mockResolvedValueOnce({ ...baseUser });
    await service.changeEmailByAdmin('u1', 'kvachekd@gmaul.com', 'cong-1');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects an email already taken by another account', async () => {
    repo.findOne
      .mockResolvedValueOnce({ ...baseUser })
      .mockResolvedValueOnce({ id: 'u2', email: 'kvachekd@gmail.com' });
    await expect(
      service.changeEmailByAdmin('u1', 'kvachekd@gmail.com', 'cong-1'),
    ).rejects.toThrow(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('throws NotFound for a user outside the congregation', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.changeEmailByAdmin('ghost', 'x@y.de', 'cong-1'),
    ).rejects.toThrow(NotFoundException);
  });
});
