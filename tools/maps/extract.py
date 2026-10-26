"""Extracts the world map art for every map from a local WoW Forever
install into public/maps/: one image per UiMapID (the map IDs the addon and
the quest data use), fully revealed (no fog of war), and maps.json listing
them.

    python tools/maps/extract.py [--install "C:/Program Files (x86)/World of Warcraft"]

Reads the game's files only; nothing in the install is changed. The art is
Blizzard's (see LICENSE). Needs Pillow (pip install pillow), which decodes
BLP textures.
"""
import argparse
import io
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from casc import Storage  # noqa: E402
from db2 import read_db2  # noqa: E402

WEBSITE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The map tables' file IDs and, per WoWDBDefs, their inline fields for the
# layouts this was written against. A new layout fails loudly rather than
# reading the wrong columns; add its fields from WoWDBDefs.
UI_MAP = (1957206, 0xDB51D55F, ["Name_lang", "ID", "ParentUiMapID", "Flags", "System", "Type", "BountySetID",
                                "BountyDisplayLocation", "VisibilityPlayerConditionID", "HelpTextPosition", "BkgAtlasID",
                                "AlternateUiMapGroup", "ContentTuningID", "AdventureMapTextureKitID",
                                "MapArtZoneTextPosition"])
UI_MAP_X_MAP_ART = (1957217, 0xEAE7DA2A, ["PhaseID", "UiMapArtID"])
UI_MAP_ART = (1957202, 0x3AE7D144, ["HighlightFileDataID", "HighlightAtlasID", "UiMapArtStyleID"])
UI_MAP_ART_STYLE_LAYER = (1957208, 0x3F597F5A, ["LayerIndex", "LayerWidth", "LayerHeight", "TileWidth", "TileHeight",
                                                "MinScale", "MaxScale", "AdditionalZoomSteps"])
UI_MAP_ART_TILE = (1957210, 0x2DA5B77B, ["RowIndex", "ColIndex", "LayerIndex", "FileDataID"])
# The "explored" art drawn over a zone's background, piece by piece: all of
# it is drawn, so every map is fully revealed.
WORLD_MAP_OVERLAY = (1134579, 0x9A196494, ["ID", "UiMapArtID", "TextureWidth", "TextureHeight", "OffsetX", "OffsetY",
                                           "HitRectTop", "HitRectBottom", "HitRectLeft", "HitRectRight",
                                           "PlayerConditionID", "Flags", "AreaID"])
WORLD_MAP_OVERLAY_TILE = (1957212, 0x2C843422, ["RowIndex", "ColIndex", "LayerIndex", "FileDataID"])
OVERLAY_TILE_SIZE = 256

# Map types worth an image: zones, continents, the world, and "micro" maps
# such as Darkspear Islands (UiMap.Type: 1 world, 2 continent, 3 zone, 6 micro).
TYPES = {1: "world", 2: "continent", 3: "zone", 6: "micro"}
MAX_WIDTH = 2048


def table(storage, spec, **options):
    fdid, layout, fields = spec
    data = storage.read_id(fdid)
    if data is None:
        sys.exit(f"Couldn't read table {fdid} from the install")
    return read_db2(data, fields, layout=layout, **options)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--install", default="C:/Program Files (x86)/World of Warcraft")
    parser.add_argument("--product", default="wow_classic_beta", help="WoW Forever's product in .build.info")
    parser.add_argument("--out", default=os.path.join(WEBSITE, "public", "maps"))
    args = parser.parse_args()

    storage = Storage(args.install, args.product)
    print(f"Reading {args.product} {storage.version}")
    maps = {row["ID"]: row for row in table(storage, UI_MAP, strings=["Name_lang"])}
    art_of = {}
    for row in table(storage, UI_MAP_X_MAP_ART, relation="UiMapID"):
        # Phase 0 is what everyone sees.
        if row["PhaseID"] == 0 or row["UiMapID"] not in art_of:
            art_of[row["UiMapID"]] = row["UiMapArtID"]
    arts = {row["ID"]: row for row in table(storage, UI_MAP_ART)}
    layers = {}
    for row in table(storage, UI_MAP_ART_STYLE_LAYER, relation="UiMapArtStyleID"):
        if row["LayerIndex"] == 0:
            layers[row["UiMapArtStyleID"]] = row
    tiles = {}
    for row in table(storage, UI_MAP_ART_TILE, relation="UiMapArtID"):
        if row["LayerIndex"] == 0:
            tiles.setdefault(row["UiMapArtID"], []).append(row)
    overlays = {}
    for row in table(storage, WORLD_MAP_OVERLAY):
        overlays.setdefault(row["UiMapArtID"], []).append(row)
    overlay_tiles = {}
    for row in table(storage, WORLD_MAP_OVERLAY_TILE, relation="WorldMapOverlayID"):
        if row["LayerIndex"] == 0:
            overlay_tiles.setdefault(row["WorldMapOverlayID"], []).append(row)

    os.makedirs(args.out, exist_ok=True)
    listing = []
    for map_id in sorted(maps):
        info = maps[map_id]
        kind = TYPES.get(info["Type"])
        art = arts.get(art_of.get(map_id))
        layer = art and layers.get(art["UiMapArtStyleID"])
        parts = art and tiles.get(art["ID"])
        if not kind or not layer or not parts:
            continue
        width, height = layer["LayerWidth"], layer["LayerHeight"]
        tile_w, tile_h = layer["TileWidth"], layer["TileHeight"]
        canvas = Image.new("RGB", (max(t["ColIndex"] + 1 for t in parts) * tile_w, max(t["RowIndex"] + 1 for t in parts) * tile_h))
        missing = 0
        for tile in parts:
            blp = storage.read_id(tile["FileDataID"])
            if blp is None:
                missing += 1
                continue
            image = Image.open(io.BytesIO(blp)).convert("RGB")
            canvas.paste(image, (tile["ColIndex"] * tile_w, tile["RowIndex"] * tile_h))
        if missing == len(parts):
            print(f"  {map_id} {info['Name_lang']}: no tiles readable, skipped")
            continue
        revealed = 0
        for overlay in overlays.get(art["ID"], []):
            for tile in overlay_tiles.get(overlay["ID"], []):
                blp = storage.read_id(tile["FileDataID"])
                if blp is None:
                    continue
                piece = Image.open(io.BytesIO(blp)).convert("RGBA")
                at = (overlay["OffsetX"] + tile["ColIndex"] * OVERLAY_TILE_SIZE,
                      overlay["OffsetY"] + tile["RowIndex"] * OVERLAY_TILE_SIZE)
                canvas.paste(piece, at, piece)
            revealed += 1
        image = canvas.crop((0, 0, width, height))
        if width > MAX_WIDTH:
            image = image.resize((MAX_WIDTH, round(height * MAX_WIDTH / width)), Image.LANCZOS)
        file = f"{map_id}.webp"
        image.save(os.path.join(args.out, file), "WEBP", quality=82, method=6)
        listing.append({
            "id": map_id,
            "name": info["Name_lang"],
            "type": kind,
            "parent": info["ParentUiMapID"] or None,
            "file": file,
            "width": image.width,
            "height": image.height,
        })
        note = f" ({missing} of {len(parts)} tiles unreadable)" if missing else ""
        print(f"  {map_id:>5} {info['Name_lang']:<24} {width}x{height}, {revealed} areas revealed{note}")

    with open(os.path.join(args.out, "maps.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"client": storage.version, "maps": listing}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"Wrote {len(listing)} maps to {args.out}")


if __name__ == "__main__":
    main()
