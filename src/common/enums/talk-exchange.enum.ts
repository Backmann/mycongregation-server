/** Direction of a public-talk exchange entry. */
export enum TalkExchangeDirection {
  /** A visiting speaker comes to give a talk in our congregation. */
  INCOMING = 'incoming',
  /** One of our speakers travels to give a talk in another congregation. */
  OUTGOING = 'outgoing',
}

/**
 * Как стоит запись обмена речами.
 *
 * Два первых состояния — про будущее: договорённость может быть
 * предварительной или твёрдой. Третье про прошлое, и без него история врала в
 * обе стороны.
 *
 * В день встречи иногда выясняется, что приедет другой брат. Если просто
 * переписать имя, первый визит исчезает бесследно — а координатору важно
 * помнить, кого он звал и кто не приехал: по этому решают, звать ли снова.
 * Если же оставить запись как есть, она соврёт иначе: скажет, что брат был, и
 * отодвинет его очередь.
 *
 * Поэтому замена — это ДВА факта: визит первого не состоялся, визит второго
 * состоялся. Несостоявшийся не считается в «когда был последний раз» и в
 * среднем промежутке, но остаётся видимым в карточке брата.
 */
export enum TalkExchangeStatus {
  TENTATIVE = 'tentative',
  CONFIRMED = 'confirmed',
  DID_NOT_HAPPEN = 'did_not_happen',
}
