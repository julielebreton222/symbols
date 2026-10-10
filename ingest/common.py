"""Shared helpers for the ingestion scripts: the database, slugs, the log."""
import datetime
import json
import os
import re
import sqlite3
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "symbols.db")
CACHE = os.path.join(ROOT, ".cache")
LOG_PATH = os.path.join(ROOT, "ingest", "log.txt")


def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(open(os.path.join(ROOT, "ingest", "schema.sql")).read())
    return con


def slugify(s):
    s = unicodedata.normalize("NFKD", s.replace("ð", "d").replace("Ð", "D").replace("þ", "th").replace("æ", "ae")
                              .replace("Æ", "Ae").replace("ø", "o").replace("ǫ", "o").replace("ß", "ss"))
    s = s.encode("ascii", "ignore").decode().lower()
    s = re.sub(r"['’`]", "", s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def norm(s):
    """A loose key for matching names: no accents, case, punctuation or leading 'the'."""
    return re.sub(r"^the-", "", slugify(s))


def jl(v):
    return json.loads(v) if v else []


def add_to_list(con, slug, col, values):
    row = con.execute(f"SELECT {col} FROM entries WHERE slug=?", (slug,)).fetchone()
    cur = jl(row[0]) if row else []
    for v in values:
        if v and v not in cur:
            cur.append(v)
    con.execute(f"UPDATE entries SET {col}=? WHERE slug=?", (json.dumps(cur, ensure_ascii=False), slug))


def source(con, sid, kind, label, url=None, license=None, note=None):
    con.execute("INSERT OR REPLACE INTO sources (id, kind, label, url, license, note) VALUES (?,?,?,?,?,?)",
                (sid, kind, label, url, license, note))
    return sid


def wiki_url(title):
    return "https://en.wikipedia.org/wiki/" + title.replace(" ", "_")


def wiki_source(con, title, revid=None):
    sid = "wp:" + title
    url = wiki_url(title) + (f"?oldid={revid}" if revid else "")
    return source(con, sid, "wikipedia", f"Wikipedia, “{title}”", url, "CC BY-SA 4.0",
                  f"revision {revid}" if revid else None)


def log(con, script, message):
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    con.execute("INSERT INTO log VALUES (?,?,?)", (ts, script, message))
    with open(LOG_PATH, "a") as f:
        f.write(f"{ts}  {script}: {message}\n")
    print(f"{script}: {message}")


# Words that would match nearly every page of any book: numbers, colours and a few
# everyday words. They are never searched for automatically (a card can still cite passages).
NOISE = {"three", "four", "seven", "nine", "twelve", "thirteen", "forty", "red", "white", "black", "gold", "blue",
         "green", "purple", "well", "air", "earth", "water", "fire", "cross", "star", "stars", "heart", "circle",
         "square", "triangle", "door", "key", "crown", "sun", "moon", "mountain", "bridge", "salt", "fish", "dog",
         "horse", "cat", "bear", "fox", "bull"}
# Ordinary words for symbols: matched in any case (and plural), unlike proper names.
GENERIC = {"throne", "cave", "lion", "eagle", "wolf", "dove", "rose", "lily", "oak", "vine", "apple", "fig", "torch",
           "candle", "mask", "anchor", "spiral", "sulfur", "mercury", "bee", "hare", "stag", "swan", "owl", "raven",
           "crane", "frog", "spider", "willow", "ivy", "laurel", "comet", "rainbow", "ladder", "mirror", "skull",
           "chalice", "spindle", "horseshoe", "hourglass", "crossroads", "serpent", "dragon", "phoenix", "lotus",
           "poppy", "cypress", "butterfly", "peacock", "tortoise", "scarab", "unicorn", "griffin", "sphinx",
           "pomegranate", "mistletoe", "mandrake", "labyrinth", "pentagram", "hexagram", "mandala", "cornucopia",
           "olive branch", "cherry blossom", "four-leaf clover", "scales", "wheel", "peach", "dreamcatcher"}


# In fairy tales many everyday things are the symbols (Bluebeard's key, the well, the crown),
# so the tale index leaves them in and only skips numbers, colours and a few words that are
# not nouns often enough ("well") or are too abstract to find by name.
TALE_NOISE = {"three", "four", "seven", "nine", "twelve", "thirteen", "forty", "red", "white", "black", "gold", "blue",
              "green", "purple", "well", "air", "earth", "cross", "circle", "square", "triangle", "heart", "fire",
              "water", "salt", "mercury", "spiral", "comet", "scales"}


def entry_terms(title, aliases, categories, noise=None):
    """(regex, lowercase needle) pairs that find an entry in running text.

    Proper names match case-sensitively, so "Gram" the sword does not match "gram";
    ordinary symbol words ("Mirror", "Apple") match in any case and in the plural;
    numbers, colours and other everyday words are not searched at all."""
    out = []
    for name in [title] + list(aliases):
        name = re.sub(r"\s*\([^)]*\)", "", name).strip()
        low = name.lower()
        stop = NOISE if noise is None else noise
        if low in stop or low.rstrip("s") in stop:
            continue
        generic = GENERIC | (NOISE if noise is not None else set())
        if low in generic or (low.endswith("s") and low[:-1] in generic):
            word = low[:-1] if low.endswith("s") and low[:-1] in generic else low
            out.append((re.compile(rf"\b{re.escape(word)}(?:s|es)?\b", re.I), word))
            continue
        if len(name) < 4 and name != "Om":
            continue
        variants = {name, unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()}
        alts = "|".join(re.escape(v) for v in sorted(variants, key=len, reverse=True) if v)
        out.append((re.compile(rf"(?<![\w-])(?:{alts})(?![\w-])"), "|".join(v.lower() for v in variants if v)))
    return out
