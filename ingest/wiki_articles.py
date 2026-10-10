"""Fuller overviews from Wikipedia: the shape of each article, section by section.

For entries with their own article, keep each section's opening (history,
religious and mystical use, symbolism, fiction, other uses...), trimmed, so the
card shows what the thing is and how it has been used, while pointing to the
full article. For entries told of inside another article (an owner's or a
story's), keep the paragraphs of that article that name the entry.

All text is Wikipedia's (CC BY-SA 4.0), credited with the article and revision.
Articles are cached in .cache/articles/.

Usage: python3 ingest/wiki_articles.py [--fetch-only]
"""
import json
import os
import re
import sys

import wm
from common import CACHE, db, log, norm, wiki_source

DIR = os.path.join(CACHE, "articles")
SKIP = re.compile(r"^(see also|references|notes|footnotes|citations|sources|bibliography|further reading|external links|"
                  r"gallery|explanatory notes|works cited|literature|notes and references|references and notes|"
                  r"primary sources|secondary sources|bibliography and further reading|general and cited references)$", re.I)
PER_SECTION = 900      # characters kept from each section
MAX_SECTIONS = 14
CONTEXT_PARAS = 4


def path_for(title):
    return os.path.join(DIR, re.sub(r"[^\w\-]+", "_", title)[:150] + ".json")


def fetch(title):
    p = path_for(title)
    if os.path.exists(p):
        return json.load(open(p))
    r = wm.wp(action="query", titles=title, prop="extracts|revisions", explaintext=1, exsectionformat="wiki",
              rvprop="ids", redirects=1)
    pages = r.get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing"):
        data = None
    else:
        pg = pages[0]
        data = {"title": pg["title"], "revid": (pg.get("revisions") or [{}])[0].get("revid"), "text": pg.get("extract", "")}
    os.makedirs(DIR, exist_ok=True)
    json.dump(data, open(p, "w"))
    return data


def sections(text):
    """[(level, heading, body)] from an extract with == headings ==."""
    out, head, level, buf = [], None, 1, []
    for line in text.split("\n"):
        m = re.match(r"^(=+)\s*(.*?)\s*=+\s*$", line)
        if m:
            out.append((level, head, "\n".join(buf).strip()))
            head, level, buf = m.group(2), len(m.group(1)), []
        else:
            buf.append(line)
    out.append((level, head, "\n".join(buf).strip()))
    return [s for s in out if s[2] or s[1]]


def trim(body, n=PER_SECTION):
    paras = [p.strip() for p in body.split("\n") if p.strip()]
    out = ""
    for p in paras:
        if len(out) + len(p) > n and out:
            break
        out += ("\n\n" if out else "") + p
    if len(out) > n * 1.4:
        cut = out[:n]
        i = cut.rfind(". ")
        out = cut[:i + 1] if i > n * 0.5 else cut.rsplit(" ", 1)[0] + "…"
    return out


def main():
    con = db()
    con.execute("""CREATE TABLE IF NOT EXISTS wiki_sections (slug TEXT, ord INTEGER, level INTEGER, heading TEXT,
                   text TEXT, src TEXT, mode TEXT, PRIMARY KEY (slug, ord))""")
    rows = con.execute("SELECT slug, title, aliases, wiki_title, wiki_role FROM entries WHERE wiki_title IS NOT NULL").fetchall()
    titles = sorted({r["wiki_title"] for r in rows})
    for i, t in enumerate(titles):
        fetch(t)
        if i % 50 == 0:
            print(f"  … {i}/{len(titles)} articles", flush=True)
    if "--fetch-only" in sys.argv:
        return
    con.execute("DELETE FROM wiki_sections")
    own = ctx = 0
    for r in rows:
        a = fetch(r["wiki_title"])
        if not a or not a["text"]:
            continue
        src = wiki_source(con, a["title"], a["revid"])
        secs = sections(a["text"])
        kept = []
        if r["wiki_role"] == "own":
            for level, head, body in secs:
                if head and SKIP.match(head):
                    continue
                if not body:
                    if head:
                        kept.append((level, head, ""))
                    continue
                kept.append((level, head, trim(body, 1400 if head is None else PER_SECTION)))
            # drop empty headings that have no content beneath them
            clean = []
            for j, (level, head, body) in enumerate(kept):
                nxt = kept[j + 1] if j + 1 < len(kept) else None
                if not body and (not nxt or nxt[0] <= level):
                    continue
                clean.append((level, head, body))
            kept = [k for k in clean if k[2] or k[1]][:MAX_SECTIONS + 1]
            mode = "own"
            own += 1
        else:
            names = [r["title"]] + json.loads(r["aliases"])
            names = [re.sub(r"\s*\(.*\)$", "", n) for n in names if len(n) > 3]
            rx = re.compile("|".join(re.escape(n) for n in names), re.I) if names else None
            if not rx:
                continue
            for level, head, body in secs:
                if head and SKIP.match(head):
                    continue
                for para in body.split("\n"):
                    if rx.search(para) and len(para) > 60:
                        kept.append((2, head, trim(para, 1100)))
                        if len(kept) >= CONTEXT_PARAS:
                            break
                if len(kept) >= CONTEXT_PARAS:
                    break
            mode = "context"
            ctx += 1 if kept else 0
        for j, (level, head, body) in enumerate(kept):
            con.execute("INSERT OR REPLACE INTO wiki_sections VALUES (?,?,?,?,?,?,?)", (r["slug"], j, level, head, body, src, mode))
    log(con, "wiki_articles", f"{len(titles)} articles; fuller overviews for {own} entries, passages for {ctx} entries in other articles")
    con.commit()


if __name__ == "__main__":
    main()
