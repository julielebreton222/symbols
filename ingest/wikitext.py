"""Just enough wikitext handling for the list pages: plain text and links."""
import re

LINK = re.compile(r"\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]")


def strip_refs(s):
    s = re.sub(r"<ref[^>/]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    return s


def strip_templates(s):
    # remove {{...}} (nested), keeping the visible text of a few inline templates
    s = re.sub(r"\{\{(?:lang|transl|transliteration|nihongo|script)\|[^|{}]*\|([^|{}]*)(?:\|[^{}]*)?\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{(?:circa|c\.)\|([^{}|]*)\}\}", r"c. \1", s, flags=re.I)
    s = re.sub(r"\{\{(?:anl|ill)\|([^{}|]*)[^{}]*\}\}", r"[[\1]]", s, flags=re.I)
    s = re.sub(r"\{\{color\|[^|{}]*\|([^{}]*)\}\}", r"\1", s, flags=re.I)
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    return s


def links(s):
    """[(target, shown text)] for every [[link]] in s."""
    out = []
    for m in LINK.finditer(s):
        target = m.group(1).strip()
        if not target or ":" in target and target.split(":")[0].lower() in ("file", "image", "category", "wikt", "wiktionary"):
            continue
        out.append((target[0].upper() + target[1:], (m.group(2) or m.group(1)).strip()))
    return out


def plain(s):
    s = strip_templates(strip_refs(s))
    s = re.sub(r"\[\[(?:File|Image|Category):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]", "", s, flags=re.I)
    s = LINK.sub(lambda m: (m.group(2) or m.group(1)), s)
    s = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", s)
    s = re.sub(r"\[https?://\S+\]", "", s)
    s = re.sub(r"'''?", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&nbsp;", " ").replace("&ndash;", "–").replace("&mdash;", "—")
    return re.sub(r"\s+", " ", s).strip()
