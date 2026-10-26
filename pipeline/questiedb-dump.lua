-- SPDX-License-Identifier: GPL-3.0-only
-- Dumps QuestieDB's Forever data, with every correction applied, as JSON.
--
-- Runs with Lua 5.1 from the root of a QuestieDB checkout that has generated
-- QuestieDB_Forever.toc (see build-data.ts). It loads the database through
-- QuestieDB's own client emulator and public read API, so what comes out is
-- what Questie sees in game.
--
--   lua questiedb-dump.lua <Alliance|Horde> <out.json>
--
-- Dynamic corrections depend on the player's faction, so the data is dumped
-- once per faction.
--
-- Output: { meta = {...}, Quest = { [id] = { fieldName = value } }, Npc, Object, Item, zones = {...} }
-- Fields that read back as 0 / nil are left out. Map-shaped fields keyed by
-- zone ({ [areaId] = points }) become lists of { areaId, points } pairs, so
-- every table in the output is either a list or has string keys.

local faction, outPath = arg[1], arg[2]
assert(faction == "Alliance" or faction == "Horde", "usage: questiedb-dump.lua <Alliance|Horde> <out.json>")
assert(outPath, "usage: questiedb-dump.lua <Alliance|Horde> <out.json>")

local config = dofile("src/config.lua")
local emulator = dofile("emulator/metadata.lua")
local client = dofile("emulator/client.lua")

local flavor = config.flavorByName.Forever
local tocPath = config.tocPath(flavor)
local map = emulator.parse(tocPath)
client.reset()
client.install({ expansion = flavor.expansion, faction = faction })
emulator.install(config.addonName, map)
local LibQuestieDB = emulator.loadAddon(tocPath, config.addonName)
assert(LibQuestieDB.readMode == "baked", "expected baked mode, got " .. tostring(LibQuestieDB.readMode))

---------------------------------------------------------------------------
-- JSON
---------------------------------------------------------------------------

local function IsList(t)
    local n = 0
    for k in pairs(t) do
        if type(k) ~= "number" or k < 1 or k ~= math.floor(k) then
            return false
        end
        n = math.max(n, k)
    end
    return true, n
end

local ESCAPES = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }

local function Encode(value, out)
    local kind = type(value)
    if value == nil then
        out[#out + 1] = "null"
    elseif kind == "number" then
        if value ~= value or value == math.huge or value == -math.huge then
            error("can't encode " .. tostring(value))
        end
        if value == math.floor(value) and math.abs(value) < 2 ^ 53 then
            out[#out + 1] = ("%.0f"):format(value)
        else
            out[#out + 1] = ("%.17g"):format(value)
        end
    elseif kind == "string" then
        out[#out + 1] = '"' .. value:gsub('[%c"\\]', function(c)
            return ESCAPES[c] or ("\\u%04x"):format(c:byte())
        end) .. '"'
    elseif kind == "boolean" then
        out[#out + 1] = tostring(value)
    elseif kind == "table" then
        local list, n = IsList(value)
        if list then
            -- Holes (positional nils, e.g. startedBy = { nil, nil, { 16305 } }) become null.
            out[#out + 1] = "["
            for i = 1, n do
                if i > 1 then out[#out + 1] = "," end
                Encode(value[i], out)
            end
            out[#out + 1] = "]"
        else
            local keys = {}
            for k in pairs(value) do
                assert(type(k) == "string", "mixed table keys")
                keys[#keys + 1] = k
            end
            table.sort(keys)
            out[#out + 1] = "{"
            for i, k in ipairs(keys) do
                if i > 1 then out[#out + 1] = "," end
                Encode(k, out)
                out[#out + 1] = ":"
                Encode(value[k], out)
            end
            out[#out + 1] = "}"
        end
    else
        error("can't encode a " .. kind)
    end
end

---------------------------------------------------------------------------
-- Entities
---------------------------------------------------------------------------

-- { [areaId] = value } -> { { areaId, value }, ... } in areaId order.
local function Pairs(byZone)
    if type(byZone) ~= "table" then
        return byZone
    end
    local zones = {}
    for zone in pairs(byZone) do
        zones[#zones + 1] = zone
    end
    table.sort(zones)
    local list = {}
    for _, zone in ipairs(zones) do
        list[#list + 1] = { zone, byZone[zone] }
    end
    return list
end

-- Per entity type, how a field's value is reshaped before encoding.
local RESHAPE = {
    Npc = { spawns = Pairs, waypoints = Pairs },
    Object = { spawns = Pairs, waypoints = Pairs },
    Quest = {
        -- { text, { [areaId] = points } }
        triggerEnd = function(v)
            return v and { v[1], Pairs(v[2]) }
        end,
        -- { { spawns by areaId, icon, text, objectiveIndex, refs }, ... }
        extraObjectives = function(v)
            if not v then return nil end
            for _, extra in ipairs(v) do
                extra[1] = Pairs(extra[1])
            end
            return v
        end,
    },
}

local function DumpType(typeName)
    local entity = LibQuestieDB[typeName]
    local meta = LibQuestieDB.Meta[typeName]
    local reshape = RESHAPE[typeName] or {}
    local rows = {}
    for _, id in ipairs(entity.GetAllIds()) do
        local row = {}
        for index = 1, meta.fieldCount do
            local name = meta.names[index]
            local value = entity.Get(id, index)
            if reshape[name] then
                value = reshape[name](value)
            end
            if value ~= nil and value ~= 0 and not (type(value) == "table" and next(value) == nil) then
                row[name] = value
            end
        end
        rows[tostring(id)] = row
    end
    return rows
end

local Support = LibQuestieDB.Support
local ZoneDB = Support.Get("ZoneDB")

-- Zone lookups the website needs to turn AreaIDs into the UiMapIDs the addon uses.
local function LoadZoneString(value)
    if type(value) == "string" then
        return assert(loadstring(value))()
    end
    return value
end

local function StringKeys(t)
    local out = {}
    for k, v in pairs(t or {}) do
        out[tostring(k)] = v
    end
    return out
end

local result = {
    meta = {
        faction = faction,
        flavor = flavor.name,
        contractVersion = config.contractVersion,
    },
    Quest = DumpType("Quest"),
    Npc = DumpType("Npc"),
    Object = DumpType("Object"),
    Item = DumpType("Item"),
    zones = {
        areaIdToUiMapId = StringKeys(LoadZoneString(ZoneDB.private.areaIdToUiMapId)),
        subZoneToParentZone = StringKeys(LoadZoneString(ZoneDB.private.subZoneToParentZone)),
        zoneIDs = ZoneDB.zoneIDs,
    },
    enums = {
        raceMaskById = StringKeys(LibQuestieDB.Enum.raceMaskById),
        factionRaceMasks = LibQuestieDB.Enum.factionRaceMasks,
        classKeys = LibQuestieDB.Enum.classKeys,
    },
    -- Quests whose objectives of one type come first in game: { [type] = { questID, ... } }
    objectiveFirst = {},
}
for kind, quests in pairs(LibQuestieDB.ObjectiveFirst) do
    local ids = {}
    for questID in pairs(quests) do
        ids[#ids + 1] = questID
    end
    table.sort(ids)
    result.objectiveFirst[kind] = ids
end

local out = {}
Encode(result, out)
local file = assert(io.open(outPath, "wb"))
file:write(table.concat(out))
file:close()
print(("Dumped %s data to %s"):format(faction, outPath))
