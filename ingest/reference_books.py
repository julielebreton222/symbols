"""Import the seven-book reference dataset (content/reference-books/*.json).

The dataset holds short, independently worded summaries of how seven writers
read each symbol (Cirlot, Eliade, Jung and colleagues, ARAS, Tresidder, Turner,
Campbell), each with its page. Following its own guidance:
  - each author's reading stays separate and attributed; readings are grouped
    by headword only so they can be compared, never merged as if they agreed;
  - every reading is shown with its book, author and page;
  - cross-book "related" links are navigation suggestions, marked as such.

Headwords are matched to existing entries by name and aliases; the rest become
new entries. Explicit relationships and related headwords become connections
whose source is the book.

Usage: python3 ingest/reference_books.py
"""
import glob
import json
import os
import re

from common import ROOT, add_to_list, db, log, norm, slugify, source

THEME_IDS = None  # filled from the themes table: book themes with the same name are linked
SACRED_CATS = re.compile(r"relig|sacred|ritual|priest|god|deit|scripture|church|shrine|cult", re.I)


def pretty(cat):
    return cat.replace("_", " ").strip().capitalize()


def author_line(b):
    b = b["bibliography"]
    who = b.get("author") or b.get("collective_author") or b.get("general_editor") and f"{b['general_editor']} (ed.)" \
        or b.get("editor") and f"{b['editor']} (ed.)"
    return who or ""


KNOWN_YEARS = {"aras_book_of_symbols_curated": 2010}  # Taschen, 2010; not given in the dataset


def year_of(b):
    if b.get("dataset_id") in KNOWN_YEARS:
        return KNOWN_YEARS[b["dataset_id"]]
    b = b["bibliography"]
    for k in ("original_edition_year", "first_publication_year", "original_publication_year", "edition_year"):
        if b.get(k):
            return b[k]
    return None


def label(b):
    bib = b["bibliography"]
    parts = [author_line(b), f"<i>{bib['title']}</i>"]
    if bib.get("translator"):
        parts.append(f"tr. {bib['translator']}")
    y = year_of(b)
    return ", ".join(p for p in parts if p) + (f" ({y})" if y else "")


def main():
    con = db()
    con.executescript("""
    CREATE TABLE IF NOT EXISTS ref_books (id TEXT PRIMARY KEY, short TEXT, title TEXT, author TEXT, year INTEGER,
        label TEXT, bibliography TEXT, framework TEXT, chapters TEXT, scope TEXT, entry_count INTEGER);
    CREATE TABLE IF NOT EXISTS ref_entries (uid TEXT PRIMARY KEY, book_id TEXT, symbol_id TEXT, slug TEXT, headword TEXT,
        category TEXT, summary TEXT, themes TEXT, related TEXT, pdf_page INTEGER, printed_page INTEGER, chapter TEXT,
        subsection TEXT, contributor TEXT, status TEXT, context TEXT);
    DELETE FROM ref_books; DELETE FROM ref_entries;
    """)
    con.execute("DELETE FROM connections WHERE origin='book'")
    con.execute("DELETE FROM entry_themes WHERE source LIKE 'book:%'")
    theme_ids = {r["id"] for r in con.execute("SELECT id FROM themes")}
    theme_names = {norm(r["name"]): r["id"] for r in con.execute("SELECT id, name FROM themes")}

    path = sorted(glob.glob(os.path.join(ROOT, "content", "reference-books", "*.json")))[0]
    d = json.load(open(path, encoding="utf-8"))
    books = d["books"]
    chapter_titles = {}
    for bid, b in books.items():
        src = source(con, "ref:" + b["short_name"], "book", label(b), None, "summarised (copyrighted book)",
                     "independent summaries with page references; see SOURCING.md")
        for ch in b.get("chapters", []):
            chapter_titles[(bid, ch.get("id"))] = ch.get("title")
        con.execute("INSERT INTO ref_books VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (bid, b["short_name"], b["bibliography"]["title"], author_line(b), year_of(b), label(b),
                     json.dumps(b["bibliography"], ensure_ascii=False), json.dumps(b.get("framework", []), ensure_ascii=False),
                     json.dumps(b.get("chapters", []), ensure_ascii=False), json.dumps(b.get("extraction_scope", {}), ensure_ascii=False),
                     b.get("entry_count")))

    # match each headword group to an entry
    known = {}
    for r in con.execute("SELECT slug, title, aliases FROM entries"):
        for n in [r["title"]] + json.loads(r["aliases"]):
            known.setdefault(norm(n), r["slug"])
            known.setdefault(norm(re.sub(r"\s*\(.*\)$", "", n)), r["slug"])

    def find(names):
        expanded = []
        for n in names:
            expanded.append(n)
            m = re.match(r"^(.+?)\s*\((?:or\s+)?(.+?)\)$", n)  # "Serpent (or Snake)"
            if m:
                expanded += [m.group(1), m.group(2)]
        for n in expanded:
            k = norm(n)
            for cand in (k, k[:-1] if k.endswith("s") else k + "s", re.sub(r"^(?:a|an)-", "", k)):
                if cand in known:
                    return known[cand]
        return None

    group_slug, matched, created = {}, 0, 0
    for sid, g in d["symbol_groups"].items():
        names = [g["headword"]] + g.get("headword_variants", [])
        slug = find(names)
        if slug:
            matched += 1
        else:
            slug = slugify(g["headword"])
            n = 2
            while con.execute("SELECT 1 FROM entries WHERE slug=?", (slug,)).fetchone():
                slug = f"{slugify(g['headword'])}-{n}"
                n += 1
            cats = g.get("categories", [])
            cat_list = ["symbol"] + (["sacred"] if any(SACRED_CATS.search(c) for c in cats) else [])
            con.execute("INSERT INTO entries (slug, title, origin) VALUES (?,?,?)", (slug, g["headword"], "reference-books"))
            add_to_list(con, slug, "categories", cat_list)
            add_to_list(con, slug, "groups", [pretty(c) for c in cats[:2]])
            for v in g.get("headword_variants", []):
                if norm(v) != norm(g["headword"]):
                    add_to_list(con, slug, "aliases", [v])
            known[norm(g["headword"])] = slug
            created += 1
        group_slug[sid] = slug

    for uid, e in d["entries"].items():
        slug = group_slug.get(e["symbol_id"])
        s = e.get("source", {})
        chapter = chapter_titles.get((e["book_id"], s.get("chapter_id"))) or (pretty(s["chapter_id"]) if s.get("chapter_id") else None)
        related = [{"h": r["headword"], "slug": group_slug.get(r.get("symbol_id")),
                    "same_book": r.get("resolution") == "same_book"} for r in e.get("related_entry_lookup", [])]
        con.execute("INSERT INTO ref_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (uid, e["book_id"], e["symbol_id"], slug, e["headword"], e["category"], e["summary"],
                     json.dumps(e.get("themes", []), ensure_ascii=False), json.dumps(related, ensure_ascii=False),
                     s.get("pdf_page_start"), s.get("printed_page_start"), chapter,
                     pretty(s["subsection_id"]) if s.get("subsection_id") else None, s.get("contributor"),
                     e.get("interpretation_status"), e.get("cultural_context")))
        if e.get("cultural_context") and slug:
            add_to_list(con, slug, "cultures", [e["cultural_context"].split(" (")[0].split(",")[0]])
        # a book theme with the same name as one of ours tags the entry, credited to the book
        for t in e.get("themes", []):
            tid = theme_names.get(norm(t.replace("_", " ")))
            if tid and slug:
                con.execute("INSERT OR IGNORE INTO entry_themes VALUES (?,?,?)", (slug, tid, "book:" + books[e["book_id"]]["short_name"]))
        # created entries get the first summary as their brief overview, credited
        row = con.execute("SELECT overview, origin FROM entries WHERE slug=?", (slug,)).fetchone()
        if row and row["origin"] == "reference-books" and not row["overview"]:
            short = books[e["book_id"]]["short_name"]
            con.execute("UPDATE entries SET overview=?, overview_src=? WHERE slug=?", (e["summary"], "ref:" + short, slug))

    # explicit relationships: attributed notes
    n_rel = 0
    for r in d["relationships"]:
        a = group_slug.get(r["from_lookup"]["symbol_id"])
        b = group_slug.get(r["to_lookup"]["symbol_id"])
        if not a or not b or a == b:
            continue
        book = books[r["book_id"]]
        cross = r["to_lookup"].get("resolution") != "same_book"
        reason = f"{r['note']} — {author_line(book) or book['bibliography']['title']}" + (" (the other headword is in a different book: a suggestion to compare, not the same meaning)" if cross else "")
        if not con.execute("SELECT 1 FROM connections WHERE ((a=? AND b=?) OR (a=? AND b=?))", (a, b, b, a)).fetchone():
            con.execute("INSERT INTO connections VALUES (?,?,?,?,?,?)", (a, b, "related", reason, "ref:" + book["short_name"], "book"))
            n_rel += 1
    # related headwords inside a book entry
    n_hw = 0
    for e in d["entries"].values():
        a = group_slug.get(e["symbol_id"])
        book = books[e["book_id"]]
        for r in e.get("related_entry_lookup", []):
            b = group_slug.get(r.get("symbol_id"))
            if not a or not b or a == b:
                continue
            if con.execute("SELECT 1 FROM connections WHERE ((a=? AND b=?) OR (a=? AND b=?))", (a, b, b, a)).fetchone():
                continue
            same = r.get("resolution") == "same_book"
            who = author_line(book) or book["bibliography"]["title"]
            reason = f"{who} lists them together under “{e['headword']}”." if same else \
                f"{who} points from “{e['headword']}” to “{r['headword']}”, which is read in another book: a suggestion to compare."
            con.execute("INSERT INTO connections VALUES (?,?,?,?,?,?)", (a, b, "related", reason, "ref:" + book["short_name"], "book"))
            n_hw += 1
    log(con, "reference_books", f"{len(d['entries'])} readings from {len(books)} books; {matched} headwords matched to entries, "
                                f"{created} new entries; {n_rel} relationships and {n_hw} related-headword links")
    con.commit()


if __name__ == "__main__":
    main()
