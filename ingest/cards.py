"""Load the hand-written full cards (content/cards/*.md) into the database.

A card is Markdown with a small header. See content/cards/README.md for the
format. Each section's sources are the [src: key, key] labels at the end of a
paragraph; keys are defined in the card's ## Sources list ("wp" always means the
entry's own Wikipedia article at the revision ingested).

Usage: python3 ingest/cards.py
"""
import glob
import html
import json
import os
import re

from common import ROOT, add_to_list, db, log, slugify, source, wiki_source

SECTIONS = {"overview": "Overview", "myth": "Myth & Origin", "lifetime": "Lifetime", "today": "Today",
            "seen": "How it was seen", "debates": "Debates", "article": "Article", "deeper": "Go deeper",
            "connections": "Connections", "sources": "Sources", "tales": "In the tales"}
BY_HEADING = {v.lower(): k for k, v in SECTIONS.items()}
LINK_TYPES = {"same-theme", "same-owner", "same-story", "same-culture", "evolved-into", "derived-from",
              "mistaken-for", "parallel", "part-of", "related"}
SRC = re.compile(r"\s*\[src:\s*([^\]]+)\]\s*$")


class CardError(Exception):
    pass


def inline(s, known=None):
    """Markdown inline -> HTML: escape, then *em*, **strong**, [text](url), [[slug|text]], {unverified}."""
    s = html.escape(s, quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"<em>\1</em>", s)
    s = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)

    def card_link(m):
        slug, text = m.group(1).strip(), (m.group(2) or m.group(1)).strip()
        if known is not None and slug not in known:
            raise CardError(f"link to unknown card [[{slug}]]")
        return f'<a href="#/e/{slug}" class="xref">{text}</a>'
    s = re.sub(r"\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]", card_link, s)
    s = s.replace("{unverified}", '<span class="unverified" title="Not traced to a source yet">unverified</span>')
    return s


def blocks(text, known):
    """Paragraphs, bullet lists and > quotes -> (html, [source keys])."""
    out, keys = [], []
    for chunk in re.split(r"\n\s*\n", text.strip()):
        lines = [l.rstrip() for l in chunk.split("\n") if l.strip()]
        if not lines:
            continue
        is_list = all(l.lstrip().startswith(("- ", "* ")) for l in lines)
        m = None if is_list else SRC.search(lines[-1])
        k = []
        if m:
            k = [x.strip() for x in m.group(1).split(",") if x.strip()]
            lines[-1] = lines[-1][:m.start()]
            if not lines[-1].strip():
                lines.pop()
        keys += k
        label = "".join(f'<sup class="src" data-src="{html.escape(x)}">{html.escape(x)}</sup>' for x in k)
        if all(l.lstrip().startswith(("- ", "* ")) for l in lines):
            items = []
            for l in lines:
                l = re.sub(r"^\s*[-*]\s+", "", l)
                mi = SRC.search(l)
                ik = []
                if mi:
                    ik = [x.strip() for x in mi.group(1).split(",") if x.strip()]
                    l = l[:mi.start()]
                    keys += ik
                items.append(inline(l, known) + "".join(f'<sup class="src" data-src="{html.escape(x)}">{html.escape(x)}</sup>' for x in ik))
            out.append("<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>" + (f'<p class="srcs">{label}</p>' if label else ""))
        elif all(l.startswith(">") for l in lines):
            q = " ".join(l.lstrip("> ").strip() for l in lines)
            out.append(f"<blockquote>{inline(q, known)}{label}</blockquote>")
        else:
            out.append(f"<p>{inline(' '.join(l.strip() for l in lines), known)}{label}</p>")
    return "\n".join(out), keys


def parse(path):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        raise CardError("missing --- header ---")
    head = {}
    for line in m.group(1).split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            head[k.strip()] = v.strip()
    body = m.group(2)
    parts = re.split(r"^## +(.+?)\s*$", body, flags=re.M)
    secs = {}
    for i in range(1, len(parts), 2):
        key = BY_HEADING.get(parts[i].strip().lower())
        if not key:
            raise CardError(f"unknown section “{parts[i]}”")
        secs[key] = parts[i + 1].strip()
    return head, secs


def subsections(text):
    """### Heading blocks -> [(heading, body)]; text before the first ### gets heading None."""
    parts = re.split(r"^### +(.+?)\s*$", text, flags=re.M)
    out = []
    if parts[0].strip():
        out.append((None, parts[0].strip()))
    for i in range(1, len(parts), 2):
        out.append((parts[i].strip(), parts[i + 1].strip()))
    return out


def split_list(v):
    return [x.strip() for x in re.split(r"[;,]", v or "") if x.strip()]


def load(con, path, known):
    slug = os.path.basename(path)[:-3]
    head, secs = parse(path)
    title = head.get("title") or slug
    exists = con.execute("SELECT wiki_title, wiki_revid FROM entries WHERE slug=?", (slug,)).fetchone()
    if not exists:
        con.execute("INSERT INTO entries (slug, title, origin) VALUES (?,?,?)", (slug, title, "card"))
        known.add(slug)
    con.execute("UPDATE entries SET title=?, status='full' WHERE slug=?", (title, slug))
    if head.get("wiki"):
        con.execute("UPDATE entries SET wiki_title=?, wiki_role='own' WHERE slug=?", (head["wiki"], slug))
    for col, key in [("aliases", "aliases"), ("categories", "categories"), ("traditions", "traditions"),
                     ("cultures", "cultures"), ("groups", "groups")]:
        if head.get(key):
            sep = r"[;]" if key in ("aliases", "cultures", "groups", "traditions") else r"[;,]"
            add_to_list(con, slug, col, [x.strip() for x in re.split(sep, head[key]) if x.strip()])
    if head.get("terms"):
        con.execute("UPDATE entries SET terms=? WHERE slug=?",
                    (json.dumps([x.strip() for x in head["terms"].split(";") if x.strip()], ensure_ascii=False), slug))
    if head.get("region"):
        con.execute("UPDATE entries SET region=? WHERE slug=?", (head["region"], slug))
    if head.get("coords"):
        lat, lon = [float(x) for x in head["coords"].split(",")]
        con.execute("UPDATE entries SET lat=?, lon=?, geo_src=? WHERE slug=?", (lat, lon, "card:" + slug, slug))
    if head.get("first"):
        y, _, label = head["first"].partition("|")
        con.execute("UPDATE entries SET first_year=?, first_label=? WHERE slug=?", (int(y.strip()), label.strip(), slug))
    for t in split_list(head.get("themes")):
        tid = slugify(t)
        con.execute("INSERT OR IGNORE INTO themes (id, name) VALUES (?,?)", (tid, t.replace("-", " ")))
        con.execute("INSERT OR REPLACE INTO entry_themes VALUES (?,?,?)", (slug, tid, "card:" + slug))

    # sources first, so section labels can be checked
    keys = {}
    row = con.execute("SELECT wiki_title, wiki_revid FROM entries WHERE slug=?", (slug,)).fetchone()
    if row["wiki_title"]:
        keys["wp"] = wiki_source(con, row["wiki_title"], row["wiki_revid"])
    for line in secs.get("sources", "").split("\n"):
        line = line.strip()
        if not line.startswith("- "):
            continue
        f = [x.strip() for x in line[2:].split(" | ")]
        if len(f) < 3:
            raise CardError(f"source line needs key | kind | label [| url [| licence]]: {line}")
        k, kind, label = f[:3]
        url = f[3] if len(f) > 3 and f[3] else None
        lic = f[4] if len(f) > 4 else None
        if k.startswith("wp:"):
            keys[k] = wiki_source(con, k[3:])
        else:
            keys[k] = source(con, f"{slug}:{k}", kind, inline(label), url, lic)

    class Keys(dict):
        def __missing__(self, k):
            if k.startswith("wp:"):
                self[k] = wiki_source(con, k[3:])
                return self[k]
            raise KeyError(k)

        def __contains__(self, k):
            return dict.__contains__(self, k) or k.startswith("wp:")

        def get(self, k, default=None):
            return self[k] if k in self else default
    keys = Keys(keys)

    con.execute("DELETE FROM sections WHERE slug=?", (slug,))

    def store(kind, ord_, heading, body):
        h, used = blocks(body, known)
        missing = [k for k in used if k not in keys]
        if missing:
            raise CardError(f"{kind}: unknown source key(s) {missing}")
        h = re.sub(r'data-src="([^"]+)"', lambda m: f'data-src="{html.escape(keys[html.unescape(m.group(1))])}"', h)
        con.execute("INSERT INTO sections VALUES (?,?,?,?,?,?)",
                    (slug, kind, ord_, heading, h, json.dumps(sorted({keys[k] for k in used}))))

    for kind in ("overview", "myth", "article"):
        if kind in secs:
            store(kind, 0, None, secs[kind])
    for kind in ("lifetime", "seen", "debates", "today"):
        for i, (heading, body) in enumerate(subsections(secs.get(kind, ""))):
            store(kind, i, heading, body)
    if "overview" in secs:
        plain = re.sub(r"<[^>]+>", "", blocks(secs["overview"], known)[0])
        con.execute("UPDATE entries SET overview=?, overview_src=? WHERE slug=?", (html.unescape(plain), "card:" + slug, slug))

    # Go deeper: "- kind | text | url"
    for i, line in enumerate(l.strip() for l in secs.get("deeper", "").split("\n") if l.strip().startswith("- ")):
        f = [x.strip() for x in line[2:].split(" | ")]
        kind, text = f[0], f[1] if len(f) > 1 else ""
        url = f[2] if len(f) > 2 and f[2] else None
        body = inline(text, known) + (f' <a class="go" href="{html.escape(url)}" target="_blank" rel="noopener">open ↗</a>' if url else "")
        con.execute("INSERT INTO sections VALUES (?,?,?,?,?,?)", (slug, "deeper", i, kind, body, "[]"))

    # Connections: "- type | target | reason | source key"
    con.execute("DELETE FROM connections WHERE a=? AND origin='card'", (slug,))
    for line in (l.strip() for l in secs.get("connections", "").split("\n") if l.strip().startswith("- ")):
        f = [x.strip() for x in line[2:].split(" | ")]
        if len(f) < 3 or f[0] not in LINK_TYPES:
            raise CardError(f"connection needs type | target | reason [| source]: {line}")
        typ, target, reason = f[:3]
        if target not in known:
            raise CardError(f"connection to unknown card “{target}”")
        src = keys.get(f[3]) if len(f) > 3 else None
        if len(f) > 3 and not src:
            raise CardError(f"connection source key “{f[3]}” not in ## Sources")
        con.execute("INSERT OR REPLACE INTO connections VALUES (?,?,?,?,?,?)", (slug, target, typ, inline(reason, known), src, "card"))
    return slug


def main():
    con = db()
    known = {r[0] for r in con.execute("SELECT slug FROM entries")}
    paths = sorted(glob.glob(os.path.join(ROOT, "content", "cards", "*.md")))
    paths = [p for p in paths if not os.path.basename(p).startswith(("_", "README"))]
    known |= {os.path.basename(p)[:-3] for p in paths}
    ok, bad = 0, 0
    for p in paths:
        try:
            load(con, p, known)
            ok += 1
        except CardError as e:
            bad += 1
            log(con, "cards", f"ERROR in {os.path.basename(p)}: {e}")
    log(con, "cards", f"{ok} full cards loaded, {bad} with errors")
    con.commit()
    if bad:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
