#!/usr/bin/env node
/**
 * patch-invite-specs.cjs — UsersService получил зависимость MailService,
 * поэтому два спека, создающие сервис через настоящий конструктор, должны
 * предоставить мок MailService (иначе Nest не резолвит DI). Добавляет
 * импорт + провайдер-мок в users.service.spec.ts и users.change-email.spec.ts.
 * Применять ВМЕСТЕ с серверным invite-патчем. Idempotent; LF/CRLF tolerant.
 * Запускать из ~/congmap/server.
 */
const fs = require('fs');

function nl(lines) {
  return lines.join('\n');
}

function patchFile(file, guard, edits) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.log(`FAIL: cannot read ${file}: ${e.message}`);
    process.exit(1);
  }
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let txt = raw.split('\r\n').join('\n');
  if (txt.includes(guard)) {
    console.log(`SKIP: ${file} already patched (${guard})`);
    return;
  }
  for (const [label, anchor, replacement] of edits) {
    const parts = txt.split(anchor);
    if (parts.length !== 2) {
      console.log(`FAIL: anchor for "${label}" in ${file} found ${parts.length - 1} time(s), expected 1`);
      process.exit(1);
    }
    txt = parts[0] + replacement + parts[1];
    console.log(`OK: ${label}`);
  }
  fs.writeFileSync(file, txt.split('\n').join(eol));
  console.log(`OK: ${file} written`);
}

const mailMockProvider = nl([
  '        {',
  '          provide: MailService,',
  '          useValue: {',
  '            sendInvite: jest.fn().mockResolvedValue(undefined),',
  '            sendPasswordReset: jest.fn().mockResolvedValue(undefined),',
  '          },',
  '        },',
]);

// 1) users.service.spec.ts
patchFile('src/users/users.service.spec.ts', "provide: MailService", [
  [
    'service-spec: import MailService',
    "import { AuditLogService } from '../audit-log/audit-log.service';",
    nl([
      "import { AuditLogService } from '../audit-log/audit-log.service';",
      "import { MailService } from '../mail/mail.service';",
    ]),
  ],
  [
    'service-spec: mail provider',
    '        { provide: getRepositoryToken(User), useValue: repo },',
    nl([
      '        { provide: getRepositoryToken(User), useValue: repo },',
      mailMockProvider,
    ]),
  ],
]);

// 2) users.change-email.spec.ts
patchFile('src/users/users.change-email.spec.ts', "provide: MailService", [
  [
    'change-email-spec: import MailService',
    "import { ConfigService } from '@nestjs/config';",
    nl([
      "import { ConfigService } from '@nestjs/config';",
      "import { MailService } from '../mail/mail.service';",
    ]),
  ],
  [
    'change-email-spec: mail provider',
    '        { provide: getRepositoryToken(User), useValue: repo },',
    nl([
      '        { provide: getRepositoryToken(User), useValue: repo },',
      mailMockProvider,
    ]),
  ],
]);

console.log('DONE: spec mocks for MailService');
