"""Pull structured facts from Wikidata (CC0) for every entry with an item.

Properties (as in the brief): instance of P31, part of P361, owned by P127,
present in work P1441, from narrative universe P1080, religion or worldview P140,
country of origin P495, named after P138, depicts P180. Also: image P18,
coordinates P625, inception P571 and the coordinates of the country of origin
(a rough map position when nothing better is known).

Context articles (an entry's owner or story) are looked up too, so that their
type (a person, a god, a work) can decide the kind of connection later.

Usage: python3 ingest/wikidata.py
"""
import json
import os

import wm
from common import CACHE, db, log, source

PROPS = {"P31": "instance of", "P361": "part of", "P127": "owned by", "P1441": "present in work",
         "P1080": "from narrative universe", "P140": "religion or worldview", "P495": "country of origin",
         "P138": "named after", "P180": "depicts", "P18": "image", "P571": "inception"}
CACHE_FILE = os.path.join(CACHE, "wikidata.json")


def query(qids):
    values = " ".join("wd:" + q for q in qids)
    props = " ".join("wdt:" + p for p in PROPS)
    facts = wm.sparql(f"""
    SELECT ?item ?p ?val ?valLabel WHERE {{
      VALUES ?item {{ {values} }}
      VALUES ?p {{ {props} }}
      ?item ?p ?val .
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}""")
    coords = wm.sparql(f"""
    SELECT ?item ?coord ?ccoord ?country WHERE {{
      VALUES ?item {{ {values} }}
      {{ ?item wdt:P625 ?coord . }} UNION {{ ?item wdt:P495 ?country . ?country wdt:P625 ?ccoord . }}
    }}""")
    out = []
    for b in facts:
        out.append({"item": b["item"], "prop": {"value": b["p"]["value"].rsplit("/", 1)[1]},
                    "val": b["val"], "valLabel": b.get("valLabel", {})})
    for b in coords:
        if "coord" in b:
            out.append({"item": b["item"], "prop": {"value": "P625"}, "coord": b["coord"]})
        else:
            out.append({"item": b["item"], "prop": {"value": "P495"}, "val": b["country"], "ccoord": b["ccoord"]})
    return out


def main():
    con = db()
    cache = json.load(open(CACHE_FILE)) if os.path.exists(CACHE_FILE) else {}
    own = [r["qid"] for r in con.execute("SELECT DISTINCT qid FROM entries WHERE qid IS NOT NULL")]
    pages = json.load(open(os.path.join(CACHE, "wp_pages.json")))
    ctx_titles = {r["wiki_title"] for r in con.execute("SELECT wiki_title FROM entries WHERE wiki_role='context'")}
    ctx = [p["qid"] for t, p in pages.items() if p and p["title"] in ctx_titles and p.get("qid")]
    todo = [q for q in dict.fromkeys(own + ctx) if q not in cache]
    for batch in wm.chunks(todo, 60):
        rows = query(batch)
        for q in batch:
            cache[q] = []
        for b in rows:
            q = b["item"]["value"].rsplit("/", 1)[1]
            fact = {"prop": b["prop"]["value"]}
            if "val" in b:
                v = b["val"]["value"]
                fact["value"] = v.rsplit("/", 1)[1] if v.startswith("http://www.wikidata.org/entity/") else v
                fact["label"] = b.get("valLabel", {}).get("value", "")
            if "coord" in b:
                fact["value"] = b["coord"]["value"]
            if "ccoord" in b:
                fact["ccoord"] = b["ccoord"]["value"]
            cache[q].append(fact)
        json.dump(cache, open(CACHE_FILE, "w"))
        print(f"  … {len(cache)} items")

    def point(wkt):  # "Point(lon lat)"
        lon, lat = wkt[wkt.index("(") + 1:-1].split()
        return float(lat), float(lon)

    con.execute("DELETE FROM wikidata_facts")
    n = 0
    for r in con.execute("SELECT slug, qid, lat FROM entries WHERE qid IS NOT NULL").fetchall():
        src = source(con, "wd:" + r["qid"], "wikidata", f"Wikidata {r['qid']}",
                     f"https://www.wikidata.org/wiki/{r['qid']}", "CC0")
        facts = cache.get(r["qid"], [])
        for f in facts:
            if f["prop"] == "P625":
                if r["lat"] is None:
                    lat, lon = point(f["value"])
                    con.execute("UPDATE entries SET lat=?, lon=?, geo_src=? WHERE slug=?", (lat, lon, src, r["slug"]))
                continue
            if "value" not in f:
                continue
            con.execute("INSERT OR IGNORE INTO wikidata_facts VALUES (?,?,?,?)",
                        (r["slug"], f["prop"], f["value"], f.get("label", "")))
            n += 1
            if f["prop"] == "P571" and f["value"][:1] in "+-0123456789":
                year = int(f["value"].lstrip("+")[:5].split("-")[0] if not f["value"].startswith("-")
                           else "-" + f["value"][1:].split("-")[0])
                con.execute("UPDATE entries SET first_year=?, first_label=? WHERE slug=? AND first_year IS NULL",
                            (year, f"inception (Wikidata): {abs(year)}{' BCE' if year < 0 else ''}", r["slug"]))
        # fall back to the country of origin's position, marked as approximate
        if r["lat"] is None:
            for f in facts:
                if f.get("ccoord"):
                    lat, lon = point(f["ccoord"])
                    con.execute("UPDATE entries SET lat=?, lon=?, geo_src=?, region=COALESCE(region, ?) WHERE slug=? AND lat IS NULL",
                                (lat, lon, src + " (country of origin, approximate)", f.get("label"), r["slug"]))
                    break
    # types of the context articles, used to tell an owner from a story
    con.execute("CREATE TABLE IF NOT EXISTS context_types (wiki_title TEXT, qid TEXT, type_qid TEXT, type_label TEXT)")
    con.execute("DELETE FROM context_types")
    for t, p in pages.items():
        if p and p["title"] in ctx_titles and p.get("qid"):
            for f in cache.get(p["qid"], []):
                if f["prop"] == "P31" and "value" in f:
                    con.execute("INSERT INTO context_types VALUES (?,?,?,?)", (p["title"], p["qid"], f["value"], f.get("label", "")))
    log(con, "wikidata", f"{len(cache)} items fetched, {n} facts stored")
    con.commit()


if __name__ == "__main__":
    main()
