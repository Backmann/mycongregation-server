#!/usr/bin/env node
/**
 * patch-publish-notify-server.cjs — два вида публикации встречи:
 * с уведомлением (push братьям, поведение по умолчанию) и тихо
 * (только статус published, без push). Протаскивает флаг notify через
 * DTO → контроллер → publishMeeting; push шлётся только при notify!==false,
 * поэтому старые вызовы без флага по-прежнему уведомляют.
 * Idempotent; LF/CRLF tolerant. Запускать из ~/congmap/server.
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

// 1) DTO: + notify?: boolean
patchFile(
  'src/assignments/dto/publish-assignments.dto.ts',
  'notify',
  [
    [
      'dto: imports IsBoolean/IsOptional',
      "import { IsEnum, IsISO8601 } from 'class-validator';",
      "import { IsBoolean, IsEnum, IsISO8601, IsOptional } from 'class-validator';",
    ],
    [
      'dto: notify field',
      nl([
        '  @IsEnum(EventType)',
        '  eventType!: EventType;',
        '}',
      ]),
      nl([
        '  @IsEnum(EventType)',
        '  eventType!: EventType;',
        '',
        '  /**',
        '   * Whether to notify the congregation (push). Defaults to true to',
        '   * preserve existing behaviour; pass false for a silent publish.',
        '   */',
        '  @IsOptional()',
        '  @IsBoolean()',
        '  notify?: boolean;',
        '}',
      ]),
    ],
  ],
);

// 2) сервис: 4-й параметр notify + условие на push
patchFile(
  'src/assignments/assignments.service.ts',
  'notify = true',
  [
    [
      'service: notify param',
      nl([
        '  async publishMeeting(',
        '    congregationId: string,',
        '    weekStartDate: string,',
        '    eventType: EventType,',
        '  ): Promise<{ published: number }> {',
      ]),
      nl([
        '  async publishMeeting(',
        '    congregationId: string,',
        '    weekStartDate: string,',
        '    eventType: EventType,',
        '    notify = true,',
        '  ): Promise<{ published: number }> {',
      ]),
    ],
    [
      'service: guard push by notify',
      'if (published > 0 && (kind === \'midweek\' || kind === \'weekend\')) {',
      "if (notify && published > 0 && (kind === 'midweek' || kind === 'weekend')) {",
    ],
  ],
);

// 3) контроллер: передать dto.notify
patchFile(
  'src/assignments/assignments.controller.ts',
  'dto.notify',
  [
    [
      'controller: pass notify',
      nl([
        '    return this.service.publishMeeting(',
        '      congregationId,',
        '      dto.weekStartDate,',
        '      dto.eventType,',
        '    );',
      ]),
      nl([
        '    return this.service.publishMeeting(',
        '      congregationId,',
        '      dto.weekStartDate,',
        '      dto.eventType,',
        '      dto.notify,',
        '    );',
      ]),
    ],
  ],
);

console.log('DONE: server supports silent publish (notify flag)');
