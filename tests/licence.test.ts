// The GPL parts (see LICENSE) and the proprietary site must stay separate:
// the site never imports the pipeline, and the GPL parts never import the
// site's own code. Every GPL source file says so on an SPDX line.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const ROOT = process.cwd();

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : /\.(ts|tsx|lua)$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );
}

const imports = (file: string) =>
  [...readFileSync(join(ROOT, file), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => relative(ROOT, join(ROOT, file, "..", m[1]!)));

test("the site doesn't import the pipeline", () => {
  for (const file of [...files("src/app"), ...files("src/lib")]) {
    expect(imports(file).filter((path) => path.startsWith("pipeline")), file).toEqual([]);
  }
});

test("the GPL parts don't import the site's own code", () => {
  for (const file of [...files("pipeline"), ...files("src/data")]) {
    expect(
      imports(file).filter((path) => /^src[\\/](app|lib)/.test(path)),
      file,
    ).toEqual([]);
  }
});

test("GPL source files say so", () => {
  for (const file of [...files("pipeline"), ...files("src/data")]) {
    expect(readFileSync(join(ROOT, file), "utf8"), file).toMatch(/SPDX-License-Identifier: GPL-3\.0-only/);
  }
});
