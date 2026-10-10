"""Derive connections and themes for every entry.

Connections written by hand in full cards (origin 'card') are kept as they are.
This script adds, each with its reason and source:
  - same owner: entries that Wikidata says are owned by the same being (P127), or
    whose context article is about the same person or god;
  - same story: entries present in the same work (P1441, P1080, P361 when it is
    a work or group, not a whole mythology), or whose context article is a story;
  - part of: P361 pointing at another entry;
  - related: P138 (named after) another entry.
Themes for stubs come from keywords in content/themes.txt.

Usage: python3 ingest/connections.py
"""
import itertools
import json
import os
import re

from common import ROOT, db, log, slugify, source

OWNER_TYPES = re.compile(r"deity|god|goddess|human|character|figure|hero|king|queen|giant|spirit|demon|wizard|saint|prophet|person", re.I)
MAX_GROUP = 25  # a "work" with more members than this is really a whole mythology


def load_themes():
    out = []
    for line in open(os.path.join(ROOT, "content", "themes.txt"), encoding="utf-8"):
        if not line.strip() or line.startswith("#"):
            continue
        tid, name, kw, about = [x.strip() for x in line.split(" | ", 3)]
        out.append((tid, name, re.compile(kw, re.I), about))
    return out


def link(con, a, b, typ, reason, src, origin):
    if a == b:
        return 0
    if con.execute("SELECT 1 FROM connections WHERE ((a=? AND b=?) OR (a=? AND b=?)) AND type=?", (a, b, b, a, typ)).fetchone():
        return 0
    con.execute("INSERT INTO connections VALUES (?,?,?,?,?,?)", (a, b, typ, reason, src, origin))
    return 1


def main():
    con = db()
    con.execute("DELETE FROM connections WHERE origin != 'card'")
    con.execute("DELETE FROM entry_themes WHERE source='keyword'")
    n = {"owner": 0, "story": 0, "part": 0, "named": 0, "context": 0}

    by_qid = {r["qid"]: r["slug"] for r in con.execute("SELECT slug, qid FROM entries WHERE qid IS NOT NULL")}
    facts = {}
    for r in con.execute("SELECT slug, prop, value, label FROM wikidata_facts"):
        facts.setdefault((r["prop"], r["value"]), {"label": r["label"], "slugs": []})["slugs"].append(r["slug"])

    for (prop, value), g in facts.items():
        slugs = sorted(set(g["slugs"]))
        src = source(con, "wd:" + value, "wikidata", f"Wikidata {value}", f"https://www.wikidata.org/wiki/{value}", "CC0") \
            if re.match(r"^Q\d+$", value) else None
        label = g["label"]
        if prop == "P127" and 1 < len(slugs) <= MAX_GROUP:
            for a, b in itertools.combinations(slugs, 2):
                n["owner"] += link(con, a, b, "same-owner", f"Both belong to {label} (Wikidata: owned by).", src, "wikidata")
        elif prop in ("P1441", "P1080", "P361") and 1 < len(slugs) <= MAX_GROUP and not re.search(r"mytholog|religion|folklore|legend$", label, re.I):
            what = {"P1441": "Both appear in", "P1080": "Both belong to the story world of", "P361": "Both are part of"}[prop]
            for a, b in itertools.combinations(slugs, 2):
                n["story"] += link(con, a, b, "same-story", f"{what} {label} (Wikidata).", src, "wikidata")
        if prop == "P361" and value in by_qid:
            for a in slugs:
                n["part"] += link(con, a, by_qid[value], "part-of", f"Wikidata: part of {label}.", src, "wikidata")
        if prop == "P138" and value in by_qid:
            for a in slugs:
                n["named"] += link(con, a, by_qid[value], "related", f"Named after {label} (Wikidata).", src, "wikidata")

    # Entries whose Wikipedia article is about their owner or story
    types = {}
    for r in con.execute("SELECT wiki_title, type_label FROM context_types"):
        types.setdefault(r["wiki_title"], []).append(r["type_label"])
    groups = {}
    for r in con.execute("SELECT slug, wiki_title FROM entries WHERE wiki_role='context' AND wiki_title IS NOT NULL"):
        groups.setdefault(r["wiki_title"], []).append(r["slug"])
    for title, slugs in groups.items():
        if not 1 < len(slugs) <= MAX_GROUP or title.startswith("List of"):
            continue
        is_owner = any(OWNER_TYPES.search(t) for t in types.get(title, []))
        typ = "same-owner" if is_owner else "same-story"
        reason = f"Both are told of in the Wikipedia article on {title}" + (", their owner." if is_owner else ".")
        src = "wp:" + title
        for a, b in itertools.combinations(sorted(slugs), 2):
            n["context"] += link(con, a, b, typ, reason, src, "wikipedia")

    # keyword themes for entries without hand-written themes
    themes = load_themes()
    for tid, name, _, about in themes:
        con.execute("INSERT OR REPLACE INTO themes (id, name, about) VALUES (?,?,?)", (tid, name, about))
    carded = {r[0] for r in con.execute("SELECT DISTINCT slug FROM entry_themes WHERE source LIKE 'card:%'")}
    nt = 0
    for r in con.execute("SELECT slug, title, overview, list_note, wiki_role FROM entries").fetchall():
        if r["slug"] in carded:
            continue
        text = " ".join(x for x in [r["title"], r["list_note"], r["overview"] if r["wiki_role"] == "own" else ""] if x)
        for tid, _, rx, _ in themes:
            if rx.search(text):
                con.execute("INSERT OR IGNORE INTO entry_themes VALUES (?,?,?)", (r["slug"], tid, "keyword"))
                nt += 1
    total = con.execute("SELECT count(*) FROM connections").fetchone()[0]
    log(con, "connections", f"added {sum(n.values())} links {n}; {total} links in all; {nt} keyword themes")
    con.commit()


if __name__ == "__main__":
    main()
