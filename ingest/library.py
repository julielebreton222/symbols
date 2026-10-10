"""The PDF library: index Julie's own books by the entries they cover.

1. Put PDFs in library/ (Git ignores that folder: the books never leave the device
   they are on, and are never published).
2. Describe each one in content/library.txt:
       file name | id | title | author | year | pd or copyrighted [| page offset]
   (page offset = printed page number minus PDF page number, if the book's pages
   are numbered differently from the PDF's.) Unknown books are listed with a
   line to fill in.
3. Run:  python3 ingest/library.py
   For every book it extracts the text page by page (pdftotext), finds on which
   pages each entry of the encyclopedia is named, and writes
       content/library/<id>.json    entry -> pages (facts only: safe to publish)
       content/library/<id>-todo.md a worklist of entries to summarise from it
   Scanned PDFs without a text layer are reported: run OCR first (for example
   `ocrmypdf in.pdf out.pdf`) and put the result in library/.
4. For public-domain books the index also keeps a short passage per entry,
   quoted. For copyrighted books it keeps page numbers only; summaries in our
   own words are then written into the cards from the worklist (see SOURCING.md).

The app shows the result on each card as "In my books": the book, and the
pages to open in Julie's own copy.
"""
import json
import os
import re
import subprocess
import sys

from common import ROOT, db, entry_terms, log

LIB = os.path.join(ROOT, "library")
OUT = os.path.join(ROOT, "content", "library")
META = os.path.join(ROOT, "content", "library.txt")


def read_meta():
    books = {}
    if not os.path.exists(META):
        return books
    for line in open(META, encoding="utf-8"):
        if not line.strip() or line.startswith("#"):
            continue
        f = [x.strip() for x in line.split("|")]
        if len(f) < 6:
            continue
        books[f[0]] = {"file": f[0], "id": f[1], "title": f[2], "author": f[3], "year": f[4],
                       "status": f[5].lower(), "offset": int(f[6]) if len(f) > 6 and f[6] else 0}
    return books


def pages_of(path):
    """Text of each page (pdftotext keeps page breaks as form feeds)."""
    out = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, errors="replace")
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:200])
    return out.stdout.split("\f")


def main():
    os.makedirs(LIB, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    meta = read_meta()
    pdfs = sorted(f for f in os.listdir(LIB) if f.lower().endswith(".pdf"))
    if not pdfs:
        print("No PDFs in library/. Put books there and describe them in content/library.txt.")
        return
    missing = [f for f in pdfs if f not in meta]
    if missing:
        print("Describe these books in content/library.txt first (one line each):")
        for f in missing:
            print(f"  {f} | short-id | Title | Author | year | pd or copyrighted | page offset")
    con = db()
    entries = con.execute("SELECT slug, title, aliases, categories, terms FROM entries").fetchall()
    for f in pdfs:
        if f not in meta:
            continue
        b = meta[f]
        pages = pages_of(os.path.join(LIB, f))
        empty = sum(1 for p in pages if len(p.strip()) < 40)
        if empty > len(pages) * 0.5:
            log(con, "library", f"{f}: {empty} of {len(pages)} pages have no text; it looks scanned. Run OCR first.")
            continue
        pd = b["status"].startswith("pd") or b["status"].startswith("public")
        index = {}
        for r in entries:
            pairs = entry_terms(r["title"], json.loads(r["aliases"]) + json.loads(r["terms"] or "[]"), json.loads(r["categories"]))
            if not pairs:
                continue
            hits = []
            for i, text in enumerate(pages):
                n = sum(len(rx.findall(text)) for rx, _ in pairs)
                if n:
                    hits.append((i + 1, n))
            if not hits:
                continue
            # keep the pages that name it most (a dictionary entry, a chapter), at most 12
            hits.sort(key=lambda h: (-h[1], h[0]))
            top = sorted(hits[:12])
            item = {"pdf_pages": [p for p, _ in top], "printed_pages": [p + b["offset"] for p, _ in top],
                    "mentions": sum(n for _, n in hits)}
            if pd:
                p0 = top[0][0]
                text = re.sub(r"\s+", " ", pages[p0 - 1])
                m = next((m for rx, _ in pairs for m in [rx.search(text)] if m), None)
                if m:
                    item["passage"] = text[max(0, m.start() - 300): m.end() + 400].strip()
            index[r["slug"]] = item
        out = {"book": {k: b[k] for k in ("id", "title", "author", "year", "status")}, "pages": len(pages), "entries": index}
        json.dump(out, open(os.path.join(OUT, b["id"] + ".json"), "w"), ensure_ascii=False, indent=1)
        # a worklist for writing summaries into the cards
        todo = sorted(index.items(), key=lambda kv: -kv[1]["mentions"])
        with open(os.path.join(OUT, b["id"] + "-todo.md"), "w") as w:
            w.write(f"# {b['title']} ({b['author']}, {b['year']}): entries to summarise\n\n")
            w.write("Copyrighted: summarise in our own words, credit the author, give the page; at most one short quote per card.\n\n"
                    if not pd else "Public domain: passages may be quoted in full.\n\n")
            for slug, it in todo:
                w.write(f"- [ ] {slug}: pp. {', '.join(map(str, it['printed_pages']))} ({it['mentions']} mentions)\n")
        log(con, "library", f"{b['title']}: {len(pages)} pages, {len(index)} entries found")
    con.commit()


if __name__ == "__main__":
    main()
