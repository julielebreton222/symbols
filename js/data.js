/* The encyclopedia's data: data/app/index.json (every entry in brief) and the
 * card buckets data/app/cards/NN.json (full detail, fetched when needed). */
window.DATA = (function () {
  let index = null, bySlug = null;
  const buckets = {};
  const CATS = { object: 'Mythic Objects', symbol: 'Symbols', sacred: 'Sacred & Religious' };
  const LINK_TYPES = {
    'same-theme': 'Same theme', 'same-owner': 'Same owner', 'same-story': 'Same story', 'same-culture': 'Same culture',
    'evolved-into': 'Evolved into', 'derived-from': 'Derived from', 'mistaken-for': 'Mistaken for',
    'parallel': 'Parallel across cultures', 'part-of': 'Part of', 'related': 'Related',
  };
  // read a directed link from the point of view of `dir`
  const INVERSE = { 'evolved-into': 'derived-from', 'derived-from': 'evolved-into', 'part-of': 'has part' };

  async function load() {
    if (index) return index;
    const r = await fetch('data/app/index.json');
    index = await r.json();
    bySlug = new Map(index.entries.map(e => [e.s, e]));
    return index;
  }
  // FNV-1a over the slug's UTF-8 bytes, the same as bucket() in ingest/export.py
  function bucketOf(slug, mod) {
    let h = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(slug)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
    return h % mod;
  }
  async function card(slug) {
    await load();
    const b = bucketOf(slug, index.meta.buckets);
    if (!buckets[b]) buckets[b] = fetch(`data/app/cards/${String(b).padStart(2, '0')}.json`).then(r => r.json());
    return (await buckets[b])[slug];
  }
  async function allCards() {
    await load();
    const out = {};
    const parts = await Promise.all([...Array(index.meta.buckets).keys()].map(b => {
      if (!buckets[b]) buckets[b] = fetch(`data/app/cards/${String(b).padStart(2, '0')}.json`).then(r => r.json());
      return buckets[b];
    }));
    for (const p of parts) Object.assign(out, p);
    return out;
  }
  const get = slug => bySlug && bySlug.get(slug);
  return { load, card, allCards, get, CATS, LINK_TYPES, INVERSE, entries: () => index.entries, meta: () => index.meta };
})();
