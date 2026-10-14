# Symbols: An Encyclopedia of Mythic Objects and Signs

A private learning app for Julie: a large, growing encyclopedia of **mythic objects**,
**symbols** and **sacred & religious signs**, with their myths and origins, their life
through history, how they were seen and argued about, where they appear in tales and
old books, and how they connect. It is also a creative well for writing fiction.

**Open it:** <https://julielebreton222.github.io/symbols/> (on a phone, "Add to Home
Screen" makes it an app that also works offline).

## What is inside

| | |
|---|---|
| Entries | about 1,700, from a hand-made seed list, Wikipedia's lists of mythological objects, magical weapons, religious and mystical symbols and Adinkra symbols, and the seven reference books |
| Full cards | 31 written for this book (Animism, Holy Grail, Excalibur, Mjölnir, Vajra, Caduceus, Rod of Asclepius, Ankh, Lotus, Ouroboros, Yggdrasil, Philosopher's stone, Aegis, Ring of Gyges, Cauldron of the Dagda, Kusanagi, Sampo, Cornucopia, Eye of Horus, Hamsa, Om, Dharmachakra, Star of David, Chi-Rho, Swastika, Phoenix, Pomegranate, Golden Fleece, Seal of Solomon, Lia Fáil, Golden apples of the Hesperides) |
| Every card | overview; the Wikipedia article in brief, section by section; Wikidata facts; what the seven reference books say; the tales it appears in (Fairies library); passages in 42 public-domain books; its journey through places and times; connections; images; sources |
| Explore | browse and search (names, or inside every card), themes, the web of connections, the map, journeys through time, the timeline, the reference library |
| Learn | today's card, spaced-repetition review (SM-2), quizzes, connect the dots, progress |
| My book | notes, favourites, highlights, sightings with photos, dream log (with the books' readings as optional lenses), story seeds in folders for each of your books, your own links between cards, reading tracker, collections, back up and restore |

Everything in **My book** is saved only on the device (IndexedDB). It is never sent
anywhere and never in this repository. Use *Back up* to keep a copy.

## How it is built

```
content/            the hand-made parts (edit these)
  seeds.txt           the seed list, by category and group
  cards/*.md          full cards (format: content/cards/README.md)
  cultures.txt        cultures and traditions, with map positions
  places.txt          gazetteer for tale origins
  themes.txt          themes and their keywords
  theme_members.txt   entries chosen by hand for a theme (added, never removed)
  books.txt           public-domain books (Gutenberg) searched for passages
  reference-books/    the seven-book reference dataset (summaries and pages)
  library.txt         your own PDFs (the PDFs go in library/, never published)
ingest/             re-runnable scripts; each logs what it did to ingest/log.txt
data/symbols.db     the master SQLite database (rebuilt by the scripts)
data/app/           what the app loads (index.json + 32 card files)
index.html, css/, js/, sw.js   the app (plain HTML/CSS/JS, no build step)
```

Rebuild everything (uses the caches in `.cache/` where present):

```
sh ingest/run_all.sh ../fairies     # path to a local copy of the Fairies repository
```

Common jobs:

- **Write or edit a full card:** add `content/cards/<slug>.md`, then `python3 ingest/cards.py && python3 ingest/export.py`.
- **Add a public-domain book:** add a line to `content/books.txt`, then `python3 ingest/pd_books.py && python3 ingest/export.py`.
- **Add your own PDF:** put it in `library/`, describe it in `content/library.txt`, run `python3 ingest/library.py && python3 ingest/export.py`. Cards then show "In my books" with the pages to open.
- **Check links:** `python3 ingest/check_links.py`.
- **Run locally:** `python3 -m http.server 8000` and open <http://localhost:8000>.

## Sources and rights

See **SOURCING.md**. In short: facts are free; Wikipedia text is reused under
CC BY-SA 4.0 with the article and revision credited on every card; Wikidata is CC0;
public-domain books are quoted freely; images come from Wikimedia Commons with their
licences; copyrighted books are summarised in our own words with page references and
at most one short quotation per card; tale texts from the private Fairies library are
never copied here, only their titles and links.
