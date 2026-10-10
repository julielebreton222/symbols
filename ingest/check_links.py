"""Check every web link written in the full cards and the book lists.

Prints the links that do not answer (or answer with an error), so they can be
fixed. Wikipedia and Wikisource links are checked through the MediaWiki API
(politely); other sites with a plain request. Some sites refuse automated
requests (403); those are listed separately rather than treated as broken.

Usage: python3 ingest/check_links.py
"""
import glob
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

import wm
from common import ROOT

URL = re.compile(r"https?://[^\s|)>\]]+")


def wiki_exists(host, title):
    api = f"https://{host}/w/api.php"
    r = wm.get(api, {"action": "query", "titles": title, "redirects": 1, "format": "json", "formatversion": 2})
    p = r.get("query", {}).get("pages", [{}])[0]
    return not p.get("missing") and not p.get("invalid")


def main():
    urls = {}
    for f in glob.glob(os.path.join(ROOT, "content", "cards", "*.md")) + [os.path.join(ROOT, "content", "books.txt")]:
        for u in URL.findall(open(f, encoding="utf-8").read()):
            u = u.rstrip(".,;'\"")
            urls.setdefault(u, set()).add(os.path.basename(f))
    bad, refused = [], []
    for i, (u, where) in enumerate(sorted(urls.items())):
        p = urllib.parse.urlparse(u)
        try:
            if p.netloc in ("en.wikipedia.org", "en.wikisource.org") and p.path.startswith("/wiki/"):
                title = urllib.parse.unquote(p.path[6:]).replace("_", " ")
                ok = wiki_exists(p.netloc, title)
                if not ok:
                    bad.append((u, "no such page", where))
                continue
            if "search" in u or "?q=" in u or "query=" in u:
                continue  # search links always answer
            req = urllib.request.Request(u, method="GET", headers={"User-Agent": wm.UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                r.read(512)
        except urllib.error.HTTPError as e:
            (refused if e.code in (401, 403, 429) else bad).append((u, e.code, where))
        except Exception as e:
            bad.append((u, type(e).__name__, where))
        time.sleep(0.5)
    print(f"{len(urls)} links checked")
    for u, why, where in bad:
        print(f"BROKEN  {why}  {u}  ({', '.join(sorted(where))})")
    for u, why, where in refused:
        print(f"REFUSED {why}  {u}  ({', '.join(sorted(where))})")


if __name__ == "__main__":
    main()
