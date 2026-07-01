import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

type Lang = 'ru' | 'en' | 'de';

interface Message {
  subject: string;
  title: string;
  intro: string;
  lead: string;
  button: string;
  validity: string;
  ignore: string;
}

interface Strings {
  brand: string;
  greeting: string;
  linkHint: string;
  footerAuto: string;
  invite: Message;
  reset: Message;
}

const STRINGS: Record<Lang, Strings> = {
  ru: {
    brand: 'mycongregation.org',
    greeting: 'Здравствуйте!',
    linkHint: 'Если кнопка не открывается, скопируйте ссылку в браузер:',
    footerAuto: 'Это автоматическое сообщение, отвечать на него не нужно.',
    invite: {
      subject: 'Приглашение в приложение собрания — mycongregation.org',
      title: 'Приглашение в приложение собрания',
      intro:
        'Вас пригласили в mycongregation.org — приложение вашего собрания. Здесь вы будете видеть своё расписание встреч и назначений, состав групп и объявления собрания.',
      lead: 'Чтобы начать, задайте пароль и войдите:',
      button: 'Задать пароль и войти',
      validity: 'Ссылка действует 72 часа.',
      ignore:
        'Если вы не ожидали это приглашение, просто проигнорируйте письмо.',
    },
    reset: {
      subject: 'Восстановление пароля — mycongregation.org',
      title: 'Восстановление пароля',
      intro:
        'Вы (или кто-то другой) запросили восстановление пароля для mycongregation.org.',
      lead: 'Чтобы задать новый пароль, перейдите по ссылке:',
      button: 'Задать новый пароль',
      validity: 'Ссылка действует 1 час.',
      ignore:
        'Если вы не запрашивали восстановление — просто проигнорируйте письмо, пароль не изменится.',
    },
  },
  en: {
    brand: 'mycongregation.org',
    greeting: 'Hello!',
    linkHint: "If the button doesn't work, copy this link into your browser:",
    footerAuto: 'This is an automated message — no need to reply.',
    invite: {
      subject: 'Invitation to your congregation app — mycongregation.org',
      title: 'Invitation to your congregation app',
      intro:
        'You have been invited to mycongregation.org — your congregation app. Here you will see your meeting and assignment schedule, your groups, and congregation announcements.',
      lead: 'To get started, set your password and sign in:',
      button: 'Set password and sign in',
      validity: 'The link is valid for 72 hours.',
      ignore:
        'If you were not expecting this invitation, simply ignore this email.',
    },
    reset: {
      subject: 'Password reset — mycongregation.org',
      title: 'Password reset',
      intro:
        'You (or someone else) requested a password reset for mycongregation.org.',
      lead: 'To set a new password, follow the link:',
      button: 'Set a new password',
      validity: 'The link is valid for 1 hour.',
      ignore:
        'If you did not request a reset, simply ignore this email — your password will not change.',
    },
  },
  de: {
    brand: 'mycongregation.org',
    greeting: 'Hallo!',
    linkHint:
      'Falls die Schaltfläche nicht funktioniert, kopieren Sie den Link in Ihren Browser:',
    footerAuto:
      'Dies ist eine automatische Nachricht — eine Antwort ist nicht nötig.',
    invite: {
      subject: 'Einladung zur Versammlungs-App — mycongregation.org',
      title: 'Einladung zur Versammlungs-App',
      intro:
        'Sie wurden zu mycongregation.org eingeladen — der App Ihrer Versammlung. Hier sehen Sie Ihren Plan für Zusammenkünfte und Aufgaben, Ihre Gruppen und Bekanntmachungen der Versammlung.',
      lead: 'Legen Sie zum Start Ihr Passwort fest und melden Sie sich an:',
      button: 'Passwort festlegen und anmelden',
      validity: 'Der Link ist 72 Stunden gültig.',
      ignore:
        'Wenn Sie diese Einladung nicht erwartet haben, ignorieren Sie diese E-Mail einfach.',
    },
    reset: {
      subject: 'Passwort zurücksetzen — mycongregation.org',
      title: 'Passwort zurücksetzen',
      intro:
        'Sie (oder jemand anderes) haben das Zurücksetzen des Passworts für mycongregation.org angefordert.',
      lead: 'Um ein neues Passwort festzulegen, folgen Sie dem Link:',
      button: 'Neues Passwort festlegen',
      validity: 'Der Link ist 1 Stunde gültig.',
      ignore:
        'Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail einfach — Ihr Passwort bleibt unverändert.',
    },
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

  /** Branded, email-client-safe HTML for one message. */
  private renderHtml(s: Strings, m: Message, link: string): string {
    const p =
      'font-size:15px;line-height:1.6;color:#334155;margin:0 0 14px;' +
      'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
    const small = 'font-size:13px;color:#64748b;';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;margin:0;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
<tr><td align="center" style="padding:30px 24px 22px;border-bottom:1px solid #eef2f6;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td align="center" valign="middle" width="64" height="64" style="width:64px;height:64px;background:#15788f;border-radius:16px;color:#ffffff;font-size:40px;font-weight:700;font-family:Arial,Helvetica,sans-serif;line-height:64px;">C</td>
</tr></table>
<div style="font-size:15px;font-weight:600;color:#0f172a;margin-top:12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${s.brand}</div>
</td></tr>
<tr><td style="padding:26px 32px 4px;">
<h1 style="font-size:20px;margin:0 0 14px;color:#0f172a;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${m.title}</h1>
<p style="${p}">${s.greeting}</p>
<p style="${p}">${m.intro}</p>
<p style="${p}">${m.lead}</p>
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:20px auto 8px;"><tr>
<td bgcolor="#15788f" style="border-radius:10px;">
<a href="${link}" style="display:inline-block;padding:13px 30px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;border-radius:10px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${m.button}</a>
</td></tr></table>
<p style="${small}text-align:center;margin:6px 0 16px;">${m.validity}</p>
<p style="${small}margin:0 0 6px;">${s.linkHint}</p>
<p style="font-size:13px;color:#0369a1;word-break:break-all;background:#f8fafc;border:1px solid #eef2f6;border-radius:8px;padding:10px 12px;margin:0 0 12px;">${link}</p>
</td></tr>
<tr><td style="padding:18px 32px 26px;background:#f8fafc;border-top:1px solid #eef2f6;">
<p style="font-size:12px;color:#94a3b8;margin:0 0 6px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${m.ignore}</p>
<p style="font-size:12px;color:#94a3b8;margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${s.footerAuto}</p>
</td></tr>
</table>
</td></tr>
</table>`;
  }

  private renderText(s: Strings, m: Message, link: string): string {
    return [
      s.greeting,
      '',
      m.intro,
      '',
      m.lead,
      link,
      '',
      m.validity,
      '',
      m.ignore,
      s.footerAuto,
    ].join('\n');
  }

  private async deliver(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(
        `[mail skipped — SMTP not configured] to=${to} subject="${subject}"`,
      );
      return false;
    }
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text,
      html,
    });
    return true;
  }

  async sendInvite(to: string, lang: string, link: string): Promise<void> {
    const s = STRINGS[lang as Lang] ?? STRINGS.ru;
    const m = s.invite;
    try {
      await this.deliver(
        to,
        m.subject,
        this.renderHtml(s, m, link),
        this.renderText(s, m, link),
      );
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
    const s = STRINGS[lang as Lang] ?? STRINGS.ru;
    const m = s.reset;
    try {
      const sent = await this.deliver(
        to,
        m.subject,
        this.renderHtml(s, m, link),
        this.renderText(s, m, link),
      );
      if (sent) this.logger.log(`Password reset mail sent to ${to}`);
    } catch (err) {
      this.logger.error(
        `Mail send failed for ${to}: ${(err as Error).message}`,
      );
    }
  }
}
