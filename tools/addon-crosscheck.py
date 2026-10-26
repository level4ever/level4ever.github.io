"""Checks the website's guide strings against the addon's real Lua, in both
directions, and refreshes tests/fixtures/addon-guides.json.

  1. The addon exports every guide in its real_guides.lua test fixture, plus
     a guide full of malformed values, and imports each string again. The
     strings and what the addon's import made of them are the fixture that
     tests/guideString.test.ts checks the website's importGuide against.
  2. The website imports each of those strings and exports it again
     (tools/reexport.ts), and the addon imports the website's strings. Each
     must come out the same as the addon's own string did.

Needs the addon's checkout (../../Level4ever, or set LEVEL4EVER_ADDON) and
its test requirements (pip install lupa). Run it after changing the export
format on either side:

  python tools/addon-crosscheck.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEBSITE = os.path.dirname(HERE)
ADDON = os.environ.get("LEVEL4EVER_ADDON") or os.path.join(WEBSITE, "..", "Level4ever")
FIXTURE = os.path.join(WEBSITE, "tests", "fixtures", "addon-guides.json")

sys.path.insert(0, os.path.join(ADDON, "tests"))
from harness import make, fixture  # noqa: E402

LUA = r'''
-- A guide as JSON, shaped like the website's Guide type: per-quest tables
-- (and objectiveCoords' inner tables) are objects keyed by ID, lists are arrays.
local MAPS = { questCoords = true, questClasses = true, optionalQuests = true,
    questPrereqs = true, objectiveCoords = true, turnInCoords = true }
local Encode
local function IsList(t)
    local n = 0
    for k in pairs(t) do
        if type(k) ~= "number" or k < 1 or k ~= math.floor(k) then return false end
        n = math.max(n, k)
    end
    return true, n
end
local function EncodeObject(t, out, valueIsMap)
    local keys = {}
    for k in pairs(t) do table.insert(keys, k) end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    table.insert(out, "{")
    for i, k in ipairs(keys) do
        if i > 1 then table.insert(out, ",") end
        Encode(tostring(k), out)
        table.insert(out, ":")
        Encode(t[k], out, valueIsMap)
    end
    table.insert(out, "}")
end
Encode = function(v, out, asMap)
    local kind = type(v)
    if kind == "number" then
        table.insert(out, v == math.floor(v) and ("%.0f"):format(v) or ("%.17g"):format(v))
    elseif kind == "string" then
        table.insert(out, '"' .. v:gsub('[%c"\\]', function(c) return ("\\u%04x"):format(c:byte()) end) .. '"')
    elseif kind == "boolean" then
        table.insert(out, tostring(v))
    elseif asMap then
        EncodeObject(v, out)
    else
        local list, n = IsList(v)
        if list and n > 0 then
            table.insert(out, "[")
            for i = 1, n do
                if i > 1 then table.insert(out, ",") end
                Encode(v[i], out)
            end
            table.insert(out, "]")
        elseif list then
            table.insert(out, "[]")
        else
            EncodeObject(v, out)
        end
    end
end
function GuideJSON(guide)
    local fields = { name = guide.name, faction = guide.faction, uid = guide.uid }
    for _, key in ipairs(L4.GUIDE_TABLES) do fields[key] = guide[key] end
    local out = { "{" }
    local first = true
    local keys = {}
    for k in pairs(fields) do table.insert(keys, k) end
    table.sort(keys)
    for _, k in ipairs(keys) do
        if not first then table.insert(out, ",") end
        first = false
        Encode(k, out)
        table.insert(out, ":")
        if k == "objectiveCoords" then
            -- quest -> objective -> coords: both levels keyed by number
            local byQuest = fields[k]
            table.insert(out, "{")
            local quests = {}
            for q in pairs(byQuest) do table.insert(quests, q) end
            table.sort(quests)
            for i, q in ipairs(quests) do
                if i > 1 then table.insert(out, ",") end
                Encode(tostring(q), out)
                table.insert(out, ":")
                Encode(byQuest[q], out, true)
            end
            table.insert(out, "}")
        else
            Encode(fields[k], out, MAPS[k])
        end
    end
    table.insert(out, "}")
    return table.concat(out)
end

-- Imports a string into the addon; the guide as JSON, or nil and the error.
-- The guide is deleted again so the next import keeps its name.
function ImportJSON(text)
    local guide, err = L4:ImportGuide(text)
    if not guide then return nil, err end
    local json = GuideJSON(guide)
    L4:DeleteGuide(guide.id)
    return json
end

-- Values of every wrong shape the addon's import has to clean up.
MALFORMED = {
    name = "  Malformed: Élan ünd Mulgore  ", faction = "Alliance", uid = "not-hex",
    chapters = {
        { id = 1, name = "First", level = 10 },
        { id = 1, name = "Same id again" },
        { id = 2, name = "   ", level = 500 },
        { id = -3, name = "Bad id" },
        "not a chapter",
    },
    items = {
        { id = 1, chapterId = 1, type = "quest", quest = 100, pickup = true, objectives = true, turnin = true, class = "PALADIN", batch = 5 },
        { id = 2, chapterId = 1, type = "quest", quest = 101, pickup = true, class = "not a class", batch = 5 },
        { id = 3, chapterId = 2, type = "note", text = "Train ✓", class = "PRIEST", batch = 7 },
        { id = 4, chapterId = 2, type = "note", text = "", class = "paladin", kind = "bogus" },
        { id = 5, chapterId = 99, type = "quest", quest = 102, objectives = { 1, 11, "x", 2 }, turnin = "yes", ongoing = true, batch = 5 },
        { id = 6, chapterId = 99, type = "quest", quest = 103, pickup = true, batch = 5 },
        { id = 6, chapterId = 1, type = "quest", quest = 104, pickup = true },
        { id = 7, chapterId = 1, type = "note", kind = "loot", text = "Wool Cloth", itemId = 2592, count = 6, prereqs = { 100, -1, 101 },
            coords = { mapID = 1411, x = 0.25, y = 0.75 } },
        { id = 8, chapterId = 1, type = "spell" },
        { id = 9.5, chapterId = 1, type = "quest", quest = 105 },
        { id = 10, chapterId = 1, type = "quest", quest = 0 },
        { id = 11, chapterId = 1, type = "note", kind = "hearth", coords = { mapID = 1411, x = "1", y = 0 } },
    },
    questCoords = { [100] = { mapID = 1411, x = 0.1, y = 0.2 }, [101] = 5, [102] = "x", [103] = { mapID = -1, x = 0, y = 0 },
        ["104"] = { mapID = 1411, x = 0.5, y = 0.5 } },
    turnInCoords = { [100] = "bad", [101] = { mapID = 1411, x = 0.3, y = 0.4 } },
    questClasses = { [100] = "SHAMAN", [101] = { "WARRIOR" }, [102] = "not a class" },
    optionalQuests = { [100] = true, [101] = "yes" },
    questPrereqs = { [100] = 5, [101] = { 99, "x", -3, 1.5, 98 }, [102] = {} },
    objectiveCoords = { [100] = 7, [101] = { [1] = { mapID = 1411, x = 0.1, y = 0.2 }, [2] = "bad", [11] = { mapID = 1411, x = 0.1, y = 0.2 } } },
}
'''


def two(result):
    """A Lua call's first two results (lupa returns a lone result unwrapped)."""
    return result if isinstance(result, tuple) else (result, None)


def lua_state():
    lua, L4 = make()
    lua.execute("math.randomseed(4)")  # the uids ExportGuide makes stay the same from run to run
    lua.globals().L4 = L4
    lua.execute(LUA)
    return lua, L4


def addon_exports():
    """The addon's export of each real guide and of MALFORMED: [(name, string)]."""
    lua, L4 = lua_state()
    lua.execute(open(fixture("real_guides.lua"), encoding="utf-8").read())
    lua.execute('Fire("PLAYER_LOGIN"); RunTimers()')
    lua.execute('MALFORMED.id = L4.db.nextGuideId; L4.db.nextGuideId = L4.db.nextGuideId + 1; table.insert(L4.db.guides, MALFORMED)')
    exports = []
    for guide in lua.eval("L4.db.guides").values():
        text, err = two(L4.ExportGuide(L4, guide.id))
        assert text, f"the addon couldn't export {guide.name}: {err}"
        exports.append((guide.name, text))
    return exports


def addon_imports(strings):
    """What the addon's import makes of each string, as parsed JSON."""
    lua, L4 = lua_state()
    lua.execute('Fire("PLAYER_LOGIN"); RunTimers()')
    results = []
    for text in strings:
        guide_json, err = two(lua.globals().ImportJSON(text))
        assert guide_json, f"the addon couldn't import a string: {err}"
        results.append(json.loads(guide_json))
    return results


def website_reexports(strings):
    """The website's importGuide then exportGuide on each string."""
    npx = "npx.cmd" if os.name == "nt" else "npx"
    out = subprocess.run([npx, "tsx", os.path.join(HERE, "reexport.ts")], input=json.dumps(strings),
                         capture_output=True, text=True, encoding="utf-8", cwd=WEBSITE)
    if out.returncode != 0:
        sys.exit("reexport.ts failed:\n" + out.stderr)
    return json.loads(out.stdout)


def main():
    exports = addon_exports()
    strings = [text for _, text in exports]
    imported = addon_imports(strings)
    cases = [{"name": name, "export": text, "imported": guide}
             for (name, text), guide in zip(exports, imported)]
    with open(FIXTURE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(cases, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"Wrote {len(cases)} addon exports to {os.path.relpath(FIXTURE, WEBSITE)}")

    failures = 0
    for case, again in zip(cases, addon_imports(website_reexports(strings))):
        if "uid" not in case["imported"]:
            again.pop("uid", None)  # reexport.ts gives a guide that lost its uid a new one
        if again != case["imported"]:
            failures += 1
            print(f"FAIL {case['name']}: the website's export imports differently in the addon")
            for key in sorted(set(again) | set(case["imported"])):
                if again.get(key) != case["imported"].get(key):
                    print(f"  {key}:\n    addon:   {json.dumps(case['imported'].get(key))[:300]}"
                          f"\n    website: {json.dumps(again.get(key))[:300]}")
        else:
            print(f"ok   {case['name']}: addon -> website -> addon round trip")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
