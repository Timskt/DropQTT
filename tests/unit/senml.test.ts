import { describe, expect, it } from 'vitest';
import { looksLikeSenml, parseSenmlPack, senmlToTable } from '../../src/utils/senml';

const NOW_MS = 1_700_000_000_000;

describe('SenML base-field inheritance', () => {
  const pack = [
    { bn: 'urn:dev:ops:esp32-1', bt: 1_700_000_000, bu: 'Cel', n: 'temp', v: 21.5 },
    { n: 'setpoint', v: 22 },
    { bn: 'urn:dev:ops:esp32-1/', n: 'humidity', u: '%RH', v: 43 },
  ];

  it('applies bn/bt/bu to later records until overridden', () => {
    const { readings } = parseSenmlPack(pack, NOW_MS);
    expect(readings.map((r) => r.name)).toEqual([
      'urn:dev:ops:esp32-1temp',
      'urn:dev:ops:esp32-1setpoint',
      'urn:dev:ops:esp32-1/humidity',
    ]);
    expect(readings[0].unit).toBe('Cel');
    // Record 3 redefines bn, and its own u wins over the inherited bu.
    expect(readings[2].unit).toBe('%RH');
  });

  it('resolves every record against the declared base time', () => {
    const { readings } = parseSenmlPack(pack, NOW_MS);
    expect(readings[0].timeMs).toBe(1_700_000_000_000);
    expect(readings[1].timeMs).toBe(1_700_000_000_000);
  });
});

describe('SenML time resolution (RFC 8428 §3)', () => {
  it('treats a base time below 2^28 as an offset from now', () => {
    const { readings } = parseSenmlPack([{ bn: 'd/', bt: -30, n: 't', v: 1 }], NOW_MS);
    expect(readings[0].timeMs).toBe(NOW_MS - 30_000);
  });

  it('treats a base time at or above 2^28 as absolute epoch seconds', () => {
    const { readings } = parseSenmlPack([{ bn: 'd/', bt: 1_700_000_100, n: 't', v: 1 }], NOW_MS);
    expect(readings[0].timeMs).toBe(1_700_000_100_000);
  });

  it('adds the record time offset onto the base time', () => {
    const { readings } = parseSenmlPack(
      [{ bn: 'd/', bt: 1_700_000_000, n: 'a', t: 5, v: 1 }, { n: 'b', t: -2, v: 2 }],
      NOW_MS,
    );
    expect(readings[0].timeMs).toBe(1_700_000_005_000);
    expect(readings[1].timeMs).toBe(1_699_999_998_000);
  });
});

describe('SenML value kinds', () => {
  it('decodes numeric, string, boolean and binary primaries', () => {
    const pack = [
      { bn: 'x/', n: 'num', v: 42.5 },
      { n: 'str', vs: 'ONLINE' },
      { n: 'bool', vb: true },
      { n: 'bytes', vd: new Uint8Array([0xff, 0x00, 0xfe]) },
    ];
    const { readings, warnings } = parseSenmlPack(pack, NOW_MS);
    expect(readings.map((r) => r.kind)).toEqual(['number', 'string', 'boolean', 'binary']);
    expect(readings[0].display).toBe('42.5');
    expect(readings[1].display).toBe('ONLINE');
    expect(readings[2].display).toBe('true');
    expect(readings[3].display).toBe('/wD+');
    expect(warnings).toEqual([]);
  });

  it('adds bv to numeric values and reports sums separately', () => {
    const { readings } = parseSenmlPack([{ bn: 'm/', bv: 100, bs: 7, n: 'a', v: 5, s: 3 }], NOW_MS);
    expect(readings.find((r) => r.kind === 'number')?.numeric).toBe(105);
    expect(readings.find((r) => r.kind === 'sum')?.sum).toBe(3);
  });
});

describe('SenML CBOR label mapping', () => {
  // decodeCbor stringifies integer map keys, so a CBOR pack reaches us shaped
  // exactly like this.
  const cborShaped = { '-2': 'urn:dev:ops:wago-1', 0: 'Temp', 2: 25.863 };

  it('reads signed-integer base labels and unsigned record labels', () => {
    const { readings } = parseSenmlPack(cborShaped, NOW_MS);
    expect(readings).toHaveLength(1);
    expect(readings[0].name).toBe('urn:dev:ops:wago-1Temp');
    expect(readings[0].numeric).toBeCloseTo(25.863, 6);
  });
});

describe('SenML validation', () => {
  it('rejects a pack version newer than the reader', () => {
    expect(() => parseSenmlPack([{ '-1': 99, bn: 'a/', n: 'x', v: 1 }], NOW_MS)).toThrow(/version 99/);
  });

  it('rejects mixed bver inside one pack', () => {
    expect(() =>
      parseSenmlPack([{ bver: 1, bn: 'a/', n: 'x', v: 1 }, { bver: 2, n: 'y', v: 2 }], NOW_MS),
    ).toThrow(/mixed bver/);
  });

  it('fails on a critical extension it cannot honour', () => {
    expect(() => parseSenmlPack([{ bn: 'a/', n: 'x', v: 1, xx_: 1 }], NOW_MS)).toThrow(/critical label/);
  });

  it('ignores an ordinary unknown label but warns', () => {
    const { readings, warnings } = parseSenmlPack([{ bn: 'a/', n: 'x', v: 1, vendorExtra: 7 }], NOW_MS);
    expect(readings).toHaveLength(1);
    expect(warnings.join()).toContain('vendorExtra');
  });

  it('accepts a record that only redefines base values', () => {
    const { readings, warnings } = parseSenmlPack([{ bn: 'a/' }, { n: 'x', v: 1 }], NOW_MS);
    expect(readings).toHaveLength(1);
    expect(warnings).toEqual([]);
  });
});

describe('SenML detection and rendering', () => {
  it('recognises SenML and rejects ordinary JSON', () => {
    expect(looksLikeSenml({ bn: 'd/', n: 'temp', v: 21.5 })).toBe(true);
    expect(looksLikeSenml([{ n: 'a', v: 1 }, { n: 'b', v: 2 }])).toBe(true);
    expect(looksLikeSenml({ deviceId: 'edge-01', status: 'ONLINE' })).toBe(false);
    expect(looksLikeSenml({ temperature: 21.5, humidity: 43 })).toBe(false);
    expect(looksLikeSenml('plain text')).toBe(false);
  });

  it('does not print an inherited base unit on non-numeric readings', () => {
    const table = senmlToTable(parseSenmlPack([
      { bn: 'd/', bu: 'Cel', n: 'temp', v: 21.5 },
      { n: 'online', vb: true },
      { n: 'state', vs: 'BOOT' },
    ], NOW_MS));
    const [numericRow, boolRow, stringRow] = table.split(String.fromCharCode(10));
    expect(numericRow).toContain('Cel');
    expect(boolRow).not.toContain('Cel');
    expect(stringRow).not.toContain('Cel');
    expect(boolRow).toContain('true');
    expect(stringRow).toContain('BOOT');
  });

  it('renders an aligned reading table with resolved names and units', () => {
    const table = senmlToTable(parseSenmlPack([{ bn: 'urn:esp32-1/', bt: 1_700_000_000, bu: 'Cel', n: 'temp', v: 21.5 }], NOW_MS));
    expect(table).toContain('urn:esp32-1/temp');
    expect(table).toContain('Cel');
    expect(table).toContain('21.5');
    expect(table).toContain('2023-11-14 22:13:20');
  });
});
