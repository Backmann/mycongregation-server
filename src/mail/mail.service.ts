import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

type Lang = 'ru' | 'en' | 'de';

/** App icon (128px PNG) embedded inline via CID so it always renders. */
const LOGO_B64 =
  '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';

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
    brand: 'MyCongregation.org',
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
    brand: 'MyCongregation.org',
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
    brand: 'MyCongregation.org',
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
    const rawFrom =
      this.config.get<string>('SMTP_FROM') ??
      user ??
      'noreply@mycongregation.org';
    this.from = /<.+>/.test(rawFrom)
      ? rawFrom
      : `"MyCongregation.org" <${rawFrom}>`;
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
<td align="center"><img src="cid:logo" width="64" height="64" alt="MyCongregation.org" style="display:block;border:0;border-radius:16px;" /></td>
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
      attachments: [
        {
          filename: 'logo.png',
          content: Buffer.from(LOGO_B64, 'base64'),
          cid: 'logo',
          contentDisposition: 'inline',
        },
      ],
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
