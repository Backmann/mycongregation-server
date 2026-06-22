/** Direction of a public-talk exchange entry. */
export enum TalkExchangeDirection {
  /** A visiting speaker comes to give a talk in our congregation. */
  INCOMING = 'incoming',
  /** One of our speakers travels to give a talk in another congregation. */
  OUTGOING = 'outgoing',
}

/** Confirmation status of an exchange entry. */
export enum TalkExchangeStatus {
  TENTATIVE = 'tentative',
  CONFIRMED = 'confirmed',
}
