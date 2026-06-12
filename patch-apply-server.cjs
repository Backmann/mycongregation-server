#!/usr/bin/env node
/**
 * patch-apply-server.cjs — серверная половина клиентского импорта EPUB.
 *  - mwb-import.service.ts: метод applyParsed (переиспользует importWeek)
 *  - mwb-import.controller.ts: POST …/apply (@Body ApplyParsedDto)
 * Новые файлы (DTO + spec) приходят в tar как полные файлы.
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
    console.log(`SKIP: ${file} already patched (${guard} present)`);
    return;
  }

  for (const [label, anchor, replacement] of edits) {
    const parts = txt.split(anchor);
    if (parts.length !== 2) {
      console.log(`FAIL: anchor for "${label}" found ${parts.length - 1} time(s), expected 1`);
      process.exit(1);
    }
    txt = parts[0] + replacement + parts[1];
    console.log(`OK: ${label}`);
  }

  fs.writeFileSync(file, txt.split('\n').join(eol));
  console.log(`OK: ${file} written`);
}

// ---------- src/mwb-import/mwb-import.service.ts ----------
patchFile('src/mwb-import/mwb-import.service.ts', 'applyParsed', [
  [
    'service: import ApplyParsedDto',
    "import { ImportResultDto, WeekImportSummary } from './dto/import-result.dto';",
    nl([
      "import { ImportResultDto, WeekImportSummary } from './dto/import-result.dto';",
      "import { ApplyParsedDto } from './dto/apply-parsed.dto';",
    ]),
  ],
  [
    'service: applyParsed method',
    '  private async importWeek(',
    nl([
      '  /**',
      '   * Applies a workbook that was parsed on the CLIENT (browser). The EPUB',
      '   * file itself never reaches the server — the payload contains only',
      '   * derived schedule metadata. Reuses the same idempotent per-week',
      '   * upsert as the upload flow.',
      '   */',
      '  async applyParsed(',
      '    congregationId: string,',
      '    dto: ApplyParsedDto,',
      '  ): Promise<ImportResultDto> {',
      '    const result: ImportResultDto = {',
      "      epubFile: dto.epubFile ?? 'client-parsed.epub',",
      '      year: dto.year ?? new Date().getFullYear(),',
      '      weeksImported: 0,',
      '      partsCreated: 0,',
      '      partsUpdated: 0,',
      '      partsSkipped: 0,',
      '      unclassifiedParts: 0,',
      '      weeks: [],',
      '      errors: [],',
      '      warnings: [],',
      '    };',
      '',
      '    for (const week of dto.weeks) {',
      '      const parts: ParsedPart[] = week.parts.map((p) => ({',
      '        rawTitle: p.partTitle ?? null,',
      '        rawNumber: null,',
      "        rawSection: 'client',",
      '        durationMin: p.partDurationMin ?? null,',
      '        durationRawText: null,',
      '        notes: [],',
      '        partKey: p.partKey,',
      '        partOrder: p.partOrder,',
      "        classifierConfidence: 'high' as const,",
      '        synthetic: p.partTitle == null,',
      '      }));',
      '      const summary = await this.importWeek(',
      '        congregationId,',
      '        week.weekStartDate,',
      '        week.weekEndDate,',
      "        week.biblePassage ?? '',",
      '        parts,',
      '        result,',
      '      );',
      '      result.weeks.push(summary);',
      '      result.weeksImported++;',
      '    }',
      '',
      '    this.logger.log(',
      '      `Applied client-parsed ${result.epubFile}: ${result.weeksImported} weeks, ` +',
      '        `${result.partsCreated} created, ${result.partsUpdated} updated, ` +',
      '        `${result.partsSkipped} skipped`,',
      '    );',
      '',
      '    return result;',
      '  }',
      '',
      '  private async importWeek(',
    ]),
  ],
]);

// ---------- src/mwb-import/mwb-import.controller.ts ----------
patchFile('src/mwb-import/mwb-import.controller.ts', "@Post('apply')", [
  [
    'controller: Body import',
    nl(['  BadRequestException,', '  Controller,']),
    nl(['  BadRequestException,', '  Body,', '  Controller,']),
  ],
  [
    'controller: ApplyParsedDto import',
    "import { MwbImportService } from './mwb-import.service';",
    nl([
      "import { MwbImportService } from './mwb-import.service';",
      "import { ApplyParsedDto } from './dto/apply-parsed.dto';",
    ]),
  ],
  [
    'controller: apply route',
    nl([
      '    return this.service.import(congregationId, file.buffer, file.originalname);',
      '  }',
      '}',
    ]),
    nl([
      '    return this.service.import(congregationId, file.buffer, file.originalname);',
      '  }',
      '',
      '  /**',
      '   * Accepts a workbook parsed on the client. No publication file is',
      '   * uploaded — the payload contains only derived schedule metadata',
      '   * (part keys, titles, durations).',
      '   */',
      "  @Post('apply')",
      '  @UseGuards(RolesGuard)',
      '  @Roles(UserRole.ADMIN, UserRole.ELDER)',
      '  apply(',
      '    @TenantId() congregationId: string,',
      '    @Body() dto: ApplyParsedDto,',
      '  ) {',
      '    return this.service.applyParsed(congregationId, dto);',
      '  }',
      '}',
    ]),
  ],
]);

console.log('DONE: server apply endpoint patched');
