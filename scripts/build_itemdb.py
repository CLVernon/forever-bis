#!/usr/bin/env python3
"""Build data/items.json — the slim item-search index the app loads.

Reads api/items.json and api/meta.json as published by the community
WoW Forever database (https://github.com/gBlaku/wow-forever-kb, built daily
from the game client's own data tables), and keeps only what the app's
search needs: id, name, quality, slot, and the source summary.

Usage: build_itemdb.py <kb_items.json> <kb_meta.json> <out.json>
"""
import json
import sys


def main(items_path, meta_path, out_path):
    with open(items_path, encoding="utf-8") as f:
        items = json.load(f)
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)

    rows = []
    for i in items:
        if i.get("id") is None or not i.get("name"):
            continue
        rows.append([
            i["id"],
            i["name"],
            i.get("quality"),
            i.get("slot") or "",
            (i.get("source_summary") or "")[:160],
        ])
    rows.sort(key=lambda r: r[0])

    out = {
        "build": meta.get("client_build", "unknown"),
        "generated": meta.get("generated_utc", ""),
        "credit": "https://github.com/gBlaku/wow-forever-kb",
        "fields": ["id", "name", "quality", "slot", "source"],
        "items": rows,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {out_path}: {len(rows)} items, build {out['build']}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
