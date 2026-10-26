import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { emptyGuide, type Guide } from "../src/lib/guide";
import { EXPORT_PREFIX, IMPORT_ERRORS, exportGuide, importGuide, newUid } from "../src/lib/guideString";
import { LuaTable, base64Decode, base64Encode, deserialize, serialize, toLua } from "../src/lib/lua";

// Strings the addon exported, and the guide the addon's own import made of
// each. Refreshed by tools/addon-crosscheck.py.
const ADDON_GUIDES: { name: string; export: string; imported: Guide }[] = JSON.parse(
  readFileSync(new URL("./fixtures/addon-guides.json", import.meta.url), "utf8"),
);

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytes = (s: string) => new TextEncoder().encode(s);

// An export string's payload with old swapped for new.
function rewrite(exported: string, old: string, replacement: string): string {
  const raw = text(base64Decode(exported.slice(EXPORT_PREFIX.length))!);
  expect(raw).toContain(old);
  return EXPORT_PREFIX + base64Encode(bytes(raw.replace(old, replacement)));
}

describe("guides exported by the addon", () => {
  test.each(ADDON_GUIDES.map((c) => [c.name.trim(), c] as const))("%s imports as the addon imports it", (_, c) => {
    expect(importGuide(c.export)).toEqual({ guide: c.imported });
  });

  test.each(ADDON_GUIDES.map((c) => [c.name.trim(), c] as const))("%s survives export and import", (_, c) => {
    const guide = importGuide(c.export).guide!;
    guide.uid ??= newUid();
    expect(importGuide(exportGuide(guide)).guide).toEqual(guide);
  });

  test("line breaks and spaces pasted into a string are ignored", () => {
    const c = ADDON_GUIDES[0]!;
    const wrapped = "  " + c.export.match(/.{1,64}/g)!.join("\n") + "\r\n";
    expect(importGuide(wrapped)).toEqual({ guide: c.imported });
  });
});

describe("importing a bad string says why, as the addon does", () => {
  const good = ADDON_GUIDES[0]!.export;

  test.each([
    ["nothing", "", IMPORT_ERRORS.empty],
    ["only whitespace", " \n\t", IMPORT_ERRORS.empty],
    ["another addon's string", "!WA:2!abc", IMPORT_ERRORS.notAGuide],
    ["a string cut short", good.slice(0, good.length - 40), IMPORT_ERRORS.damaged],
    ["a character that isn't base64", good.slice(0, 20) + "|" + good.slice(21), IMPORT_ERRORS.damaged],
    ["an older format", rewrite(good, "s7:versionn4;", "s7:versionn3;"), IMPORT_ERRORS.older],
    ["a newer format", rewrite(good, "s7:versionn4;", "s7:versionn5;"), IMPORT_ERRORS.newer],
    ["no faction", rewrite(good, "s5:Horde", "s5:Orcss"), IMPORT_ERRORS.damaged],
  ])("%s", (_, input, error) => {
    expect(importGuide(input)).toEqual({ error });
  });

  test("a payload that isn't a table", () => {
    expect(importGuide(EXPORT_PREFIX + base64Encode(serialize("hello")))).toEqual({ error: IMPORT_ERRORS.damaged });
  });

  test("the version may be a numeric string, as Lua's tonumber allows", () => {
    const guide = importGuide(rewrite(good, "s7:versionn4;", "s7:versions1:4")).guide;
    expect(guide).toEqual(ADDON_GUIDES[0]!.imported);
  });
});

describe("exporting", () => {
  const guide: Guide = {
    ...emptyGuide("Durotar ✓", "Horde"),
    uid: "3fa9c01b77e2",
    chapters: [{ id: 1, name: "Valley of Trials", level: 5 }],
    items: [
      { id: 1, chapterId: 1, type: "quest", quest: 4641, pickup: true },
      { id: 2, chapterId: 1, type: "note", text: "Set hearth", kind: "hearth", coords: { mapID: 1411, x: 0.452, y: 0.638 } },
    ],
    questCoords: { 4641: { mapID: 1411, x: 0.4234, y: 0.6876 } },
    questPrereqs: { 788: [4641] },
  };

  test("needs a uid, so the addon can update copies of the guide later", () => {
    expect(() => exportGuide({ ...guide, uid: undefined })).toThrow(/uid/);
    expect(newUid()).toMatch(/^[0-9a-f]{12}$/);
  });

  test("quest IDs are number keys and lengths count bytes", () => {
    const raw = text(base64Decode(exportGuide(guide).slice(EXPORT_PREFIX.length))!);
    expect(raw).toContain("s4:names11:Durotar ✓"); // ✓ is 3 bytes
    expect(raw).toContain("s11:questCoords{n4641;{");
    expect(raw).toContain("s12:questPrereqs{n788;{n1;n4641;}}");
    expect(raw).toContain("s1:xn0.452;");
  });

  test("round trips", () => {
    expect(importGuide(exportGuide(guide))).toEqual({ guide });
  });
});

describe("serializing like the addon", () => {
  const encode = (value: unknown) => text(serialize(toLua(value)!));

  test.each([
    [0, "n0;"],
    [-0, "n0;"],
    [42, "n42;"],
    [-7, "n-7;"],
    [2 ** 31 - 1, "n2147483647;"],
    // %d is 32-bit on some clients, so bigger integers use %.10g
    [2 ** 31, "n2147483648;"],
    [8589934770, "n8589934770;"],
    [12345678901, "n1.23456789e+10;"],
    [0.452, "n0.452;"],
    [0.1 + 0.2, "n0.3;"],
    [1 / 3, "n0.3333333333;"],
    [0.00001234, "n1.234e-05;"],
    [123.456, "n123.456;"],
  ])("%s", (value, expected) => {
    expect(encode(value)).toBe(expected);
  });

  test("other values", () => {
    expect(encode("héllo")).toBe("s6:héllo");
    expect(encode(true) + encode(false)).toBe("TF");
    expect(encode(["a", undefined, "c"])).toBe("{n1;s1:an3;s1:c}");
    expect(encode({ 12: "x", abc: 1, "012": 2 })).toBe("{n12;s1:xs3:abcn1;s3:012n2;}");
    expect(() => encode(Infinity)).toThrow();
  });

  test("reading back", () => {
    const table = deserialize(bytes("{n1;s2:hin2;Ts1:1F}")) as LuaTable;
    expect([...table.pairs()]).toEqual([
      [1, "hi"],
      [2, true],
      ["1", false], // "1" and 1 are different keys
    ]);
    expect(deserialize(bytes("n0x10;"))).toBe(16);
    expect(deserialize(bytes("n 1.5e2 ;"))).toBe(150);
  });

  test.each([
    ["extra data", "n1;n2;", /extra data/],
    ["a bad number", "nabc;", /bad number/],
    ["a number without its end", "n12", /bad number/],
    ["a string cut short", "s5:abc", /cut short/],
    ["a bad string length", "s-1:", /bad string/],
    ["a table cut short", "{n1;n2;", /cut short/],
    ["a table key", "{{}n1;}", /bad key/],
    ["an unknown tag", "x", /unexpected/],
    ["nesting past 32", "{n1;".repeat(33) + "}".repeat(33), /too deep/],
  ])("rejects %s", (_, input, error) => {
    expect(() => deserialize(bytes(input))).toThrow(error);
  });

  test("base64 matches the standard alphabet", () => {
    for (const s of ["", "a", "ab", "abc", "abcd", "héllo wörld ✓"]) {
      const encoded = base64Encode(bytes(s));
      expect(encoded).toBe(Buffer.from(s).toString("base64"));
      expect(text(base64Decode(encoded)!)).toBe(s);
    }
    expect(base64Decode("abcde")).toBeUndefined(); // length % 4 == 1
    expect(base64Decode("ab|d")).toBeUndefined();
  });
});
