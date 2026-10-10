"""Polite helpers for the Wikimedia APIs (Wikipedia, Wikidata, Commons).

Every request carries a descriptive User-Agent, waits between calls and backs
off on HTTP 429 / 5xx, as Wikimedia's API etiquette asks.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "SymbolsStudyApp/0.1 (private study app; https://github.com/julielebreton222/symbols)"
WP = "https://en.wikipedia.org/w/api.php"
WD_SPARQL = "https://query.wikidata.org/sparql"
COMMONS = "https://commons.wikimedia.org/w/api.php"
_last = [0.0]


def get(url, params=None, pause=0.6, tries=8, post=False):
    data = None
    if params and post:
        data = urllib.parse.urlencode(params).encode()
    elif params:
        url += "?" + urllib.parse.urlencode(params)
    for attempt in range(tries):
        wait = pause - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/sparql-results+json, application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                ra = e.headers.get("Retry-After")
                time.sleep(max(float(ra) if ra and ra.isdigit() else 0, 2 * (attempt + 1)))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("gave up on " + url[:200])


def wp(**params):
    params.setdefault("format", "json")
    params.setdefault("formatversion", "2")
    return get(WP, params)


def commons(**params):
    params.setdefault("format", "json")
    params.setdefault("formatversion", "2")
    return get(COMMONS, params)


def sparql(query):
    return get(WD_SPARQL, {"query": query}, pause=1.0, post=True)["results"]["bindings"]


def chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]
