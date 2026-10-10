"""Resolve each entry's Wikipedia article and pull its summary.

For every entry: follow redirects, record the revision id and the Wikidata item,
and (for entries whose article is about them) keep the first sentences of the
article's lead as the stub overview, credited to that revision (CC BY-SA).
Entries with no article named yet try their own name; a hit counts only if it
is not a disambiguation page.

Results are cached in .cache/wp_pages.json; delete it to refresh.

Usage: python3 ingest/wiki_resolve.py
"""
import json
import os
import re

import wm
from common import CACHE, db, log, norm, wiki_source

CACHE_FILE = os.path.join(CACHE, "wp_pages.json")
NOT_A_SYMBOL = re.compile(r"\bis (?:a|an|the) [^.]{0,60}\b(?:album|single|song|film|band|video game|television series|novel|EP)\b", re.I)


def fetch_pages(titles, cache):
    todo = [t for t in titles if t not in cache]
    for batch in wm.chunks(todo, 20):
        r = wm.wp(action="query", titles="|".join(batch), redirects=1,
                  prop="extracts|pageprops|revisions|coordinates|pageimages",
                  exintro=1, explaintext=1, exlimit=20, rvprop="ids", ppprop="wikibase_item|disambiguation",
                  piprop="name", colimit=20)
        q = r.get("query", {})
        alias = {}
        for k in ("normalized", "redirects"):
            for x in q.get(k, []):
                alias[x["from"]] = x["to"]
        pages = {p["title"]: p for p in q.get("pages", [])}
        for t in batch:
            final = t
            for _ in range(3):
                final = alias.get(final, final)
            p = pages.get(final)
            if not p or p.get("missing") or p.get("invalid"):
                cache[t] = None
                continue
            cache[t] = {
                "title": p["title"],
                "redirected": final != t,
                "revid": (p.get("revisions") or [{}])[0].get("revid"),
                "qid": p.get("pageprops", {}).get("wikibase_item"),
                "disambig": "disambiguation" in p.get("pageprops", {}),
                "extract": p.get("extract", ""),
                "coords": (p.get("coordinates") or [{}])[0],
                "image": p.get("pageimage"),
            }
        json.dump(cache, open(CACHE_FILE, "w"))
        print(f"  … {len(cache)} pages cached")


def lead(extract, max_chars=700):
    text = re.sub(r"\s+", " ", extract or "").strip()
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    i = max(cut.rfind(". "), cut.rfind(".) "))
    return cut[:i + 1] if i > 200 else cut.rsplit(" ", 1)[0] + "…"


def main():
    con = db()
    cache = json.load(open(CACHE_FILE)) if os.path.exists(CACHE_FILE) else {}
    rows = con.execute("SELECT slug, title, wiki_title, wiki_role FROM entries").fetchall()
    titles = {r["wiki_title"] for r in rows if r["wiki_title"]}
    titles |= {r["title"] for r in rows if not r["wiki_title"]}
    fetch_pages(sorted(titles), cache)

    own = ctx = found = missing = 0
    for r in rows:
        guess = not r["wiki_title"]
        t = r["wiki_title"] or r["title"]
        p = cache.get(t)
        if not p or p["disambig"]:
            if not guess:
                missing += 1
                log(con, "wiki_resolve", f"no article for {r['slug']}: “{t}”")
                con.execute("UPDATE entries SET wiki_title=NULL WHERE slug=?", (r["slug"],))
            continue
        role = r["wiki_role"] or "own"
        if guess and NOT_A_SYMBOL.search((p.get("extract") or "")[:300]):
            continue  # a guess by name that found an album, song, film...
        if guess:
            found += 1
            role = "own"
        src = wiki_source(con, p["title"], p["revid"])
        con.execute("UPDATE entries SET wiki_title=?, wiki_role=?, wiki_revid=? WHERE slug=?",
                    (p["title"], role, p["revid"], r["slug"]))
        if role == "own":
            own += 1
            con.execute("UPDATE entries SET qid=COALESCE(qid, ?), overview=?, overview_src=? WHERE slug=?",
                        (p["qid"], lead(p["extract"]), src, r["slug"]))
            c = p.get("coords") or {}
            if c.get("lat") is not None:
                con.execute("UPDATE entries SET lat=?, lon=?, geo_src=? WHERE slug=? AND lat IS NULL",
                            (c["lat"], c["lon"], src, r["slug"]))
        else:
            ctx += 1
    log(con, "wiki_resolve", f"{own} entries with their own article, {ctx} with a context article, "
                             f"{found} found by name, {missing} named articles missing")
    con.commit()


if __name__ == "__main__":
    main()
