import { describe, expect, it } from 'vitest';
import { mosquittoCommand, mosquittoCommandText } from '../../src/utils/mqttCommand';
import type { MqttGenericMessage } from '../../src/types';

const broker = { host: '127.0.0.1', port: 18831, tls: false };

const msg = (over: Partial<MqttGenericMessage> = {}): MqttGenericMessage => ({
  id: 'm1',
  topic: 'devices/edge-1/telemetry',
  payload: '{"temp":21.5}',
  payloadLen: 13,
  payloadBase64: 'eyJ0ZW1wIjoyMS41fQ==',
  truncated: false,
  qos: 1,
  retain: false,
  timestamp: '10:00:00.000',
  direction: 'in',
  ...over,
});

/** What the shell actually runs: backslash-newline continuations collapse. */
/** What the shell actually runs: line continuations and their indentation fold. */
const flat = (command: string): string => command.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();

describe('mosquittoCommand', () => {
  it('carries topic, qos, retain and payload as one shell-safe command', () => {
    const { command, notes } = mosquittoCommand(msg(), broker);
    const one = flat(command);
    expect(one).toContain('mosquitto_pub -V mqttv5');
    expect(one).toContain("-h '127.0.0.1' -p 18831");
    expect(one).toContain("-t 'devices/edge-1/telemetry' -q 1");
    expect(one).toContain(`-m '${'{"temp":21.5}'}'`);
    expect(one).not.toContain('-r');
    expect(notes).toEqual([]);
    // Every continuation ends the line, which is what makes the paste work.
    expect(command).toContain('\\\n');
  });

  it('escapes an apostrophe instead of letting it end the argument', () => {
    const { command } = mosquittoCommand(msg({ payload: "it's hot", payloadLen: 8 }), broker);
    expect(flat(command)).toContain(`-m 'it'\\''s hot'`);
  });

  it('adds retain and the v5 properties the CLI can express', () => {
    const { command } = mosquittoCommand(
      msg({
        retain: true,
        contentType: 'application/json',
        responseTopic: 'devices/edge-1/reply',
        correlationData: 'c-7',
        userProperties: [['trace', 'abc']],
      }),
      broker,
    );
    const one = flat(command);
    expect(one).toContain('-r');
    expect(one).toContain("-D publish content-type 'application/json'");
    expect(one).toContain("-D publish response-topic 'devices/edge-1/reply'");
    expect(one).toContain("-D publish correlation-data 'c-7'");
    expect(one).toContain("-D publish user-property 'trace' 'abc'");
  });

  it('falls back to a file for binary payloads and says what to write', () => {
    const { command, notes } = mosquittoCommand(
      msg({ payload: '', payloadBase64: '/wAB', payloadLen: 3 }),
      broker,
    );
    expect(command).toContain('-f payload.bin');
    expect(command).not.toContain('-m');
    expect(notes[0]).toContain('/wAB');
  });

  it('refuses to pretend a truncated payload is reproducible', () => {
    const { command, notes } = mosquittoCommand(
      msg({ payload: 'abcdef', payloadLen: 90_000, truncated: true }),
      broker,
    );
    expect(command).toContain('-f payload.bin');
    expect(notes[0]).toContain('truncated');
  });

  it('names a binary correlation instead of pasting a lossy text form', () => {
    const { command, notes } = mosquittoCommand(
      msg({ correlationHex: '00ff10', correlationData: undefined }),
      broker,
    );
    expect(command).not.toContain('correlation-data');
    expect(notes[0]).toContain('3 raw bytes (00ff10)');
  });

  it('never emits credentials, and the text form keeps the notes visible', () => {
    const text = mosquittoCommandText(mosquittoCommand(msg({ payload: 'x' }), { ...broker, tls: true }));
    expect(text).toContain('--cafile <path>');
    expect(text).not.toMatch(/-P|-u /);
    const withNotes = mosquittoCommandText(mosquittoCommand(msg({ payload: '', payloadBase64: '/wAB' }), broker));
    expect(withNotes.split('\n').at(-1)).toMatch(/^# /);
  });
});
