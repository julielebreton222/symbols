/* Symbols: views and routing. Plain JS, no build step.
 * The explore views (web, map, timeline), learning and My book live in
 * views-explore.js, views-learn.js and views-mine.js and register themselves here. */
window.APP = (function () {
  const D = window.DATA, S = window.STORE;
  const app = () => document.getElementById('app');
  const views = {};
  const FAIRIES_DEFAULT = 'https://julielebreton222.github.io/fairies/';

  /* ---------------- helpers ---------------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[ðđ]/g, 'd').replace(/þ/g, 'th').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/ß/g, 'ss');
  const plural = (n, w, p) => `${n.toLocaleString()} ${n === 1 ? w : (p || w + 's')}`;
  const yearLabel = y => y == null ? '' : (y < 0 ? `${-y} BCE` : (y < 1000 ? `${y} CE` : String(y)));
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  function setPage(html, wide) { app().innerHTML = `<div class="page${wide ? ' wide' : ''}">${html}</div>`; window.scrollTo(0, 0); }
  // linked=false inside tiles, which are links already
  const catBadges = (e, linked = true) => e.c.map(c => linked
    ? `<a class="cat ${c}" href="#/browse?cat=${c}" style="text-decoration:none">${esc(D.CATS[c] || c)}</a>`
    : `<span class="cat ${c}">${esc(D.CATS[c] || c)}</span>`).join(' ');
  const tagLink = t => `<a class="chip kw" href="#/tag/${encodeURIComponent(t)}" title="A theme word used by the reference books">${esc(t.replace(/_/g, ' '))}</a>`;
  const initial = t => esc((t || '?').replace(/^(the|a)\s+/i, '').charAt(0).toUpperCase());
  function entryTile(e) {
    const sub = [...e.cu.slice(0, 2), ...(e.tr || []).filter(t => !e.cu.includes(t)).slice(0, 1)].join(' · ');
    return `<li class="entry"><a class="cover" href="#/e/${e.s}">
      ${e.im ? `<img class="thumb" loading="lazy" alt="" src="${esc(thumb(e.im, 400))}">` : `<div class="thumb none">${initial(e.t)}</div>`}
      <div class="body"><div class="name">${esc(e.t)}</div>
      <div class="sub">${catBadges(e, false)} ${esc(sub)}</div>
      ${e.st === 'full' ? '<div class="full">✦ full card</div>' : ''}
      <div class="blurb">${esc(e.o)}</div></div></a></li>`;
  }
  // Commons thumbnails come in standard widths; ask for a smaller one in lists.
  function thumb(url, w) {
    return url.replace(/\/(\d+)px-([^/]+)$/, (m, px, f) => `/${Math.min(+px, w > 330 ? 500 : 330)}px-${f}`);
  }
  const entryLink = slug => { const e = D.get(slug); return e ? `<a href="#/e/${slug}">${esc(e.t)}</a>` : esc(slug); };
  async function fairiesBase() { return (await S.setting('fairiesBase', FAIRIES_DEFAULT)).replace(/\/?$/, '/'); }

  /* ---------------- search ---------------- */
  let searchIndex = null;
  function buildSearch() {
    searchIndex = D.entries().map(e => ({
      e, t: fold(e.t), a: fold(e.a.join(' | ')), m: fold([...e.cu, ...(e.tr || []), ...(e.ow || []), ...e.g].join(' | ')), o: fold(e.o),
    }));
  }
  function search(q) {
    if (!searchIndex) buildSearch();
    const words = fold(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const x of searchIndex) {
      let score = 0, ok = true;
      for (const w of words) {
        let s = 0;
        if (x.t === w) s = 100; else if (x.t.startsWith(w)) s = 40; else if (x.t.includes(w)) s = 25;
        else if (x.a.includes(w)) s = 18; else if (x.m.includes(w)) s = 8; else if (x.o.includes(w)) s = 4;
        if (!s) { ok = false; break; }
        score += s;
      }
      if (ok) out.push([score + (x.e.st === 'full' ? 3 : 0), x.e]);
    }
    if (fold(q) && searchIndex) for (const r of out) if (r[1].t && fold(r[1].t) === fold(q)) r[0] += 200;
    return out.sort((a, b) => b[0] - a[0] || a[1].t.localeCompare(b[1].t)).map(r => r[1]);
  }
  async function fullTextSearch(q) {
    const words = fold(q).split(/\s+/).filter(w => w.length > 1);
    const cards = await D.allCards();
    const out = [];
    for (const [slug, c] of Object.entries(cards)) {
      const parts = [c.overview, c.list_note, ...Object.values(c.sections || {}).flat().map(s => (s.h || '') + ' ' + s.html.replace(/<[^>]+>/g, ' ')),
        ...(c.passages || []).map(p => p.text), ...(c.tales || []).map(t => t.t), ...(c.refs || []).map(r => r.sum + ' ' + (r.th || []).join(' '))];
      const text = fold(parts.join(' \n '));
      if (words.every(w => text.includes(w))) {
        const i = text.indexOf(words[0]);
        out.push({ slug, hits: words.reduce((n, w) => n + text.split(w).length - 1, 0), at: text.slice(Math.max(0, i - 70), i + 110) });
      }
    }
    return out.sort((a, b) => b.hits - a.hits);
  }

  /* ---------------- home ---------------- */
  async function dailyPick() {
    const today = new Date().toISOString().slice(0, 10);
    const saved = await S.get('meta', 'daily:' + today);
    if (saved && D.get(saved.slug)) return D.get(saved.slug);
    // Rotate the three categories by day; prefer full cards, then stubs with a picture and an overview.
    const seen = new Set((await S.all('seen')).map(x => x.slug));
    const day = Math.floor(Date.now() / 864e5);
    const cat = ['object', 'symbol', 'sacred'][day % 3];
    const pool = D.entries().filter(e => e.c.includes(cat) && !seen.has(e.s) && e.o);
    const rank = e => (e.st === 'full' ? 0 : 2) + (e.im ? 0 : 1);
    pool.sort((a, b) => rank(a) - rank(b));
    const best = pool.filter(e => rank(e) === rank(pool[0] || e));
    const pick = best.length ? best[day % best.length] : D.entries()[day % D.entries().length];
    await S.put('meta', { key: 'daily:' + today, slug: pick.s });
    return pick;
  }
  views.home = async function () {
    const m = D.meta(), e = await dailyPick();
    const reviews = await S.all('reviews');
    const due = reviews.filter(r => r.due <= Date.now()).length;
    const byCat = c => D.entries().filter(x => x.c.includes(c)).length;
    setPage(`
      <h1>Symbols</h1>
      <p class="center m">An encyclopedia of mythic objects, symbols and sacred signs: their stories, their lives through history, how they were seen, and how they connect.</p>
      <div class="stats">
        <span><b>${m.counts.entries.toLocaleString()}</b> entries</span>
        <span><b>${m.counts.full}</b> full cards</span>
        <span><b>${m.counts.links.toLocaleString()}</b> connections</span>
        <span><b>${m.counts.tales.toLocaleString()}</b> tale links</span>
        <span><b>${m.counts.passages.toLocaleString()}</b> old-book passages</span>
        <span><b>${(m.counts.readings || 0).toLocaleString()}</b> readings from 7 books</span>
      </div>
      <h2 class="orn">Today’s card</h2>
      <div class="leaf daily">
        ${e.im ? `<a href="#/e/${e.s}"><img src="${esc(thumb(e.im, 500))}" alt=""></a>` : `<div class="entry"><div class="thumb none" style="height:12rem">${initial(e.t)}</div></div>`}
        <div><div class="row">${catBadges(e)}</div>
          <h2 style="margin:.3rem 0"><a href="#/e/${e.s}" style="text-decoration:none">${esc(e.t)}</a></h2>
          <p class="m">${esc([...e.cu, ...(e.tr || [])].slice(0, 3).join(' · '))}</p>
          <p>${esc(e.o)}</p>
          <a class="btn" href="#/e/${e.s}">Open the card</a></div>
      </div>
      ${due ? `<p class="center"><a class="btn primary" href="#/learn/review">${plural(due, 'card')} to review today</a></p>` : ''}
      <h2 class="orn">The three books</h2>
      <div class="tiles">
        <a class="tile" href="#/browse?cat=object"><b>Mythic Objects</b><span>${byCat('object').toLocaleString()} weapons, cloaks, rings, stones, vessels, ships and trees of myth and legend</span></a>
        <a class="tile" href="#/browse?cat=symbol"><b>Symbols</b><span>${byCat('symbol').toLocaleString()} animals, plants, shapes, numbers, colours, stars and signs</span></a>
        <a class="tile" href="#/browse?cat=sacred"><b>Sacred &amp; Religious</b><span>${byCat('sacred').toLocaleString()} symbols of living and historical faiths, with what they mean to believers today</span></a>
      </div>
      <h2 class="orn">Ways in</h2>
      <div class="tiles">
        <a class="tile" href="#/browse?status=full"><b>The full cards</b><span>Myth, history, interpretations, debates and an essay</span></a>
        <a class="tile" href="#/library"><b>The reference library</b><span>What Cirlot, Eliade, Jung, Campbell, Turner and others say</span></a>
        <a class="tile" href="#/themes"><b>Themes</b><span>Invisibility, kingship, storm weapons, endless wealth…</span></a>
        <a class="tile" href="#/graph"><b>The web</b><span>Every connection, as a map of threads</span></a>
        <a class="tile" href="#/map"><b>The map</b><span>Where each one comes from</span></a>
        <a class="tile" href="#/timeline"><b>The timeline</b><span>From the oldest to the newest</span></a>
        <a class="tile" href="#/learn"><b>Learn</b><span>Reviews, quizzes and connect the dots</span></a>
        <a class="tile" href="#/mine"><b>My book</b><span>Notes, highlights, sightings, dreams and story seeds</span></a>
      </div>`);
  };

  /* ---------------- browse ---------------- */
  const ERAS = [['ancient', 'Ancient (before 500 CE)', y => y < 500], ['medieval', 'Medieval (500–1500)', y => y >= 500 && y < 1500],
    ['early-modern', 'Early modern (1500–1800)', y => y >= 1500 && y < 1800], ['modern', 'Modern (1800 on)', y => y >= 1800]];
  const PER_PAGE = 60;
  views.browse = async function (args, query) {
    const q = query.get('q') || '', cat = query.get('cat') || '', group = query.get('group') || '', culture = query.get('culture') || '',
      theme = query.get('theme') || '', era = query.get('era') || '', status = query.get('status') || '', page = +(query.get('page') || 1);
    let list = q ? search(q) : D.entries().slice();
    if (cat) list = list.filter(e => e.c.includes(cat));
    if (group) list = list.filter(e => e.g.includes(group));
    if (culture) list = list.filter(e => e.cu.includes(culture) || (e.tr || []).includes(culture));
    if (theme) list = list.filter(e => e.th.includes(theme));
    if (era) { const f = ERAS.find(x => x[0] === era); list = list.filter(e => e.y != null && f[2](e.y)); }
    if (status) list = list.filter(e => e.st === status);
    const link = (k, v) => { const p = new URLSearchParams(query); v ? p.set(k, v) : p.delete(k); p.delete('page'); return '#/browse?' + p; };
    const base = cat ? D.entries().filter(e => e.c.includes(cat)) : D.entries();
    const count = key => { const m = new Map(); for (const e of base) for (const v of (key === 'cu' ? [...e.cu, ...(e.tr || [])] : e[key])) m.set(v, (m.get(v) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
    const groups = count('g'), cultures = count('cu'), themes = count('th');
    const sel = (name, cur, items, label) => `<div class="row"><label>${label}</label><select data-k="${name}">
      <option value="">All</option>${items.map(([v, n]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label === 'Theme' ? (D.meta().themes[v] || {}).name || v : v)} (${n})</option>`).join('')}</select></div>`;
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    const shown = list.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const pg = p => { const x = new URLSearchParams(query); x.set('page', p); return '#/browse?' + x; };
    setPage(`
      <h1>${esc(cat ? D.CATS[cat] : q ? 'Search' : 'Browse')}</h1>
      ${q ? `<p class="center">${plural(list.length, 'entry', 'entries')} for “${esc(q)}”. <a href="#/fulltext/${encodeURIComponent(q)}">Search inside every card and passage too</a></p>` : ''}
      <div class="chips" style="justify-content:center">
        <a class="chip${!cat ? ' on' : ''}" href="${link('cat', '')}">Everything</a>
        ${Object.entries(D.CATS).map(([k, v]) => `<a class="chip${cat === k ? ' on' : ''}" href="${link('cat', k)}">${v}</a>`).join('')}
        <a class="chip${status === 'full' ? ' on' : ''}" href="${link('status', status === 'full' ? '' : 'full')}">✦ Full cards only</a>
      </div>
      <div class="filters leaf">
        ${sel('group', group, groups, 'Group')}
        ${sel('culture', culture, cultures, 'Culture')}
        ${sel('theme', theme, themes, 'Theme')}
        <div class="row"><label>Era</label><select data-k="era"><option value="">All</option>${ERAS.map(([k, l]) => `<option value="${k}"${k === era ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <span class="m small">Only entries with a known date</span></div>
      </div>
      <p class="m center">${plural(list.length, 'entry', 'entries')}${pages > 1 ? ` · page ${page} of ${pages}` : ''}</p>
      <ul class="entries">${shown.map(entryTile).join('')}</ul>
      ${pages > 1 ? `<div class="pager">${page > 1 ? `<a class="btn small" href="${pg(page - 1)}">← Previous</a>` : ''}<span class="m">${page} / ${pages}</span>${page < pages ? `<a class="btn small" href="${pg(page + 1)}">Next →</a>` : ''}</div>` : ''}
    `, true);
    for (const s of app().querySelectorAll('select[data-k]')) s.onchange = () => { location.hash = link(s.dataset.k, s.value); };
  };
  views.fulltext = async function (args) {
    const q = decodeURIComponent(args[0] || '');
    setPage(`<h1>Inside the cards</h1><p class="center m">Searching every card, passage and tale title for “${esc(q)}”…</p>`);
    const res = await fullTextSearch(q);
    setPage(`<h1>Inside the cards</h1>
      <p class="center">${plural(res.length, 'card')} mention “${esc(q)}”. <a href="#/browse?q=${encodeURIComponent(q)}">Back to names</a></p>
      <ul class="list leaf">${res.slice(0, 200).map(r => `<li>${entryLink(r.slug)} <span class="m">(${r.hits})</span><div class="m small">…${esc(r.at)}…</div></li>`).join('')}</ul>`);
  };

  /* ---------------- themes ---------------- */
  views.themes = async function () {
    const counts = new Map();
    for (const e of D.entries()) for (const t of e.th) counts.set(t, (counts.get(t) || 0) + 1);
    const th = Object.entries(D.meta().themes).filter(([k]) => counts.get(k)).sort((a, b) => a[1].name.localeCompare(b[1].name));
    setPage(`<h1>Themes</h1>
      <p class="center m">The ideas that run through many cultures. Themes on full cards are chosen by hand; on stubs they are found by keywords in the summary (shown with a dashed border).</p>
      <div class="tiles">${th.map(([k, t]) => `<a class="tile" href="#/theme/${k}"><b>${esc(t.name)}</b><span>${counts.get(k)} entries${t.about ? ' · ' + esc(t.about) : ''}</span></a>`).join('')}</div>`, true);
  };
  views.theme = async function (args) {
    const id = args[0], t = D.meta().themes[id] || { name: id };
    const list = D.entries().filter(e => e.th.includes(id)).sort((a, b) => (a.st === 'full' ? -1 : 0) - (b.st === 'full' ? -1 : 0) || a.t.localeCompare(b.t));
    const cultures = new Map();
    for (const e of list) for (const c of e.cu.slice(0, 1)) cultures.set(c, (cultures.get(c) || 0) + 1);
    setPage(`<h1>${esc(t.name)}</h1><p class="center m">${esc(t.about || '')}</p>
      <p class="center">${plural(list.length, 'entry', 'entries')} across ${plural(cultures.size, 'culture')}. <a href="#/graph?theme=${id}">See them as a web</a></p>
      <ul class="entries">${list.map(entryTile).join('')}</ul>`, true);
  };
  views.culture = async function (args) {
    const name = decodeURIComponent(args[0]);
    location.replace('#/browse?culture=' + encodeURIComponent(name));
  };

  views.tag = async function (args) {
    const t = decodeURIComponent(args[0] || '');
    const list = D.entries().filter(e => (e.rt || []).includes(t));
    setPage(`<h1>${esc(t.replace(/_/g, ' '))}</h1><p class="center m">A theme word the reference books use. ${plural(list.length, 'entry', 'entries')} carry it in at least one book’s reading.</p>
      <ul class="entries">${list.map(entryTile).join('')}</ul>`, true);
  };
  views.owner = async function (args) {
    const o = decodeURIComponent(args[0] || '');
    const list = D.entries().filter(e => (e.ow || []).includes(o));
    const self = D.entries().find(e => fold(e.t) === fold(o));
    setPage(`<h1>${esc(o)}</h1><p class="center m">${plural(list.length, 'thing', 'things')} that belong to ${esc(o)}.${self ? ` See also ${entryLink(self.s)}.` : ''} <a href="#/browse?q=${encodeURIComponent(o)}">Search for “${esc(o)}”</a></p>
      <ul class="entries">${list.map(entryTile).join('')}</ul>`, true);
  };
  views.fact = async function (args) {
    const p = decodeURIComponent(args[0] || ''), v = decodeURIComponent(args[1] || '');
    setPage(`<h1>${esc(v)}</h1><p class="center m">Looking through every card…</p>`, true);
    const cards = await D.allCards();
    const list = Object.entries(cards).filter(([, c]) => (c.facts || []).some(f => f.v === v && (!p || f.p === p))).map(([s]) => D.get(s)).filter(Boolean)
      .sort((a, b) => a.t.localeCompare(b.t));
    setPage(`<h1>${esc(v)}</h1><p class="center m">${plural(list.length, 'entry', 'entries')} where Wikidata gives “${esc(p)}: ${esc(v)}”. <a href="#/browse?q=${encodeURIComponent(v)}">Search for “${esc(v)}”</a></p>
      <ul class="entries">${list.map(entryTile).join('')}</ul>`, true);
  };

  /* ---------------- the card ---------------- */
  const SECTION_ORDER = [['overview', 'Overview'], ['encyclopedia', 'From the encyclopedia'], ['myth', 'Myth & Origin'], ['lifetime', 'Lifetime'], ['journey', 'Journey'], ['today', 'Today'],
    ['seen', 'How it was seen'], ['readings', 'What the books say'], ['debates', 'Debates'], ['article', 'Article'], ['tales', 'In the tales'], ['books', 'In the old books'],
    ['mybooks', 'In my books'], ['deeper', 'Go deeper'], ['connections', 'Connections'], ['images', 'Images'], ['sources', 'Sources'], ['mine', 'My notes']];
  const ERA_NAMES = { ancient: 'Ancient', medieval: 'Medieval', 'early modern': 'Early modern', modern: 'Modern' };

  views.entry = async function (args) {
    const slug = args[0], e = D.get(slug);
    if (!e) { setPage(`<h1>Not found</h1><p class="center">There is no card called “${esc(slug)}”. <a href="#/browse">Browse</a></p>`); return; }
    const c = await D.card(slug);
    S.markSeen(slug);
    const meta = D.meta(), secs = c.sections || {};
    // number the sources in order of first use
    const order = [];
    const use = id => { if (id && c.sources[id] && !order.includes(id)) order.push(id); return order.indexOf(id) + 1; };
    const numbered = html => html.replace(/<sup class="src" data-src="([^"]+)">[^<]*<\/sup>/g, (m, id) => {
      const real = id.replace(/&amp;/g, '&'); const n = use(real);
      return n ? `<sup class="src"><a href="#src-${n}" title="${esc(c.sources[real].label.replace(/<[^>]+>/g, ''))}">${n}</a></sup>` : '';
    });
    const srcRef = id => { const n = use(id); return n ? `<sup class="src"><a href="#src-${n}">${n}</a></sup>` : ''; };
    const block = list => (list || []).map(s => numbered(s.html)).join('\n');
    const parts = {};

    // Overview
    if (secs.overview) parts.overview = block(secs.overview);
    else {
      let o = '';
      if (c.overview) o += `<p>${esc(c.overview)}${srcRef(c.overview_src)}</p>`;
      if (c.list_note) o += `<p>${esc(c.list_note)}${srcRef(c.list_src)}</p>`;
      if (c.wiki && c.wiki.role === 'context') o += `<p class="m">It has no Wikipedia article of its own; it is told of in the article on <a href="${esc(c.wiki.url)}" target="_blank" rel="noopener">${esc(c.wiki.title)}</a>.</p>`;
      o += `<div class="stubnote">Not yet written up as a full card. Below: ${[(c.wiki_secs || []).length ? 'the encyclopedia article in brief' : '', (c.refs || []).length ? 'what the reference books say' : '', e.n[0] ? 'the tales it appears in' : '', e.n[1] ? 'passages from the old books' : '', (c.journey || []).length ? 'its journey across the world' : ''].filter(Boolean).join(', ') || 'its sources'}.</div>`;
      parts.overview = o;
    }
    if (c.facts && c.facts.length) {
      const g = {};
      for (const f of c.facts) (g[f.p] = g[f.p] || []).push(f.v);
      parts.overview += `<h3>Facts</h3><dl class="facts">${Object.entries(g).map(([p, v]) => `<dt>${esc(p)}</dt><dd>${[...new Set(v)].map(x => `<a href="#/fact/${encodeURIComponent(p)}/${encodeURIComponent(x)}">${esc(x)}</a>`).join(', ')}</dd>`).join('')}</dl>
        <div class="srcnote">From Wikidata (CC0)${srcRef('wd:' + c.qid)}</div>`;
    }
    // From the encyclopedia: Wikipedia's article, section by section, trimmed
    if (c.wiki_secs && c.wiki_secs.length) {
      const ws = c.wiki_secs, ctx = ws[0].mode === 'context';
      const paras = t => t.split(/\n\n+/).map(p => `<p>${esc(p)}</p>`).join('');
      parts.encyclopedia = (ctx ? `<p class="m small">It has no article of its own; these passages come from Wikipedia’s article on <a href="${esc(c.wiki.url)}" target="_blank" rel="noopener">${esc(c.wiki.title)}</a>.</p>` : '') +
        ws.map(x => (x.h ? `<h${Math.min(5, x.l + 1)} class="wsec">${esc(x.h)}</h${Math.min(5, x.l + 1)}>` : '') + (x.t ? paras(x.t) : '')).join('') +
        `<div class="srcnote">From Wikipedia (CC BY-SA 4.0), shortened: each section's opening only.${srcRef(ws[0].src)} <a href="${esc(c.wiki.url)}" target="_blank" rel="noopener">Read the whole article ↗</a></div>`;
    }
    // Journey: where and when it appears
    if (c.journey && c.journey.length) {
      const fb = await fairiesBase();
      const J = c.journey.map(j => j.link && j.link.startsWith('#/tale/') ? { ...j, link: fb + '#/c/' + j.link.slice(7) } : j);
      c.journey = J;
      const kinds = { card: '✦', first: '◆', tale: '❦' };
      parts.journey = `<p class="m small">Where and when it appears${J.some(j => j.kind === 'tale') ? ', including the tales of the Fairies library' : ''}. ✦ written on this card · ❦ a tale · ◆ first appearance.</p>
        <div id="minimap" style="height:16rem;border:1px solid var(--line);border-radius:5px;margin:.5rem 0"></div>
        <ul class="list journey">${J.map(j => `<li><b>${esc(yearLabel(j.y))}</b> ${kinds[j.kind] || ''} <span class="m">${esc(j.place || '')}</span> — ${j.link ? `<a href="${esc(j.link)}"${j.link.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${esc(j.text)}</a>` : esc(j.text)}</li>`).join('')}</ul>
        <p class="small"><a href="#/map?j=${slug}">Follow its journey on the big map</a> · compare it with others there.</p>`;
    }
    // Myth & origin
    if (secs.myth || c.first) parts.myth = (c.first ? `<p class="firstline">First appears: ${esc(c.first)}</p>` : '') + block(secs.myth);
    if (secs.lifetime) parts.lifetime = `<div class="lifetime">${secs.lifetime.map(s => `<div class="era"><h3>${esc(ERA_NAMES[(s.h || '').toLowerCase()] || s.h || '')}</h3>${numbered(s.html)}</div>`).join('')}</div>`;
    if (secs.today) parts.today = secs.today.map(s => (s.h ? `<h3>${esc(s.h)}</h3>` : '') + numbered(s.html)).join('');
    if (secs.seen) parts.seen = secs.seen.map(s => `<div class="lens">${s.h ? `<h3>${esc(s.h)}</h3>` : ''}${numbered(s.html)}</div>`).join('');
    if (secs.debates) parts.debates = secs.debates.map(s => s.h ? `<div class="debate"><h3>${esc(s.h)}</h3>${numbered(s.html)}</div>` : numbered(s.html)).join('');
    // What the reference books say: one reading per book, never merged
    if (c.refs && c.refs.length) {
      const rb = meta.refbooks || {};
      const STATUS = { source_attributed_symbolic_reflection: 'symbolic reflection', source_attributed_symbolic_interpretation: 'symbolic interpretation',
        source_attributed_historical_or_iconographic_interpretation: 'historical / iconographic reading', source_attributed_comparative_interpretation: 'comparative reading',
        source_attributed_analytic_concept: 'analytic concept', source_attributed_psychological_theory: 'psychological theory',
        reported_ndembu_ritual_interpretation: 'Ndembu interpretation, as reported by Turner', source_attributed_ritual_description: 'ritual description',
        case_specific_interpretation: 'reading of one case', source_attributed_critical_interpretation: 'critical reading' };
      parts.readings = `<p class="m small">Each reading is one writer’s interpretation, summarised in our own words with its page. They are kept apart because they do not always agree.</p>` +
        c.refs.map(r => { const b = rb[r.b] || {};
          const where = [r.pp ? `p. ${r.pp}` : '', r.pdf ? `PDF p. ${r.pdf}` : ''].filter(Boolean).join(' · ');
          const rel = (r.rel || []).map(x => x.slug && x.slug !== slug ? `<a class="chip" href="#/e/${x.slug}"${x.same_book ? '' : ' title="Read in another book: a suggestion to compare"'}>${esc(x.h)}${x.same_book ? '' : ' ↗'}</a>` : `<span class="chip">${esc(x.h)}</span>`).join('');
          return `<div class="passage reading"><div class="where"><a href="#/library/${r.b}">${b.label || esc(r.b)}</a>${r.who ? ` · ${esc(r.who)}` : ''}</div>
            ${r.h.toLowerCase() !== e.t.toLowerCase() ? `<div class="m small">under “${esc(r.h)}”</div>` : ''}
            <div class="text">${esc(r.sum)}${srcRef('ref:' + r.b)}</div>
            <div class="m small">${esc([where, r.ch, r.sub, STATUS[r.st] || '', r.ctx].filter(Boolean).join(' · '))}</div>
            ${(r.th || []).length ? `<div class="chips">${r.th.map(tagLink).join('')}</div>` : ''}
            ${rel ? `<div class="chips"><span class="m small">See also:</span> ${rel}</div>` : ''}</div>`; }).join('');
    }
    if (secs.article) parts.article = `<div class="article">${block(secs.article)}</div>`;

    // In the tales (the Fairies library)
    if (c.tales && c.tales.length) {
      const base = await fairiesBase();
      const row = t => `<li><a class="t" href="${esc(base)}#/c/${esc(t.p)}/${encodeURIComponent(t.s)}" target="_blank" rel="noopener">${esc(t.t)}</a>
        <span class="m small">${esc([t.o, t.y, t.k].filter(Boolean).join(' · '))}${t.h > 1 ? ` · named ${t.h}×` : ''}</span>
        ${t.x ? `<span class="x">${esc(t.x)}</span>` : ''}</li>`;
      parts.tales = `<p class="m">${plural(c.tales_total, 'tale')} in the Fairies library mention it${c.tales_total > c.tales.length ? ` (the ${c.tales.length} that mention it most are listed)` : ''}. Each opens in the Fairies book.</p>
        <ul class="list tales">${c.tales.slice(0, 12).map(row).join('')}</ul>
        ${c.tales.length > 12 ? `<details><summary class="m">Show all ${c.tales.length}</summary><ul class="list tales">${c.tales.slice(12).map(row).join('')}</ul></details>` : ''}
        <div class="srcnote">Found by name in the tale texts, so a few may only mention it in passing. Tale texts stay in the Fairies book; excerpts are shown only for tales from public-domain books.</div>`;
    }
    // In the old books (public-domain passages)
    if (c.passages && c.passages.length) {
      parts.books = c.passages.map(p => {
        const b = meta.books[p.book] || { title: p.book };
        return `<div class="passage"><div class="where"><i>${esc(b.title)}</i>${b.author ? ', ' + esc(b.author) : ''}${b.translator ? `, tr. ${esc(b.translator)}` : ''}${p.ch && p.ch !== '—' ? ` · ${esc(p.ch)}` : ''}</div>
          <div class="text">${esc(p.text)}</div><a class="small" href="${esc(p.url)}" target="_blank" rel="noopener">Read it in place ↗</a></div>`;
      }).join('') + `<div class="srcnote">Public-domain texts from Project Gutenberg, quoted in full. The link opens the book at this passage.</div>`;
    }
    // In my books: pages in Julie's own copies
    if (c.mybooks && c.mybooks.length) {
      parts.mybooks = c.mybooks.map(m => `<div class="passage"><div class="where"><i>${esc(m.book.title)}</i>${m.book.author ? ', ' + esc(m.book.author) : ''}${m.book.year ? ` (${esc(m.book.year)})` : ''}</div>
        <div>Open your copy at p. ${m.pp.join(', ')} <span class="m small">(PDF p. ${m.pdf.join(', ')}; named ${m.n}×)</span></div>
        ${m.x ? `<div class="text">… ${esc(m.x)} …</div>` : ''}</div>`).join('') + '<div class="srcnote">From your own library (page numbers only for copyrighted books).</div>';
    }
    // Go deeper
    const deeper = (secs.deeper || []).map(d => `<li><span class="kind">${esc(d.h)}</span>${d.html}</li>`);
    if (c.wiki) deeper.push(`<li><span class="kind">encyclopedia</span>Wikipedia, <a href="${esc(c.wiki.url)}" target="_blank" rel="noopener">“${esc(c.wiki.title)}”</a></li>`);
    if (c.qid) deeper.push(`<li><span class="kind">data</span>Wikidata, <a href="https://www.wikidata.org/wiki/${esc(c.qid)}" target="_blank" rel="noopener">${esc(c.qid)}</a></li>`);
    const pbooks = [...new Set((c.passages || []).map(p => p.book))];
    for (const id of pbooks) { const b = meta.books[id]; if (b) deeper.push(`<li><span class="kind">primary text</span>${esc(b.author ? b.author + ', ' : '')}<a href="${esc(b.url)}" target="_blank" rel="noopener"><i>${esc(b.title)}</i></a>${b.translator ? `, tr. ${esc(b.translator)}` : ''} (${b.year < 0 ? -b.year + ' BCE' : b.year})</li>`); }
    deeper.push(`<li><span class="kind">search</span><a href="https://www.metmuseum.org/art/collection/search?q=${encodeURIComponent(e.t)}&showOnly=openAccess" target="_blank" rel="noopener">The Met, open-access objects</a> ·
      <a href="https://www.jstor.org/action/doBasicSearch?Query=${encodeURIComponent('"' + e.t + '"')}" target="_blank" rel="noopener">JSTOR</a> ·
      <a href="https://archive.org/search?query=${encodeURIComponent('"' + e.t + '"')}" target="_blank" rel="noopener">Internet Archive</a> ·
      <a href="https://en.wikisource.org/w/index.php?search=${encodeURIComponent('"' + e.t + '"')}" target="_blank" rel="noopener">Wikisource</a></li>`);
    parts.deeper = `<ul class="deeper">${deeper.join('')}</ul>`;

    // Connections
    const conn = c.conn || [];
    const typed = {};
    for (const x of conn) {
      const label = x.dir === 'in' && D.INVERSE[x.type] ? D.INVERSE[x.type] : x.type;
      (typed[label] = typed[label] || []).push(x);
    }
    let ch = Object.entries(typed).map(([t, xs]) => `<h3>${esc(D.LINK_TYPES[t] || t.replace(/-/g, ' '))}</h3><div class="conn">${xs.map(x =>
      `<div class="c">${entryLink(x.to)} ${x.src ? srcRef(x.src) : ''}<span class="why">${x.reason}</span></div>`).join('')}</div>`).join('');
    // the same theme, chosen by hand on full cards
    const myThemes = (c.themes || []).filter(t => t.by === 'card').map(t => t.id);
    if (myThemes.length) {
      const linked = new Set(conn.map(x => x.to));
      const same = D.entries().filter(x => x.s !== slug && !linked.has(x.s) && x.st === 'full' && x.th.some(t => myThemes.includes(t)));
      if (same.length) ch += `<h3>Shares a theme</h3><div class="chips">${same.slice(0, 16).map(x => `<a class="chip" href="#/e/${x.s}">${esc(x.t)}</a>`).join('')}</div>`;
    }
    parts.connections = ch + `<div id="my-links"></div><p class="small"><a href="#/graph?focus=${slug}">See its web of connections</a></p>`;
    // Images
    if (c.images && c.images.length) parts.images = `<div class="gallery">${c.images.map(im => `<figure><a href="${esc(im.page_url)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(thumb(im.thumb, 330))}" alt="${esc(e.t)}"></a>
      <figcaption>${esc(im.author || 'Unknown author')} · <a href="${esc(im.license_url || im.page_url)}" target="_blank" rel="noopener">${esc(im.license)}</a> · via Wikimedia Commons</figcaption></figure>`).join('')}</div>`;
    // number every remaining source so the list is complete
    for (const id of Object.keys(c.sources)) use(id);
    parts.sources = `<div class="sources"><ol>${order.map((id, i) => { const s = c.sources[id];
      return `<li id="src-${i + 1}">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${s.label}</a>` : s.label}${s.license ? ` <span class="lic">(${esc(s.license)}${s.note ? ', ' + esc(s.note) : ''})</span>` : ''}</li>`; }).join('')}</ol>
      ${e.st === 'full' ? '<p class="srcnote">This card was written for this book in our own words. The numbers point to where each fact can be checked; a fact that could not be traced is marked <span class="unverified">unverified</span>.</p>' : ''}</div>`;
    parts.mine = '<div id="mine-box"><p class="m">Loading your notes…</p></div>';

    const hero = (c.images || [])[0];
    // related at a glance: hand-written and book links first, then the rest
    const rank = { card: 0, book: 1, wikidata: 2, wikipedia: 3 };
    const related = [...new Map((c.conn || []).slice().sort((a, b) => (rank[a.origin] ?? 9) - (rank[b.origin] ?? 9))
      .map(x => [x.to, D.get(x.to)]).filter(([, v]) => v)).values()].slice(0, 12);
    const present = SECTION_ORDER.filter(([k]) => parts[k]);
    setPage(`
      <div class="card-head">
        <div class="cats">${catBadges(e)}${e.st === 'full' ? ' <span class="cat" style="background:var(--gold)">full card</span>' : ''}</div>
        <h1>${esc(e.t)} <button class="star" id="favstar" title="Favourite" aria-label="Favourite">☆</button></h1>
        ${e.a.length ? `<div class="aka">also ${esc(e.a.join(' · '))}</div>` : ''}
        <div class="chips" style="justify-content:center">
          ${[...e.cu, ...(e.tr || []).filter(t => !e.cu.includes(t))].map(x => `<a class="chip" href="#/browse?culture=${encodeURIComponent(x)}">${esc(x)}</a>`).join('')}
          ${(c.themes || []).map(t => `<a class="chip${t.by === 'keyword' ? ' kw' : ''}" title="${t.by === 'keyword' ? 'Found by keyword in the summary' : t.by.startsWith('book:') ? 'A theme the reference books give it' : 'Theme chosen for this card'}" href="#/theme/${t.id}">${esc((meta.themes[t.id] || {}).name || t.id)}</a>`).join('')}
        </div>
        <div class="chips" style="justify-content:center">
          ${(e.ow || []).filter(o => o.toLowerCase() !== e.t.toLowerCase()).map(o => `<a class="chip" href="#/owner/${encodeURIComponent(o)}" title="Everything that belongs to ${esc(o)}">✋ ${esc(o)}</a>`).join('')}
          ${e.g.map(g => `<a class="chip" href="#/browse?group=${encodeURIComponent(g)}" title="Group">${esc(g)}</a>`).join('')}
        </div>
        ${related.length ? `<div class="related"><span class="m small">Related:</span> ${related.map(x => `<a class="chip" href="#/e/${x.s}">${esc(x.t)}</a>`).join('')}</div>` : ''}
      </div>
      ${hero ? `<figure class="hero"><img src="${esc(thumb(hero.thumb, 500))}" alt="${esc(e.t)}"><figcaption>${esc(hero.author || '')} · ${esc(hero.license)} · <a href="${esc(hero.page_url)}" target="_blank" rel="noopener">Wikimedia Commons</a></figcaption></figure>` : ''}
      <nav class="toc">${present.map(([k, l]) => `<a href="#/e/${slug}" data-sec="${k}">${l}</a>`).join(' · ')}</nav>
      <article class="leaf">
        ${present.map(([k, l]) => `<section class="sec" id="sec-${k}"><h2>${l}</h2>${parts[k]}</section>`).join('')}
      </article>`);
    for (const a of app().querySelectorAll('.toc a')) a.onclick = ev => { ev.preventDefault(); document.getElementById('sec-' + a.dataset.sec).scrollIntoView({ behavior: 'smooth' }); };
    for (const a of app().querySelectorAll('sup.src a, a[href^="#src-"]')) a.onclick = ev => { ev.preventDefault(); const t = document.getElementById(a.getAttribute('href').slice(1)); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    if (views.mineBox) views.mineBox(slug, document.getElementById('mine-box'));
    if (views.myLinks) views.myLinks(slug, document.getElementById('my-links'));
    if (views.miniJourney && c.journey && c.journey.length) views.miniJourney(document.getElementById('minimap'), c.journey);
    const star = document.getElementById('favstar');
    const paint = on => { star.textContent = on ? '★' : '☆'; star.classList.toggle('on', !!on); star.title = on ? 'A favourite (tap to remove)' : 'Add to favourites'; };
    paint(await S.get('favorites', slug));
    star.onclick = async () => {
      if (await S.get('favorites', slug)) { await S.del('favorites', slug); paint(false); toast('Removed from favourites'); }
      else { await S.put('favorites', { slug, added: S.now() }); paint(true); toast('Added to favourites'); }
    };
  };

  /* ---------------- about ---------------- */
  views.about = async function () {
    const m = D.meta();
    setPage(`<h1>About this book</h1><div class="leaf">
      <p>This is Julie’s private encyclopedia of symbols, mythic objects and sacred signs. It holds ${m.counts.entries.toLocaleString()} entries; ${m.counts.full} are full cards written for it, and the rest are stubs that are enriched batch by batch.</p>
      <h3>Where everything comes from</h3>
      <ul>
        <li><b>Wikipedia</b> (CC BY-SA 4.0): stub summaries and list notes, each credited to the article and revision it came from.</li>
        <li><b>Wikidata</b> (CC0): owners, works, types, places and dates, and many of the connections.</li>
        <li><b>Public-domain books</b> from Project Gutenberg: ${Object.keys(m.books).length} books, quoted where each entry is named. <a href="#/books">See the list</a>.</li>
        <li><b>Wikimedia Commons</b>: images, each with its author and licence; only freely licensed files are used.</li>
        <li><b>The reference library</b>: seven books on symbols (Cirlot, Eliade, Jung and colleagues, ARAS, Tresidder, Turner, Campbell), distilled into short readings in our own words with their pages. <a href="#/library">See the books</a>.</li>
        <li><b>The Fairies library</b>: links to the tales where a symbol appears (titles and facts only).</li>
        <li><b>Full cards</b> are written in our own words; ideas from copyrighted books are summarised and credited with the page, with at most one short quotation.</li>
      </ul>
      <h3>Your own things</h3>
      <p>Notes, highlights, sightings, dreams, story seeds, reviews and collections are saved only in this browser on this device. Use <a href="#/mine/backup">Back up</a> to keep a copy or move it to another device.</p>
      <p class="m small">Data built ${esc(m.built)}.</p></div>`);
  };
  views.books = async function () {
    const m = D.meta();
    const list = Object.entries(m.books).sort((a, b) => a[1].year - b[1].year);
    setPage(`<h1>The old books</h1><p class="center m">Public-domain texts searched for passages. Every one can be read in full on Project Gutenberg.</p>
      <ul class="list leaf">${list.map(([id, b]) => `<li><a href="${esc(b.url)}" target="_blank" rel="noopener"><i>${esc(b.title)}</i></a>${b.author ? ', ' + esc(b.author) : ''}${b.translator ? `, tr. ${esc(b.translator)}` : ''} <span class="m">(${b.year})</span></li>`).join('')}</ul>`);
  };

  /* ---------------- the reference library ---------------- */
  views.library = async function (args) {
    const rb = D.meta().refbooks || {};
    if (!args[0]) {
      setPage(`<h1>The reference library</h1>
        <p class="center m">Seven books on symbols, distilled into short readings in our own words, each with its page. Their ideas sit side by side on the cards under “What the books say”.</p>
        <div class="tiles">${Object.entries(rb).map(([k, b]) => `<a class="tile" href="#/library/${k}"><b>${esc(b.title)}</b><span>${esc(b.author || '')}${b.year ? ' · ' + b.year : ''} · ${b.count} readings</span></a>`).join('')}</div>
        <p class="center small m">These are selective distillations, not complete books; they do not contain the books’ text or illustrations. Open your own copy at the page given for the full argument.</p>`, true);
      return;
    }
    const k = args[0], b = rb[k];
    if (!b) { setPage('<h1>Not found</h1>'); return; }
    const entries = D.entries().filter(e => (e.rb || []).includes(k)).sort((a, x) => a.t.localeCompare(x.t));
    const bib = b.bib || {};
    const pages = p => p && p.length ? `<span class="m small"> (PDF p. ${p.length > 2 ? p[0] + '–' + p[p.length - 1] : p.join(', ')})</span>` : '';
    setPage(`<h1>${esc(b.title)}</h1><p class="center">${b.label}</p>
      <div class="leaf">
        <dl class="facts">${Object.entries(bib).filter(([kk, v]) => v && !/source_type|pdf_filename|source_document_pages|source_pdf_pages/.test(kk)).map(([kk, v]) => `<dt>${esc(kk.replace(/_/g, ' '))}</dt><dd>${esc(Array.isArray(v) ? v.join(', ') : v)}</dd>`).join('')}</dl>
        ${b.scope && b.scope.interpretation_warning ? `<p class="stubnote">${esc(b.scope.interpretation_warning)}</p>` : ''}
        ${b.framework && b.framework.length ? `<h2>How the book reads symbols</h2><ul>${b.framework.map(f => `<li>${esc(f.principle)}${pages(f.source_pdf_pages)}</li>`).join('')}</ul>` : ''}
        ${b.chapters && b.chapters.length ? `<h2>Chapters</h2>${b.chapters.map(ch => `<h3>${esc(ch.title || ch.id)}${ch.printed_pages ? ` <span class="m small">pp. ${ch.printed_pages.join('–')}</span>` : ''}</h3>
          ${ch.overview ? `<p>${esc(ch.overview)}</p>` : ''}${(ch.ideas || []).length ? `<ul>${ch.ideas.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}`).join('')}` : ''}
      </div>
      <h2 class="orn">Its ${entries.length} headwords</h2>
      <ul class="entries">${entries.map(entryTile).join('')}</ul>`, true);
  };

  /* ---------------- router ---------------- */
  function register(name, fn) { views[name] = fn; }
  async function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const query = new URLSearchParams(qs || '');
    for (const a of document.querySelectorAll('.topnav a')) a.classList.toggle('on', ('#/' + path).startsWith(a.getAttribute('href')));
    const name = { '': 'home', e: 'entry', search: 'browse' }[parts[0] || ''] || parts[0];
    if (parts[0] === 'search') { query.set('q', parts[1] || ''); }
    const fn = views[name];
    try {
      if (fn) await fn(parts.slice(1), query);
      else setPage(`<h1>Not found</h1><p class="center"><a href="#/">Back to the start</a></p>`);
    } catch (err) {
      console.error(err);
      setPage(`<h1>Something went wrong</h1><p class="center m">${esc(err.message)}</p><p class="center"><a href="#/">Back to the start</a></p>`);
    }
  }
  function theme() {
    const btn = document.getElementById('theme');
    let t = null;
    try { t = localStorage.getItem('symbols-theme'); } catch (e) { /* ignore */ }
    if (t) document.documentElement.dataset.theme = t;
    btn.onclick = () => {
      const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('symbols-theme', document.documentElement.dataset.theme); } catch (e) { /* ignore */ }
    };
  }
  async function start() {
    theme();
    const form = document.getElementById('topsearch');
    form.onsubmit = ev => { ev.preventDefault(); const q = form.q.value.trim(); if (q) location.hash = '#/browse?q=' + encodeURIComponent(q); form.q.blur(); };
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    try { await D.load(); }
    catch (err) { setPage(`<h1>The book will not open</h1><p class="center m">Could not load data/app/index.json (${esc(err.message)}). If you opened the file directly, run a local server: <code>python3 -m http.server</code>.</p>`); return; }
    window.addEventListener('hashchange', route);
    route();
  }
  return { tagLink, start, register, esc, fold, plural, toast, setPage, entryTile, entryLink, catBadges, thumb, search, yearLabel, fairiesBase, views, initial, route };
})();
