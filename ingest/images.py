"""Images from Wikimedia Commons, with the licence checked for every file.

Candidates: each entry's Wikidata image (P18) and, for entries whose article is
about them, the article's lead image. Only public domain, CC0, CC BY, CC BY-SA, GFDL and
open-government / no-known-restrictions files are kept; the author, licence and credit are stored and shown.
Images of modern copyrighted characters, film stills or brand artwork never
pass this check, because such files are not freely licensed on Commons.

Usage: python3 ingest/images.py
"""
import json
import os
import re
import urllib.parse

import wm
from common import CACHE, db, log

CACHE_FILE = os.path.join(CACHE, "commons.json")
OK = re.compile(r"^(public domain|pd\b|pd-|cc0|no restrictions|copyrighted free use|gfdl|godl|cc[- ]by(?:[- ]sa)?(?:[- ][\d.]+)?(?:[- ]\w+)?$)", re.I)


def strip_html(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()


def main():
    con = db()
    cache = json.load(open(CACHE_FILE)) if os.path.exists(CACHE_FILE) else {}
    pages = json.load(open(os.path.join(CACHE, "wp_pages.json")))
    wanted = {}  # slug -> [(file, source)]
    for r in con.execute("SELECT slug, value FROM wikidata_facts WHERE prop='P18'"):
        f = urllib.parse.unquote(r["value"].rsplit("/", 1)[1]).replace("_", " ")
        wanted.setdefault(r["slug"], []).append((f, "Wikidata P18"))
    for r in con.execute("SELECT slug, wiki_title FROM entries WHERE wiki_role='own' AND wiki_title IS NOT NULL"):
        p = pages.get(r["wiki_title"]) or next((v for v in pages.values() if v and v["title"] == r["wiki_title"]), None)
        if p and p.get("image"):
            f = p["image"].replace("_", " ")
            if f not in [x[0] for x in wanted.get(r["slug"], [])]:
                wanted.setdefault(r["slug"], []).append((f, "Wikipedia lead image"))
    files = sorted({f for v in wanted.values() for f, _ in v} - set(cache))
    for batch in wm.chunks(files, 40):
        r = wm.commons(action="query", titles="|".join("File:" + f for f in batch), prop="imageinfo",
                       iiprop="url|extmetadata", iiurlwidth=640,
                       iiextmetadatafilter="LicenseShortName|LicenseUrl|Artist|Credit|UsageTerms|Copyrighted")
        q = r.get("query", {})
        norm = {x["to"]: x["from"] for x in q.get("normalized", [])}
        for p in q.get("pages", []):
            name = p["title"][5:]
            orig = norm.get(p["title"], p["title"])[5:]
            ii = (p.get("imageinfo") or [None])[0]
            if not ii:
                cache[orig] = None
                continue
            m = ii.get("extmetadata", {})
            cache[orig] = {
                "file": name, "page": ii.get("descriptionurl"), "thumb": ii.get("thumburl"),
                "license": strip_html(m.get("LicenseShortName", {}).get("value")),
                "license_url": m.get("LicenseUrl", {}).get("value"),
                "author": strip_html(m.get("Artist", {}).get("value"))[:200],
                "credit": strip_html(m.get("Credit", {}).get("value"))[:200],
            }
        for f in batch:
            cache.setdefault(f, None)
        json.dump(cache, open(CACHE_FILE, "w"))
        print(f"  … {len(cache)} files checked")

    con.execute("DELETE FROM images WHERE source LIKE 'Wiki%'")
    kept = refused = 0
    for slug, items in wanted.items():
        for i, (f, how) in enumerate(items):
            info = cache.get(f)
            if not info or not info["thumb"]:
                continue
            if not OK.match(info["license"] or ""):
                refused += 1
                log(con, "images", f"skipped {f} for {slug}: licence “{info['license']}” is not free enough")
                continue
            con.execute("INSERT OR REPLACE INTO images VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (slug, info["file"], info["page"], info["thumb"], info["license"], info["license_url"],
                         info["author"] or "unknown", info["credit"], how, i))
            kept += 1
    log(con, "images", f"{kept} images kept, {refused} refused for their licence")
    con.commit()


if __name__ == "__main__":
    main()
