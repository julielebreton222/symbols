"""Index the tales in the Fairies library where each entry appears.

Reads a local copy of the private Fairies repository (its catalog and text
bundles), finds each entry's names in every tale, and stores the tales that
mention it most, with their title, land, date, kind and a link into the Fairies
app. Because this repository is public and Ashliman's translations are not
openly licensed, NO tale text is stored for Folktexts tales: only the facts
about them. Tales from public-domain Gutenberg books get a short excerpt.

Usage: python3 ingest/tales.py [path to the fairies repository]   (default ../fairies)
"""
import glob
import html
import json
import os
import re
import sys

from common import ROOT, TALE_NOISE, db, entry_terms, log

MAX_TALES = 60


def text_of(h):
    h = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", h, flags=re.S)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h))).strip()


def main():
    fairies = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(ROOT), "fairies")
    cat = json.load(open(os.path.join(fairies, "data", "catalog.json")))
    bundles = {}
    for f in glob.glob(os.path.join(fairies, "data", "bundles", "b*.json")):
        bundles[int(os.path.basename(f)[1:-5])] = json.load(open(f))
    tales = []
    for p in cat["pages"]:
        b = bundles.get(p.get("b"), {}).get(p["slug"])
        if not b:
            continue
        texts = {s["id"]: s.get("html", "") for s in b.get("stories", [])}
        for s in p["stories"]:
            t = text_of(texts.get(s["id"], ""))
            if not t:
                continue
            tales.append({"page": p["slug"], "story": s["id"], "title": s["title"], "origin": s.get("origin") or s.get("region") or "",
                          "year": s.get("earliest") or s.get("sourceYear"), "kind": ", ".join(s.get("kinds", [])),
                          "pd": p.get("kind") == "book", "text": t, "low": t.lower(), "title_low": s["title"].lower()})
    con = db()
    con.execute("DELETE FROM tale_mentions")
    n_entries = n_rows = 0
    for r in con.execute("SELECT slug, title, aliases, categories, terms FROM entries").fetchall():
        names = json.loads(r["aliases"]) + json.loads(r["terms"] or "[]")
        pairs = entry_terms(r["title"], names, json.loads(r["categories"]), noise=TALE_NOISE)
        if not pairs:
            continue
        needles = [x for _, n in pairs for x in n.split("|")]
        found = []
        for t in tales:
            if not any(n in t["low"] for n in needles):
                continue
            ms = [m for rx, _ in pairs for m in rx.finditer(t["text"])]
            in_title = any(rx.search(t["title"]) for rx, _ in pairs)
            if not ms and not in_title:
                continue
            found.append((len(ms) + (10 if in_title else 0), t, ms[0] if ms else None))
        if not found:
            continue
        found.sort(key=lambda x: (-x[0], x[1]["title"]))
        n_entries += 1
        for score, t, m in found[:MAX_TALES]:
            snippet = None
            if t["pd"] and m:
                a = max(0, t["text"].rfind(" ", 0, max(0, m.start() - 140)) + 1)
                z = t["text"].find(" ", min(len(t["text"]), m.end() + 160))
                z = len(t["text"]) if z < 0 else z
                snippet = ("… " if a else "") + t["text"][a:z] + (" …" if z < len(t["text"]) else "")
            hits = len([1 for rx, _ in pairs for _ in rx.finditer(t["text"])])
            con.execute("INSERT OR REPLACE INTO tale_mentions VALUES (?,?,?,?,?,?,?,?,?)",
                        (r["slug"], t["page"], t["story"], t["title"], t["origin"], t["year"], t["kind"], hits, snippet))
            n_rows += 1
        if len(found) > MAX_TALES:
            con.execute("INSERT OR REPLACE INTO tale_mentions VALUES (?,?,?,?,?,?,?,?,?)",
                        (r["slug"], "", "", "", "", None, "", len(found), None))  # total count marker
    log(con, "tales", f"{len(tales)} tales read; {n_rows} tale links for {n_entries} entries")
    con.commit()


if __name__ == "__main__":
    main()
