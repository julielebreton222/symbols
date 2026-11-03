"""More images, for entries that images.py left without one.

Run after images.py. For each entry without a picture it tries, in order:
  1. the other pictures in its own Wikipedia article (the first whose file name
     shares a word with the entry's name, else the first photo or painting);
  2. for entries told of in someone else's article, that article's lead image
     (labelled with the article it comes from);
  3. The Met's open-access collection (only objects marked public domain, CC0,
     whose title or tags name the entry);
  4. a Wikimedia Commons search (only files whose name contains the entry's name).
Commons files go through the same licence check as images.py. Nothing is kept
without its author, licence and source.

Not yet part of run_all.sh: written but not yet run.

Usage: python3 ingest/images_more.py
"""
import json
import os
import re
import urllib.parse

import wm
from common import CACHE, db, log, norm
from images import OK, strip_html

CACHE_FILE = os.path.join(CACHE, "images_more.json")
COMMONS_CACHE = os.path.join(CACHE, "commons.json")
MET = "https://collectionapi.metmuseum.org/public/collection/v1"
SKIP_FILE = re.compile(r"\.svg$|icon|logo|flag of|map|locator|commons-|wiki|question|edit-|ambox|padlock|disambig|portal|stub|symbol_support|crystal|nuvola|folder|audio|speaker|\.ogg$|\.webm$|\.mp3$|\.pdf$|\.tif$|signature", re.I)
STOP = {"the", "of", "and", "a", "an", "in", "on", "de", "la", "le", "symbol", "symbols", "sacred", "image", "tree", "stone"}


def words(title):
    return [w for w in re.findall(r"[a-z0-9]+", norm(title)) if len(w) > 2 and w not in STOP]


def name_match(title, text):
    ws = words(title)
    t = norm(text)
    return bool(ws) and all(w in t for w in ws[:3])


def commons_info(files, cache):
    files = [f for f in files if f not in cache]
    for batch in wm.chunks(files, 40):
        r = wm.commons(action="query", titles="|".join("File:" + f for f in batch), prop="imageinfo",
                       iiprop="url|extmetadata", iiurlwidth=640,
                       iiextmetadatafilter="LicenseShortName|LicenseUrl|Artist|Credit")
        q = r.get("query", {})
        nm = {x["to"]: x["from"] for x in q.get("normalized", [])}
        for p in q.get("pages", []):
            orig = nm.get(p["title"], p["title"])[5:]
            ii = (p.get("imageinfo") or [None])[0]
            if not ii:
                cache[orig] = None
                continue
            m = ii.get("extmetadata", {})
            cache[orig] = {
                "file": p["title"][5:], "page": ii.get("descriptionurl"), "thumb": ii.get("thumburl"),
                "license": strip_html(m.get("LicenseShortName", {}).get("value")),
                "license_url": m.get("LicenseUrl", {}).get("value"),
                "author": strip_html(m.get("Artist", {}).get("value"))[:200],
                "credit": strip_html(m.get("Credit", {}).get("value"))[:200],
            }
        for f in batch:
            cache.setdefault(f, None)
    return [cache.get(f) for f in files]


def free(info):
    return info and info.get("thumb") and OK.match(info.get("license") or "")


def article_images(title, mc):
    key = "wpimgs:" + title
    if key not in mc:
        r = wm.get("https://en.wikipedia.org/w/api.php", {"action": "query", "titles": title, "prop": "images",
                   "imlimit": 50, "redirects": 1, "format": "json", "formatversion": 2})
        p = (r.get("query", {}).get("pages") or [{}])[0]
        mc[key] = [i["title"][5:] for i in p.get("images", [])]
    return [f for f in mc[key] if not SKIP_FILE.search(f)]


def met_search(term, mc):
    key = "met:" + term
    if key not in mc:
        out = []
        try:
            r = wm.get(MET + ".1/search", {"q": term, "hasImages": "true", "isPublicDomain": "true", "limit": 6, "offset": 0}, pause=0.3, tries=3)
            for oid in (r.get("objectIDs") or [])[:6]:
                o = wm.get(f"{MET}/objects/{oid}", pause=0.3, tries=3)
                if o.get("isPublicDomain") and o.get("primaryImageSmall"):
                    out.append({"title": o.get("title") or "", "tags": " ".join(t.get("term", "") for t in (o.get("tags") or [])),
                                "thumb": o["primaryImageSmall"], "page": o.get("objectURL"),
                                "author": o.get("artistDisplayName") or ", ".join(x for x in [o.get("culture"), o.get("objectDate")] if x),
                                "credit": o.get("creditLine") or ""})
        except Exception as e:
            print("  met:", term, type(e).__name__)
            return []
        mc[key] = out
    return mc[key]


def commons_search(term, mc):
    key = "cs:" + term
    if key not in mc:
        r = wm.commons(action="query", list="search", srsearch=f'intitle:"{term}" filetype:bitmap', srnamespace=6, srlimit=8)
        mc[key] = [x["title"][5:] for x in r.get("query", {}).get("search", [])]
    return mc[key]


def main():
    con = db()
    mc = json.load(open(CACHE_FILE)) if os.path.exists(CACHE_FILE) else {}
    cc = json.load(open(COMMONS_CACHE)) if os.path.exists(COMMONS_CACHE) else {}
    pages = json.load(open(os.path.join(CACHE, "wp_pages.json")))
    lead = {v["title"]: v.get("image") for v in pages.values() if v}
    con.execute("DELETE FROM images WHERE source LIKE 'More:%'")
    have = {r[0] for r in con.execute("SELECT DISTINCT slug FROM images")}
    todo = [dict(r) for r in con.execute("SELECT slug, title, wiki_title, wiki_role FROM entries ORDER BY slug") if r["slug"] not in have]
    print(f"{len(todo)} entries without a picture")
    got = {"article": 0, "context": 0, "met": 0, "search": 0}

    def keep(slug, info, how, page=None):
        con.execute("INSERT OR REPLACE INTO images VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (slug, info["file"], page or info["page"], info["thumb"], info["license"], info.get("license_url"),
                     info.get("author") or "unknown", info.get("credit") or "", "More: " + how, 0))

    for n, e in enumerate(todo):
        slug, title, wt = e["slug"], e["title"], e["wiki_title"]
        done = False
        # 1. other pictures in its own article
        if wt and e["wiki_role"] == "own":
            files = article_images(wt, mc)
            files = sorted(files, key=lambda f: (not name_match(title, f) and not name_match(wt, f), not re.search(r"\.jpe?g$", f, re.I)))[:6]
            commons_info(files, cc)
            for f in files:
                if free(cc.get(f)):
                    keep(slug, cc[f], f"a picture in the Wikipedia article {wt}")
                    got["article"] += 1
                    done = True
                    break
        # 2. the lead picture of the article it is told of in
        if not done and wt and e["wiki_role"] == "context" and not wt.startswith("List of") and lead.get(wt):
            f = lead[wt].replace("_", " ")
            commons_info([f], cc)
            if free(cc.get(f)):
                keep(slug, cc[f], f"the lead picture of the Wikipedia article {wt}")
                got["context"] += 1
                done = True
        # 3. The Met, public domain only, and only if the object names the entry
        if not done and words(title):
            for o in met_search(title, mc):
                if name_match(title, o["title"] + " " + o["tags"]):
                    keep(slug, {"file": "met:" + o["page"].rsplit("/", 1)[-1], "page": o["page"], "thumb": o["thumb"],
                                "license": "CC0 (The Met Open Access)", "license_url": "https://www.metmuseum.org/about-the-met/policies-and-documents/open-access",
                                "author": o["author"] or "The Metropolitan Museum of Art", "credit": o["credit"]},
                         f"The Met: {o['title']}")
                    got["met"] += 1
                    done = True
                    break
        # 4. a Commons search on the name
        if not done and words(title):
            files = [f for f in commons_search(title, mc) if not SKIP_FILE.search(f) and name_match(title, f)]
            commons_info(files[:5], cc)
            for f in files[:5]:
                if free(cc.get(f)):
                    keep(slug, cc[f], "Wikimedia Commons search")
                    got["search"] += 1
                    done = True
                    break
        if n % 25 == 24:
            json.dump(mc, open(CACHE_FILE, "w"))
            json.dump(cc, open(COMMONS_CACHE, "w"))
            con.commit()
            print(f"  … {n + 1}/{len(todo)} {got}")
    json.dump(mc, open(CACHE_FILE, "w"))
    json.dump(cc, open(COMMONS_CACHE, "w"))
    left = con.execute("SELECT count(*) FROM entries e WHERE NOT EXISTS (SELECT 1 FROM images i WHERE i.slug=e.slug)").fetchone()[0]
    log(con, "images_more", f"found pictures {got}; {left} entries still without one")
    con.commit()


if __name__ == "__main__":
    main()
