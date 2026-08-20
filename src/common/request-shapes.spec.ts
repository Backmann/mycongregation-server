// The tasks controller pulls in the push module, which ships ESM that Jest
// will not parse. Nothing here sends a push; stubbing keeps the import graph
// quiet without weakening what is being checked.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitReportDto } from '../service-reports/dto/submit-report.dto';
import { UpdateReportDto } from '../service-reports/dto/update-report.dto';
import { UpdateAssignmentDto } from '../assignments/dto/update-assignment.dto';
import { UpdateAccessDto } from '../publishers/dto/update-access.dto';
import { LoginDto } from '../auth/dto/login.dto';
import {
  RedeemInviteDto,
  ResetPasswordDto,
} from '../auth/dto/reset-password.dto';
import { ForgotPasswordDto } from '../auth/dto/forgot-password.dto';
import {
  MakeTaskDto,
  MoveItemDto,
  CarryOverDto,
} from '../tasks/tasks.controller';

/**
 * The shapes the app actually sends, checked against the shapes the server
 * declares.
 *
 * These exist because of a whole afternoon lost to «property loginName should
 * not exist». The two sides describe every request TWICE — an interface in the
 * app, a DTO here — and nothing compares them. The compiler cannot: it sees
 * one repository at a time. The service tests cannot either: they call methods
 * directly, so the request body never passes a validator at all.
 *
 * ValidationPipe runs with forbidNonWhitelisted, which means an undeclared
 * field does not get quietly dropped — the WHOLE request is refused. So a
 * field added to a screen and forgotten here does not degrade the feature; it
 * removes it, and the button simply does nothing.
 *
 * When one of these fails, the fix is usually to add the field to the DTO —
 * not to delete it from the test. The test is a copy of what a real screen
 * sends today.
 */
const check = async (cls: new () => object, payload: Record<string, unknown>) =>
  validate(plainToInstance(cls, payload) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const fieldsRefused = (errors: { property: string }[]) =>
  errors.map((e) => e.property);

describe('request shapes the app sends', () => {
  describe('submitting a service report', () => {
    it('takes what an ordinary publisher sends', async () => {
      expect(
        await check(SubmitReportDto, {
          reportMonth: '2026-08',
          servedThisMonth: true,
          bibleStudies: 0,
          notes: 'по телефону',
        }),
      ).toHaveLength(0);
    });

    it('takes what a pioneer sends — hours instead of the yes/no', async () => {
      expect(
        await check(SubmitReportDto, {
          reportMonth: '2026-08',
          hoursReported: 52,
          bibleStudies: 3,
        }),
      ).toHaveLength(0);
    });

    it('takes an elder filing on somebody else\u2019s behalf', async () => {
      expect(
        await check(SubmitReportDto, {
          reportMonth: '2026-08',
          publisherId: '0f2b4c62-1f7d-4a1e-9d33-2b9b3c5d7e11',
          servedThisMonth: true,
          bibleStudies: 1,
        }),
      ).toHaveLength(0);
    });

    it('still refuses a month in the wrong shape', async () => {
      // The guard has to bite, or these tests only prove the DTO is empty.
      const errors = await check(SubmitReportDto, {
        reportMonth: 'август',
        bibleStudies: 0,
      });
      expect(fieldsRefused(errors)).toContain('reportMonth');
    });

    it('takes an edit of a filed report', async () => {
      expect(
        await check(UpdateReportDto, {
          servedThisMonth: true,
          hoursReported: 12,
          bibleStudies: 2,
          notes: '',
        }),
      ).toHaveLength(0);
    });
  });

  describe('an assignment being edited on the schedule screen', () => {
    it('takes the whole payload, including the nulls that clear a field', async () => {
      expect(
        await check(UpdateAssignmentDto, {
          weekStartDate: '2026-08-24',
          eventType: 'midweek',
          partKey: 'bible_reading',
          partOrder: 3,
          partTitle: 'Чтение Библии',
          partDurationMin: 4,
          publisherId: null,
          assistantPublisherId: null,
          status: 'draft',
          notes: '',
        }),
      ).toHaveLength(0);
    });
  });

  describe('the access card', () => {
    it('takes every field the card can change at once', async () => {
      expect(
        await check(UpdateAccessDto, {
          email: 'family@gmail.com',
          loginName: 'sidorova.vera',
          password: 'correct horse battery',
          isAdmin: false,
          isActive: true,
          canViewPrivateData: false,
        }),
      ).toHaveLength(0);
    });

    it('takes an emptied address — that is how one is removed now', async () => {
      expect(await check(UpdateAccessDto, { email: '' })).toHaveLength(0);
    });
  });

  describe('the doors into the app', () => {
    it('takes a sign-in by login name', async () => {
      expect(
        await check(LoginDto, {
          login: 'sidorova.vera',
          email: 'sidorova.vera',
          password: 'correct horse battery',
        }),
      ).toHaveLength(0);
    });

    it('takes the eight-character password of somebody who set one before the floor rose', async () => {
      expect(
        await check(LoginDto, { login: 'x.y', password: '12345678' }),
      ).toHaveLength(0);
    });

    it('takes an invitation redeemed with the code alone', async () => {
      expect(
        await check(RedeemInviteDto, {
          code: 'K7QM3XPD',
          password: 'correct horse battery',
        }),
      ).toHaveLength(0);
    });

    it('still takes the address older app builds send with it', async () => {
      expect(
        await check(RedeemInviteDto, {
          email: 'vera@gmail.com',
          code: 'K7QM3XPD',
          password: 'correct horse battery',
        }),
      ).toHaveLength(0);
    });

    it('takes a forgotten password asked for by name or by address', async () => {
      expect(
        await check(ForgotPasswordDto, { login: 'sidorova.vera' }),
      ).toHaveLength(0);
      expect(
        await check(ForgotPasswordDto, {
          login: 'vera@gmail.com',
          email: 'vera@gmail.com',
        }),
      ).toHaveLength(0);
    });

    it('takes a password set from the link in a letter', async () => {
      expect(
        await check(ResetPasswordDto, {
          token: 'a'.repeat(64),
          password: 'correct horse battery',
        }),
      ).toHaveLength(0);
    });
  });

  describe('the agenda of the elders\u2019 meeting', () => {
    it('takes an item turned into a task', async () => {
      expect(
        await check(MakeTaskDto, {
          assigneePublisherIds: ['0f2b4c62-1f7d-4a1e-9d33-2b9b3c5d7e11'],
          assigneeKind: 'people',
          dueDate: '2026-09-01',
          details: 'обсудить с секретарём',
        }),
      ).toHaveLength(0);
    });

    it('refuses an assignee kind nobody has ever heard of', async () => {
      const errors = await check(MakeTaskDto, { assigneeKind: 'everybody' });
      expect(fieldsRefused(errors)).toContain('assigneeKind');
    });

    it('takes an item moved and an item carried over', async () => {
      expect(await check(MoveItemDto, { direction: 'up' })).toHaveLength(0);
      expect(
        await check(CarryOverDto, {
          toMeetingId: '0f2b4c62-1f7d-4a1e-9d33-2b9b3c5d7e11',
        }),
      ).toHaveLength(0);
      expect(await check(CarryOverDto, {})).toHaveLength(0);
    });
  });

  it('refuses a field nobody declared — the failure this file exists for', async () => {
    // Not a warning, not a dropped field: the request is refused whole, and
    // the screen looks broken rather than wrong.
    const errors = await check(MoveItemDto, {
      direction: 'up',
      somethingNew: true,
    });
    expect(fieldsRefused(errors)).toContain('somethingNew');
  });
});
