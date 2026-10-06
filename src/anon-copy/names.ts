/**
 * Invented names for the anonymised copy.
 *
 * A real name is replaced word by word, and the same real word always becomes
 * the same invented word — in every table. The app compares people by name in
 * places (the circuit overseer and his card, doubles among visiting speakers),
 * and those comparisons have to come out on the copy exactly as they do on the
 * live data: equal stays equal, different stays different.
 *
 * Nothing here is derived from the real word itself: the invented word is the
 * next free one from a list, so it cannot be reversed.
 */

export type NameKind = 'male' | 'female' | 'last';

const MALE = [
  'Адам',
  'Альберт',
  'Арно',
  'Бруно',
  'Вальтер',
  'Вернер',
  'Виктор',
  'Гарри',
  'Генрих',
  'Герман',
  'Густав',
  'Давид',
  'Даниэль',
  'Дитер',
  'Зигфрид',
  'Карл',
  'Клаус',
  'Конрад',
  'Курт',
  'Лео',
  'Лукас',
  'Людвиг',
  'Макс',
  'Марк',
  'Мартин',
  'Маттиас',
  'Норберт',
  'Оскар',
  'Отто',
  'Пауль',
  'Рихард',
  'Роберт',
  'Рольф',
  'Рудольф',
  'Себастьян',
  'Симон',
  'Стефан',
  'Тео',
  'Тобиас',
  'Томас',
  'Ульрих',
  'Феликс',
  'Фердинанд',
  'Франк',
  'Фридрих',
  'Ханс',
  'Хельмут',
  'Хуго',
  'Эдгар',
  'Эмиль',
  'Эрвин',
  'Эрих',
  'Эрнст',
  'Юлиан',
  'Юрген',
  'Якоб',
  'Ян',
  'Йонас',
  'Йохан',
  'Бенедикт',
  'Винсент',
  'Габриэль',
  'Доминик',
  'Кристоф',
  'Леонард',
  'Манфред',
  'Николас',
  'Оливер',
  'Патрик',
  'Рафаэль',
  'Самуэль',
  'Тимо',
  'Фабиан',
  'Харальд',
  'Эдуард',
  'Арнольд',
  'Бернд',
  'Вильгельм',
  'Гюнтер',
  'Детлеф',
  'Йорг',
  'Лотар',
  'Райнер',
  'Удо',
  'Уве',
  'Фолькер',
  'Хайнц',
  'Хорст',
  'Эгон',
  'Эккехард',
];

const FEMALE = [
  'Агата',
  'Адель',
  'Альма',
  'Анита',
  'Беата',
  'Берта',
  'Бригитта',
  'Ванда',
  'Вильма',
  'Габриэла',
  'Герда',
  'Гертруда',
  'Грета',
  'Дора',
  'Доротея',
  'Ева',
  'Жанна',
  'Зельма',
  'Зигрид',
  'Ида',
  'Ильза',
  'Ингрид',
  'Ирма',
  'Камилла',
  'Карла',
  'Клара',
  'Корнелия',
  'Лаура',
  'Леа',
  'Лена',
  'Лотта',
  'Луиза',
  'Магда',
  'Марта',
  'Матильда',
  'Мелани',
  'Мира',
  'Моника',
  'Нора',
  'Оттилия',
  'Паула',
  'Петра',
  'Рената',
  'Рита',
  'Роза',
  'Сабина',
  'Сандра',
  'Сильвия',
  'Стелла',
  'Тереза',
  'Тильда',
  'Урсула',
  'Фрида',
  'Ханна',
  'Хедвиг',
  'Хельга',
  'Шарлотта',
  'Эдит',
  'Эльза',
  'Эмма',
  'Эрика',
  'Эстер',
  'Юдит',
  'Ютта',
  'Аннелиза',
  'Барбара',
  'Вальтраут',
  'Гизела',
  'Дагмар',
  'Зента',
  'Ирмгард',
  'Кристель',
  'Лизелотта',
  'Маргит',
  'Николь',
  'Ольга',
  'Розмари',
  'Сюзанна',
  'Трауди',
  'Ульрика',
  'Фелиция',
  'Хайди',
  'Эльфрида',
  'Ивонна',
  'Йоханна',
  'Мехтильда',
  'Ортруд',
  'Регина',
  'Уте',
  'Франциска',
];

/** Surnames that read the same for a man and a woman. */
const LAST_STEMS = [
  'Альт',
  'Бах',
  'Берг',
  'Блюм',
  'Браун',
  'Вайс',
  'Вальд',
  'Винтер',
  'Вольф',
  'Гольд',
  'Грюн',
  'Дорн',
  'Зоммер',
  'Кайзер',
  'Кёниг',
  'Кляйн',
  'Кох',
  'Краус',
  'Кун',
  'Ланг',
  'Линд',
  'Майер',
  'Нойман',
  'Рот',
  'Розен',
  'Фельд',
  'Фогель',
  'Франк',
  'Фукс',
  'Хаас',
  'Хан',
  'Хирш',
  'Шварц',
  'Штайн',
  'Штерн',
  'Шульц',
  'Эбер',
  'Эрн',
  'Юнг',
  'Ягер',
];
const LAST_ENDS = ['', 'ман', 'берг', 'хоф', 'бах', 'лер', 'штайн', 'талер'];

function surnames(): string[] {
  const out: string[] = [];
  for (const end of LAST_ENDS) {
    for (const stem of LAST_STEMS) {
      if (end !== '' && stem.toLowerCase().endsWith(end)) continue;
      out.push(stem + end);
    }
  }
  return out;
}

const POOLS: Record<NameKind, string[]> = {
  male: MALE,
  female: FEMALE,
  last: surnames(),
};

/** A word of a name: letters, with an apostrophe or hyphen staying outside. */
const WORD = /\p{L}+/gu;

export function wordsOf(text: string): string[] {
  const found: string[] = text.match(WORD) ?? [];
  return found.map((w) => w.toLowerCase());
}

function sameCase(real: string, invented: string): string {
  if (real.length > 1 && real === real.toUpperCase()) {
    return invented.toUpperCase();
  }
  if (real[0] === real[0].toLowerCase()) return invented.toLowerCase();
  return invented;
}

export class NameMap {
  /** real word, lower-cased → invented word. */
  private readonly map = new Map<string, string>();
  private readonly next: Record<NameKind, number> = {
    male: 0,
    female: 0,
    last: 0,
  };
  private readonly kinds = new Map<string, NameKind>();
  private readonly taken = new Set<string>();
  private real = new Set<string>();

  /**
   * Every real word has to be known before the first invented one is handed
   * out: an invented word must never be somebody's real one — the self-check
   * after the copy could not tell the two apart, and neither could a reader.
   */
  forbid(realWords: Iterable<string>): void {
    for (const w of realWords) this.real.add(w.toLowerCase());
  }

  private fresh(kind: NameKind): string {
    const pool = POOLS[kind];
    for (;;) {
      const n = this.next[kind]++;
      const round = Math.floor(n / pool.length);
      const base = pool[n % pool.length];
      // Past the end of the list a second word is put after the first, which
      // keeps it one word of letters: «Марк» → «Маркэрн».
      const word =
        round === 0
          ? base
          : base + POOLS.last[(round - 1) % POOLS.last.length].toLowerCase();
      const key = word.toLowerCase();
      if (this.real.has(key) || this.taken.has(key)) continue;
      this.taken.add(key);
      return word;
    }
  }

  /** Decide what a real word becomes; the first decision stands. */
  learn(realWord: string, kind: NameKind): void {
    const key = realWord.toLowerCase();
    if (key.length < 2 || this.map.has(key)) return;
    this.map.set(key, this.fresh(kind));
    this.kinds.set(key, kind);
  }

  /** Real words that became invented ones, lower-cased, with their kind. */
  learned(): Map<string, NameKind> {
    return new Map(this.kinds);
  }

  /**
   * A whole name with every word replaced. A word not met before is taken for
   * a surname. A single letter is an initial and becomes «Н».
   */
  rename(text: string): string {
    return text.replace(WORD, (w) => {
      if (w.length < 2) return sameCase(w, 'Н');
      this.learn(w, 'last');
      return sameCase(w, this.map.get(w.toLowerCase()) as string);
    });
  }

  /**
   * Text that is not a name but may have one inside (a part's title typed by
   * hand): only words known as a SURNAME are replaced, and only where they
   * are written with a capital, as a name is. First names are left: the
   * titles that come from the publications are full of them («Давид»,
   * «Марк»), and a first name on its own points at nobody.
   */
  scrub(text: string): string {
    return text.replace(WORD, (w) => {
      if (w[0] === w[0].toLowerCase()) return w;
      const key = w.toLowerCase();
      if (this.kinds.get(key) !== 'last') return w;
      return sameCase(w, this.map.get(key) as string);
    });
  }

  /** The invented words handed out so far, lower-cased. */
  invented(): Set<string> {
    return new Set(this.taken);
  }
}
