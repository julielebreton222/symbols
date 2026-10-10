"""Find the passages in the public-domain library where each entry is named.

Downloads the books listed in content/books.txt from Project Gutenberg (cached in
.cache/books/), strips the Gutenberg header and footer, splits the text into
paragraphs with their chapter heading, and keeps for each entry the passages
that name it most densely (at most 2 per book, 8 in all). The texts are in the
public domain, so the passage is quoted as it stands. Each passage links to the
exact place in Gutenberg's HTML edition with a text fragment (#:~:text=...),
which modern browsers scroll to and highlight.

Usage: python3 ingest/pd_books.py
"""
import json
import math
import os
import re
import time
import urllib.parse
import urllib.request

from common import CACHE, ROOT, db, entry_terms, log, source

BOOKS_DIR = os.path.join(CACHE, "books")
HEADING = re.compile(r"^(?:(?:CHAPTER|BOOK|CANTO|RUNE|SECTION|PART|FYTTE|SONG|SURA|SURAH|PSALM|STORY|TALE|LAY|ADVENTURE|"
                     r"Chapter|Book|Canto|Rune|Section|Part|Sura|Adventure)\b.{0,70}|[A-Z][A-Z0-9 ,.'’;:&()\-]{3,70})$")


def load_books():
    books = []
    for line in open(os.path.join(ROOT, "content", "books.txt"), encoding="utf-8"):
        if not line.strip() or line.startswith("#"):
            continue
        f = [x.strip() for x in line.split("|")]
        books.append({"id": f[0], "ebooks": [x.strip() for x in f[1].split(",")], "title": f[2], "author": f[3],
                      "translator": f[4], "year": int(f[5])})
    return books


def fetch(ebook):
    path = os.path.join(BOOKS_DIR, ebook + ".txt")
    if not os.path.exists(path) or os.path.getsize(path) < 1000:
        os.makedirs(BOOKS_DIR, exist_ok=True)
        url = f"https://www.gutenberg.org/cache/epub/{ebook}/pg{ebook}.txt"
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "SymbolsStudyApp/0.1"})
                open(path, "wb").write(urllib.request.urlopen(req, timeout=120).read())
                break
            except Exception:
                time.sleep(5 * (attempt + 1))
        time.sleep(1)
    return open(path, encoding="utf-8", errors="replace").read()


def paragraphs(text):
    text = text.replace("\r\n", "\n")
    s = re.search(r"\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG.*?\*\*\*", text)
    e = re.search(r"\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG", text)
    text = text[s.end() if s else 0: e.start() if e else len(text)]
    chapter = ""
    for block in re.split(r"\n\s*\n", text):
        lines = [l.strip() for l in block.strip().split("\n") if l.strip()]
        if not lines:
            continue
        if len(lines) <= 2 and all(HEADING.match(l) for l in lines):
            chapter = chapter_name(lines)
            continue
        para = " ".join(lines)
        if len(para) > 40:
            yield chapter, para


def excerpt(para, m, width=650):
    if len(para) <= width:
        return para
    start = max(0, m.start() - width // 3)
    start = para.rfind(" ", 0, start) + 1 if start else 0
    end = min(len(para), start + width)
    end = para.find(" ", end) if para.find(" ", end) != -1 else len(para)
    return ("… " if start else "") + para[start:end].strip() + (" …" if end < len(para) else "")


def fragment(para, m):
    """A short run of words around the match, copied exactly, for a #:~:text= link."""
    start = m.start()
    for _ in range(3):
        j = para.rfind(" ", 0, max(start - 1, 0))
        if j < 0:
            start = 0
            break
        start = j + 1
    end = m.end()
    for _ in range(3):
        j = para.find(" ", end + 1)
        if j < 0:
            end = len(para)
            break
        end = j
    phrase = para[start:end].strip(" ,;:.!?\"'“”‘’()[]_|")
    # stop at characters that break text fragments (markup, footnote marks, verse bars)
    phrase = re.split(r"[_\[\]|*]", phrase)[0] if not re.match(r"^[_\[\]|*]", phrase) else m.group(0)
    if m.group(0) not in phrase:
        phrase = m.group(0)
    return urllib.parse.quote(phrase.strip(), safe="").replace("-", "%2D")


LOW_VALUE = re.compile(r"index|glossary|footnote|notes|preface|contents|introduct|argument|appendix|bibliograph", re.I)


def chapter_name(lines):
    name = " ".join(lines)[:90]
    if name.isupper():
        name = re.sub(r"\b([IVXLC]+)\b", lambda m: m.group(1).upper(), name.title(), flags=re.I)
        name = re.sub(r"(\w)’S\b", r"\1’s", name)
    return name


def main():
    con = db()
    books = load_books()
    corpus = []  # (book, ebook, chapter, para, lower)
    for b in books:
        con.execute("INSERT OR REPLACE INTO books VALUES (?,?,?,?,?,?,?)",
                    (b["id"], b["title"], b["author"], b["year"], b["translator"],
                     "https://www.gutenberg.org/ebooks/" + b["ebooks"][0], "Public domain"))
        for eb in b["ebooks"]:
            n = 0
            for chapter, para in paragraphs(fetch(eb)):
                corpus.append((b, eb, chapter, para))
                n += 1
            if n < 20:
                log(con, "pd_books", f"WARNING: only {n} paragraphs in ebook {eb}")
    full = {}
    for b, eb, _, para in corpus:
        full.setdefault(eb, []).append(para)
    full = {eb: "\n".join(v) for eb, v in full.items()}
    full_low = {eb: v.lower() for eb, v in full.items()}

    con.execute("DELETE FROM passages")
    total = with_any = 0
    rows = con.execute("SELECT slug, title, aliases, categories FROM entries").fetchall()
    for r in rows:
        pairs = entry_terms(r["title"], json.loads(r["aliases"]), json.loads(r["categories"]))
        if not pairs:
            continue
        terms = [t for t, _ in pairs]
        # skip books that cannot contain any of the terms (cheap substring test first)
        needles = [x for _, n in pairs for x in n.split("|")]
        books_hit = {eb for eb, low in full_low.items() if any(n and n in low for n in needles)}
        if not books_hit:
            continue
        found = []
        for b, eb, chapter, para in corpus:
            if eb not in books_hit:
                continue
            if para.startswith(("CHAPTER ", "Chapter ")) and len(para) < 200:
                continue  # a table-of-contents line
            ms = [m for t in terms for m in t.finditer(para)]
            if not ms:
                continue
            score = len(ms) / math.sqrt(max(len(para), 200)) * (0.6 if len(para) > 3000 else 1)
            if LOW_VALUE.search(chapter) or len(para) < 120:
                score *= 0.3
            found.append((score, b, eb, chapter, para, ms[0], len(ms)))
        if not found:
            continue
        found.sort(key=lambda x: -x[0])
        per_book, keep = {}, []
        for f in found:
            if per_book.get(f[1]["id"], 0) >= 2:
                continue
            per_book[f[1]["id"]] = per_book.get(f[1]["id"], 0) + 1
            keep.append(f)
            if len(keep) >= 8:
                break
        with_any += 1
        for score, b, eb, chapter, para, m, hits in keep:
            url = f"https://www.gutenberg.org/cache/epub/{eb}/pg{eb}-images.html#:~:text={fragment(para, m)}"
            ch = chapter or "—"
            con.execute("INSERT OR REPLACE INTO passages VALUES (?,?,?,?,?,?)",
                        (r["slug"], b["id"], ch, url, excerpt(para, m), hits))
            total += 1
    log(con, "pd_books", f"{len(books)} books, {len(corpus)} paragraphs; {total} passages for {with_any} entries")
    con.commit()


if __name__ == "__main__":
    main()
