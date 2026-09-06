import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';
import { RefreshSession } from '../entities/refresh-session.entity';
import { Congregation } from '../entities/congregation.entity';
import { Publisher } from '../entities/publisher.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { loginNameProblem } from './login-name';

/**
 * Correcting the name a person signs in with.
 *
 * Transliteration produced `bakmann.lionel` for a man who writes himself
 * Backmann on every document he owns, and `shefer` for a Schäfer. The generated
 * name is a starting point; this is how it stops being wrong.
 */
describe('UsersService.changeLoginNameByAdmin', () => {
  let service: UsersService;
  let repo: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let audit: { logUpdate: jest.Mock };
  let taken: boolean;

  const CONG = 'cong-1';

  beforeEach(async () => {
    taken = false;
    repo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'u1',
        congregationId: CONG,
        loginName: 'bakmann.lionel',
      }),
      save: jest.fn().mockImplementation(async (x) => x),
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockImplementation(async () => (taken ? 1 : 0)),
        getOne: jest.fn().mockResolvedValue(null),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    audit = { logUpdate: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        {
          provide: getRepositoryToken(Publisher),
          useValue: { createQueryBuilder: jest.fn() },
        },
        {
          provide: getRepositoryToken(RefreshSession),
          // Setting a password now ends the account's open sessions — one
          // implementation for both the self-service and the elder's path.
          useValue: { update: jest.fn().mockResolvedValue({ affected: 0 }) },
        },
        {
          // Read for one line of the invitation letter: whose congregation it
          // comes from.
          provide: getRepositoryToken(Congregation),
          useValue: { findOne: jest.fn().mockResolvedValue({ name: 'Хамм' }) },
        },
        { provide: MailService, useValue: { sendInvite: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: AuditLogService,
          useValue: {
            ...audit,
            logCreate: jest.fn(),
            logRawUpdate: jest.fn(),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('saves the corrected spelling', async () => {
    await service.changeLoginNameByAdmin(
      'u1',
      '  Backmann.Lionel ',
      CONG,
      'admin-1',
    );

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ loginName: 'backmann.lionel' }),
    );
  });

  it('writes the change to the journal, both sides of it', async () => {
    // Somebody who cannot sign in tomorrow needs to be able to find out that
    // his name was changed today, and by whom.
    await service.changeLoginNameByAdmin(
      'u1',
      'backmann.lionel',
      CONG,
      'admin-1',
    );

    expect(audit.logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        before: { loginName: 'bakmann.lionel' },
        after: { loginName: 'backmann.lionel' },
        fields: ['loginName'],
      }),
    );
  });

  it('refuses a name somebody else holds', async () => {
    taken = true;

    await expect(
      service.changeLoginNameByAdmin('u1', 'sidorova.vera', CONG, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses characters that cannot be dictated over the phone', async () => {
    await expect(
      service.changeLoginNameByAdmin('u1', 'Bäckmann Lionel', CONG, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves the owner account alone', async () => {
    repo.findOne.mockResolvedValue({
      id: 'u1',
      congregationId: CONG,
      isOwner: true,
    });

    await expect(
      service.changeLoginNameByAdmin('u1', 'someone.else', CONG, 'admin-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does nothing at all when the name is unchanged', async () => {
    await service.changeLoginNameByAdmin(
      'u1',
      'bakmann.lionel',
      CONG,
      'admin-1',
    );

    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.logUpdate).not.toHaveBeenCalled();
  });
});

describe('loginNameProblem', () => {
  it('accepts what the generator itself produces', () => {
    // If these ever disagreed, an account would be born with a name its own
    // owner could not retype.
    expect(loginNameProblem('sidorova.vera')).toBeNull();
    expect(loginNameProblem('mueller.joerg2')).toBeNull();
  });

  it('names each refusal so the screen can put it in words', () => {
    expect(loginNameProblem('ab')).toBe('tooShort');
    expect(loginNameProblem('a'.repeat(65))).toBe('tooLong');
    expect(loginNameProblem('vera@gmail.com')).toBe('badCharacters');
    expect(loginNameProblem('vera sidorova')).toBe('badCharacters');
    expect(loginNameProblem('.vera')).toBe('edgeDot');
    expect(loginNameProblem('vera..sidorova')).toBe('edgeDot');
  });
});
