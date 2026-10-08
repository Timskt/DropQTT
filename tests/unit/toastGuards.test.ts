import { describe, expect, it } from 'vitest';
import { isNewVerdict, pruneVerdicts, verdictKey } from '../../src/utils/toastGuards';
import { SubRejection } from '../../src/types';

const rej = (filter: string, code: number): SubRejection => ({
  filter,
  code,
  meaning: 'not authorized (ACL)',
  atMs: 1_000,
});

describe('isNewVerdict', () => {
  it('announces a refusal once, however often the reconnect repeats it', () => {
    const seen = new Set<string>();
    expect(isNewVerdict(seen, rej('$SYS/#', 0x87))).toBe(true);
    expect(isNewVerdict(seen, rej('$SYS/#', 0x87))).toBe(false);
    expect(isNewVerdict(seen, rej('$SYS/#', 0x87))).toBe(false);
  });

  it('keeps distinct filters apart', () => {
    const seen = new Set<string>();
    expect(isNewVerdict(seen, rej('a/b', 0x87))).toBe(true);
    expect(isNewVerdict(seen, rej('secret/telemetry', 0x87))).toBe(true);
    expect(isNewVerdict(seen, rej('a/b', 0x87))).toBe(false);
  });

  it('treats a changed reason code as news worth interrupting for', () => {
    const seen = new Set<string>();
    expect(isNewVerdict(seen, rej('a/b', 0x87))).toBe(true);
    expect(isNewVerdict(seen, rej('a/b', 0x9e))).toBe(true);
  });

  it('keys on both parts so no filter can silence another', () => {
    expect(verdictKey(rej('a/b', 1))).toBe(verdictKey(rej('a/b', 1)));
    expect(verdictKey(rej('a/b', 1))).not.toBe(verdictKey(rej('a/c', 1)));
  });
});

describe('pruneVerdicts', () => {
  it('lets a filter announce again once it stops being refused', () => {
    const seen = new Set<string>();
    isNewVerdict(seen, rej('a/b', 0x87));
    expect(isNewVerdict(seen, rej('a/b', 0x87))).toBe(false);
    // Broker granted it after an ACL edit; the memory has to go with the verdict.
    pruneVerdicts(seen, []);
    expect(isNewVerdict(seen, rej('a/b', 0x87))).toBe(true);
  });

  it('keeps the ones still refused and drops only the resolved ones', () => {
    const seen = new Set<string>();
    isNewVerdict(seen, rej('a/b', 0x87));
    isNewVerdict(seen, rej('c/d', 0x87));
    pruneVerdicts(seen, ['c/d']);
    expect(isNewVerdict(seen, rej('c/d', 0x87))).toBe(false);
    expect(isNewVerdict(seen, rej('a/b', 0x87))).toBe(true);
  });
});
