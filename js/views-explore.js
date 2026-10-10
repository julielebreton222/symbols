/* The web of connections, the map and the timeline. */
(function () {
  const A = window.APP, D = window.DATA;
  const { esc, setPage } = A;
  const CAT_COLOR = () => {
    const cs = getComputedStyle(document.documentElement);
    return { object: cs.getPropertyValue('--obj').trim(), symbol: cs.getPropertyValue('--sym').trim(), sacred: cs.getPropertyValue('--sac').trim() };
  };
  const loaded = {};
  function lib(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    return loaded[src];
  }
  const LINK_COLORS = { 'same-theme': '#b8860b', 'same-owner': '#8c2a1b', 'same-story': '#2f6b3a', 'same-culture': '#6a5537',
    'evolved-into': '#6b2d5c', 'derived-from': '#6b2d5c', 'mistaken-for': '#c0392b', 'parallel': '#2f4f7a', 'part-of': '#7f8c8d', 'related': '#a08c6a', 'mine': '#d4005a' };

  /* ---------------- the web ---------------- */
  A.register('graph', async function (args, query) {
    const focus = query.get('focus') || '', theme = query.get('theme') || '', cat = query.get('cat') || '',
      culture = query.get('culture') || '', type = query.get('type') || '', depth = +(query.get('depth') || 1);
    const all = await D.allCards();
    // collect edges once (each is stored on both ends)
    const edges = [], seen = new Set();
    for (const [a, c] of Object.entries(all)) for (const x of c.conn || []) {
      const key = [a, x.to].sort().join('|') + x.type;
      if (seen.has(key) || x.dir !== 'out') continue;
      seen.add(key); edges.push({ a, b: x.to, type: x.type, reason: x.reason, origin: x.origin });
    }
    // her own links, from this device
    const mine = await window.STORE.all('links');
    for (const l of mine) for (let i = 0; i < l.slugs.length; i++) for (let j = i + 1; j < l.slugs.length; j++)
      edges.push({ a: l.slugs[i], b: l.slugs[j], type: 'mine', reason: l.note || 'My link', origin: 'mine' });
    if (query.get('mine')) { const ss = new Set(mine.flatMap(l => l.slugs)); for (const x of edges) if (x.type !== 'mine') x.skip = true; edges.splice(0, edges.length, ...edges.filter(x => !x.skip)); if (!ss.size) edges.length = 0; }
    let nodes;
    const ok = e => e && (!cat || e.c.includes(cat)) && (!culture || e.cu.includes(culture) || (e.tr || []).includes(culture));
    let es = edges.filter(x => !type || x.type === type);
    if (focus) {
      nodes = new Set([focus]);
      for (let i = 0; i < depth; i++) for (const x of es) if (nodes.has(x.a) || nodes.has(x.b)) { nodes.add(x.a); nodes.add(x.b); }
    } else if (theme) {
      nodes = new Set(D.entries().filter(e => e.th.includes(theme)).map(e => e.s));
    } else {
      nodes = new Set(es.flatMap(x => [x.a, x.b]));
    }
    nodes = new Set([...nodes].filter(s => ok(D.get(s)) || s === focus));
    es = es.filter(x => nodes.has(x.a) && nodes.has(x.b));
    const big = nodes.size > 700;
    const link = (k, v) => { const p = new URLSearchParams(query); v ? p.set(k, v) : p.delete(k); return '#/graph?' + p; };
    const themes = Object.entries(D.meta().themes).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const cultures = Object.entries(D.meta().cultures).sort((a, b) => b[1].n - a[1].n).slice(0, 60);
    setPage(`<h1>The web</h1>
      <p class="center m">${focus ? `Everything linked to ${A.entryLink(focus)}${depth > 1 ? `, ${depth} steps out` : ''}.` : theme ? `Entries sharing the theme “${esc((D.meta().themes[theme] || {}).name || theme)}”.` : 'Every connection between entries. Filter it, or open a card and choose “See its web”.'}
        Tap a name to open it.</p>
      <div class="filters leaf">
        <div class="row"><label>Kind</label><select data-k="cat"><option value="">All</option>${Object.entries(D.CATS).map(([k, v]) => `<option value="${k}"${k === cat ? ' selected' : ''}>${v}</option>`).join('')}</select>
          <label>Link</label><select data-k="type"><option value="">All</option>${Object.entries(D.LINK_TYPES).map(([k, v]) => `<option value="${k}"${k === type ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="row"><label>Theme</label><select data-k="theme"><option value="">—</option>${themes.map(([k, t]) => `<option value="${k}"${k === theme ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
          <label>Culture</label><select data-k="culture"><option value="">All</option>${cultures.map(([k]) => `<option${k === culture ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
        ${focus ? `<div class="row"><label>Reach</label>${[1, 2, 3].map(n => `<a class="chip${n === depth ? ' on' : ''}" href="${link('depth', n)}">${n} step${n > 1 ? 's' : ''}</a>`).join('')} <a class="chip" href="${link('focus', '')}">Show everything</a></div>` : ''}
      </div>
      <div class="legend">${Object.entries(D.CATS).map(([k, v]) => `<span><span class="dot" style="background:${CAT_COLOR()[k]}"></span>${v}</span>`).join('')}
        · ${Object.entries(LINK_COLORS).filter(([k]) => es.some(x => x.type === k)).map(([k, c]) => `<span><span class="dot" style="background:${c};border-radius:2px;height:.25rem"></span>${k === 'mine' ? 'My links' : D.LINK_TYPES[k]}</span>`).join('')}</div>
      <p class="m small center">${nodes.size} entries · ${es.length} links${big ? ' · a big web: names appear as you zoom in' : ''}</p>
      <div id="graph" role="img" aria-label="Network of connections"></div>`, true);
    for (const s of document.querySelectorAll('select[data-k]')) s.onchange = () => { location.hash = link(s.dataset.k, s.value); };
    if (!nodes.size) { document.getElementById('graph').innerHTML = '<p class="center m" style="padding:2rem">Nothing to show with these filters.</p>'; return; }
    await lib('js/vendor/cytoscape.min.js');
    const cs = getComputedStyle(document.documentElement), colors = CAT_COLOR();
    const deg = new Map();
    for (const x of es) { deg.set(x.a, (deg.get(x.a) || 0) + 1); deg.set(x.b, (deg.get(x.b) || 0) + 1); }
    const cy = window.cytoscape({
      container: document.getElementById('graph'),
      elements: [
        ...[...nodes].map(s => { const e = D.get(s) || { t: s, c: [] }; return { data: { id: s, label: e.t, color: colors[e.c[0]] || '#999', size: 10 + Math.min(30, (deg.get(s) || 0) * 2), focus: s === focus ? 1 : 0, full: e.st === 'full' ? 1 : 0 } }; }),
        ...es.map((x, i) => ({ data: { id: 'e' + i, source: x.a, target: x.b, color: LINK_COLORS[x.type] || '#aaa', type: x.type } })),
      ],
      style: [
        { selector: 'node', style: { 'background-color': 'data(color)', width: 'data(size)', height: 'data(size)', label: big ? '' : 'data(label)', 'font-size': 9,
          color: cs.getPropertyValue('--ink').trim(), 'text-valign': 'bottom', 'text-margin-y': 2, 'font-family': 'Georgia, serif',
          'text-background-color': cs.getPropertyValue('--page').trim(), 'text-background-opacity': .7, 'text-background-padding': 1, 'min-zoomed-font-size': 7 } },
        { selector: 'node[full = 1]', style: { 'border-width': 2, 'border-color': cs.getPropertyValue('--gold').trim() } },
        { selector: 'node[focus = 1]', style: { 'border-width': 4, 'border-color': cs.getPropertyValue('--rubric').trim(), 'font-size': 13, 'font-weight': 'bold', label: 'data(label)' } },
        { selector: 'edge', style: { width: 1.2, 'line-color': 'data(color)', opacity: .65, 'curve-style': 'haystack' } },
        { selector: '.hl', style: { label: 'data(label)', 'z-index': 10 } },
      ],
      layout: { name: nodes.size > 400 ? 'cose' : 'cose', animate: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 60, numIter: nodes.size > 800 ? 400 : 1000, randomize: true },
      wheelSensitivity: .3, minZoom: .05, maxZoom: 4,
    });
    cy.on('tap', 'node', ev => { location.hash = '#/e/' + ev.target.id(); });
    cy.on('mouseover', 'node', ev => ev.target.addClass('hl'));
    cy.on('mouseout', 'node', ev => ev.target.removeClass('hl'));
    if (big) cy.on('zoom', () => { const z = cy.zoom(); cy.style().selector('node').style('label', z > 1.2 ? 'data(label)' : '').update(); });
  });

  /* ---------------- the map ---------------- */
  const PALETTE = ['#8c2a1b', '#2f4f7a', '#2f6b3a', '#6b2d5c', '#b8860b', '#0f7c7c', '#c0392b', '#5b4636'];
  const yl = y => y == null ? '' : y < 0 ? `${-y} BCE` : `${y}`;
  function journeyLayer(L, map, J, color, label) {
    const group = L.layerGroup().addTo(map), pts = [];
    J.forEach((j, i) => {
      if (!j.ll) return;
      const m = L.circleMarker(j.ll, { radius: j.kind === 'tale' ? 5 : 8, color, weight: 2, fillColor: color, fillOpacity: j.kind === 'tale' ? .35 : .85 });
      m.bindTooltip(`${yl(j.y)} · ${j.place || ''}`, { direction: 'top' });
      m.bindPopup(`<b>${esc(label)}</b><br>${esc(yl(j.y))} · ${esc(j.place || '')}<br>${j.link ? `<a href="${esc(j.link)}"${j.link.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${esc(j.text)}</a>` : esc(j.text)}`);
      m.j = j; m.addTo(group); pts.push(m);
    });
    return { group, pts };
  }
  A.register('miniJourney', async function (el, J) {
    if (!el) return;
    await lib('js/vendor/leaflet.js');
    const L = window.L;
    const map = L.map(el, { scrollWheelZoom: false, worldCopyJump: true }).setView([30, 20], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 10, attribution: '© OpenStreetMap' }).addTo(map);
    const { pts } = journeyLayer(L, map, J, '#8c2a1b', '');
    const line = J.filter(j => j.ll).map(j => j.ll);
    if (line.length > 1) L.polyline(line, { color: '#a57a22', weight: 1.5, opacity: .6, dashArray: '4 4' }).addTo(map);
    if (pts.length) map.fitBounds(L.featureGroup(pts).getBounds().pad(.3), { maxZoom: 5 }); else map.setView([30, 20], 2);
  });

  A.register('map', async function (args, query) {
    const cat = query.get('cat') || '';
    const jsel = (query.get('j') || '').split(',').filter(s => D.get(s));
    const mode = query.has('j') ? 'journeys' : 'all';
    const link = (k, v) => { const p = new URLSearchParams(query); v ? p.set(k, v) : p.delete(k); return '#/map?' + p; };
    if (mode === 'journeys') return journeys(jsel, link);
    const list = D.entries().filter(e => e.ll && (!cat || e.c.includes(cat)));
    setPage(`<h1>The map</h1>
      <div class="tabs"><a class="chip on" href="#/map">Where they come from</a><a class="chip" href="#/map?j=">Journeys through time</a></div>
      <p class="center m">Where each entry comes from. Most points mark the home region of its culture (a ring); a filled dot is a known place. ${list.length.toLocaleString()} entries placed.</p>
      <div class="chips" style="justify-content:center"><a class="chip${!cat ? ' on' : ''}" href="#/map">Everything</a>${Object.entries(D.CATS).map(([k, v]) => `<a class="chip${cat === k ? ' on' : ''}" href="#/map?cat=${k}">${v}</a>`).join('')}</div>
      <div id="map"></div>
      <p class="m small center">Map tiles © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (needs a connection).</p>`, true);
    await lib('js/vendor/leaflet.js');
    const L = window.L, colors = CAT_COLOR();
    const map = L.map('map', { worldCopyJump: true }).setView([30, 20], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '© OpenStreetMap' }).addTo(map);
    const groups = new Map();
    for (const e of list) { const k = e.ll.join(','); (groups.get(k) || groups.set(k, []).get(k)).push(e); }
    for (const [k, es] of groups) {
      const [lat, lon] = k.split(',').map(Number), approx = es.every(e => e.lla);
      const color = colors[es[0].c[0]] || '#888';
      const m = L.circleMarker([lat, lon], { radius: Math.min(26, 5 + Math.sqrt(es.length) * 2.2), color, weight: 2, fillColor: color, fillOpacity: approx ? .12 : .75 }).addTo(map);
      const region = es[0].cu[0] || es[0].tr[0] || '';
      m.bindPopup(`<b>${esc(approx ? region || 'Region' : es[0].t)}</b> <span class="m">(${es.length})</span><div style="max-height:14rem;overflow:auto">${es.sort((a, b) => a.t.localeCompare(b.t)).slice(0, 300).map(e => `<div><a href="#/e/${e.s}">${esc(e.t)}</a> · <a href="#/map?j=${e.s}" title="Its journey">↝</a></div>`).join('')}</div>`);
    }
  });

  async function journeys(sel, link) {
    const fb = await A.fairiesBase();
    setPage(`<h1>Journeys</h1>
      <div class="tabs"><a class="chip" href="#/map">Where they come from</a><a class="chip on" href="#/map?j=">Journeys through time</a></div>
      <p class="center m">Choose symbols and objects, and follow where and when they appear: their first appearance, the places written on their cards, and every tale in the Fairies library that names them. Move the slider or press play to travel through time.</p>
      <div class="leaf"><div class="field"><label>Symbols to follow</label><div id="jpick"></div></div>
        <div class="row"><button class="btn primary small" id="show">Show their journeys</button><button class="btn small" id="favs">Add my favourites</button><button class="btn small" id="clear">Clear</button></div></div>
      <div class="legend" id="jlegend"></div>
      <div class="row" style="justify-content:center"><button class="btn small" id="play">▶ Play</button><input type="range" id="slider" class="grow" style="max-width:36rem"><b id="yr" class="firstline"></b></div>
      <div id="map"></div>
      <h2 class="orn">The timeline</h2><div id="jtl" class="leaf"></div>`, true);
    const get = A.picker(document.getElementById('jpick'), sel);
    const go = list => { location.hash = '#/map?j=' + list.join(','); };
    document.getElementById('show').onclick = () => go(get());
    document.getElementById('clear').onclick = () => go([]);
    document.getElementById('favs').onclick = async () => go([...new Set([...get(), ...(await window.STORE.all('favorites')).map(f => f.slug)])].filter(s => D.get(s)).slice(0, 12));
    await lib('js/vendor/leaflet.js');
    const L = window.L;
    const map = L.map('map', { worldCopyJump: true }).setView([35, 20], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 10, attribution: '© OpenStreetMap' }).addTo(map);
    if (!sel.length) { document.getElementById('jtl').innerHTML = '<p class="center m">Choose one or more symbols above, or add your favourites.</p>'; return; }
    const layers = [], rows = [];
    for (let i = 0; i < sel.length; i++) {
      const s = sel[i], e = D.get(s), c = await D.card(s), color = PALETTE[i % PALETTE.length];
      const J = (c.journey || []).map(j => j.link && j.link.startsWith('#/tale/') ? { ...j, link: fb + '#/c/' + j.link.slice(7) } : j);
      const lay = journeyLayer(L, map, J, color, e.t);
      const line = L.polyline(J.filter(j => j.ll).map(j => j.ll), { color, weight: 1.5, opacity: .5, dashArray: '4 4' }).addTo(map);
      layers.push({ ...lay, line, J, color, e });
      for (const j of J) rows.push({ ...j, e, color });
    }
    document.getElementById('jlegend').innerHTML = layers.map(l => `<span><span class="dot" style="background:${l.color}"></span><a href="#/e/${l.e.s}">${esc(l.e.t)}</a> <span class="m small">(${l.J.length})</span></span>`).join('');
    const all = layers.flatMap(l => l.pts);
    if (all.length) map.fitBounds(L.featureGroup(all).getBounds().pad(.2), { maxZoom: 5 });
    const years = rows.map(r => r.y).filter(y => y != null);
    const slider = document.getElementById('slider'), yr = document.getElementById('yr');
    const lo = Math.min(...years), hi = Math.max(...years);
    slider.min = lo; slider.max = hi; slider.value = hi;
    const apply = () => {
      const t = +slider.value; yr.textContent = 'up to ' + yl(t);
      for (const l of layers) {
        for (const m of l.pts) { const on = m.j.y <= t; if (on && !l.group.hasLayer(m)) l.group.addLayer(m); if (!on && l.group.hasLayer(m)) l.group.removeLayer(m); }
        l.line.setLatLngs(l.J.filter(j => j.ll && j.y <= t).map(j => j.ll));
      }
      for (const li of document.querySelectorAll('#jtl [data-y]')) li.style.opacity = +li.dataset.y <= t ? 1 : .3;
    };
    slider.oninput = apply;
    let timer = null;
    document.getElementById('play').onclick = ev => {
      if (timer) { clearInterval(timer); timer = null; ev.target.textContent = '▶ Play'; return; }
      ev.target.textContent = '❚❚ Pause';
      if (+slider.value >= hi) slider.value = lo;
      const stepYears = Math.max(5, Math.round((hi - lo) / 120));
      timer = setInterval(() => { slider.value = Math.min(hi, +slider.value + stepYears); apply(); if (+slider.value >= hi) { clearInterval(timer); timer = null; ev.target.textContent = '▶ Play'; } }, 120);
    };
    window.addEventListener('hashchange', () => { if (timer) clearInterval(timer); }, { once: true });
    rows.sort((a, b) => a.y - b.y);
    const cent = y => y < 0 ? `${Math.ceil(-y / 100)}00s BCE`.replace(/^(\d+)00s/, (m, c) => `${c}00s`) : `${Math.floor(y / 100) * 100}s`;
    const byC = new Map();
    for (const r of rows) { const k = cent(r.y); (byC.get(k) || byC.set(k, []).get(k)).push(r); }
    document.getElementById('jtl').innerHTML = [...byC].map(([k, rs]) => `<div class="century"><div class="yr">${k}</div><ul class="list">${rs.map(r =>
      `<li data-y="${r.y}"><span class="dot" style="background:${r.color}"></span><b>${esc(yl(r.y))}</b> <a href="#/e/${r.e.s}">${esc(r.e.t)}</a> · <span class="m">${esc(r.place || '')}</span> — ${r.link ? `<a href="${esc(r.link)}"${r.link.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${esc(r.text)}</a>` : esc(r.text)}</li>`).join('')}</ul></div>`).join('');
    document.getElementById('jtl').classList.add('tl');
    apply();
  }

  /* ---------------- the timeline ---------------- */
  A.register('timeline', async function () {
    const dated = D.entries().filter(e => e.y != null).sort((a, b) => a.y - b.y);
    const bucket = y => y < -3000 ? -4000 : y < 0 ? Math.floor(y / 500) * 500 : y < 1000 ? Math.floor(y / 250) * 250 : Math.floor(y / 100) * 100;
    const label = b => b === -4000 ? 'Before 3000 BCE' : b < 0 ? `${-b} BCE` : b === 0 ? '0–250 CE' : b < 1000 ? `${b} CE` : `${b}s`;
    const groups = new Map();
    for (const e of dated) { const b = bucket(e.y); (groups.get(b) || groups.set(b, []).get(b)).push(e); }
    // eras from the full cards' Lifetime sections are on each card; here, first appearances
    setPage(`<h1>The timeline</h1>
      <p class="center m">When each entry first appears, as far as is known. Only ${dated.length} entries have a date so far: every full card has one, and stubs get one as they are written up.</p>
      <div class="tl leaf">${[...groups].map(([b, es]) => `<div class="century"><div class="yr">${label(b)}</div><div class="items">${es.map(e =>
        `<a class="chip" href="#/e/${e.s}" title="${esc(e.y < 0 ? -e.y + ' BCE' : e.y + ' CE')}"><span class="dot" style="background:${CAT_COLOR()[e.c[0]]}"></span>${esc(e.t)}</a>`).join('')}</div></div>`).join('') || '<p class="center m">No dates yet.</p>'}</div>`);
  });
})();
