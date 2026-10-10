-- The master database (data/symbols.db). Built only by the scripts in ingest/,
-- so it can be thrown away and rebuilt at any time. Julie's own notes, dreams,
-- sightings and reviews are NOT here: they live on her device (see js/store.js),
-- because this repository is public.

CREATE TABLE IF NOT EXISTS entries (
  slug          TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  aliases       TEXT DEFAULT '[]',     -- JSON list
  categories    TEXT DEFAULT '[]',     -- JSON: object, symbol, sacred
  groups        TEXT DEFAULT '[]',     -- JSON: "Swords & blades", ...
  traditions    TEXT DEFAULT '[]',     -- JSON: faiths (sacred entries)
  cultures      TEXT DEFAULT '[]',     -- JSON: "Norse mythology", ...
  status        TEXT DEFAULT 'stub',   -- stub | full
  wiki_title    TEXT,                  -- Wikipedia article
  wiki_role     TEXT DEFAULT 'own',    -- own: about this entry | context: about its owner/story
  wiki_revid    INTEGER,
  qid           TEXT,                  -- Wikidata item
  overview      TEXT,                  -- plain text
  overview_src  TEXT,                  -- source id
  list_note     TEXT,                  -- description line from a Wikipedia list
  list_src      TEXT,
  first_year    INTEGER,               -- approx. first appearance (negative = BCE)
  first_label   TEXT,
  region        TEXT,
  lat REAL, lon REAL, geo_src TEXT,
  origin        TEXT,                  -- which script created it
  terms         TEXT DEFAULT '[]'      -- extra words to find it by in texts (from a card's terms: line)
);

CREATE TABLE IF NOT EXISTS sections (     -- full cards (content/cards/*.md)
  slug TEXT, kind TEXT, ord INTEGER, heading TEXT, html TEXT, sources TEXT DEFAULT '[]',
  PRIMARY KEY (slug, kind, ord)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, kind TEXT, label TEXT, url TEXT, license TEXT, note TEXT
);

CREATE TABLE IF NOT EXISTS connections (
  a TEXT, b TEXT, type TEXT, reason TEXT, source TEXT, origin TEXT,
  PRIMARY KEY (a, b, type)
);

CREATE TABLE IF NOT EXISTS themes (id TEXT PRIMARY KEY, name TEXT, about TEXT);
CREATE TABLE IF NOT EXISTS entry_themes (slug TEXT, theme TEXT, source TEXT, PRIMARY KEY (slug, theme));

CREATE TABLE IF NOT EXISTS wikidata_facts (
  slug TEXT, prop TEXT, value TEXT, label TEXT, PRIMARY KEY (slug, prop, value)
);

CREATE TABLE IF NOT EXISTS images (
  slug TEXT, file TEXT, page_url TEXT, thumb TEXT, license TEXT, license_url TEXT,
  author TEXT, credit TEXT, source TEXT, ord INTEGER DEFAULT 0, PRIMARY KEY (slug, file)
);

CREATE TABLE IF NOT EXISTS tale_mentions (   -- from the Fairies library
  slug TEXT, page TEXT, story TEXT, title TEXT, origin TEXT, year INTEGER, kind TEXT,
  hits INTEGER, snippet TEXT, region TEXT, PRIMARY KEY (slug, page, story)
);

CREATE TABLE IF NOT EXISTS journeys (        -- a card's ## Journey: where and when it appears
  slug TEXT, ord INTEGER, year INTEGER, place TEXT, lat REAL, lon REAL, text TEXT, src TEXT,
  PRIMARY KEY (slug, ord)
);

CREATE TABLE IF NOT EXISTS passages (        -- public-domain books
  slug TEXT, book TEXT, chapter TEXT, url TEXT, text TEXT, hits INTEGER,
  PRIMARY KEY (slug, book, chapter)
);

CREATE TABLE IF NOT EXISTS books (           -- public-domain library
  id TEXT PRIMARY KEY, title TEXT, author TEXT, year INTEGER, translator TEXT, url TEXT, license TEXT
);

CREATE TABLE IF NOT EXISTS log (ts TEXT, script TEXT, message TEXT);
