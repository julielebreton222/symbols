#!/bin/sh
# Rebuild everything, in order. Network steps use the caches in .cache/ when present.
#   sh ingest/run_all.sh [path to the fairies repository]
set -e
cd "$(dirname "$0")"
python3 seeds.py              # content/seeds.txt
python3 wiki_lists.py         # Wikipedia list pages (MediaWiki API)
python3 wiki_resolve.py       # each entry's article, summary, Wikidata id
python3 wikidata.py           # structured facts (SPARQL)
python3 images.py             # Commons images, licence checked
python3 reference_books.py    # the seven-book reference dataset
python3 cards.py              # hand-written full cards (content/cards)
python3 connections.py        # owners, stories, themes
python3 pd_books.py           # passages in the public-domain books
python3 tales.py "${1:-../../fairies}"   # tales in the Fairies library
python3 export.py             # data/app/ for the app
