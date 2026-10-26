// The addon's string format for plain Lua data (Serialize / Deserialize and
// Base64 in the addon's Guides.lua), byte for byte:
//   number  n<digits>;    string  s<length>:<bytes>    true/false  T / F
//   table   { key value key value ... }
// Lengths count bytes, so strings are handled as UTF-8 throughout.

export type LuaValue = number | string | boolean | LuaTable;
export type LuaKey = number | string;

// A Lua table. Unlike a JS object, 1 and "1" are different keys, which the
// addon relies on: quest IDs must arrive as numbers.
export class LuaTable {
  readonly entries = new Map<LuaKey, LuaValue>();

  get(key: LuaKey): LuaValue | undefined {
    return this.entries.get(key);
  }

  set(key: LuaKey, value: LuaValue): this {
    this.entries.set(key, value);
    return this;
  }

  // Lua's ipairs: t[1], t[2], ... up to the first nil.
  *ipairs(): Generator<LuaValue> {
    for (let i = 1; this.entries.has(i); i++) {
      yield this.entries.get(i)!;
    }
  }

  pairs(): IterableIterator<[LuaKey, LuaValue]> {
    return this.entries.entries();
  }
}

const MAX_DEPTH = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A JS value as a Lua table: arrays are 1-based lists, and object keys that
// are integers become number keys. undefined is nil.
export function toLua(value: unknown): LuaValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof LuaTable) {
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`can't convert a ${typeof value} to Lua`);
  }
  const table = new LuaTable();
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      const lua = toLua(v);
      if (lua !== undefined) {
        table.set(i + 1, lua);
      }
    });
  } else {
    for (const [k, v] of Object.entries(value)) {
      const lua = toLua(v);
      if (lua !== undefined) {
        table.set(/^-?(0|[1-9]\d*)$/.test(k) && Number.isSafeInteger(Number(k)) ? Number(k) : k, lua);
      }
    }
  }
  return table;
}

// C's %.10g, as the addon formats non-integers.
function formatG10(n: number): string {
  const exponent = Number(n.toExponential(9).split("e")[1]);
  if (exponent < -4 || exponent >= 10) {
    const [mantissa, exp] = n.toExponential(9).split("e") as [string, string];
    const digits = mantissa.includes(".") ? mantissa.replace(/0+$/, "").replace(/\.$/, "") : mantissa;
    const sign = exp.startsWith("-") ? "-" : "+";
    return `${digits}e${sign}${exp.replace(/^[+-]/, "").padStart(2, "0")}`;
  }
  const fixed = n.toFixed(9 - exponent);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError(`can't serialize ${n}`);
  }
  // %d is 32-bit on some clients, so bigger integers go through %.10g as well.
  if (Number.isInteger(n) && Math.abs(n) < 2 ** 31) {
    return Object.is(n, -0) ? "0" : String(n);
  }
  return formatG10(n);
}

function writeValue(value: LuaValue, out: Uint8Array[]): void {
  if (typeof value === "number") {
    out.push(encoder.encode(`n${formatNumber(value)};`));
  } else if (typeof value === "string") {
    const bytes = encoder.encode(value);
    out.push(encoder.encode(`s${bytes.length}:`), bytes);
  } else if (typeof value === "boolean") {
    out.push(encoder.encode(value ? "T" : "F"));
  } else {
    out.push(encoder.encode("{"));
    for (const [k, v] of value.pairs()) {
      writeValue(k, out);
      writeValue(v, out);
    }
    out.push(encoder.encode("}"));
  }
}

export function serialize(value: LuaValue): Uint8Array {
  const out: Uint8Array[] = [];
  writeValue(value, out);
  const bytes = new Uint8Array(out.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of out) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

// Lua 5.1's tonumber on a string: decimal (with optional exponent) or hex,
// surrounded by optional whitespace. NaN if it isn't a number.
export function luaToNumber(text: string): number {
  if (/^[ \t\n\v\f\r]*[+-]?0[xX][0-9a-fA-F]+[ \t\n\v\f\r]*$/.test(text)) {
    const trimmed = text.trim();
    const negative = trimmed.startsWith("-");
    const n = parseInt(trimmed.replace(/^[+-]?0[xX]/, ""), 16);
    return negative ? -n : n;
  }
  if (/^[ \t\n\v\f\r]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[ \t\n\v\f\r]*$/.test(text)) {
    return Number(text.trim());
  }
  return NaN;
}

const TAG_N = "n".charCodeAt(0);
const TAG_S = "s".charCodeAt(0);
const TAG_T = "T".charCodeAt(0);
const TAG_F = "F".charCodeAt(0);
const OPEN = "{".charCodeAt(0);
const CLOSE = "}".charCodeAt(0);
const SEMICOLON = ";".charCodeAt(0);
const COLON = ":".charCodeAt(0);

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

// Reading never runs anything, so a pasted string is just data. Throws on
// anything malformed, as the addon does.
export function deserialize(bytes: Uint8Array): LuaValue {
  let pos = 0;
  const read = (depth: number): LuaValue => {
    if (depth > MAX_DEPTH) {
      throw new Error("nested too deep");
    }
    const tag = bytes[pos];
    pos++;
    if (tag === TAG_N) {
      const stop = bytes.indexOf(SEMICOLON, pos);
      const n = stop === -1 ? NaN : luaToNumber(ascii(bytes, pos, stop));
      if (!Number.isFinite(n)) {
        throw new Error("bad number");
      }
      pos = stop + 1;
      return n;
    } else if (tag === TAG_S) {
      const colon = bytes.indexOf(COLON, pos);
      const length = colon === -1 ? NaN : luaToNumber(ascii(bytes, pos, colon));
      if (!Number.isInteger(length) || length < 0) {
        throw new Error("bad string");
      }
      if (colon + 1 + length > bytes.length) {
        throw new Error("string cut short");
      }
      pos = colon + 1 + length;
      return decoder.decode(bytes.subarray(colon + 1, pos));
    } else if (tag === TAG_T) {
      return true;
    } else if (tag === TAG_F) {
      return false;
    } else if (tag === OPEN) {
      const table = new LuaTable();
      while (bytes[pos] !== CLOSE) {
        if (pos >= bytes.length) {
          throw new Error("table cut short");
        }
        const key = read(depth + 1);
        if (typeof key !== "number" && typeof key !== "string") {
          throw new Error("bad key");
        }
        table.set(key, read(depth + 1));
      }
      pos++;
      return table;
    }
    throw new Error("unexpected data");
  };
  const value = read(0);
  if (pos < bytes.length) {
    throw new Error("extra data at the end");
  }
  return value;
}

// Base64, so the string survives copy/paste and chat-style edit boxes (which
// treat "|" as an escape).
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DECODE = new Map([...ALPHABET].map((c, i) => [c.charCodeAt(0), i]));

export function base64Encode(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i]!;
    const b = data[i + 1];
    const c = data[i + 2];
    const n = a * 65536 + (b ?? 0) * 256 + (c ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += b === undefined ? "=" : ALPHABET[(n >> 6) & 63]!;
    out += c === undefined ? "=" : ALPHABET[n & 63]!;
  }
  return out;
}

// Undefined if the text isn't valid base64.
export function base64Decode(text: string): Uint8Array | undefined {
  text = text.replace(/=+$/, "");
  if (text.length % 4 === 1) {
    return undefined;
  }
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const values = [0, 1, 2, 3].map((j) => (i + j < text.length ? DECODE.get(text.charCodeAt(i + j)) : null));
    if (values.some((v) => v === undefined)) {
      return undefined; // a character outside the alphabet
    }
    const [v1, v2, v3, v4] = values as (number | null)[];
    const n = v1! * 262144 + v2! * 4096 + (v3 ?? 0) * 64 + (v4 ?? 0);
    out.push(Math.floor(n / 65536));
    if (v3 !== null) {
      out.push(Math.floor(n / 256) % 256);
    }
    if (v4 !== null) {
      out.push(n % 256);
    }
  }
  return new Uint8Array(out);
}
