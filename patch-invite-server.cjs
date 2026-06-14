#!/usr/bin/env node
/**
 * patch-invite-server.cjs — приглашение по email (честный invite-флоу):
 * аккаунт создаётся без пароля, выпускается invite-токен (reset-токен,
 * TTL 72ч), шлётся письмо «задайте пароль». Переиспускает /reset-password.
 *  - User.passwordHash → nullable (миграция 1799 отдельным файлом)
 *  - CreateUserDto.password → опциональный
 *  - createUserByAdmin → ветка без пароля (passwordHash=null)
 *  - GrantAccessDto → password опциональный + sendInvite
 *  - grantAccess → invite-флоу при sendInvite
 *  - mailService.sendInvite (по образцу sendPasswordReset)
 *  - login → явная защита от null-хэша (приглашённый без пароля не входит)
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

// ===== 1) entity: passwordHash nullable =====
patchFile('src/entities/user.entity.ts', 'passwordHash!: string | null', [
  [
    'entity: nullable passwordHash',
    nl([
      "  @Column({ type: 'varchar', length: 255, select: false })",
      '  passwordHash!: string;',
    ]),
    nl([
      "  @Column({ type: 'varchar', length: 255, select: false, nullable: true })",
      '  passwordHash!: string | null;',
    ]),
  ],
]);

// ===== 2) CreateUserDto: password optional =====
patchFile('src/users/dto/create-user.dto.ts', "password?: string", [
  [
    'dto: optional password',
    nl([
      '  @IsString()',
      '  @MinLength(8)',
      '  password!: string;',
    ]),
    nl([
      '  @IsOptional()',
      '  @IsString()',
      '  @MinLength(8)',
      '  password?: string;',
    ]),
  ],
]);

// ===== 3) createUserByAdmin: ветка без пароля =====
patchFile('src/users/users.service.ts', 'dto.password ? await this.hashPassword', [
  [
    'service: nullable password hash',
    'const passwordHash = await this.hashPassword(dto.password);',
    'const passwordHash = dto.password\n      ? await this.hashPassword(dto.password)\n      : null;',
  ],
]);

// ===== 4) GrantAccessDto: password optional + sendInvite =====
patchFile('src/publishers/dto/grant-access.dto.ts', 'sendInvite', [
  [
    'grant-dto: optional password + sendInvite',
    nl([
      '  @MinLength(8)',
      '  @MaxLength(128)',
      '  password!: string;',
      '',
      '  @IsOptional()',
      '  @IsBoolean()',
      '  isAdmin?: boolean;',
      '}',
    ]),
    nl([
      '  @IsOptional()',
      '  @MinLength(8)',
      '  @MaxLength(128)',
      '  password?: string;',
      '',
      '  @IsOptional()',
      '  @IsBoolean()',
      '  isAdmin?: boolean;',
      '',
      '  /** When true, create the account without a password and email an',
      '   * invitation link to set one (instead of an admin-set password). */',
      '  @IsOptional()',
      '  @IsBoolean()',
      '  sendInvite?: boolean;',
      '}',
    ]),
  ],
]);

// ===== 5) grantAccess: invite-флоу =====
patchFile('src/publishers/publishers.service.ts', 'sendInvitation', [
  [
    'grant: invite flow',
    nl([
      '    const role = dto.isAdmin',
      '      ? UserRole.ADMIN',
      '      : deriveRoleFromAppointment(publisher.appointment);',
      '    const created = await this.usersService.createUserByAdmin(',
      '      { email, password: dto.password, role },',
      '      tenantId,',
      '      actor.id,',
      '    );',
      '    publisher.userId = created.id;',
      '    await this.publishersRepo.save(publisher);',
      '    return this.getAccess(tenantId, id);',
    ]),
    nl([
      '    const role = dto.isAdmin',
      '      ? UserRole.ADMIN',
      '      : deriveRoleFromAppointment(publisher.appointment);',
      '',
      '    if (!dto.sendInvite && !dto.password) {',
      '      throw new BadRequestException(',
      "        'Provide a password or enable the email invitation',",
      '      );',
      '    }',
      '',
      '    const created = await this.usersService.createUserByAdmin(',
      '      {',
      '        email,',
      '        password: dto.sendInvite ? undefined : dto.password,',
      '        role,',
      '      },',
      '      tenantId,',
      '      actor.id,',
      '    );',
      '    publisher.userId = created.id;',
      '    await this.publishersRepo.save(publisher);',
      '',
      '    if (dto.sendInvite) {',
      '      // sendInvitation: issue a 72h token and email the link.',
      '      await this.usersService.sendInvitation(created.id, email);',
      '    }',
      '',
      '    return this.getAccess(tenantId, id);',
    ]),
  ],
]);

console.log('DONE: invite server core (entity/dto/grant)');

// ===== 6) users.service: инжект MailService + метод sendInvitation =====
patchFile('src/users/users.service.ts', 'async sendInvitation', [
  [
    'users: import MailService + crypto',
    "import { ConfigService } from '@nestjs/config';",
    nl([
      "import { ConfigService } from '@nestjs/config';",
      "import { createHash, randomBytes } from 'crypto';",
      "import { MailService } from '../mail/mail.service';",
    ]),
  ],
  [
    'users: inject MailService',
    nl([
      '    private readonly config: ConfigService,',
      '  ) {}',
    ]),
    nl([
      '    private readonly config: ConfigService,',
      '    private readonly mailService: MailService,',
      '  ) {}',
    ]),
  ],
  [
    'users: sendInvitation method',
    '  private hashPassword(password: string): Promise<string> {',
    nl([
      '  /**',
      '   * Issue a 72h invitation token for an account and email the link, so',
      '   * the invited person sets their own password via /reset-password.',
      '   */',
      '  async sendInvitation(userId: string, email: string): Promise<void> {',
      '    const THREE_DAYS = 72 * 60 * 60 * 1000;',
      "    const token = randomBytes(32).toString('hex');",
      "    const tokenHash = createHash('sha256').update(token).digest('hex');",
      '    const expiresAt = new Date(Date.now() + THREE_DAYS);',
      '    await this.setPasswordResetToken(userId, tokenHash, expiresAt);',
      '    const user = await this.findById(userId);',
      "    const lang = user?.uiLanguage ?? 'ru';",
      '    const base =',
      "      this.config.get<string>('PUBLIC_APP_URL') ??",
      "      'https://mycongregation.org';",
      '    const link = `${base}/reset-password?token=${token}`;',
      '    await this.mailService.sendInvite(email, lang, link);',
      '  }',
      '',
      '  private hashPassword(password: string): Promise<string> {',
    ]),
  ],
]);

// ===== 7) mail.service: sendInvite + строки =====
patchFile('src/mail/mail.service.ts', 'async sendInvite', [
  [
    'mail: STRINGS type widen',
    '  { subject: string; body: string; button: string; ignore: string }',
    nl([
      '  {',
      '    subject: string;',
      '    body: string;',
      '    button: string;',
      '    ignore: string;',
      '    inviteSubject: string;',
      '    inviteBody: string;',
      '    inviteButton: string;',
      '    inviteIgnore: string;',
      '  }',
    ]),
  ],
  [
    'mail: invite strings ru',
    "    subject: 'Восстановление пароля — mycongregation.org',",
    nl([
      "    inviteSubject: 'Приглашение — mycongregation.org',",
      "    inviteBody:",
      "      'Вас пригласили в приложение собрания mycongregation.org. Чтобы задать пароль и войти, перейдите по ссылке (действует 72 часа):',",
      "    inviteButton: 'Задать пароль и войти',",
      "    inviteIgnore:",
      "      'Если вы не ожидали это приглашение, просто проигнорируйте письмо.',",
      "    subject: 'Восстановление пароля — mycongregation.org',",
    ]),
  ],
  [
    'mail: invite strings en',
    "    subject: 'Password reset — mycongregation.org',",
    nl([
      "    inviteSubject: 'Invitation — mycongregation.org',",
      "    inviteBody:",
      "      'You have been invited to the mycongregation.org congregation app. To set your password and sign in, follow the link (valid for 72 hours):',",
      "    inviteButton: 'Set password and sign in',",
      "    inviteIgnore:",
      "      'If you were not expecting this invitation, simply ignore this email.',",
      "    subject: 'Password reset — mycongregation.org',",
    ]),
  ],
  [
    'mail: invite strings de',
    "    subject: 'Passwort zurücksetzen — mycongregation.org',",
    nl([
      "    inviteSubject: 'Einladung — mycongregation.org',",
      "    inviteBody:",
      "      'Sie wurden zur Versammlungs-App mycongregation.org eingeladen. Um Ihr Passwort festzulegen und sich anzumelden, folgen Sie dem Link (72 Stunden gültig):',",
      "    inviteButton: 'Passwort festlegen und anmelden',",
      "    inviteIgnore:",
      "      'Wenn Sie diese Einladung nicht erwartet haben, ignorieren Sie diese E-Mail einfach.',",
      "    subject: 'Passwort zurücksetzen — mycongregation.org',",
    ]),
  ],
  [
    'mail: sendInvite method',
    '  async sendPasswordReset(',
    nl([
      '  async sendInvite(to: string, lang: string, link: string): Promise<void> {',
      '    const L = STRINGS[lang as Lang] ?? STRINGS.ru;',
      '    const text = `${L.inviteBody}\\n\\n${link}\\n\\n${L.inviteIgnore}`;',
      '    const html = [',
      '      `<p>${L.inviteBody}</p>`,',
      '      `<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:8px">${L.inviteButton}</a></p>`,',
      '      `<p style="font-size:13px;color:#64748b">${link}</p>`,',
      '      `<p style="font-size:13px;color:#64748b">${L.inviteIgnore}</p>`,',
      "    ].join('\\n');",
      '    if (!this.transporter) {',
      '      this.logger.warn(',
      '        `[mail skipped — SMTP not configured] to=${to} subject="${L.inviteSubject}" link=${link}`,',
      '      );',
      '      return;',
      '    }',
      '    try {',
      '      await this.transporter.sendMail({',
      '        from: this.from,',
      '        to,',
      '        subject: L.inviteSubject,',
      '        text,',
      '        html,',
      '      });',
      '    } catch (e) {',
      '      this.logger.warn(',
      '        `sendInvite failed for to=${to}: ${e instanceof Error ? e.message : String(e)}`,',
      '      );',
      '    }',
      '  }',
      '',
      '  async sendPasswordReset(',
    ]),
  ],
]);

// ===== 8) login-guard: приглашённый без пароля не входит =====
patchFile('src/auth/auth.service.ts', '!user.isActive || !user.passwordHash', [
  [
    'auth: null password guard',
    nl([
      '    const user = await this.usersService.findByEmailWithPassword(dto.email);',
      '    if (!user || !user.isActive) {',
      "      throw new UnauthorizedException('Invalid credentials');",
      '    }',
      '    const ok = await bcrypt.compare(dto.password, user.passwordHash);',
    ]),
    nl([
      '    const user = await this.usersService.findByEmailWithPassword(dto.email);',
      '    if (!user || !user.isActive || !user.passwordHash) {',
      "      throw new UnauthorizedException('Invalid credentials');",
      '    }',
      '    const ok = await bcrypt.compare(dto.password, user.passwordHash);',
    ]),
  ],
]);

// ===== 9) changePassword-guard: нельзя сменить несуществующий пароль =====
patchFile('src/users/users.service.ts', "set a password via the invitation", [
  [
    'users: null password guard in changePassword',
    nl([
      '    if (!user) {',
      "      throw new NotFoundException('User not found');",
      '    }',
      '',
      '    const ok = await bcrypt.compare(currentPassword, user.passwordHash);',
    ]),
    nl([
      '    if (!user) {',
      "      throw new NotFoundException('User not found');",
      '    }',
      '',
      '    if (!user.passwordHash) {',
      '      // Invited account that has not set a password yet — direct them',
      '      // to set a password via the invitation link instead.',
      "      throw new BadRequestException('Set a password via the invitation link first');",
      '    }',
      '',
      '    const ok = await bcrypt.compare(currentPassword, user.passwordHash);',
    ]),
  ],
]);

console.log('DONE: invite server complete');
