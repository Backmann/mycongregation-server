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

/**
 * The parts of a letter that depend on who is reading it.
 *
 * An object rather than four more positional arguments: the seventh
 * `undefined` in a row is how a letter ends up addressed to nobody.
 */
interface LetterExtras {
  code?: string;
  expiresAt?: Date;
  installUrl?: string;
  /** How to say hello — the person's own first name. */
  recipientName?: string | null;
  /** What this person types to sign in; the letter is where they learn it. */
  loginName?: string | null;
  /**
   * The elder issued this code himself, for somebody who already has a
   * password (a lost phone, a password nobody remembers). The letter then
   * does not say «вы попросили».
   */
  issuedByElder?: boolean;
  /**
   * Which congregation this letter comes from.
   *
   * Without it the letter arrives from an unfamiliar domain, calls itself
   * «приложение вашего собрания», and asks the reader to set a password. A
   * careful person is right to distrust that, and careful people are exactly
   * the ones who will not click.
   */
  congregationName?: string | null;
}

interface Strings {
  brand: string;
  greeting: string;
  /**
   * The same hello, with a name in it.
   *
   * Not a nicety: a husband and wife share one mailbox, and two identical
   * letters arriving in it are a puzzle. The name at the top says which is
   * whose before anything else is read.
   */
  greetingNamed: string;
  /** «Your name for signing in:» — the one place a person learns it. */
  loginNameLead: string;
  /** Says plainly that this, and not the address, is what to type. */
  loginNameHint: string;
  footerAuto: string;
  invite: Message;
  reset: Message;
  /**
   * Sent to whoever ALREADY used an address, at the moment it starts serving a
   * second login too.
   *
   * Nobody should learn that their way in has changed by failing to get in.
   * The address stops identifying a single person the instant it is shared, so
   * the person who has been signing in with it for months needs telling — by
   * us, at that moment, without anybody having to remember to do it.
   */
  shared: Message;
  /**
   * Sent to somebody whose password was set by an elder, not by themselves.
   *
   * Usually agreed beforehand — «я тебе задам пароль, запиши» — and then this
   * is merely a confirmation. When it was not agreed, it is the only way the
   * owner of the account finds out at all.
   */
  passwordSet: Message;
  newestLetter: string;
  installButton: string;
  codeValid: string;
  /** Month names in the genitive, as a date is read aloud: «6 октября». */
  months: string[];
  /** Whose congregation this is — said before anything is asked of the reader. */
  fromCongregation: string;
  /** Where to turn when the code does not work. */
  askWhoInvited: string;
  /**
   * THE CODE LETTER (7 October 2026) — an invitation and a forgotten password
   * are the same letter now: two steps and a code.
   *
   * Both used to carry a link that signed its clicker in WHERE THE LETTER WAS
   * OPENED. People use this app three ways — the Android app, the icon on an
   * iPhone's Home Screen, a browser on a computer — and a link from a mail
   * client lands in the right one of those only some of the time: on an
   * iPhone it signs the mail client's own browser in and leaves the icon on
   * the Home Screen asking for a password; on an Android phone without the
   * app yet it signs the browser in and the app, installed a minute later,
   * asks again. «Вошёл — и снова экран входа» was the complaint.
   *
   * A code is typed where the person already is, so it works the same in all
   * three. The button that remains only OPENS the code screen with the code
   * filled in; opened in the wrong place it costs nothing — the code is still
   * good.
   */
  step1: string;
  /** What «the app» is on each kind of device, and where to get it. */
  step1NoApp: string;
  step2Invite: string;
  step2Reset: string;
  thenInvite: string;
  thenReset: string;
  /** For a code that lives a day: a date would say less than «сутки». */
  codeValidDay: string;
  fillButton: string;
  fillNote: string;
  /** A session on the phone is not a session on the computer. */
  eachDevice: string;
  /** «Вам выдали код» — for somebody who already has a password. */
  resetByElderIntro: string;
}

/** Why a notification came as a letter, and how to make the letters stop. */
const NOTICE_WHY: Record<Lang, string> = {
  ru: 'Письмо пришло потому, что ни на одном вашем устройстве не включены уведомления приложения. Включите их на главном экране приложения, и письма прекратятся.',
  en: 'This came as a letter because notifications are not turned on for any of your devices. Turn them on from the home screen of the app and the letters will stop.',
  de: 'Diese Nachricht kam als E-Mail, weil auf keinem deiner Geräte Benachrichtigungen der App eingeschaltet sind. Schalte sie auf der Startseite der App ein, dann hören die E-Mails auf.',
};

const STRINGS: Record<Lang, Strings> = {
  ru: {
    brand: 'MyCongregation.org',
    step1: 'Шаг 1. Откройте приложение собрания',
    step1NoApp:
      'Ещё не установлено? Откройте на своём телефоне страницу ниже — она сама покажет, что нужно: на Android — установку приложения, на iPhone — как добавить значок на экран «Домой». На компьютере приложение — это сайт mycongregation.org.',
    step2Invite:
      'Шаг 2. На экране входа нажмите «Вас пригласили?» и введите код',
    step2Reset:
      'Шаг 2. На экране входа нажмите «Забыли пароль?», затем «У меня есть код», и введите его',
    thenInvite: 'Затем придумайте пароль — и вы сразу внутри.',
    thenReset: 'Затем придумайте новый пароль — и вы сразу внутри.',
    codeValidDay: 'Код действует сутки.',
    fillButton: 'Открыть и вписать код',
    fillNote:
      'Кнопка только вписывает код за вас. Если после неё вы снова видите экран входа — значит, она открылась не там, где у вас приложение. Ничего страшного: код действует, введите его вручную, как сказано в шаге 2.',
    eachDevice:
      'Пользуетесь и телефоном, и компьютером? На каждом устройстве входят отдельно — тем же именем и паролем.',
    resetByElderIntro:
      'Вам выдали код, чтобы вы снова могли войти в приложение собрания и задать новый пароль.',
    greetingNamed: 'Здравствуйте, {{name}}!',
    loginNameLead: 'Ваше имя для входа:',
    loginNameHint:
      'Этим именем вы входите в приложение — запишите его. Адрес почты тоже подойдёт, если этим ящиком пользуетесь только вы.',
    newestLetter:
      'Если таких писем несколько — берите код из самого нового: прежние уже не работают.',
    installButton: 'Как установить',
    codeValid: 'Код действует до',
    months: [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря',
    ],
    fromCongregation: 'Собрание: {{name}}',
    askWhoInvited:
      'Если что-то не получается — обратитесь к тому, кто вас пригласил, или к любому из старейшин.',
    greeting: 'Здравствуйте!',
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
    passwordSet: {
      subject: 'Вам задали новый пароль — mycongregation.org',
      title: 'Пароль изменён',
      intro:
        'Администратор собрания задал для вашей учётной записи новый пароль — обычно об этом договариваются заранее, и он сообщает пароль вам лично. Все устройства, где вы были в приложении, вышли: войдите заново с новым паролем.',
      lead: 'Входите так:',
      button: 'Открыть приложение',
      validity: '',
      ignore:
        'Если вы ни о чём не договаривались и не понимаете, почему это письмо пришло, — свяжитесь с администратором собрания.',
    },
    shared: {
      subject: 'Как вы теперь входите — mycongregation.org',
      title: 'Входите по имени',
      intro:
        'Этим почтовым ящиком теперь пользуются два входа в приложение — ваш и кого-то ещё, чаще всего из вашей семьи. Поэтому по адресу почты войти больше нельзя: он не говорит, кто именно из вас входит.',
      lead: 'Пароль у вас прежний, менять его не нужно. Входите так:',
      button: 'Открыть приложение',
      validity: '',
      ignore:
        'Если непонятно, о чём это письмо, спросите у администратора собрания — он подскажет.',
    },
    reset: {
      subject: 'Восстановление пароля — mycongregation.org',
      title: 'Восстановление пароля',
      intro:
        'Вы попросили восстановить пароль для входа в приложение собрания.',
      lead: 'Чтобы задать новый пароль, перейдите по ссылке:',
      button: 'Задать новый пароль',
      validity: 'Ссылка действует 1 час.',
      ignore:
        'Если вы не запрашивали восстановление — просто проигнорируйте письмо, пароль не изменится.',
    },
  },
  en: {
    brand: 'MyCongregation.org',
    step1: 'Step 1. Open the congregation app',
    step1NoApp:
      'Not installed yet? Open the page below on your phone — it shows what your device needs: on Android, how to install the app; on an iPhone, how to add the icon to the Home Screen. On a computer the app is the website mycongregation.org.',
    step2Invite:
      'Step 2. On the sign-in screen tap «Were you invited?» and enter the code',
    step2Reset:
      'Step 2. On the sign-in screen tap «Forgot password?», then «I have a code», and enter it',
    thenInvite: 'Then choose a password — and you are in.',
    thenReset: 'Then choose a new password — and you are in.',
    codeValidDay: 'The code is valid for one day.',
    fillButton: 'Open and fill in the code',
    fillNote:
      'The button only fills the code in for you. If you see the sign-in screen again after it, it opened somewhere other than where your app is. No harm done: the code is still good — enter it by hand as in step 2.',
    eachDevice:
      'Using both a phone and a computer? You sign in on each device separately — with the same name and password.',
    resetByElderIntro:
      'You have been given a code so that you can get back into your congregation app and choose a new password.',
    greetingNamed: 'Hello, {{name}}!',
    loginNameLead: 'Your name for signing in:',
    loginNameHint:
      'This is the name you sign in with — do write it down. Your e-mail address works too, if you are the only one using that mailbox.',
    newestLetter:
      'If several such letters arrived, take the code from the newest — earlier ones no longer work.',
    installButton: 'How to install',
    codeValid: 'The code is valid until',
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    fromCongregation: 'Congregation: {{name}}',
    askWhoInvited:
      'If something does not work, ask the person who invited you or any of the elders.',
    greeting: 'Hello!',
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
    passwordSet: {
      subject: 'A new password was set for you — mycongregation.org',
      title: 'Your password has been changed',
      intro:
        'The congregation administrator has set a new password for your account — usually this is agreed beforehand and they tell you the password in person. Every device you were signed in on has been signed out: sign in again with the new password.',
      lead: 'Sign in like this:',
      button: 'Open the app',
      validity: '',
      ignore:
        'If you agreed to nothing of the sort and do not know why this letter arrived, contact the congregation administrator.',
    },
    shared: {
      subject: 'How you sign in from now on — mycongregation.org',
      title: 'Sign in with your name',
      intro:
        'This mailbox now serves two logins to the app — yours and somebody else\u2019s, most often a family member\u2019s. An address can therefore no longer be used to sign in: it does not say which of you is signing in.',
      lead: 'Your password is unchanged. Sign in like this:',
      button: 'Open the app',
      validity: '',
      ignore:
        'If this letter makes no sense to you, ask the congregation administrator — they will help.',
    },
    reset: {
      subject: 'Password reset — mycongregation.org',
      title: 'Password reset',
      intro: 'You asked to reset the password for your congregation app.',
      lead: 'To set a new password, follow the link:',
      button: 'Set a new password',
      validity: 'The link is valid for 1 hour.',
      ignore:
        'If you did not request a reset, simply ignore this email — your password will not change.',
    },
  },
  de: {
    brand: 'MyCongregation.org',
    step1: 'Schritt 1. Öffnen Sie die Versammlungs-App',
    step1NoApp:
      'Noch nicht installiert? Öffnen Sie die Seite unten auf Ihrem Telefon – sie zeigt, was Ihr Gerät braucht: auf Android die Installation der App, auf dem iPhone, wie Sie das Symbol zum Home-Bildschirm hinzufügen. Am Computer ist die App die Website mycongregation.org.',
    step2Invite:
      'Schritt 2. Tippen Sie auf dem Anmeldebildschirm auf «Wurden Sie eingeladen?» und geben Sie den Code ein',
    step2Reset:
      'Schritt 2. Tippen Sie auf dem Anmeldebildschirm auf «Passwort vergessen?», dann auf «Ich habe einen Code», und geben Sie ihn ein',
    thenInvite: 'Danach wählen Sie ein Passwort – und Sie sind drin.',
    thenReset: 'Danach wählen Sie ein neues Passwort – und Sie sind drin.',
    codeValidDay: 'Der Code ist einen Tag gültig.',
    fillButton: 'Öffnen und Code eintragen',
    fillNote:
      'Die Schaltfläche trägt nur den Code für Sie ein. Wenn Sie danach wieder den Anmeldebildschirm sehen, hat sie sich nicht dort geöffnet, wo Ihre App ist. Das macht nichts: Der Code gilt weiter – geben Sie ihn von Hand ein, wie in Schritt 2 beschrieben.',
    eachDevice:
      'Nutzen Sie Telefon und Computer? Auf jedem Gerät melden Sie sich separat an – mit demselben Namen und Passwort.',
    resetByElderIntro:
      'Sie haben einen Code erhalten, damit Sie wieder in die Versammlungs-App gelangen und ein neues Passwort wählen können.',
    greetingNamed: 'Hallo, {{name}}!',
    loginNameLead: 'Ihr Name für die Anmeldung:',
    loginNameHint:
      'Mit diesem Namen melden Sie sich in der App an – bitte notieren Sie ihn. Ihre E-Mail-Adresse funktioniert ebenfalls, wenn nur Sie dieses Postfach nutzen.',
    newestLetter:
      'Falls mehrere solche E-Mails angekommen sind: Nehmen Sie den Code aus der neuesten – frühere funktionieren nicht mehr.',
    installButton: 'So wird installiert',
    codeValid: 'Der Code ist gültig bis',
    months: [
      'Januar',
      'Februar',
      'März',
      'April',
      'Mai',
      'Juni',
      'Juli',
      'August',
      'September',
      'Oktober',
      'November',
      'Dezember',
    ],
    fromCongregation: 'Versammlung: {{name}}',
    askWhoInvited:
      'Wenn etwas nicht klappt, wenden Sie sich an die Person, die Sie eingeladen hat, oder an einen der Ältesten.',
    greeting: 'Hallo!',
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
    passwordSet: {
      subject: 'Für Sie wurde ein neues Passwort gesetzt — mycongregation.org',
      title: 'Ihr Passwort wurde geändert',
      intro:
        'Der Versammlungsadministrator hat für Ihr Konto ein neues Passwort gesetzt — üblicherweise wird das vorher abgesprochen und er nennt Ihnen das Passwort persönlich. Alle Geräte, auf denen Sie angemeldet waren, wurden abgemeldet: melden Sie sich mit dem neuen Passwort neu an.',
      lead: 'So melden Sie sich an:',
      button: 'App öffnen',
      validity: '',
      ignore:
        'Wenn nichts dergleichen abgesprochen war und Sie nicht wissen, warum dieser Brief kam, wenden Sie sich an den Versammlungsadministrator.',
    },
    shared: {
      subject: 'So melden Sie sich künftig an — mycongregation.org',
      title: 'Melden Sie sich mit Ihrem Namen an',
      intro:
        'Dieses Postfach wird nun von zwei Zugängen zur App genutzt — Ihrem und dem einer weiteren Person, meist aus Ihrer Familie. Eine Anmeldung mit der Adresse ist deshalb nicht mehr möglich: sie sagt nicht, wer von Ihnen sich anmeldet.',
      lead: 'Ihr Passwort bleibt unverändert. So melden Sie sich an:',
      button: 'App öffnen',
      validity: '',
      ignore:
        'Wenn Sie mit diesem Brief nichts anfangen können, fragen Sie den Versammlungsadministrator — er hilft Ihnen weiter.',
    },
    reset: {
      subject: 'Passwort zurücksetzen — mycongregation.org',
      title: 'Passwort zurücksetzen',
      intro:
        'Sie haben darum gebeten, das Passwort für die Versammlungs-App zurückzusetzen.',
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
  /** Formats the day the code stops working, for the reader. */
  /**
   * A day, said the way a person says it: «6 октября».
   *
   * It used to print «06.10.2026, 12:00» — a machine format nothing else in
   * this project uses, with a precision to the minute for something that lives
   * a month, and an hour taken from the server's own clock rather than the
   * congregation's. Three small wrongs in one short line. The month names are
   * the ones already written for each language.
   */
  private until(lang: Strings, when?: Date): string {
    if (!when) return '';
    return `${when.getDate()} ${lang.months[when.getMonth()]}`;
  }

  /** The outer shell every letter shares: logo, title, body, footer. */
  private shell(s: Strings, title: string, body: string, foot: string[]) {
    const font =
      'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;margin:0;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
<tr><td align="center" style="padding:30px 24px 22px;border-bottom:1px solid #eef2f6;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td align="center"><img src="cid:logo" width="64" height="64" alt="MyCongregation.org" style="display:block;border:0;border-radius:16px;" /></td>
</tr></table>
<div style="font-size:15px;font-weight:600;color:#0f172a;margin-top:12px;${font}">${s.brand}</div>
</td></tr>
<tr><td style="padding:26px 32px 12px;">
<h1 style="font-size:20px;margin:0 0 14px;color:#0f172a;${font}">${title}</h1>
${body}
</td></tr>
<tr><td style="padding:18px 32px 26px;background:#f8fafc;border-top:1px solid #eef2f6;">
${foot
  .filter(Boolean)
  .map(
    (line, i, all) =>
      `<p style="font-size:12px;color:#94a3b8;margin:0 0 ${i === all.length - 1 ? 0 : 6}px;${font}">${line}</p>`,
  )
  .join('\n')}
</td></tr>
</table>
</td></tr>
</table>`;
  }

  private static readonly P =
    'font-size:15px;line-height:1.6;color:#334155;margin:0 0 14px;' +
    'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
  private static readonly SMALL = 'font-size:13px;color:#64748b;';

  private button(href: string, label: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:16px auto 10px;"><tr><td bgcolor="#15788f" style="border-radius:10px;"><a href="${href}" style="display:inline-block;padding:13px 30px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;border-radius:10px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${label}</a></td></tr></table>`;
  }

  private nameBox(s: Strings, loginName?: string | null): string {
    if (!loginName) return '';
    const small = MailService.SMALL;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;"><tr><td style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:14px 16px;">
<p style="${small}margin:0 0 6px;">${s.loginNameLead}</p>
<p style="font-size:19px;font-weight:700;color:#0c4a6e;margin:0 0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${loginName}</p>
<p style="${small}margin:0;">${s.loginNameHint}</p>
</td></tr></table>`;
  }

  /** «Код действует до 6 ноября» — or «сутки», for a code that lives a day. */
  private validity(s: Strings, expiresAt?: Date): string {
    if (!expiresAt) return '';
    const left = expiresAt.getTime() - Date.now();
    return left <= 36 * 60 * 60 * 1000
      ? s.codeValidDay
      : `${s.codeValid} ${this.until(s, expiresAt)}`;
  }

  /**
   * The code letter, in the order a person acts on it: open the app (and
   * what «the app» is on this device), enter the code, and only then the
   * things to keep — the name, the note about several letters and several
   * devices. See Strings.step1 for why there is no sign-in link in it.
   *
   * `fillLink` opens the code screen with the code already typed. It signs
   * nobody in.
   */
  private codeParts(s: Strings, kind: 'invite' | 'reset', extra: LetterExtras) {
    const m = kind === 'invite' ? s.invite : s.reset;
    return {
      m,
      hello: extra.recipientName
        ? s.greetingNamed.replace('{{name}}', extra.recipientName)
        : s.greeting,
      intro:
        kind === 'reset' && extra.issuedByElder ? s.resetByElderIntro : m.intro,
      congregation: extra.congregationName
        ? s.fromCongregation.replace('{{name}}', extra.congregationName)
        : '',
      step2: kind === 'invite' ? s.step2Invite : s.step2Reset,
      then: kind === 'invite' ? s.thenInvite : s.thenReset,
      valid: this.validity(s, extra.expiresAt),
      // Somebody who did not ask is told what to do about it; an elder's own
      // act needs no such line.
      ignore: kind === 'reset' && extra.issuedByElder ? '' : m.ignore,
    };
  }

  private renderCodeHtml(
    s: Strings,
    kind: 'invite' | 'reset',
    fillLink: string,
    extra: LetterExtras,
  ): string {
    const c = this.codeParts(s, kind, extra);
    const p = MailService.P;
    const small = MailService.SMALL;
    const step =
      'font-size:16px;font-weight:700;color:#0f172a;margin:18px 0 8px;' +
      'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
    const body = `<p style="${p}">${c.hello}</p>
<p style="${p}">${c.intro}</p>
${c.congregation ? `<p style="${small}margin:0 0 6px;">${c.congregation}</p>` : ''}
<p style="${step}">${s.step1}</p>
${
  extra.installUrl
    ? `<p style="${small}margin:0 0 4px;line-height:1.55;">${s.step1NoApp}</p>${this.button(extra.installUrl, s.installButton)}<p style="${small}word-break:break-all;text-align:center;margin:0 0 6px;">${extra.installUrl}</p>`
    : ''
}
<p style="${step}">${c.step2}</p>
<p style="font-size:30px;letter-spacing:4px;font-weight:700;color:#0f172a;text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 12px;margin:0 0 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${extra.code ?? ''}</p>
<p style="${p}margin-bottom:6px;">${c.then}</p>
${c.valid ? `<p style="${small}margin:0 0 6px;">${c.valid}</p>` : ''}
${fillLink ? `${this.button(fillLink, s.fillButton)}<p style="${small}margin:0 0 16px;line-height:1.55;">${s.fillNote}</p>` : ''}
${this.nameBox(s, extra.loginName)}
<p style="${small}margin:0 0 10px;line-height:1.55;">${s.newestLetter}</p>
<p style="${small}margin:0 0 10px;line-height:1.55;">${s.eachDevice}</p>
<p style="${small}margin:0 0 12px;line-height:1.55;">${s.askWhoInvited}</p>`;
    return this.shell(s, c.m.title, body, [c.ignore, s.footerAuto]);
  }

  private renderCodeText(
    s: Strings,
    kind: 'invite' | 'reset',
    fillLink: string,
    extra: LetterExtras,
  ): string {
    const c = this.codeParts(s, kind, extra);
    return [
      c.hello,
      '',
      c.intro,
      ...(c.congregation ? ['', c.congregation] : []),
      '',
      s.step1,
      ...(extra.installUrl ? [s.step1NoApp, extra.installUrl] : []),
      '',
      c.step2 + ':',
      extra.code ?? '',
      '',
      c.then,
      ...(c.valid ? [c.valid] : []),
      ...(fillLink ? ['', `${s.fillButton}:`, fillLink, s.fillNote] : []),
      ...(extra.loginName
        ? ['', s.loginNameLead, extra.loginName, s.loginNameHint]
        : []),
      '',
      s.newestLetter,
      s.eachDevice,
      '',
      s.askWhoInvited,
      '',
      ...(c.ignore ? [c.ignore] : []),
      s.footerAuto,
    ].join('\n');
  }

  /**
   * A plain notice with a way into the app: «вам задали пароль», «входите по
   * имени». No code, no steps.
   */
  private renderHtml(
    s: Strings,
    m: Message,
    link: string,
    extra: LetterExtras = {},
  ): string {
    const p = MailService.P;
    const small = MailService.SMALL;
    const hello = extra.recipientName
      ? s.greetingNamed.replace('{{name}}', extra.recipientName)
      : s.greeting;
    const body = `<p style="${p}">${hello}</p>
<p style="${p}">${m.intro}</p>
<p style="${p}">${m.lead}</p>
${this.nameBox(s, extra.loginName)}
${link ? this.button(link, m.button) : ''}
${link ? `<p style="${small}word-break:break-all;text-align:center;margin:0 0 14px;">${link}</p>` : ''}
<p style="${small}margin:0 0 10px;line-height:1.55;">${s.eachDevice}</p>
<p style="${small}margin:0 0 12px;line-height:1.55;">${s.askWhoInvited}</p>`;
    return this.shell(s, m.title, body, [m.ignore, s.footerAuto]);
  }

  private renderText(
    s: Strings,
    m: Message,
    link: string,
    extra: LetterExtras = {},
  ): string {
    return [
      extra.recipientName
        ? s.greetingNamed.replace('{{name}}', extra.recipientName)
        : s.greeting,
      '',
      m.intro,
      '',
      m.lead,
      ...(extra.loginName
        ? [s.loginNameLead, extra.loginName, s.loginNameHint]
        : []),
      ...(link ? ['', `${m.button}:`, link] : []),
      '',
      s.eachDevice,
      s.askWhoInvited,
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
    /**
     * Every letter that actually leaves leaves a line.
     *
     * Until now a successful send was silent — only a skipped one and a failed
     * invitation said anything — so «did the app just write to this person?»
     * could not be answered from the server at all. It came up the first time
     * somebody reported a letter arriving unbidden, and there was nothing to
     * look at: an empty log meant «nothing is recorded here», not «nothing
     * happened», and those two must never look alike.
     *
     * The address and the subject, and nothing else. The body carries names,
     * codes and links; a log file is not the place for any of them.
     */
    this.logger.log(`mail sent to=${to} subject="${subject}"`);
    return true;
  }

  async sendInvite(
    to: string,
    lang: string,
    link: string,
    extra: LetterExtras = {},
  ): Promise<void> {
    const s = STRINGS[lang as Lang] ?? STRINGS.ru;
    const m = s.invite;
    try {
      await this.deliver(
        to,
        m.subject,
        this.renderCodeHtml(s, 'invite', link, extra),
        this.renderCodeText(s, 'invite', link, extra),
      );
    } catch (e) {
      this.logger.warn(
        `sendInvite failed for to=${to}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * «An elder set you a new password.»
   *
   * Same shape as the shared-mailbox notice, and for the same reason: somebody
   * else changed how this person gets in, so this person hears it from us.
   */
  async sendPasswordSetByAdmin(
    to: string,
    lang: string,
    extra: LetterExtras = {},
  ): Promise<void> {
    const s = STRINGS[lang as Lang] ?? STRINGS.ru;
    const m = s.passwordSet;
    const link = 'https://mycongregation.org/app/';
    try {
      const sent = await this.deliver(
        to,
        m.subject,
        this.renderHtml(s, m, link, extra),
        this.renderText(s, m, link, extra),
      );
      if (sent) this.logger.log(`password-set notice sent to ${to}`);
    } catch (err) {
      // Never let a letter undo the reset itself: the elder has already told
      // the person their new password, and failing here would leave the
      // account with the OLD one.
      this.logger.warn(
        `password-set notice failed for ${to}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * «Your mailbox now serves two logins — sign in with your name.»
   *
   * The one letter here nobody asked for. It goes out precisely when somebody's
   * habit stops working, so that they hear it from us rather than from a
   * refusal at the sign-in screen.
   */
  async sendSharedMailboxNotice(
    to: string,
    lang: string,
    extra: LetterExtras = {},
  ): Promise<void> {
    const s = STRINGS[lang as Lang] ?? STRINGS.ru;
    const m = s.shared;
    const link = 'https://mycongregation.org/app/';
    try {
      const sent = await this.deliver(
        to,
        m.subject,
        this.renderHtml(s, m, link, extra),
        this.renderText(s, m, link, extra),
      );
      if (sent) this.logger.log(`shared-mailbox notice sent to ${to}`);
    } catch (err) {
      this.logger.warn(
        `shared-mailbox notice failed for ${to}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * A notification, by post — for somebody whose devices receive none.
   *
   * On 1 October 2026 a third of the people using the app had no device a
   * notification could reach, and nine of them held a part in the coming
   * weeks. Until they switch notifications on, a letter is the only way to
   * tell them. It names its reader first, because one mailbox may serve a
   * husband and a wife; it carries NO link that signs anybody in, for the
   * same reason; and it says why it came and how to make the letters stop.
   */
  async sendNotice(
    to: string,
    lang: string,
    notice: { title: string; body: string; recipientName?: string | null },
  ): Promise<boolean> {
    const s = STRINGS[lang as Lang] ?? STRINGS.ru;
    const why = NOTICE_WHY[lang as Lang] ?? NOTICE_WHY.ru;
    const hello = notice.recipientName
      ? s.greetingNamed.replace('{{name}}', notice.recipientName)
      : s.greeting;
    const esc = (x: string) =>
      x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const font =
      'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
    const lines = notice.body.split('\n').filter((l) => l.trim().length > 0);
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;margin:0;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
<tr><td align="center" style="padding:30px 24px 22px;border-bottom:1px solid #eef2f6;">
<img src="cid:logo" width="64" height="64" alt="MyCongregation.org" style="display:block;border:0;border-radius:16px;" />
<div style="font-size:15px;font-weight:600;color:#0f172a;margin-top:12px;${font}">${s.brand}</div>
</td></tr>
<tr><td style="padding:26px 32px 10px;">
<h1 style="font-size:20px;margin:0 0 14px;color:#0f172a;${font}">${esc(notice.title)}</h1>
<p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 14px;${font}">${esc(hello)}</p>
${lines
  .map(
    (l) =>
      `<p style="font-size:15px;line-height:1.6;color:#0f172a;margin:0 0 8px;${font}">${esc(l)}</p>`,
  )
  .join('\n')}
</td></tr>
<tr><td style="padding:18px 32px 26px;background:#f8fafc;border-top:1px solid #eef2f6;">
<p style="font-size:12px;color:#94a3b8;margin:0 0 6px;${font}">${why}</p>
<p style="font-size:12px;color:#94a3b8;margin:0;${font}">${s.footerAuto}</p>
</td></tr>
</table>
</td></tr>
</table>`;
    const text = [hello, '', ...lines, '', why, s.footerAuto].join('\n');
    try {
      return await this.deliver(to, notice.title, html, text);
    } catch (err) {
      this.logger.error(
        `Mail send failed for ${to}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * A reset letter also names its reader, and for the same reason: one mailbox
   * may serve two accounts, and «somebody asked to reset a password» is no use
   * when two people share it. The login name is repeated here too — forgetting
   * it is a likelier reason to be locked out than forgetting a password.
   */
  async sendPasswordReset(
    to: string,
    lang: string,
    link: string,
    extra: LetterExtras = {},
  ): Promise<void> {
    const s = STRINGS[lang as Lang] ?? STRINGS.ru;
    const m = s.reset;
    try {
      const sent = await this.deliver(
        to,
        m.subject,
        this.renderCodeHtml(s, 'reset', link, extra),
        this.renderCodeText(s, 'reset', link, extra),
      );
      if (sent) this.logger.log(`Password reset mail sent to ${to}`);
    } catch (err) {
      this.logger.error(
        `Mail send failed for ${to}: ${(err as Error).message}`,
      );
    }
  }
}
