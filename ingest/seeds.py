"""Load content/seeds.txt into the database.

Every seed becomes an entry (a stub until a full card is written). Seeds with the
same name, or that point to the same Wikipedia article of their own, are merged.

Usage: python3 ingest/seeds.py
"""
import json
import os
import re

from common import ROOT, add_to_list, db, log, slugify

LINE = re.compile(r"^(?P<name>.+?)(?:\s+(?P<arrow>=>|~>)\s+(?P<wiki>.+?))?(?P<plus>(?:\s+\+\w+)*)(?:\s+@\s+(?P<trad>.+))?$")


def parse(path):
    cat = group = None
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^\[(\w+)\s*\|\s*(.+)\]$", line)
        if m:
            cat, group = m.group(1), m.group(2)
            continue
        m = LINE.match(line)
        yield {
            "name": m["name"].strip(),
            "wiki": (m["wiki"] or m["name"]).strip(),
            "role": "context" if m["arrow"] == "~>" else "own",
            "cats": [cat] + [p.strip()[1:] for p in (m["plus"] or "").split() if p.strip()],
            "group": group,
            "trad": m["trad"].strip() if m["trad"] else None,
        }


def main():
    con = db()
    n_new = 0
    by_wiki = {r["wiki_title"]: r["slug"] for r in con.execute("SELECT slug, wiki_title FROM entries WHERE wiki_role='own'")}
    for s in parse(os.path.join(ROOT, "content", "seeds.txt")):
        slug = slugify(s["name"])
        exists = con.execute("SELECT slug FROM entries WHERE slug=?", (slug,)).fetchone()
        if not exists and s["role"] == "own" and s["wiki"] in by_wiki:
            # A second name for an entry we already have (e.g. Arrow of Brahma = Brahmastra).
            slug = by_wiki[s["wiki"]]
            add_to_list(con, slug, "aliases", [s["name"]])
            exists = True
        if not exists:
            con.execute("INSERT INTO entries (slug, title, wiki_title, wiki_role, origin) VALUES (?,?,?,?,?)",
                        (slug, s["name"], s["wiki"], s["role"], "seed"))
            n_new += 1
            if s["role"] == "own":
                by_wiki[s["wiki"]] = slug
        add_to_list(con, slug, "categories", s["cats"])
        add_to_list(con, slug, "groups", [s["group"]])
        if s["trad"]:
            add_to_list(con, slug, "traditions", [s["trad"]])
    total = con.execute("SELECT count(*) FROM entries").fetchone()[0]
    log(con, "seeds", f"{n_new} new entries from seeds.txt ({total} in total)")
    con.commit()


if __name__ == "__main__":
    main()
