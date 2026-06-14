import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

type Lang = 'ru' | 'en' | 'de';

const STRINGS: Record<
  Lang,
  {
    subject: string;
    body: string;
    button: string;
    ignore: string;
    inviteSubject: string;
    inviteBody: string;
    inviteButton: string;
    inviteIgnore: string;
  }
> = {
  ru: {
    inviteSubject: 'Приглашение — mycongregation.org',
    inviteBody:
      'Вас пригласили в приложение собрания mycongregation.org. Чтобы задать пароль и войти, перейдите по ссылке (действует 72 часа):',
    inviteButton: 'Задать пароль и войти',
    inviteIgnore:
      'Если вы не ожидали это приглашение, просто проигнорируйте письмо.',
    subject: 'Восстановление пароля — mycongregation.org',
    body: 'Вы (или кто-то другой) запросили восстановление пароля. Чтобы задать новый пароль, перейдите по ссылке (действует 1 час):',
    button: 'Задать новый пароль',
    ignore:
      'Если вы не запрашивали восстановление — просто проигнорируйте это письмо, пароль не изменится.',
  },
  en: {
    inviteSubject: 'Invitation — mycongregation.org',
    inviteBody:
      'You have been invited to the mycongregation.org congregation app. To set your password and sign in, follow the link (valid for 72 hours):',
    inviteButton: 'Set password and sign in',
    inviteIgnore:
      'If you were not expecting this invitation, simply ignore this email.',
    subject: 'Password reset — mycongregation.org',
    body: 'You (or someone else) requested a password reset. To set a new password, follow the link (valid for 1 hour):',
    button: 'Set a new password',
    ignore:
      'If you did not request a reset, simply ignore this email — your password will not change.',
  },
  de: {
    inviteSubject: 'Einladung — mycongregation.org',
    inviteBody:
      'Sie wurden zur Versammlungs-App mycongregation.org eingeladen. Um Ihr Passwort festzulegen und sich anzumelden, folgen Sie dem Link (72 Stunden gültig):',
    inviteButton: 'Passwort festlegen und anmelden',
    inviteIgnore:
      'Wenn Sie diese Einladung nicht erwartet haben, ignorieren Sie diese E-Mail einfach.',
    subject: 'Passwort zurücksetzen — mycongregation.org',
    body: 'Sie (oder jemand anderes) haben das Zurücksetzen des Passworts angefordert. Um ein neues Passwort festzulegen, folgen Sie dem Link (1 Stunde gültig):',
    button: 'Neues Passwort festlegen',
    ignore:
      'Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail einfach — Ihr Passwort bleibt unverändert.',
  },
};

/**
 * Thin nodemailer wrapper. When SMTP_* env vars are missing, mail is logged
 * instead of sent — keeps local dev and pre-DNS production from crashing.
 * Send failures are swallowed (logged) so the forgot-password endpoint
 * always answers with the same generic OK.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    this.from =
      this.config.get<string>('SMTP_FROM') ??
      user ??
      'noreply@mycongregation.org';
    if (!host || !user || !pass) {
      this.logger.warn(
        'SMTP is not configured — outgoing mail will be logged, not sent',
      );
      this.transporter = null;
    } else {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`SMTP configured: ${host}:${port}`);
    }
  }

  async sendInvite(to: string, lang: string, link: string): Promise<void> {
    const L = STRINGS[lang as Lang] ?? STRINGS.ru;
    const text = `${L.inviteBody}\n\n${link}\n\n${L.inviteIgnore}`;
    const html = [
      `<p>${L.inviteBody}</p>`,
      `<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:8px">${L.inviteButton}</a></p>`,
      `<p style="font-size:13px;color:#64748b">${link}</p>`,
      `<p style="font-size:13px;color:#64748b">${L.inviteIgnore}</p>`,
    ].join('\n');
    if (!this.transporter) {
      this.logger.warn(
        `[mail skipped — SMTP not configured] to=${to} subject="${L.inviteSubject}" link=${link}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: L.inviteSubject,
        text,
        html,
      });
    } catch (e) {
      this.logger.warn(
        `sendInvite failed for to=${to}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async sendPasswordReset(
    to: string,
    lang: string,
    link: string,
  ): Promise<void> {
    const L = STRINGS[lang as Lang] ?? STRINGS.ru;
    const text = `${L.body}\n\n${link}\n\n${L.ignore}`;
    const html = [
      `<p>${L.body}</p>`,
      `<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:8px">${L.button}</a></p>`,
      `<p style="font-size:13px;color:#64748b">${link}</p>`,
      `<p style="font-size:13px;color:#64748b">${L.ignore}</p>`,
    ].join('\n');

    if (!this.transporter) {
      this.logger.warn(
        `[mail skipped — SMTP not configured] to=${to} subject="${L.subject}" link=${link}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: L.subject,
        text,
        html,
      });
      this.logger.log(`Password reset mail sent to ${to}`);
    } catch (err) {
      this.logger.error(
        `Mail send failed for ${to}: ${(err as Error).message}`,
      );
    }
  }
}
