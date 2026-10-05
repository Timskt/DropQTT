import { Translations, fill } from '../i18n';

/**
 * MQTT 5 §3.2.2.2.0 reason codes, localized here rather than in the backend so
 * the user's language applies. The Rust side sends the byte plus an English
 * fallback; this is the authority for what the UI shows.
 *
 * The values were cross-checked against the tables mqtt.js ships
 * (`mqtt-packet/constants.js`), which agree with rumqttc's parser. Two traps are
 * why the tables are kept per packet family rather than merged: SUBACK's "topic
 * filter invalid" is 0x8F while 0x90 belongs to the publish family only, and
 * 0x10/0x11 are notes (never errors) that mean something different in each.
 */
const SHARED_REFUSALS: Record<number, keyof Translations> = {
  0x80: 'ackCodeUnspecified',
  0x83: 'ackCodeImplSpecific',
  0x87: 'ackCodeNotAuthorized',
  0x91: 'ackCodePkidInUse',
  0x97: 'ackCodeQuotaExceeded',
};

const SUB_KEYS: Record<number, keyof Translations> = {
  ...SHARED_REFUSALS,
  0x8f: 'ackCodeTopicFilterInvalid',
  0x9e: 'ackCodeSharedSubsUnsupported',
  0xa1: 'ackCodeSubIdUnsupported',
  0xa2: 'ackCodeWildcardSubsUnsupported',
};

const UNSUB_KEYS: Record<number, keyof Translations> = {
  ...SHARED_REFUSALS,
  0x11: 'ackCodeNoSubscriptionExisted',
  0x8f: 'ackCodeTopicFilterInvalid',
};

const PUB_KEYS: Record<number, keyof Translations> = {
  ...SHARED_REFUSALS,
  0x10: 'ackCodeNoSubscribers',
  0x90: 'ackCodeTopicNameInvalid',
  0x92: 'ackCodePkidNotFound',
  0x99: 'ackCodePayloadFormatInvalid',
};

const TABLES = { sub: SUB_KEYS, unsub: UNSUB_KEYS, pub: PUB_KEYS } as const;

/** A SUBACK below 0x80 is a grant, and the byte *is* the granted QoS. */
export function isSubAckGrant(code: number): boolean {
  return code <= 0x02;
}

/** Everything from 0x80 up is a refusal; below it the broker said yes. */
export function isAckError(code: number): boolean {
  return code >= 0x80;
}

/** Localized name for an ack reason byte, in the family that sent it. */
export function describeAck(
  code: number,
  kind: keyof typeof TABLES,
  t: Translations,
): string {
  if (kind === 'sub' && isSubAckGrant(code)) {
    return fill(t.ackCodeGrantedQos, { qos: String(code) });
  }
  const key = TABLES[kind][code];
  if (key) return t[key];
  return fill(t.ackCodeUnrecognized, { code: ackHex(code) });
}

/** `0x87` — the raw byte, shown next to the words so it can be searched. */
export function ackHex(code: number): string {
  return `0x${code.toString(16).padStart(2, '0')}`;
}
