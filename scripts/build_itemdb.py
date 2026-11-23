#!/usr/bin/env python3
"""Build data/items.json and data/sources.json — the indexes the app loads.

Reads api/items.json, api/item_sources.json and api/meta.json as published by
the community WoW Forever database (https://github.com/gBlaku/wow-forever-kb,
built daily from the game client's own data tables) and keeps only what the
app needs:

  items.json   — search index: id, name, quality, slot, source summary
  sources.json — planner index (equippable items only): item id, kind
                 (drop/quest/vendor/object/crafted/container), source name,
                 zone, drop chance, extra (boss/elite, faction, …)

Usage: build_itemdb.py <kb_dir> <out_dir>
  where <kb_dir> holds api/items.json, api/item_sources.json, api/meta.json
"""
import json
import os
import sys

# Items in these "slots" are not equipment and never appear in the planner.
NON_GEAR = {"", "Non-equippable", "Bag", "Shirt", "Tabard", "Ammo"}


def main(kb_dir, out_dir):
    api = os.path.join(kb_dir, "api")
    with open(os.path.join(api, "items.json"), encoding="utf-8") as f:
        items = json.load(f)
    with open(os.path.join(api, "item_sources.json"), encoding="utf-8") as f:
        sources = json.load(f)
    with open(os.path.join(api, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)

    build = meta.get("client_build", "unknown")
    stamp = {
        "build": build,
        "generated": meta.get("generated_utc", ""),
        "credit": "https://github.com/gBlaku/wow-forever-kb",
    }

    rows = []
    gear_ids = set()
    for i in items:
        if i.get("id") is None or not i.get("name"):
            continue
        slot = i.get("slot") or ""
        if slot not in NON_GEAR:
            gear_ids.add(i["id"])
        rows.append([
            i["id"],
            i["name"],
            i.get("quality"),
            slot,
            (i.get("source_summary") or "")[:160],
        ])
    rows.sort(key=lambda r: r[0])

    src_rows = []
    for s in sources:
        if s.get("item_id") not in gear_ids or not s.get("name"):
            continue
        chance = s.get("chance")
        src_rows.append([
            s["item_id"],
            s.get("kind") or "",
            s["name"][:60],
            (s.get("zone") or "")[:40],
            round(chance, 2) if isinstance(chance, (int, float)) else None,
            (s.get("extra") or "")[:40],
        ])
    src_rows.sort(key=lambda r: (r[0], r[1], -(r[4] or 0)))

    os.makedirs(out_dir, exist_ok=True)

    def dump(name, payload):
        path = os.path.join(out_dir, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        print(f"Wrote {path}: {os.path.getsize(path) / 1e6:.2f} MB")

    dump("items.json", {**stamp, "fields": ["id", "name", "quality", "slot", "source"], "items": rows})
    dump("sources.json", {**stamp, "fields": ["item", "kind", "name", "zone", "chance", "extra"], "rows": src_rows})
    print(f"{len(rows)} items ({len(gear_ids)} equippable), {len(src_rows)} sources, build {build}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
