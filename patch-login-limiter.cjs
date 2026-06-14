#!/usr/bin/env node
/**
 * patch-login-limiter.cjs — лимитер попыток входа: 6 попыток за 15 минут
 * по email и по IP (sliding window, тем же механизмом, что forgotPassword).
 * При превышении — 429 Too Many Requests; успешный вход сбрасывает счётчик
 * для email. Контроллер протаскивает req.ip так же, как forgot-password.
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

// ===== 1) auth.service.ts =====
patchFile('src/auth/auth.service.ts', 'loginAttempts', [
  // 1a) импорт исключения 429
  [
    'service: import TooManyRequests',
    nl([
      '  Injectable,',
      '  NotFoundException,',
      '  UnauthorizedException,',
      "} from '@nestjs/common';",
    ]),
    nl([
      '  HttpException,',
      '  HttpStatus,',
      '  Injectable,',
      '  NotFoundException,',
      '  UnauthorizedException,',
      "} from '@nestjs/common';",
    ]),
  ],
  // 1b) login(dto, ip) + проверка лимита и сброс при успехе
  [
    'service: limiter in login',
    nl([
      '  async login(dto: LoginDto) {',
      '    const user = await this.usersService.findByEmailWithPassword(dto.email);',
      '    if (!user || !user.isActive) {',
      "      throw new UnauthorizedException('Invalid credentials');",
      '    }',
      '    const ok = await bcrypt.compare(dto.password, user.passwordHash);',
      '    if (!ok) {',
      "      throw new UnauthorizedException('Invalid credentials');",
      '    }',
      '    await this.usersService.touchLastLogin(user.id);',
      '    return this.issueTokens(user);',
      '  }',
    ]),
    nl([
      "  /** Sliding-window in-memory limiter for login; key -> recent times. */",
      '  private readonly loginAttempts = new Map<string, number[]>();',
      '  private allowLogin(key: string, limit: number, windowMs: number): boolean {',
      '    const now = Date.now();',
      '    const recent = (this.loginAttempts.get(key) ?? []).filter(',
      '      (t) => now - t < windowMs,',
      '    );',
      '    if (recent.length >= limit) {',
      '      this.loginAttempts.set(key, recent);',
      '      return false;',
      '    }',
      '    recent.push(now);',
      '    this.loginAttempts.set(key, recent);',
      '    return true;',
      '  }',
      '',
      "  async login(dto: LoginDto, ip = 'unknown') {",
      '    const FIFTEEN_MIN = 15 * 60 * 1000;',
      '    const email = dto.email.toLowerCase().trim();',
      '    // 6 attempts / 15 min, by email and by IP.',
      '    if (',
      '      !this.allowLogin(`login:email:${email}`, 6, FIFTEEN_MIN) ||',
      '      !this.allowLogin(`login:ip:${ip}`, 6, FIFTEEN_MIN)',
      '    ) {',
      '      throw new HttpException(',
      "        'Too many login attempts. Please try again later.',",
      '        HttpStatus.TOO_MANY_REQUESTS,',
      '      );',
      '    }',
      '    const user = await this.usersService.findByEmailWithPassword(dto.email);',
      '    if (!user || !user.isActive) {',
      "      throw new UnauthorizedException('Invalid credentials');",
      '    }',
      '    const ok = await bcrypt.compare(dto.password, user.passwordHash);',
      '    if (!ok) {',
      "      throw new UnauthorizedException('Invalid credentials');",
      '    }',
      '    // Successful login clears the email counter.',
      '    this.loginAttempts.delete(`login:email:${email}`);',
      '    await this.usersService.touchLastLogin(user.id);',
      '    return this.issueTokens(user);',
      '  }',
    ]),
  ],
]);

// ===== 2) auth.controller.ts: протащить req.ip =====
patchFile('src/auth/auth.controller.ts', 'login(@Body() dto: LoginDto, @Req()', [
  [
    'controller: pass ip to login',
    nl([
      '  @Post(\'login\')',
      '  login(@Body() dto: LoginDto) {',
      '    return this.authService.login(dto);',
      '  }',
    ]),
    nl([
      '  @Post(\'login\')',
      '  login(@Body() dto: LoginDto, @Req() req: Request) {',
      "    return this.authService.login(dto, req.ip ?? 'unknown');",
      '  }',
    ]),
  ],
]);

console.log('DONE: login rate limiter (6 / 15 min by email and IP)');
