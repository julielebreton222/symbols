"""Ingest the Wikipedia list pages (via the MediaWiki API) into entries.

Pages: List of mythological objects, List of magical weapons (folklore part),
List of symbols (religious and mystical part), Religious symbol (table),
Adinkra symbols (table), Thirteen Treasures of the Island of Britain.
The wikitext is cached in .cache/wikitext/ with its revision id; delete the
cache to fetch fresh copies. The one-line description from the list is kept
as the entry's list note, credited to that page and revision (CC BY-SA).

Usage: python3 ingest/wiki_lists.py
"""
import json
import os
import re

import wm
from common import CACHE, add_to_list, db, log, norm, slugify, wiki_source
from wikitext import links, plain, strip_refs, strip_templates

PAGES = ["List of mythological objects", "List of magical weapons", "List of symbols", "Religious symbol",
         "Adinkra symbols", "Thirteen Treasures of the Island of Britain"]

# Section headings of "List of mythological objects" -> the app's groups.
GROUPS = [
    (r"^(Armor|Helmets|Headgear|Shields|Gauntlets)", "Armor, shields & headgear"),
    (r"^(Clothing|Crowns|Belts|Girdles|Gloves|Veils|Caps|Garments|Footwear|Boots|Sandals|Shoes|Outerwear|Coats|Cloaks|Mantles|Robes|Pants)", "Clothing, cloaks & footwear"),
    (r"^(Swords|Daggers)", "Swords & blades"),
    (r"^(Clubs|Axes|Hammers)", "Hammers, axes, clubs & thunder weapons"),
    (r"^(Pole weapons|Rods|Scythes|Spears|Polearms|Bidents|Javelins|Lances|Tridents|Whips)", "Spears, staffs & polearms"),
    (r"^(Bow|Bows|Arrows|Crossbows|Projectile)", "Bows, arrows & missiles"),
    (r"^(Jewelry|Necklaces|Amulets|Rings|Arm rings|Earrings|Gemstones)", "Rings, necklaces & jewels"),
    (r"^Stones", "Stones"),
    (r"^(Vehicles|Airborne|Vimana|Chariots|Ships|Trains|Unidentified)", "Vehicles & ships"),
    (r"^(Treasures|Relics)", "Treasures & relics"),
    (r"^(Books|Mirrors)", "Mirrors, books & tablets"),
    (r"^(Cauldrons|Foods|Drinks|Fruits|Other|Eggs|Substances|Containers|Bags|Cups|Lamps|Dispensers)", "Vessels, food & drink"),
    (r"^(Botany|Plants|Trees|World trees)", "Trees & sacred plants"),
    (r"^(Musical|Conchs|Drums|Flutes|Harps|Horns|Lyres|Rattles|Trumpets)", "Instruments & horns"),
    (r"^(Ropes|Hooks|Nets)", "Bindings & other objects"),
    (r"^(Body parts|Heads|Eyes|Limbs|Hair|Blood|Bones|Organs)", "Body parts & remains"),
    (r".", "Bindings & other objects"),
]
SKIP_SECTIONS = {"Explanatory notes", "References", "External links", "See also", "Notes", "Further reading"}
CULTURE = re.compile(r"\(\s*((?:\[\[[^\]]+\]\]|[A-Z][\w\s,'/–-]*?)(?:\s*(?:,|and|/)\s*(?:\[\[[^\]]+\]\]|[A-Z][\w\s'-]*?))*)\s*\)\s*\.?\s*$")


def fetch(title):
    path = os.path.join(CACHE, "wikitext", title.replace(" ", "_") + ".json")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        p = wm.wp(action="parse", page=title, prop="wikitext|revid", redirects=1)["parse"]
        json.dump({"title": p["title"], "revid": p["revid"], "wikitext": p["wikitext"]}, open(path, "w"))
    return json.load(open(path))


def group_for(heading):
    for pat, g in GROUPS:
        if re.search(pat, heading):
            return g


class Index:
    """Find an existing entry by slug, loose name, alias or own Wikipedia article."""

    def __init__(self, con):
        self.con = con
        self.by = {}
        for r in con.execute("SELECT slug, title, aliases, wiki_title, wiki_role FROM entries"):
            self.add(r["slug"], [r["title"]] + json.loads(r["aliases"]), r["wiki_title"] if r["wiki_role"] == "own" else None)

    def add(self, slug, names, wiki=None):
        for n in names:
            self.by.setdefault("n:" + norm(n), slug)
        if wiki:
            self.by.setdefault("w:" + wiki, slug)

    def find(self, name, wiki=None):
        return (wiki and self.by.get("w:" + wiki)) or self.by.get("n:" + norm(name))


ALSO = re.compile(r"^\((?:also|or|also known as|a\.k\.a\.)\s+(.+?)\)[,.:;]?\s*", re.I)


def upsert(con, idx, name, wiki, role, cats, group, culture, note, src, trad=None, origin="wikipedia-list"):
    name = name.strip(" ,.:;")
    if not name or len(name) > 90:
        return None
    name = name[0].upper() + name[1:]
    aliases = []
    m = re.match(r"^(.+?), (The .+)$", name)
    if m:
        name, aliases = m.group(1), [m.group(2)]
    if note:
        m = ALSO.match(note)
        if m:
            aliases += [a.strip(" '\"") for a in re.split(r",|;|\bor\b", m.group(1).replace("''", "")) if a.strip(" '\"")]
            note = note[m.end():]
            note = note[:1].upper() + note[1:] if note else None
    slug = idx.find(name)
    for a in aliases:
        slug = slug or idx.find(a)
    if not slug and role == "own" and wiki:
        # Same article as an entry we have: merge only if the article is named after this item,
        # otherwise it is a different object that the article merely discusses (e.g. Marmiadoise -> Excalibur).
        slug = idx.find(name, wiki) if norm(wiki.split(" (")[0]) == norm(name) else None
        if not slug and idx.find("", wiki):
            role = "context"
    new = slug is None
    if new:
        slug = slugify(name)
        n = 2
        while con.execute("SELECT 1 FROM entries WHERE slug=?", (slug,)).fetchone():
            slug = f"{slugify(name)}-{n}"
            n += 1
        con.execute("INSERT INTO entries (slug, title, wiki_title, wiki_role, origin) VALUES (?,?,?,?,?)",
                    (slug, name, wiki, role if wiki else "own", origin))
        idx.add(slug, [name], wiki if role == "own" else None)
    else:
        row = con.execute("SELECT wiki_title, title FROM entries WHERE slug=?", (slug,)).fetchone()
        if not row["wiki_title"] and wiki:
            con.execute("UPDATE entries SET wiki_title=?, wiki_role=? WHERE slug=?", (wiki, role, slug))
        if norm(row["title"]) != norm(name):
            add_to_list(con, slug, "aliases", [name])
    if aliases:
        title = con.execute("SELECT title FROM entries WHERE slug=?", (slug,)).fetchone()[0]
        add_to_list(con, slug, "aliases", [a for a in aliases if norm(a) not in (norm(name), norm(title))])
        idx.add(slug, aliases)
    add_to_list(con, slug, "categories", cats)
    if group:
        add_to_list(con, slug, "groups", [group])
    if culture:
        add_to_list(con, slug, "cultures", [c.strip() for c in re.split(r",|/| and ", culture) if c.strip()])
    if trad:
        add_to_list(con, slug, "traditions", [trad])
    if note:
        cur = con.execute("SELECT list_note FROM entries WHERE slug=?", (slug,)).fetchone()[0]
        if not cur:
            con.execute("UPDATE entries SET list_note=?, list_src=? WHERE slug=?", (note, src, slug))
    return slug, new


def bullet_entry(line):
    """'* '''[[X]]''', desc ([[Culture]])' -> (name, wiki, role, culture, note)."""
    body = re.sub(r"^\*+\s*", "", line).strip()
    body = strip_templates(strip_refs(body))
    culture = None
    m = CULTURE.search(body)
    if m:
        culture = plain(m.group(1))
        body = body[:m.start()].rstrip()
    b = re.match(r"^'''(.+?)'''", body)
    if b:
        bold, rest = b.group(1), body[b.end():]
        ls = links(bold)
        shown = plain(bold)
        if len(ls) == 1 and plain(f"[[{ls[0][0]}|{ls[0][1]}]]") == shown:
            wiki, role = ls[0][0], "own"
        elif ls:
            wiki, role = ls[0][0], "context"
        else:
            wiki, role = None, "own"
        name = shown
    else:
        ls = links(body)
        if not ls or not body.startswith("[["):
            return None
        m2 = re.match(r"^\[\[[^\]]+\]\]", body)
        name, wiki, role = ls[0][1], ls[0][0], "own"
        rest = body[m2.end():]
    note = plain(rest).lstrip(" ,:;–—-").strip()
    if note:
        note = note[0].upper() + note[1:]
        if not note.endswith((".", "!", "?", ")")):
            note += "."
    return name, wiki, role, culture, note


def sections(wikitext):
    """Yield (heading path, line) for every line, tracking == headings ==."""
    path = []
    for line in wikitext.split("\n"):
        m = re.match(r"^(=+)\s*(.*?)\s*=+\s*$", line)
        if m:
            lvl = len(m.group(1)) - 1
            path = path[:lvl - 1] + [plain(m.group(2))]
            continue
        yield path, line


def mythological_objects(con, idx, page):
    src = wiki_source(con, page["title"], page["revid"])
    n = new = 0
    for path, line in sections(page["wikitext"]):
        if not line.startswith("*") or not path or path[0] in SKIP_SECTIONS:
            continue
        e = bullet_entry(line)
        if not e:
            continue
        name, wiki, role, culture, note = e
        heading = path[1] if len(path) > 1 else path[0]
        r = upsert(con, idx, name, wiki, role, ["object"], group_for(heading) or group_for(path[0]), culture, note, src)
        if r:
            n += 1
            new += r[1]
    return n, new


WEAPON_GROUPS = [(r"sword|blade|sabre|katana|scimitar|dagger|knife|kris|keris", "Swords & blades"),
                 (r"spear|lance|trident|staff|rod|pike|halberd|glaive", "Spears, staffs & polearms"),
                 (r"bow|arrow|missile|astra|disc|chakra|bullet|sling", "Bows, arrows & missiles"),
                 (r"hammer|axe|club|mace|thunder|bolt", "Hammers, axes, clubs & thunder weapons"),
                 (r"shield|armou?r|helm", "Armor, shields & headgear")]


def magical_weapons(con, idx, page):
    src = wiki_source(con, page["title"], page["revid"])
    n = new = 0
    for path, line in sections(page["wikitext"]):
        if not line.startswith("*") or not path or path[0] != "In folklore":
            continue
        body = re.sub(r"^\*+\s*", "", line)
        m = re.match(r"^((?:\[\[[^\]]+\]\](?:\s*(?:and|,)\s*)?)+)\s*[–—-]\s*(.*)$", body)
        if not m:
            continue
        note = plain(m.group(2))
        culture = path[1] if len(path) > 1 else None
        for wiki, shown in links(m.group(1)):
            text = (shown + " " + note).lower()
            group = next((g for pat, g in WEAPON_GROUPS if re.search(pat, text)), "Swords & blades")
            r = upsert(con, idx, shown, wiki, "own", ["object"], group, culture, note, src)
            if r:
                n += 1
                new += r[1]
    return n, new


def list_of_symbols(con, idx, page):
    src = wiki_source(con, page["title"], page["revid"])
    n = new = 0
    for path, line in sections(page["wikitext"]):
        if not line.startswith("*") or not path or path[0] != "Religious and mystical symbols":
            continue
        body = strip_templates(re.sub(r"^\*+\s*", "", line))
        ls = links(body)
        if not ls:
            continue
        # "[[☥]] — [[Ankh]]" style lines: the last link is the name
        wiki, shown = ls[-1] if re.match(r"^\[\[[^\]]{1,3}\]\]\s*[—–-]", body) else ls[0]
        if len(shown) <= 2:
            continue
        rest = body.split("]]", 1)[1] if "]]" in body else ""
        note = plain(rest).lstrip(" ,:;–—-")
        note = note if len(note) > 12 and not note.startswith("[") else None
        r = upsert(con, idx, shown, wiki, "own", ["symbol"], "Religious & mystical signs", None, note, src)
        if r:
            n += 1
            new += r[1]
    return n, new


def table_rows(wikitext):
    rows, cur = [], []
    for line in wikitext.split("\n"):
        if line.startswith("|-") or line.startswith("|}"):
            if cur:
                rows.append(cur)
            cur = []
        elif line.startswith("|") and not line.startswith("|+"):
            for cell in re.split(r"\|\|", line[1:]):
                cur.append(cell)
    if cur:
        rows.append(cur)
    return rows


def religious_symbol(con, idx, page):
    src = wiki_source(con, page["title"], page["revid"])
    n = new = 0
    text = page["wikitext"].split("==Religious symbolism==")[0]
    religion = None
    for cells in table_rows(text):
        cells = [c for c in cells]
        if cells and "rowspan" in cells[0] or (len(cells) >= 5):
            religion = plain(re.sub(r"^[^|]*rowspan[^|]*\|", "", cells[0]))
            cells = cells[1:]
        if len(cells) < 2 or not religion:
            continue
        name_cell = cells[0]
        ls = links(name_cell)
        if not ls:
            continue
        origin = plain(cells[2]) if len(cells) > 2 else ""
        for wiki, shown in ls[:2]:
            if shown.lower() in ("cruciform",):
                continue
            r = upsert(con, idx, shown, wiki, "own", ["sacred"], religion, None,
                       f"A symbol of {religion}." + (f" Origin given: {origin}." if origin else ""), src, trad=religion)
            if r:
                n += 1
                new += r[1]
    return n, new


def adinkra(con, idx, page):
    src = wiki_source(con, page["title"], page["revid"])
    n = new = 0
    for cells in table_rows(page["wikitext"]):
        if len(cells) < 4 or not cells[0].strip().isdigit():
            continue
        name = plain(cells[1])
        meaning = plain(cells[2])
        details = plain(cells[3])
        note = f"Adinkra symbol of the Akan people. Literal meaning: “{meaning}”." + (f" {details}" if details else "")
        r = upsert(con, idx, name, "Adinkra symbols", "context", ["symbol"], "Adinkra symbols", "Akan (Ghana)", note, src)
        if r:
            n += 1
            new += r[1]
    return n, new


TREASURE_ALIASES = {"Coat of Padarn Beisrudd": "Coat of Padarn Red-Coat"}


def thirteen_treasures(con, idx, page):
    src = wiki_source(con, page["title"], page["revid"])
    n = 0
    text = page["wikitext"].split("==Description==")[1].split("==See also==")[0]
    for part in re.split(r"\n===", text)[1:]:
        head, _, body = part.partition("===")
        head = plain(head)
        if head == "Myrddin Wyllt":
            continue
        para = next((p for p in body.strip().split("\n\n") if p.strip() and not p.startswith(("[[File", "{{"))), "")
        note = plain(para)
        if len(note) > 600:
            note = note[:600].rsplit(". ", 1)[0] + "."
        name = TREASURE_ALIASES.get(head, head)
        r = upsert(con, idx, name, "Thirteen Treasures of the Island of Britain", "context", ["object"],
                   "Thirteen Treasures of the Island of Britain", "Welsh mythology", note, src)
        if r:
            n += 1
            if name != head:
                add_to_list(con, r[0], "aliases", [head])
    return n, 0


def main():
    con = db()
    idx = Index(con)
    for title, fn in [("List of mythological objects", mythological_objects), ("List of magical weapons", magical_weapons),
                      ("List of symbols", list_of_symbols), ("Religious symbol", religious_symbol),
                      ("Adinkra symbols", adinkra), ("Thirteen Treasures of the Island of Britain", thirteen_treasures)]:
        page = fetch(title)
        n, new = fn(con, idx, page)
        log(con, "wiki_lists", f"{title} (rev {page['revid']}): {n} items, {new} new entries")
    total = con.execute("SELECT count(*) FROM entries").fetchone()[0]
    log(con, "wiki_lists", f"{total} entries in total")
    con.commit()


if __name__ == "__main__":
    main()
