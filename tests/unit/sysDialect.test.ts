import { describe, expect, it } from 'vitest';
import { SysRow } from '../../src/types';
import {
  MOSQUITTO,
  detectDialect,
  detectVendor,
  normalizeSysTopic,
  pickMetrics,
} from '../../src/utils/sysDialect';

/**
 * The topic list below was captured from a real mosquitto 2.0.15 on this machine
 * (`mosquitto_sub -V mqttv5 -t '$SYS/#' -F '%t'`, 38 lines), not written from
 * documentation. That is the point of this file: a layout table is only worth
 * having if it was read from the broker it claims to describe.
 */
const MOSQUITTO_TOPICS = [
  '$SYS/broker/bytes/received',
  '$SYS/broker/bytes/sent',
  '$SYS/broker/clients/active',
  '$SYS/broker/clients/connected',
  '$SYS/broker/clients/maximum',
  '$SYS/broker/clients/total',
  '$SYS/broker/load/bytes/received/15min',
  '$SYS/broker/load/bytes/received/1min',
  '$SYS/broker/load/bytes/received/5min',
  '$SYS/broker/load/bytes/sent/15min',
  '$SYS/broker/load/bytes/sent/1min',
  '$SYS/broker/load/bytes/sent/5min',
  '$SYS/broker/load/connections/15min',
  '$SYS/broker/load/connections/1min',
  '$SYS/broker/load/connections/5min',
  '$SYS/broker/load/messages/received/15min',
  '$SYS/broker/load/messages/received/1min',
  '$SYS/broker/load/messages/received/5min',
  '$SYS/broker/load/messages/sent/15min',
  '$SYS/broker/load/messages/sent/1min',
  '$SYS/broker/load/messages/sent/5min',
  '$SYS/broker/load/publish/sent/15min',
  '$SYS/broker/load/publish/sent/1min',
  '$SYS/broker/load/publish/sent/5min',
  '$SYS/broker/load/sockets/15min',
  '$SYS/broker/load/sockets/1min',
  '$SYS/broker/load/sockets/5min',
  '$SYS/broker/messages/received',
  '$SYS/broker/messages/sent',
  '$SYS/broker/messages/stored',
  '$SYS/broker/publish/bytes/sent',
  '$SYS/broker/publish/messages/sent',
  '$SYS/broker/retained messages/count',
  '$SYS/broker/store/messages/bytes',
  '$SYS/broker/store/messages/count',
  '$SYS/broker/subscriptions/count',
  '$SYS/broker/uptime',
  '$SYS/broker/version',
];

const rows = (topics: string[], value = '1'): SysRow[] =>
  topics.map((topic) => ({ topic, value, lastSeen: 0 }));

describe('broker $SYS layouts', () => {
  it('normalizes the prefix and case brokers disagree about', () => {
    expect(normalizeSysTopic('$SYS/broker/uptime')).toBe('broker/uptime');
    expect(normalizeSysTopic('$SYS//broker/Version/')).toBe('broker/version');
    expect(normalizeSysTopic('broker/uptime')).toBe('broker/uptime');
  });

  it('claims mosquitto from a tree that was really captured, not guessed', () => {
    const all = rows(MOSQUITTO_TOPICS);
    expect(detectDialect(all)?.name).toBe('Mosquitto');
    const picked = pickMetrics(all, MOSQUITTO);
    // Every metric in the table must exist in the captured tree; a row that
    // drifted from the real broker is the bug this test exists to catch.
    expect(picked.map((p) => p.id)).toEqual([
      'version',
      'uptime',
      'connections',
      'msgReceived',
      'msgSent',
      'load1min',
      'retained',
      'subscriptions',
      'bytesReceived',
      'bytesSent',
    ]);
    for (const { id, row } of picked) {
      expect(row.topic.toLowerCase()).toContain(MOSQUITTO.metrics[id]);
    }
  });

  it('does not claim a layout from a single coincidental topic', () => {
    expect(detectDialect(rows(['$SYS/broker/version']))).toBeNull();
    expect(detectDialect(rows(['$SYS/broker/version', '$SYS/broker/other']))).toBeNull();
    // Two topics from the signature is the bar; `uptime` is deliberately not in
    // it, because nearly every broker publishes an uptime row and it proves nothing.
    expect(
      detectDialect(rows(['$SYS/broker/version', '$SYS/broker/clients/connected']))?.name,
    ).toBe('Mosquitto');
    expect(detectDialect(rows(['$SYS/broker/version', '$SYS/broker/uptime']))).toBeNull();
  });

  it('skips metrics a broker does not publish instead of inventing a row', () => {
    const partial = rows([
      '$SYS/broker/version',
      '$SYS/broker/uptime',
      '$SYS/broker/clients/connected',
    ]);
    const picked = pickMetrics(partial, MOSQUITTO);
    expect(picked.map((p) => p.id)).toEqual(['version', 'uptime', 'connections']);
  });

  it('says which vendor it read, and never a name it made up', () => {
    expect(detectVendor(rows(['$SYS/broker/version'], 'mosquitto version 2.0.15'))).toBe('Mosquitto');
    expect(detectVendor(rows(['$SYS/broker/version'], 'emqx 5.0.26'))).toBe('EMQX');
    expect(detectVendor(rows(['$SYS/broker/version'], 'HiveMQ 4.x'))).toBe('HiveMQ');
    expect(detectVendor(rows(['$SYS/broker/version'], 'verne 5.9'))).toBe('VerneMQ');
    expect(detectVendor(rows(['$SYS/broker/version'], 'nanomq 0.21'))).toBe('NanoMQ');
    expect(detectVendor(rows(['$SYS/broker/version'], 'weirdbroker 1.2.3'))).toBe('weirdbroker');
    expect(detectVendor(rows(['$SYS/broker/uptime'], '3600'))).toBe('');
  });

  it('a vendor we cannot name still gets the raw tree, not an empty panel', () => {
    // EMQX/HiveMQ/VerneMQ/NanoMQ have no table on purpose: their layouts were
    // never read from a broker here. Detection must report the vendor and leave
    // the metric cards empty so the panel says "unknown layout" out loud.
    const emqx = rows(
      ['$SYS/broker/version', '$SYS/emqx/sys/uptime', '$SYS/emqx/sys/received_msgs'],
      'emqx 5.0.26',
    );
    expect(detectVendor(emqx)).toBe('EMQX');
    expect(detectDialect(emqx)).toBeNull();
    expect(pickMetrics(emqx, null)).toEqual([]);
  });
});
