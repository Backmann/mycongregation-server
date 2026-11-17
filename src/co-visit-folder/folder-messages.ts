import { SupportedLanguage } from '../common/i18n/supported-languages';

/**
 * What the folder's reminders say — pure, in each language (17 November
 * 2026). German on «Sie», Russian on «вы».
 */
export type FolderNews = 's62' | 'gaps' | 'deleteFiles';

const LOCALE: Record<SupportedLanguage, string> = {
  ru: 'ru-RU',
  de: 'de-DE',
  en: 'en-GB',
};

function day(iso: string, lang: SupportedLanguage): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`));
}

export function folderText(
  news: FolderNews,
  f: { due: string; s62Due: string; notReady: number },
  lang: SupportedLanguage,
): { title: string; body: string } {
  if (news === 's62') {
    return {
      ru: {
        title: 'Визит районного: S-62',
        body: `Бланк S-62 нужно отправить до ${day(f.s62Due, 'ru')} — не позднее чем за месяц до визита.`,
      },
      de: {
        title: 'Besuch des Kreisaufsehers: S-62',
        body: `Bitte senden Sie das S-62 bis ${day(f.s62Due, 'de')} — mindestens einen Monat vor dem Besuch.`,
      },
      en: {
        title: 'Circuit overseer visit: S-62',
        body: `The S-62 is due by ${day(f.s62Due, 'en')} — at least a month before the visit.`,
      },
    }[lang];
  }
  if (news === 'gaps') {
    return {
      ru: {
        title: 'Папка для районного',
        body: `Передать до ${day(f.due, 'ru')}. Не готово пунктов: ${f.notReady}.`,
      },
      de: {
        title: 'Unterlagen für den Kreisaufseher',
        body: `Abgabe bis ${day(f.due, 'de')}. Noch offen: ${f.notReady}.`,
      },
      en: {
        title: 'Folder for the circuit overseer',
        body: `Due by ${day(f.due, 'en')}. Items not ready: ${f.notReady}.`,
      },
    }[lang];
  }
  return {
    ru: {
      title: 'Папка передана',
      body: 'Удалите сохранённые файлы папки со своего компьютера и из «Загрузок».',
    },
    de: {
      title: 'Unterlagen übergeben',
      body: 'Bitte löschen Sie die gespeicherten Dateien von Ihrem Computer, auch aus «Downloads».',
    },
    en: {
      title: 'Folder handed over',
      body: 'Please delete the saved files from your computer, including Downloads.',
    },
  }[lang];
}
