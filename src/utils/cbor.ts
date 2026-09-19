/**
 * Minimal dependency-free CBOR (RFC 8949) encoder/decoder.
 * Covers the practical subset: unsigned/negative ints, byte strings, text
 * strings, arrays, maps, booleans, null, undefined, float64, tags, and
 * indefinite-length arrays/maps/strings (decode only).
 */

export interface CborTagged {
  __tag: number;
  value: unknown;
}

export type CborValue =
  | number
  | string
  | boolean
  | null
  | undefined
  | Uint8Array
  | CborValue[]
  | { [key: string]: CborValue }
  | CborTagged;

/* ------------------------------------------------------------------ */
/* Encoder                                                             */
/* ------------------------------------------------------------------ */

class ByteWriter {
  private parts: Uint8Array[] = [];

  push(...bytes: number[]) {
    this.parts.push(Uint8Array.from(bytes));
  }

  raw(data: Uint8Array) {
    this.parts.push(data);
  }

  /** CBOR head: major type + non-negative integer argument */
  head(major: number, arg: number) {
    const mt = major << 5;
    if (arg < 24) {
      this.push(mt | arg);
    } else if (arg < 0x100) {
      this.push(mt | 24, arg);
    } else if (arg < 0x10000) {
      this.push(mt | 25, (arg >> 8) & 0xff, arg & 0xff);
    } else if (arg < 0x100000000) {
      this.push(mt | 26, (arg >>> 24) & 0xff, (arg >>> 16) & 0xff, (arg >>> 8) & 0xff, arg & 0xff);
    } else {
      const hi = Math.floor(arg / 0x100000000);
      const lo = arg % 0x100000000;
      this.push(
        mt | 27,
        (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
        (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff,
      );
    }
  }

  toBytes(): Uint8Array {
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of this.parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }
}

const textEncoder = new TextEncoder();

function encodeFloat64(w: ByteWriter, value: number) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value);
  w.push(0xfb);
  w.raw(new Uint8Array(buf));
}

function encodeValue(w: ByteWriter, value: unknown) {
  if (value === null) return w.push(0xf6);
  if (value === undefined) return w.push(0xf7);
  if (typeof value === 'boolean') return w.push(value ? 0xf5 : 0xf4);

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return encodeFloat64(w, value); // NaN / ±Infinity encode fine as float64
    }
    if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
      if (value >= 0) w.head(0, value);
      else w.head(1, -value - 1);
      return;
    }
    return encodeFloat64(w, value);
  }

  if (typeof value === 'bigint') {
    if (value >= 0n) w.head(0, Number(value));
    else w.head(1, Number(-value - 1n));
    return;
  }

  if (typeof value === 'string') {
    const bytes = textEncoder.encode(value);
    w.head(3, bytes.length);
    w.raw(bytes);
    return;
  }

  if (value instanceof Uint8Array) {
    w.head(2, value.length);
    w.raw(value);
    return;
  }

  if (Array.isArray(value)) {
    w.head(4, value.length);
    for (const item of value) encodeValue(w, item);
    return;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.__tag === 'number') {
      w.head(6, obj.__tag);
      encodeValue(w, obj.value);
      return;
    }
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
    w.head(5, entries.length);
    for (const [k, v] of entries) {
      encodeValue(w, k);
      encodeValue(w, v);
    }
    return;
  }

  w.push(0xf6); // unsupported → null
}

export function encodeCbor(value: unknown): Uint8Array {
  const w = new ByteWriter();
  encodeValue(w, value);
  return w.toBytes();
}

/* ------------------------------------------------------------------ */
/* Decoder                                                             */
/* ------------------------------------------------------------------ */

const BREAK = 0xff;

class ByteReader {
  readonly view: DataView;
  offset = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  u8(): number {
    if (this.offset >= this.bytes.length) throw new Error('CBOR: unexpected end of input');
    return this.bytes[this.offset++];
  }

  take(n: number): Uint8Array {
    if (this.remaining < n) throw new Error('CBOR: truncated data item');
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  readArg(lowBits: number): number {
    if (lowBits < 24) return lowBits;
    switch (lowBits) {
      case 24:
        return this.u8();
      case 25: {
        const v = this.view.getUint16(this.offset);
        this.offset += 2;
        return v;
      }
      case 26: {
        const v = this.view.getUint32(this.offset);
        this.offset += 4;
        return v;
      }
      case 27: {
        const hi = this.view.getUint32(this.offset);
        const lo = this.view.getUint32(this.offset + 4);
        this.offset += 8;
        const n = hi * 0x100000000 + lo;
        if (!Number.isSafeInteger(n)) throw new Error('CBOR: integer exceeds safe range');
        return n;
      }
      default:
        throw new Error(`CBOR: invalid additional info ${lowBits}`);
    }
  }

  atBreak(): boolean {
    return this.bytes[this.offset] === BREAK;
  }

  consumeBreak() {
    this.offset++;
  }
}

function decodeItem(r: ByteReader): CborValue {
  const initial = r.u8();
  const major = initial >> 5;
  const info = initial & 0x1f;

  switch (major) {
    case 0:
      return r.readArg(info);
    case 1:
      return -1 - r.readArg(info);
    case 2: {
      if (info === 31) {
        // indefinite-length byte string
        const chunks: Uint8Array[] = [];
        while (!r.atBreak()) {
          const sub = decodeItem(r);
          if (sub instanceof Uint8Array) chunks.push(sub);
        }
        r.consumeBreak();
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.length;
        }
        return out;
      }
      const len = r.readArg(info);
      return new Uint8Array(r.take(len));
    }
    case 3: {
      if (info === 31) {
        const parts: string[] = [];
        while (!r.atBreak()) {
          const sub = decodeItem(r);
          parts.push(typeof sub === 'string' ? sub : String(sub));
        }
        r.consumeBreak();
        return parts.join('');
      }
      const len = r.readArg(info);
      return new TextDecoder().decode(r.take(len));
    }
    case 4: {
      const arr: CborValue[] = [];
      if (info === 31) {
        while (!r.atBreak()) arr.push(decodeItem(r));
        r.consumeBreak();
        return arr;
      }
      const len = r.readArg(info);
      for (let i = 0; i < len; i++) arr.push(decodeItem(r));
      return arr;
    }
    case 5: {
      const obj: Record<string, CborValue> = {};
      if (info === 31) {
        while (!r.atBreak()) {
          const key = decodeItem(r);
          const val = decodeItem(r);
          obj[keyToProp(key)] = val;
        }
        r.consumeBreak();
        return obj;
      }
      const len = r.readArg(info);
      for (let i = 0; i < len; i++) {
        const key = decodeItem(r);
        const val = decodeItem(r);
        obj[keyToProp(key)] = val;
      }
      return obj;
    }
    case 6: {
      const tag = r.readArg(info);
      const value = decodeItem(r);
      if (tag === 0 || tag === 1) return value as CborValue; // timestamps passthrough
      return { __tag: tag, value } as CborTagged;
    }
    default: {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return undefined;
      if (info === 25) {
        const h = r.view.getUint16(r.offset);
        r.offset += 2;
        return halfToFloat(h);
      }
      if (info === 26) {
        const v = r.view.getFloat32(r.offset);
        r.offset += 4;
        return v;
      }
      if (info === 27) {
        const v = r.view.getFloat64(r.offset);
        r.offset += 8;
        return v;
      }
      return info; // plain simple value
    }
  }
}

function keyToProp(key: CborValue): string {
  if (typeof key === 'string') return key;
  if (key === null || key === undefined) return String(key);
  try {
    return JSON.stringify(key) ?? String(key);
  } catch {
    return String(key);
  }
}

function halfToFloat(h: number): number {
  const exp = (h & 0x7c00) >> 10;
  const frac = h & 0x03ff;
  const sign = h & 0x8000 ? -1 : 1;
  if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

export function decodeCbor(data: Uint8Array): CborValue {
  const r = new ByteReader(data);
  if (r.remaining === 0) throw new Error('CBOR: empty input');
  const value = decodeItem(r);
  return value;
}

/** Pretty-print decoded CBOR as JSON text (Uint8Array → base64) for display */
export function cborToDisplayJson(value: unknown, indent = 2): string {
  const replacer = (_key: string, v: unknown) => {
    if (v instanceof Uint8Array) {
      return { __bytes: uint8ToBase64(v) };
    }
    return v;
  };
  return JSON.stringify(value, replacer, indent) ?? String(value);
}

/* ------------------------------------------------------------------ */
/* Shared binary helpers                                               */
/* ------------------------------------------------------------------ */

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function utf8ToUint8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function uint8ToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

export function uint8ToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
    if ((i + 1) % 16 === 0) hex += '\n';
    else hex += ' ';
  }
  return hex.trimEnd();
}

/** Classic offset+ASCII hex dump used by MQTTX-like tools */
export function uint8ToHexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.subarray(i, i + 16);
    const hexPart = Array.from(row)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(47, ' ');
    const asciiPart = Array.from(row)
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
      .join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hexPart}  |${asciiPart}|`);
  }
  return lines.join('\n');
}
