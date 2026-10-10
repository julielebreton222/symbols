# Full cards

Each full card is one Markdown file named after the entry's slug (`holy-grail.md`).
`python3 ingest/cards.py` checks and loads them; it stops with a message if a
source key, a linked card or a connection type is unknown.

## Header

```
---
title: Holy Grail
aliases: Grail; Sangreal; San Graal          (also used to find it in the books and tales)
categories: object, sacred
traditions: Christian tradition              (sacred entries: the faith)
cultures: Arthurian legend; Medieval legend
groups: Vessels, food & drink
themes: sacred-vessel, quest, healing        (ids from content/themes.txt, or new ones)
region: Northern France
coords: 48.30, 4.08                          (where it first appears)
first: 1180 | c. 1180–1191, Chrétien de Troyes, *Perceval*   (year for the timeline | label)
wiki: Holy Grail                             (its Wikipedia article)
terms: grail                                 (extra words to find it by)
---
```

## Sections

`## Overview`, `## Myth & Origin`, `## Lifetime` (with `### Ancient`, `### Medieval`,
`### Early modern`, `### Modern`), `## Today`, `## How it was seen` (one `###` per
lens), `## Debates` (one `###` per question, each position a bullet:
`- **Position.** Held by …: …`), `## Article`, `## Go deeper`, `## Connections`, `## Sources`.

- End a paragraph with `[src: key, key]` to label where it comes from.
- `*italic*`, `**bold**`, `[text](https://…)`, `[[slug]]` or `[[slug|text]]` to link a card.
- Write `{unverified}` after a statement that could not be traced to a source.

`## Go deeper` lines: `- kind | text | url` (kind: primary, book, article, museum, film…).

`## Connections` lines: `- type | target-slug | reason | source key`
(types: same-theme, same-owner, same-story, same-culture, evolved-into, derived-from,
mistaken-for, parallel, part-of, related).

`## Sources` lines: `- key | kind | label | url | licence`. `wp` is always the entry's
own Wikipedia article; `wp:Some title` is another Wikipedia article.

## Rules (see SOURCING.md)

Write in our own words. Summarise copyrighted books and credit them; at most one
short quotation per card. Quote public-domain texts freely. Never invent a source.
For living faiths, say what the symbol means to believers today.
