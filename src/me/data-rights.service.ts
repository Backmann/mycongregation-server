import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { Absence } from '../entities/absence.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CartRequest } from '../entities/cart-request.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { PushToken } from '../entities/push-token.entity';
import { WebPushSubscription } from '../entities/web-push-subscription.entity';
import { PushReceipt } from '../entities/push-receipt.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';

/**
 * Self-service data-subject rights (GDPR) for the signed-in member.
 *
 * Scope is always the requester themselves: their own User account and the
 * Publisher record linked via publisher.userId — never the wider congregation
 * data they may otherwise see as an elder/admin.
 *
 * Erasure is implemented as in-place anonymisation, because service_reports
 * reference the publisher with onDelete: RESTRICT and several schedule tables
 * keep historical references. Anonymising satisfies Art. 17 (personal data is
 * removed) while preserving the congregation's organisational records.
 */
@Injectable()
export class DataRightsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** GDPR Art. 15/20 — assemble the requester's own data as a JSON bundle. */
  async exportMyData(tenantId: string, userId: string) {
    const ds = this.dataSource;
    const account = await ds
      .getRepository(User)
      .findOne({ where: { id: userId } });
    const publisher = await ds
      .getRepository(Publisher)
      .findOne({ where: { congregationId: tenantId, userId } });
    const pubId = publisher?.id ?? null;

    const [
      absences,
      serviceReports,
      assignments,
      duties,
      talkExchanges,
      cartRequests,
      cartAssignments,
    ] = pubId
      ? await Promise.all([
          ds.getRepository(Absence).find({ where: { publisherId: pubId } }),
          ds
            .getRepository(ServiceReport)
            .find({ where: { publisherId: pubId } }),
          ds.getRepository(Assignment).find({ where: { publisherId: pubId } }),
          ds.getRepository(Duty).find({ where: { publisherId: pubId } }),
          ds
            .getRepository(TalkExchange)
            .find({ where: { publisherId: pubId } }),
          ds.getRepository(CartRequest).find({ where: { publisherId: pubId } }),
          ds
            .getRepository(CartAssignment)
            .find({ where: { publisherId: pubId } }),
        ])
      : [[], [], [], [], [], [], []];

    const responsibilities = await ds
      .getRepository(Responsibility)
      .find({ where: { congregationId: tenantId, userId } });
    const webPushSubscriptions = await ds
      .getRepository(WebPushSubscription)
      .count({ where: { userId } });
    const pushTokens = await ds
      .getRepository(PushToken)
      .count({ where: { userId } });

    return {
      exportedAt: new Date().toISOString(),
      note: 'Personal data export under GDPR Art. 15/20.',
      controller: {
        name: 'Lionel Backmann',
        email: 'info@mycongregation.org',
        address: 'Beverfördering 66, 59071 Hamm, Deutschland',
      },
      account: account
        ? {
            id: account.id,
            email: account.email,
            role: account.role,
            uiLanguage: account.uiLanguage,
            isActive: account.isActive,
            createdAt: account.createdAt,
            lastLoginAt: account.lastLoginAt,
          }
        : null,
      publisher: publisher ?? null,
      absences,
      serviceReports,
      assignments,
      duties,
      talkExchanges,
      cartRequests,
      cartAssignments,
      responsibilities,
      devices: { webPushSubscriptions, pushTokens },
    };
  }

  /**
   * GDPR Art. 17 — instant self-service erasure.
   * Requires the account password. Blocks the last active admin from locking
   * the congregation out. Runs as a single transaction.
   */
  async eraseMyAccount(tenantId: string, userId: string, password: string) {
    const usersRepo = this.dataSource.getRepository(User);
    const user = await usersRepo.findOne({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        congregationId: true,
        passwordHash: true,
      },
    });
    if (!user || !user.passwordHash) {
      throw new BadRequestException('Account cannot be erased.');
    }

    // Not "the owner may not leave" — that would be a loss of rights, and a
    // questionable one where erasure is a protected right. What must not
    // happen is the LAST owner leaving: with none, nobody can reach the
    // platform endpoints and the backups become unreachable. Appoint another
    // and this door opens.
    if (user.isOwner) {
      const owners = await usersRepo.count({ where: { isOwner: true } });
      if (owners <= 1) {
        throw new BadRequestException(
          'The last platform owner cannot be removed. Appoint another owner first.',
        );
      }
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('Invalid password.');
    }

    if (user.role === UserRole.ADMIN) {
      const admins = await usersRepo.count({
        where: {
          congregationId: tenantId,
          role: UserRole.ADMIN,
          isActive: true,
        },
      });
      if (admins <= 1) {
        throw new ConflictException(
          'LAST_ADMIN: assign another administrator before deleting your account.',
        );
      }
    }

    await this.dataSource.transaction(async (m) => {
      const publisher = await m.findOne(Publisher, {
        where: { congregationId: tenantId, userId },
      });
      if (publisher) {
        publisher.firstName = 'Удалённый';
        publisher.middleName = null;
        publisher.lastName = 'возвещатель';
        publisher.displayName = 'Удалённый возвещатель';
        publisher.birthDate = null;
        publisher.mobilePhone = null;
        publisher.email = null;
        publisher.address = null;
        publisher.baptismDate = null;
        publisher.ministryStartDate = null;
        publisher.pioneerSince = null;
        publisher.pioneerType = PioneerType.NONE;
        publisher.appointment = PublisherAppointment.PUBLISHER;
        publisher.capabilities = {};
        publisher.publicTalkNumbers = [];
        publisher.notes = null;
        publisher.removedNote = null;
        publisher.isActive = false;
        publisher.removedAt = new Date();
        publisher.anonymizedAt = new Date();
        publisher.userId = null;
        await m.save(Publisher, publisher);

        // Keep the numbers (hours / Bible studies) attached to the anonymised
        // record for congregation totals; only the free-text notes are wiped.
        await m.update(
          ServiceReport,
          { publisherId: publisher.id },
          { notes: null },
        );
      }

      // Technical / contact records tied to the login.
      await m.delete(PushToken, { userId });
      await m.delete(WebPushSubscription, { userId });
      await m.delete(PushReceipt, { userId });
      await m.delete(Responsibility, { userId });

      // Empty every journal entry that held this person's values. The entries
      // stay: what an administrator did last March is the congregation's
      // record and must not disappear because a member exercised a right.
      // What goes is only what was theirs.
      const concerned = [userId, publisher?.id].filter(
        (v): v is string => typeof v === 'string',
      );
      const pending = await m.find(AuditLog, {
        where: [
          { congregationId: tenantId, actorUserId: In(concerned) },
          { congregationId: tenantId, subjectId: In(concerned) },
          { congregationId: tenantId, entityId: In(concerned) },
        ],
      });
      for (const row of pending) {
        if (row.redactedAt) continue;
        row.beforeJson = null;
        row.afterJson = null;
        row.changedFields = [];
        row.redactedAt = new Date();
        await m.save(AuditLog, row);
      }

      // Record the erasure event itself (IDs + timestamp only, no erased PII).
      await m.insert(AuditLog, {
        congregationId: tenantId,
        entityType: 'user',
        entityId: userId,
        action: 'erase',
        actorUserId: userId,
      });

      // Remove the login identity entirely (email is unique and personal).
      await m.delete(User, { id: userId });
    });

    return { erased: true };
  }
}
