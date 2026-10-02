import { describe, expect, it } from 'vitest';
import { translations } from '../../src/i18n';
import { ackHex, describeAck, isAckError, isSubAckGrant } from '../../src/utils/ackReason';

const en = translations.en;

/**
 * These bytes are the difference between "your subscription is live" and "the
 * broker refused it because your ACL forbids that topic". The values come from
 * MQTT 5 §3.2.2.2.0 and were cross-checked against the table mqtt.js ships; the
 * traps (0x8F vs 0x90, 0x10 not being an error) are pinned individually.
 */
describe('ack reason codes', () => {
  it('names a granted suback qos instead of treating it as a refusal', () => {
    expect(isSubAckGrant(0x02)).toBe(true);
    expect(isAckError(0x02)).toBe(false);
    expect(describeAck(0x00, 'sub', en)).toBe('granted QoS 0');
    expect(describeAck(0x02, 'sub', en)).toBe('granted QoS 2');
  });

  it('labels every documented suback refusal', () => {
    expect(describeAck(0x80, 'sub', en)).toBe('unspecified error');
    expect(describeAck(0x83, 'sub', en)).toBe('implementation specific error');
    expect(describeAck(0x87, 'sub', en)).toBe('not authorized (ACL)');
    expect(describeAck(0x8f, 'sub', en)).toBe('topic filter invalid');
    expect(describeAck(0x91, 'sub', en)).toBe('packet identifier in use');
    expect(describeAck(0x97, 'sub', en)).toBe('quota exceeded');
    expect(describeAck(0x9e, 'sub', en)).toBe('shared subscriptions not supported');
    expect(describeAck(0xa1, 'sub', en)).toBe('subscription identifiers not supported');
    expect(describeAck(0xa2, 'sub', en)).toBe('wildcard subscriptions not supported');
    for (const code of [0x80, 0x83, 0x87, 0x8f, 0x91, 0x97, 0x9e, 0xa1, 0xa2]) {
      expect(isAckError(code)).toBe(true);
    }
  });

  it('keeps the two 0x8e/0x8f traps apart', () => {
    // 0x8E is a PUBLISH-family code ("topic alias invalid"), never a SUBACK one.
    expect(describeAck(0x8e, 'sub', en)).toContain('unrecognized');
    // 0x90 means "topic name invalid" for a publish and nothing for a suback.
    expect(describeAck(0x90, 'pub', en)).toBe('topic name invalid');
    expect(describeAck(0x90, 'sub', en)).toContain('unrecognized');
  });

  it('treats the low non-zero bytes as family-specific notes', () => {
    expect(describeAck(0x10, 'pub', en)).toBe('no matching subscribers');
    expect(isAckError(0x10)).toBe(false);
    expect(describeAck(0x11, 'unsub', en)).toBe('no subscription existed');
    // ...and nothing for the other families.
    expect(describeAck(0x10, 'sub', en)).toContain('unrecognized');
    expect(describeAck(0x11, 'sub', en)).toContain('unrecognized');
    expect(describeAck(0x92, 'pub', en)).toBe('packet identifier not found');
  });

  it('prints the byte the user can search for', () => {
    expect(ackHex(0x87)).toBe('0x87');
    expect(ackHex(0xa2)).toBe('0xa2');
    expect(describeAck(0x77, 'sub', en)).toBe('unrecognized reason code 0x77');
  });

  it('has a translation for every code of every family, in all four languages', () => {
    const byFamily: Record<'sub' | 'unsub' | 'pub', number[]> = {
      sub: [0x00, 0x01, 0x02, 0x80, 0x83, 0x87, 0x8f, 0x91, 0x97, 0x9e, 0xa1, 0xa2],
      unsub: [0x11, 0x80, 0x83, 0x87, 0x8f, 0x91],
      pub: [0x10, 0x80, 0x83, 0x87, 0x90, 0x91, 0x92, 0x97, 0x99],
    };
    // 0x00 means "success" for the unsubscribe and publish families; nothing in
    // the UI ever asks for a label for it, so it is deliberately unlabelled.
    expect(isAckError(0x00)).toBe(false);
    for (const [lang, t] of Object.entries(translations)) {
      for (const [family, codes] of Object.entries(byFamily)) {
        for (const code of codes) {
          const label = describeAck(code, family as 'sub' | 'unsub' | 'pub', t);
          expect(label, `${lang} ${family} ${ackHex(code)}`).not.toBe('');
          expect(label, `${lang} ${family} ${ackHex(code)}`).not.toContain('unrecognized');
        }
      }
      expect(describeAck(0x00, 'sub', t)).toContain('QoS 0');
    }
  });
});
