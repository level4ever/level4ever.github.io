# Level4ever website

A guide builder for the [Level4ever](../Level4ever) addon on WoW Forever: pick quests, see the route,
and export a string the addon imports.

- **The guide builder** (`src/app/`): a React app. Guides are saved in the browser (IndexedDB),
  and imported or exported as addon strings.
- **Guide logic** (`src/lib/`): the addon's export format, ported from its `Guides.lua`
  (`guideString.ts`, `lua.ts`); editing a guide the way the addon's editor does (`editor.ts`);
  reading a guide in order for warnings and the quests available at a point (`analysis.ts`);
  adding a quest with its settings filled in from the data (`addQuest.ts`).
- **Quest data** (`pipeline/`): quests, NPCs, objects and items for each faction, with map
  coordinates, built from [QuestieDB](https://github.com/Questie/QuestieDB) (the database Questie
  uses).

## Commands

```sh
npm install
npm run data        # builds public/data/ from QuestieDB (needs git and network; ~30s); the site needs it
npm run dev         # the site at http://localhost:5173
npm test            # unit and UI tests (no addon checkout or network needed)
npm run typecheck
npm run build       # the site in dist/, quest data included
python tools/addon-crosscheck.py   # checks guide strings against the addon's own Lua
python tools/maps/extract.py       # re-extracts public/maps/ from your WoW Forever install (see "Maps")
```

## The guide builder

- **Undo:** every change to a guide, and to who it's for, can be undone and redone (buttons, Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y;
  in a text box those keys undo its typing). A run of typing in one field is one step. Deleting a
  guide shows an Undo notice instead of asking first. Edits are saved after a short pause, and at
  once when the page is hidden or closed.
- **Library:** the guides in this browser. New guide asks for a name, faction, and optionally
  races, class and professions (the profile). Import takes an addon string as a new guide; it
  never overwrites one.
- **Chapters** (left): click to show one; drop a step on one to move it there.
- **Steps** (middle): the chapter's steps in guide order. P/O/T tick pick up, objectives and turn
  in. Drag to reorder. Batches (steps done together: every pick-up, then every objective, then
  every turn-in) are outlined and labelled. A step's ⛓ button works like the addon's Batch button:
  click it, then click the steps to batch with it, and Done or Esc to finish. Each joins the batch
  on the side it came from (just before it from above, just after it from below), so neighbours
  keep their order. (The addon's own button always moves it after, swapping a step from above.) On a batched step, the same button takes it out. Click a step and new steps go after it (the
  "new steps go here" line); double-click to open it.
- **Add quests** (right): what's in the quest log at that point (to do or turn in), and what can
  be picked up there. That's the faction's quests that fit the profile, with prerequisites done,
  around the chapter's level (not red: 5 or more levels above it), lowest level first. The zone filter goes by where a quest is picked
  up (the map its giver stands on), so subzone and class quests count as the zone they're in.
  A guide with no steps yet opens with the filter on its race's starting zone (Durotar for
  Orc/Troll, Mulgore for Tauren, and so on). Some quests are never suggested (`HIDDEN_QUESTS` in
  `src/lib/questData.ts`: the Collector's Edition "Welcome!" and Winter Veil's "Winter's
  Presents"), though search still finds them. Searching covers every quest. Adding a quest fills in
  where it's picked up (the giver's spawn nearest to where the guide is), its class for class
  quests, and its prerequisites. The addon needs every prerequisite done, so a QuestieDB "one of
  these" list is only used when exactly one of them is in the guide.
- **Map** (always shown beside the steps; above the side panel on narrower screens): the chapter's
  route over the zone's fully revealed art. A pulsing ring marks where new steps go, so the route
  grows as quests are added. Hovering a quest in the side panel shows where it's picked up, or, for
  one in the log, where it's done and turned in. Pins are numbered by step: pick up, objectives,
  turn in and notes. A solid pin is a place the guide sets; a dashed one is worked out from the
  quest data (the nearest quest ender, or the nearest place an objective is done). Selecting a step
  moves the map to its zone and shows where its objectives are done. "Set on the map" places the
  step's pick-up, objective, turn-in or note location with a click; objective locations go into
  the guide's `objectiveCoords`, which the addon's arrow uses.
- **Selected step:** everything the addon supports for a step and its quest: ticks, ongoing,
  objectives, class, batch, optional, prerequisites, pick-up and turn-in coordinates, and note
  kinds (loot item and count, target NPC, and so on).
- **Warnings** come from reading the guide in order as a character of the profile would.
  - Errors: a step that can't work, e.g. a turn-in whose pick-up comes later.
  - Warnings: probably wrong, e.g. a quest above the chapter's level, or for another race.
  - Info: worth knowing, e.g. a quest still in the log at the end of the guide.

  A turn-in with no pick-up anywhere in the guide counts as carried over from an earlier guide, not
  as an error. The real guides in the addon's test fixtures have no errors or warnings.

The profile (races, class, professions) is website-only; the export string carries only the
faction, as the addon works the rest out from the character playing.

## Maps

`public/maps/` holds the world map art, fully revealed (each zone's "explored" overlays from
`WorldMapOverlay`/`WorldMapOverlayTile` are drawn over its background): one WebP per UiMapID (the map IDs the addon and the quest
data use), and `maps.json` listing them with the client build they came from. It's committed,
because CI has no game client to extract from.

`tools/maps/extract.py` reads the art from a local WoW Forever install. It only reads; nothing in
the install is changed. It needs Python and Pillow (`pip install pillow`), which decodes Blizzard's
BLP textures. Re-run it after a patch that changes the maps, and commit the result.

- `tools/maps/casc.py` reads files from Blizzard's CASC storage by file ID: `.build.info`, the
  local indexes, BLTE (plain and zlib), encoding, and root.
- `tools/maps/db2.py` reads the map tables (WDC3 to WDC5 DB2 files): `UiMap`, `UiMapXMapArt`,
  `UiMapArt`, `UiMapArtStyleLayer` and `UiMapArtTile`.
- Their file IDs and column layouts are pinned in `extract.py`, from
  [WoWDBDefs](https://github.com/wowdev/WoWDBDefs). If a patch changes a table's layout, the script
  stops with the new layout hash rather than reading the wrong columns. Add that layout's fields
  from WoWDBDefs to fix it.

The art is Blizzard's: the site credits it, and `LICENSE` lists it as not covered by the site's
own terms. Wowhead's maps aren't used: their terms forbid scripted downloading and showing their
content on other sites without permission.

## Deploying

`.github/workflows/site.yml` tests, rebuilds the quest data, builds the site and, on `main`,
publishes it to GitHub Pages. It runs on every push and weekly, so QuestieDB's corrections reach
the site without anyone doing anything. In the repository's Settings > Pages, set Source to
"GitHub Actions" once.

## Guide strings

An export string is `L4G1:` followed by base64 of the addon's own serialization of the guide
(see `src/lib/lua.ts`). Two details matter for the addon to accept a string:

- Maps keyed by quest ID (`questCoords`, `questPrereqs`, ...) must have **number** keys in Lua.
  `toLua` turns integer-looking object keys into numbers, so a `Record<number, ...>` works.
- String lengths count **bytes** (UTF-8), not JS characters.

The importer cleans a guide the way the addon does (drops values of the wrong shape, moves items
with no chapter into the first chapter, tidies batches). One deliberate difference: names and note
text are cut at 60/255 bytes without splitting a character, where the addon may cut mid-character.

`tools/addon-crosscheck.py` runs the addon's real Lua through its test harness
(`../Level4ever/tests/harness.py`, which needs `pip install lupa`). It exports the guides in the
addon's `real_guides.lua` fixture, plus a guide full of malformed values, and imports each string
again. That writes `tests/fixtures/addon-guides.json`, which the unit tests check `importGuide`
against. The script then puts the website's own exports through the addon's import and checks
each comes out identical. Run it whenever the format changes on either side, and commit the
refreshed fixture.

## Quest data

`npm run data`:

1. Clones or updates QuestieDB in `.cache/QuestieDB`. Use `--questiedb <path>` to use a checkout
   you already have.
2. Runs QuestieDB's own generator for Forever with the Lua 5.1 it ships (Windows and Linux x64;
   elsewhere set `LUA`). This applies QuestieDB's corrections. The raw data files alone are far
   behind; for example, Forever's new quests mostly exist only as corrections.
3. Loads the result through QuestieDB's client emulator and public API (`pipeline/questiedb-dump.lua`),
   once per faction, since some corrections depend on faction.
4. Writes `public/data/horde.json` and `alliance.json` (shape: `src/data/types.ts`) plus
   `manifest.json` with the QuestieDB commit used.

Each faction file holds the quests that faction can get, plus only the NPCs, objects and items they
involve (about 3 MB, 0.75 MB gzipped). Coordinates are 0–100 per UiMapID, the map IDs the addon
uses. The addon stores 0–1, so divide by 100 when writing a guide. Spawns in dungeons have no map
and are listed under `instances` instead. A quest's `objectives` are in the order the game
numbers them, which is Questie's order including its per-quest exceptions. So objective `n` in a
guide's `objectives`/`objectiveCoords` is `objectives[n - 1]`.

The quest-giver positions recorded in the real guides agree with this data: 401 of 436 are
within 1.5% of the map. Most of the rest are quests started by an item, where the guide records
where the item was picked up.

`public/data/` is not committed. CI (`.github/workflows/data.yml`) rebuilds it on every push and
weekly, so new QuestieDB corrections flow in automatically.

## License and credits

The website is proprietary: all rights reserved (see `LICENSE`). The exceptions are the parts
built on QuestieDB, which stay under the GNU General Public License v3
(`LICENSES/GPL-3.0.txt`) as QuestieDB requires:

- `pipeline/`: the data pipeline
- `src/data/`: the data format and masks, which the pipeline uses
- `public/data/`: the generated quest data

Files under the GPL say so on an `SPDX-License-Identifier` line. Keep the split clean:

- The site's own code (`src/lib/`, `src/app/`) may import `src/data/`, which you own and also use
  under the proprietary terms. It must never import `pipeline/`.
- `pipeline/` and `src/data/` must never import the site's own code.
- The site loads the generated data at runtime as data, which keeps it a separate work.

The quest data comes from [QuestieDB](https://github.com/Questie/QuestieDB), by the
[Questie](https://github.com/Questie/Questie) team and contributors. The Questie team allows
reuse under the GPLv3 terms (see their
[license](https://github.com/Questie/QuestieDB/blob/master/LICENSE.md)). Every generated data file
carries a credit that says the data was modified, when, and the QuestieDB commit it came from
(`source.credit` in each faction file, `credit` in `manifest.json`). The site must show that
credit wherever the data appears. The GPL also requires anyone who gets the data to be able to
get its source: QuestieDB at that commit (linked in the credit) plus `pipeline/`. A public
repository covers that; with a private one, publish `pipeline/` somewhere public instead.
The Questie name and logo are not covered by that permission and aren't used here.
