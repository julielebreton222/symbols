"""Export the database to the files the app reads (data/app/).

  data/app/index.json       every entry in brief (for browsing, search, map, timeline,
                            graph, quizzes) plus themes, cultures, books and counts
  data/app/cards/NN.json    full detail, 32 files bucketed by slug, loaded on demand

Cultures and traditions are normalised with content/cultures.txt (which also
gives each culture an approximate map position).

Usage: python3 ingest/export.py
"""
import datetime
import json
import os
import re

from common import ROOT, db, log, wiki_url

OUT = os.path.join(ROOT, "data", "app")
BUCKETS = 32
LABELS = {"P31": "Instance of", "P361": "Part of", "P127": "Owned by", "P1441": "Appears in", "P1080": "Story world",
          "P140": "Religion", "P495": "Country of origin", "P138": "Named after", "P180": "Depicts", "P571": "Inception"}


def bucket(slug):
    """FNV-1a (32-bit) of the slug's UTF-8 bytes, so the app can compute it too (js/data.js)."""
    h = 0x811C9DC5
    for b in slug.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h % BUCKETS


def load_cultures():
    canon, drop = {}, set()
    for line in open(os.path.join(ROOT, "content", "cultures.txt"), encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("!"):
            drop.add(line[1:].strip().lower())
            continue
        f = [x.strip() for x in line.split("|")]
        name, region = f[0], f[1]
        ll = [float(x) for x in f[2].split(",")] if len(f) > 2 and f[2] else None
        info = {"name": name, "region": region, "ll": ll}
        canon[name.lower()] = info
        for a in (f[3].split(";") if len(f) > 3 else []):
            if a.strip():
                canon[a.strip().lower()] = info
    return canon, drop


def short(text, n=240):
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= n:
        return text
    cut = text[:n]
    i = cut.rfind(". ")
    return cut[:i + 1] if i > n * 0.5 else cut.rsplit(" ", 1)[0] + "…"


def main():
    con = db()
    canon, drop = load_cultures()
    os.makedirs(os.path.join(OUT, "cards"), exist_ok=True)

    def norm_list(values):
        out = []
        for v in values:
            if v.lower() in drop:
                continue
            c = canon.get(v.lower())
            name = c["name"] if c else v
            if name not in out:
                out.append(name)
        return out

    sources = {r["id"]: dict(r) for r in con.execute("SELECT * FROM sources")}
    themes = {r["id"]: dict(r) for r in con.execute("SELECT * FROM themes")}
    books = {r["id"]: dict(r) for r in con.execute("SELECT * FROM books")}
    ent_themes, conns, imgs, tales, tale_total, passages, facts, secs = {}, {}, {}, {}, {}, {}, {}, {}
    for r in con.execute("SELECT * FROM entry_themes"):
        by = "keyword" if r["source"] == "keyword" else (r["source"] if r["source"].startswith("book:") else "card")
        ent_themes.setdefault(r["slug"], []).append({"id": r["theme"], "by": by})
    # readings from the seven reference books, kept per book and never merged
    refs, ref_books = {}, {}
    for r in con.execute("SELECT * FROM ref_books ORDER BY year"):
        ref_books[r["short"]] = {"id": r["id"], "title": r["title"], "author": r["author"], "year": r["year"], "label": r["label"],
                                 "bib": json.loads(r["bibliography"]), "framework": json.loads(r["framework"]),
                                 "chapters": json.loads(r["chapters"]), "scope": json.loads(r["scope"]), "count": r["entry_count"]}
    short_of = {v["id"]: k for k, v in ref_books.items()}
    for r in con.execute("SELECT * FROM ref_entries ORDER BY slug, book_id"):
        refs.setdefault(r["slug"], []).append({
            "b": short_of[r["book_id"]], "h": r["headword"], "sum": r["summary"], "th": json.loads(r["themes"]),
            "rel": json.loads(r["related"]), "pp": r["printed_page"], "pdf": r["pdf_page"], "ch": r["chapter"],
            "sub": r["subsection"], "who": r["contributor"], "st": r["status"], "ctx": r["context"], "cat": r["category"]})
    for r in con.execute("SELECT * FROM connections"):
        d = dict(r)
        conns.setdefault(r["a"], []).append({"to": r["b"], "type": r["type"], "reason": r["reason"], "src": r["source"], "origin": r["origin"], "dir": "out"})
        conns.setdefault(r["b"], []).append({"to": r["a"], "type": r["type"], "reason": r["reason"], "src": r["source"], "origin": r["origin"], "dir": "in"})
    for r in con.execute("SELECT * FROM images ORDER BY slug, ord"):
        d = {k: r[k] for k in ("file", "page_url", "thumb", "license", "license_url", "author", "credit")}
        d["thumb"] = (d["thumb"] or "").split("?")[0]
        a = d["author"] or ""
        if len(a) % 2 == 0 and a[:len(a) // 2] == a[len(a) // 2:]:
            d["author"] = a[:len(a) // 2]  # Commons sometimes repeats the name
        imgs.setdefault(r["slug"], []).append(d)
    # owners: Wikidata "owned by", else a context article about a person or god
    owners = {}
    for r in con.execute("SELECT slug, label FROM wikidata_facts WHERE prop='P127'"):
        owners.setdefault(r["slug"], []).append(r["label"])
    owner_types = re.compile(r"deity|god|goddess|human|character|figure|hero|king|queen|giant|spirit|demon|wizard|saint|prophet|person", re.I)
    ctx_owner = {r["wiki_title"] for r in con.execute("SELECT wiki_title, type_label FROM context_types") if owner_types.search(r["type_label"] or "")}
    for r in con.execute("SELECT slug, wiki_title FROM entries WHERE wiki_role='context'"):
        if r["wiki_title"] in ctx_owner and r["slug"] not in owners:
            owners[r["slug"]] = [re.sub(r" \(.*\)$", "", r["wiki_title"])]
    for r in con.execute("SELECT * FROM tale_mentions ORDER BY slug, hits DESC, title"):
        if r["page"] == "":
            tale_total[r["slug"]] = r["hits"]
            continue
        tales.setdefault(r["slug"], []).append({"p": r["page"], "s": r["story"], "t": r["title"], "o": r["origin"], "y": r["year"],
                                                "k": r["kind"], "h": r["hits"], "x": r["snippet"]})
    for r in con.execute("SELECT * FROM passages ORDER BY slug, hits DESC"):
        passages.setdefault(r["slug"], []).append({"book": r["book"], "ch": r["chapter"], "url": r["url"], "text": r["text"]})
    for r in con.execute("SELECT * FROM wikidata_facts WHERE prop != 'P18'"):
        facts.setdefault(r["slug"], []).append({"p": LABELS.get(r["prop"], r["prop"]), "v": r["label"] or r["value"], "q": r["value"]})
    for r in con.execute("SELECT * FROM sections ORDER BY slug, kind, ord"):
        secs.setdefault(r["slug"], {}).setdefault(r["kind"], []).append({"h": r["heading"], "html": r["html"], "src": json.loads(r["sources"])})

    index, cards = [], [dict() for _ in range(BUCKETS)]
    culture_use = {}
    for r in con.execute("SELECT * FROM entries ORDER BY title COLLATE NOCASE"):
        s = r["slug"]
        cultures = norm_list(json.loads(r["cultures"]))
        trads = norm_list(json.loads(r["traditions"]))
        for c in cultures + trads:
            culture_use[c] = culture_use.get(c, 0) + 1
        own_overview = r["overview"] if (r["wiki_role"] == "own" or r["status"] == "full") else None
        overview = own_overview or r["list_note"] or ""
        ll, approx = None, False
        if r["lat"] is not None:
            ll, approx = [round(r["lat"], 3), round(r["lon"], 3)], "approximate" in (r["geo_src"] or "")
        else:
            for c in cultures + trads:
                info = canon.get(c.lower())
                if info and info["ll"]:
                    ll, approx = info["ll"], True
                    break
        th = ent_themes.get(s, [])
        im = imgs.get(s, [])
        index.append({
            "s": s, "t": r["title"], "a": json.loads(r["aliases"]), "c": json.loads(r["categories"]),
            "g": json.loads(r["groups"]), "cu": cultures, "tr": trads, "th": [t["id"] for t in th],
            "st": r["status"], "y": r["first_year"], "ll": ll, "lla": approx, "ow": owners.get(s, []),
            "im": im[0]["thumb"] if im else None, "o": short(overview),
            "n": [len(tales.get(s, [])), len(passages.get(s, [])), len(conns.get(s, [])), len(refs.get(s, []))],
            "rb": sorted({x["b"] for x in refs.get(s, [])}),
            "rt": sorted({t for x in refs.get(s, []) for t in x["th"]}),
        })
        used_src = set()
        for kind in secs.get(s, {}).values():
            for x in kind:
                used_src.update(x["src"])
        for c in conns.get(s, []):
            if c["src"]:
                used_src.add(c["src"])
        for k in (r["overview_src"], r["list_src"]):
            if k:
                used_src.add(k)
        for x in refs.get(s, []):
            used_src.add("ref:" + x["b"])
        if r["wiki_title"]:
            used_src.add("wp:" + r["wiki_title"])
        if r["qid"]:
            used_src.add("wd:" + r["qid"])
        # card-local sources too
        for sid in sources:
            if sid.startswith(s + ":"):
                used_src.add(sid)
        cards[bucket(s)][s] = {
            "overview": overview, "overview_src": r["overview_src"] if own_overview else r["list_src"],
            "list_note": r["list_note"] if own_overview and r["list_note"] and r["list_note"] != overview else None,
            "list_src": r["list_src"],
            "wiki": {"title": r["wiki_title"], "url": wiki_url(r["wiki_title"]), "role": r["wiki_role"], "revid": r["wiki_revid"]} if r["wiki_title"] else None,
            "qid": r["qid"], "first": r["first_label"], "region": r["region"],
            "geo": r["geo_src"], "sections": secs.get(s, {}),
            "sources": {k: {kk: sources[k][kk] for kk in ("kind", "label", "url", "license", "note")} for k in sorted(used_src) if k in sources},
            "conn": conns.get(s, []), "images": im, "themes": th,
            "tales": tales.get(s, []), "tales_total": tale_total.get(s, len(tales.get(s, []))),
            "passages": passages.get(s, []), "facts": facts.get(s, []), "refs": refs.get(s, []),
        }

    cultures_out = {}
    for c, n in culture_use.items():
        info = canon.get(c.lower())
        cultures_out[c] = {"n": n, "region": info["region"] if info else None, "ll": info["ll"] if info else None}
    meta = {
        "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "buckets": BUCKETS,
        "themes": {k: {"name": v["name"], "about": v["about"]} for k, v in themes.items()},
        "cultures": cultures_out,
        "books": {k: {kk: v[kk] for kk in ("title", "author", "translator", "year", "url")} for k, v in books.items()},
        "refbooks": ref_books,
        "counts": {"entries": len(index), "full": sum(1 for e in index if e["st"] == "full"),
                   "tales": sum(len(v) for v in tales.values()), "passages": sum(len(v) for v in passages.values()),
                   "links": con.execute("SELECT count(*) FROM connections").fetchone()[0],
                   "images": sum(len(v) for v in imgs.values()), "readings": sum(len(v) for v in refs.values())},
    }
    json.dump({"meta": meta, "entries": index}, open(os.path.join(OUT, "index.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    for i, b in enumerate(cards):
        json.dump(b, open(os.path.join(OUT, "cards", f"{i:02d}.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    size = sum(os.path.getsize(os.path.join(OUT, "cards", f)) for f in os.listdir(os.path.join(OUT, "cards")))
    log(con, "export", f"{len(index)} entries; index {os.path.getsize(os.path.join(OUT, 'index.json')) // 1024} KB, cards {size // 1024} KB")
    con.commit()


if __name__ == "__main__":
    main()
