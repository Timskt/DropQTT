import { describe, expect, it } from 'vitest';
import { MqttGenericMessage } from '../../src/types';
import { diffFields, diffLines } from '../../src/utils/diff';

const LABELS = {
  topic: 'topic',
  direction: 'dir',
  qos: 'qos',
  retain: 'retain',
  contentType: 'ct',
  payloadFormat: 'pfi',
  responseTopic: 'rt',
  correlation: 'corr',
  userProperties: 'up',
  payload: 'payload',
};

const msg = (over: Partial<MqttGenericMessage> = {}): MqttGenericMessage => ({
  id: 'x',
  topic: 'a/b',
  payload: '{"v":1}',
  payloadLen: 8,
  payloadBase64: Buffer.from('{"v":1}').toString('base64'),
  truncated: false,
  qos: 1,
  retain: false,
  timestamp: '',
  direction: 'in',
  ...over,
});

describe('feed row diff', () => {
  it('marks only the fields that actually differ', () => {
    const rows = diffFields(msg(), msg({ qos: 2, topic: 'a/c' }), LABELS);
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.topic.same).toBe(false);
    expect(byField.qos.same).toBe(false);
    expect(byField.dir.same).toBe(true);
    expect(byField.payload.same).toBe(true, 'same payload bytes must not read as changed');
  });

  it('shows an em dash for absent properties rather than an empty cell', () => {
    const rows = diffFields(msg(), msg({ qos: 1 }), LABELS);
    const ct = rows.find((r) => r.field === 'ct')!;
    expect(ct.left).toBe('—');
    expect(ct.right).toBe('—');
    expect(ct.same, 'two absences are equal').toBe(true);
  });

  it('falls back to the hex correlation when the bytes are not text', () => {
    const rows = diffFields(
      msg({ correlationHex: 'ff00' }),
      msg({ correlationData: 'ff00' }),
      LABELS,
    );
    const corr = rows.find((r) => r.field === 'corr')!;
    expect(corr.left).toBe('hex:ff00');
    expect(corr.same).toBe(false, 'a hex form and a text form are different claims');
  });

  it('compares user properties as a set of pairs', () => {
    const rows = diffFields(
      msg({ userProperties: [['k', '1']] }),
      msg({ userProperties: [['k', '1'], ['j', '2']] }),
      LABELS,
    );
    expect(rows.find((r) => r.field === 'up')!.same).toBe(false);
  });
});

describe('payload line diff', () => {
  it('aligns identical lines and labels the rest', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\nc');
    expect(lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('handles pure additions and pure removals', () => {
    expect(diffLines('a', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'added', text: 'b' },
    ]);
    expect(diffLines('a\nb', 'a').slice(-1)).toEqual([{ kind: 'removed', text: 'b' }]);
  });

  it('refuses to fake an alignment it was not allowed to compute', () => {
    const big = new Array(400).fill('x').join('\n');
    expect(diffLines(big, big + '\ny')).toBeNull();
  });
});
