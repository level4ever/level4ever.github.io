// SPDX-License-Identifier: GPL-3.0-only
// Builds the website's quest data from QuestieDB (npm run data):
//
//   1. Fetches QuestieDB into .cache/QuestieDB (or uses --questiedb <path>).
//   2. Runs QuestieDB's own generator for Forever, which applies all its
//      corrections, with the Lua 5.1 it ships.
//   3. Reads every quest, NPC, object and item back through QuestieDB's
//      public API (questiedb-dump.lua), once per faction.
//   4. Writes public/data/<faction>.json (see src/data/types.ts) and
//      public/data/manifest.json.
//
// Options: --questiedb <path>  use this checkout as is (no fetch)
//          --out <dir>         instead of public/data

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { FACTIONS, questieCredit } from "../src/data/types";
import { checkMasks, transform, type Dump } from "./transform";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const QUESTIEDB_REPO = "https://github.com/Questie/QuestieDB.git";

const { values: options } = parseArgs({
  options: {
    questiedb: { type: "string" },
    out: { type: "string", default: join(ROOT, "public", "data") },
  },
});
const cache = join(ROOT, ".cache");
const out = resolve(options.out!);

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

// The Lua 5.1 that QuestieDB ships for this platform (or $LUA).
function luaFor(checkout: string): string {
  if (process.env.LUA) {
    return process.env.LUA;
  }
  if (process.platform === "win32") {
    return join(checkout, "tools", "lua-binary", "lua.exe");
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return join(checkout, "tools", "lua-binary", "linux-x64", "lua");
  }
  throw new Error("No bundled Lua 5.1 for this platform: set LUA to a Lua 5.1 or LuaJIT interpreter.");
}

function fetchQuestieDB(): string {
  const checkout = join(cache, "QuestieDB");
  if (!existsSync(checkout)) {
    mkdirSync(cache, { recursive: true });
    console.log(`Cloning ${QUESTIEDB_REPO}`);
    run("git", ["clone", "--quiet", "--depth", "1", QUESTIEDB_REPO, checkout], ROOT);
  } else {
    console.log("Updating .cache/QuestieDB");
    run("git", ["fetch", "--quiet", "--depth", "1", "origin", "master"], checkout);
    // Our own cache: generated files and all, it's put back to upstream's master.
    run("git", ["reset", "--quiet", "--hard", "FETCH_HEAD"], checkout);
  }
  return checkout;
}

const checkout = options.questiedb ? resolve(options.questiedb) : fetchQuestieDB();
const commit = run("git", ["rev-parse", "HEAD"], checkout).trim();
const lua = luaFor(checkout);

console.log(`Generating QuestieDB ${commit.slice(0, 9)} for Forever`);
run(lua, ["generate.lua", "Forever"], checkout);

mkdirSync(cache, { recursive: true });
mkdirSync(out, { recursive: true });
const generated = new Date().toISOString();
const manifest: Record<string, unknown> = { generated, questiedb: commit, credit: questieCredit(commit, generated), factions: {} };

for (const faction of FACTIONS) {
  const dumpPath = join(cache, `questiedb-${faction.toLowerCase()}.json`);
  run(lua, [join(ROOT, "pipeline", "questiedb-dump.lua"), faction, dumpPath], checkout);
  const dump: Dump = JSON.parse(readFileSync(dumpPath, "utf8"));
  checkMasks(dump);
  const data = transform(dump, generated, commit);

  const file = `${faction.toLowerCase()}.json`;
  const json = JSON.stringify(data);
  writeFileSync(join(out, file), json);
  const counts = {
    quests: data.quests.length,
    npcs: Object.keys(data.npcs).length,
    objects: Object.keys(data.objects).length,
    items: Object.keys(data.items).length,
  };
  (manifest.factions as Record<string, unknown>)[faction] = { file, bytes: json.length, ...counts };
  console.log(
    `${faction}: ${counts.quests} quests, ${counts.npcs} NPCs, ${counts.objects} objects, ${counts.items} items ` +
      `(${(json.length / 1024 / 1024).toFixed(1)} MB) -> ${join(out, file)}`,
  );
}

writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
