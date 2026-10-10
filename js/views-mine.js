/* My book: Julie's own notes, highlights, sightings, dreams, story seeds,
 * reading and collections. Saved only on this device (js/store.js). */
(function () {
  const A = window.APP, D = window.DATA, S = window.STORE;
  const { esc, setPage, plural, toast } = A;
  const fmtDate = iso => { try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return iso; } };
  const today = () => new Date().toISOString().slice(0, 10);
  const chipsFor = slugs => (slugs || []).filter(s => D.get(s)).map(s => `<a class="chip" href="#/e/${s}">${esc(D.get(s).t)}</a>`).join('');
  const urls = [];
  const blobURL = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  window.addEventListener('hashchange', () => { while (urls.length) URL.revokeObjectURL(urls.pop()); });

  /* ---------- a picker for linking cards ---------- */
  function picker(el, initial) {
    const chosen = [...(initial || [])];
    el.classList.add('picker');
    el.innerHTML = `<div class="chips sel"></div><input type="search" placeholder="Add a symbol…" style="width:100%"><div class="sugg" hidden></div>`;
    const sel = el.querySelector('.sel'), inp = el.querySelector('input'), sugg = el.querySelector('.sugg');
    const draw = () => { sel.innerHTML = chosen.map(s => `<span class="chip on" data-s="${s}">${esc((D.get(s) || { t: s }).t)} ✕</span>`).join(''); };
    sel.onclick = ev => { const c = ev.target.closest('[data-s]'); if (c) { chosen.splice(chosen.indexOf(c.dataset.s), 1); draw(); } };
    inp.oninput = () => {
      const q = inp.value.trim();
      if (q.length < 2) { sugg.hidden = true; return; }
      const res = A.search(q).filter(e => !chosen.includes(e.s)).slice(0, 12);
      sugg.innerHTML = res.map(e => `<div data-s="${e.s}">${esc(e.t)} <span class="m small">${esc(e.cu.slice(0, 1).join(''))}</span></div>`).join('') || '<div class="m">Nothing found</div>';
      sugg.hidden = false;
    };
    sugg.onclick = ev => { const d = ev.target.closest('[data-s]'); if (d) { chosen.push(d.dataset.s); draw(); inp.value = ''; sugg.hidden = true; inp.focus(); } };
    inp.onblur = () => setTimeout(() => { sugg.hidden = true; }, 200);
    draw();
    return () => chosen.slice();
  }

  A.picker = picker;

  /* ---------- shrink photos before saving ---------- */
  async function shrink(file, max = 1600) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    } catch (e) { return file; }
  }

  /* ---------- her own links between cards ---------- */
  const MY_TYPES = { 'my-link': 'My link', ...D.LINK_TYPES };
  A.register('myLinks', async function (slug, box) {
    if (!box) return;
    const mine = (await S.all('links')).filter(l => (l.slugs || []).includes(slug));
    box.innerHTML = `<h3>My links</h3>
      ${mine.map(l => `<div class="c mylink"><span class="ltype">${esc(MY_TYPES[l.type] || l.type)}</span> ${chipsFor(l.slugs.filter(s => s !== slug))}
        ${l.note ? `<span class="why">${esc(l.note)}</span>` : ''} <button class="btn small" data-del="${l.id}">Remove</button></div>`).join('') || '<p class="m small">None yet: link this card to others that belong with it.</p>'}
      <details><summary class="small">+ Link this card to others</summary>
        <div class="field"><label>Cards to link with it (one or more)</label><div id="lpick"></div></div>
        <div class="row"><select id="ltype">${Object.entries(MY_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
          <input type="text" id="lnote" class="grow" placeholder="Why they belong together"></div>
        <button class="btn primary small" id="lsave">Save link</button></details>`;
    const get = picker(box.querySelector('#lpick'), []);
    box.querySelector('#lsave').onclick = async () => {
      const others = get();
      if (!others.length) { toast('Choose at least one other card'); return; }
      await S.put('links', { id: S.uid(), slugs: [slug, ...others], type: box.querySelector('#ltype').value, note: box.querySelector('#lnote').value.trim(), added: S.now() });
      toast('Link saved'); A.views.myLinks(slug, box);
    };
    for (const b of box.querySelectorAll('[data-del]')) b.onclick = async () => { if (confirm('Remove this link?')) { await S.del('links', b.dataset.del); A.views.myLinks(slug, box); } };
  });

  /* ---------- the box at the end of every card ---------- */
  A.register('mineBox', async function (slug, box) {
    const [note, seed, fav, cols, hls, sights, dreams, projects] = await Promise.all([S.get('notes', slug), S.get('seeds', slug), S.get('favorites', slug),
      S.all('collections'), S.all('highlights'), S.all('sightings'), S.all('dreams'), S.all('projects')]);
    projects.sort((a, b) => a.name.localeCompare(b.name));
    const myH = hls.filter(h => (h.slugs || []).includes(slug)), myS = sights.filter(h => (h.slugs || []).includes(slug)), myD = dreams.filter(h => (h.slugs || []).includes(slug));
    box.innerHTML = `
      <div class="row"><button class="btn small" id="fav">${fav ? '★ A favourite' : '☆ Favourite'}</button>
        <button class="btn small" id="seed">${seed ? '✒ A story seed' : '✒ Mark as a story seed'}</button>
        <select id="col"><option value="">Add to a collection…</option>${cols.map(c => `<option value="${c.id}">${esc(c.name)}${(c.slugs || []).includes(slug) ? ' ✓' : ''}</option>`).join('')}<option value="+">New collection…</option></select></div>
      <div class="field"><label>My notes <span class="saved" id="saved"></span></label><textarea id="note" placeholder="Your thoughts on this card…">${esc(note ? note.text : '')}</textarea></div>
      <div class="field" id="seedbox" ${seed ? '' : 'hidden'}><label>Story seed: how might it live in your fiction?</label><textarea id="seednote">${esc(seed ? seed.notes || '' : '')}</textarea>
        <div class="chips" id="projchips">${projects.map(p => `<button class="chip${seed && (seed.projects || []).includes(p.id) ? ' on' : ''}" data-p="${p.id}">📁 ${esc(p.name)}</button>`).join('')}
        <button class="chip" id="newproj">+ New book</button></div><div class="m small">Put it in one or more of your books.</div></div>
      <div class="row small"><a href="#/mine/highlights?add=${slug}">+ Highlight from a book</a> · <a href="#/mine/sightings?add=${slug}">+ Sighting</a> · <a href="#/mine/dreams?add=${slug}">+ Dream</a></div>
      ${myH.length ? `<h3>My highlights</h3>${myH.map(h => `<blockquote>${esc(h.quote)}<div class="m small">${esc(h.book || '')}${h.page ? ', p. ' + esc(h.page) : ''}</div></blockquote>`).join('')}` : ''}
      ${myS.length ? `<h3>My sightings</h3><div class="gallery">${myS.map(x => `<figure>${x.photo ? `<img src="${blobURL(x.photo)}" alt="">` : ''}<figcaption>${esc(x.place || '')} · ${fmtDate(x.date)}</figcaption></figure>`).join('')}</div>` : ''}
      ${myD.length ? `<h3>In my dreams</h3><ul class="list">${myD.map(d => `<li><a href="#/mine/dreams?open=${d.id}">${esc(d.title || 'A dream')}</a> <span class="m small">${fmtDate(d.date)}</span></li>`).join('')}</ul>` : ''}`;
    let t;
    const saved = box.querySelector('#saved');
    box.querySelector('#note').oninput = ev => {
      clearTimeout(t);
      t = setTimeout(async () => { const text = ev.target.value; if (text.trim()) await S.put('notes', { slug, text, updated: S.now() }); else await S.del('notes', slug); saved.textContent = 'saved'; setTimeout(() => { saved.textContent = ''; }, 1500); }, 500);
    };
    box.querySelector('#seednote').oninput = ev => {
      clearTimeout(t);
      t = setTimeout(async () => { const sd = (await S.get('seeds', slug)) || { slug, projects: [] }; sd.notes = ev.target.value; sd.updated = S.now(); await S.put('seeds', sd); saved.textContent = 'saved'; }, 500);
    };
    for (const b of box.querySelectorAll('[data-p]')) b.onclick = async () => {
      const sd = (await S.get('seeds', slug)) || { slug, notes: '', projects: [] };
      sd.projects = sd.projects || [];
      const i = sd.projects.indexOf(b.dataset.p);
      if (i >= 0) sd.projects.splice(i, 1); else sd.projects.push(b.dataset.p);
      sd.updated = S.now(); await S.put('seeds', sd); b.classList.toggle('on', i < 0);
    };
    box.querySelector('#newproj').onclick = async () => {
      const name = prompt('Name of your book (a novel, a story, a collection…)');
      if (!name) return;
      const id = S.uid(); await S.put('projects', { id, name, about: '', added: S.now() });
      const sd = (await S.get('seeds', slug)) || { slug, notes: '', projects: [] };
      sd.projects = [...(sd.projects || []), id]; sd.updated = S.now(); await S.put('seeds', sd);
      A.views.mineBox(slug, box);
    };
    box.querySelector('#fav').onclick = async ev => {
      if (await S.get('favorites', slug)) { await S.del('favorites', slug); ev.target.textContent = '☆ Favourite'; }
      else { await S.put('favorites', { slug, added: S.now() }); ev.target.textContent = '★ A favourite'; }
    };
    box.querySelector('#seed').onclick = async ev => {
      if (await S.get('seeds', slug)) { await S.del('seeds', slug); ev.target.textContent = '✒ Mark as a story seed'; box.querySelector('#seedbox').hidden = true; }
      else { await S.put('seeds', { slug, notes: '', projects: [], updated: S.now() }); ev.target.textContent = '✒ A story seed'; box.querySelector('#seedbox').hidden = false; }
    };
    box.querySelector('#col').onchange = async ev => {
      let id = ev.target.value;
      if (!id) return;
      if (id === '+') {
        const name = prompt('Name of the new collection');
        if (!name) { ev.target.value = ''; return; }
        id = S.uid(); await S.put('collections', { id, name, about: '', slugs: [slug], updated: S.now() });
        toast(`Added to “${name}”`);
      } else {
        const c = await S.get('collections', id);
        if (!c.slugs.includes(slug)) { c.slugs.push(slug); c.updated = S.now(); await S.put('collections', c); toast(`Added to “${c.name}”`); }
      }
      A.views.mineBox(slug, box);
    };
  });

  /* ---------- My book ---------- */
  const TABS = [['', 'Overview'], ['notes', 'Notes'], ['highlights', 'Highlights'], ['sightings', 'Sightings'], ['dreams', 'Dream log'],
    ['seeds', 'Story seeds'], ['links', 'My links'], ['reading', 'Reading'], ['collections', 'Collections'], ['favorites', 'Favourites'], ['backup', 'Back up']];
  const tabs = cur => `<h1>My book</h1><div class="tabs">${TABS.map(([k, l]) => `<a class="chip${k === cur ? ' on' : ''}" href="#/mine${k ? '/' + k : ''}">${l}</a>`).join('')}</div>`;

  A.register('mine', async function (args, query) {
    const sub = args[0] || '';
    const fn = { notes, highlights, sightings, dreams, seeds, links, reading, collections, favorites, backup }[sub];
    if (fn) return fn(query, args.slice(1));
    const counts = {};
    for (const k of ['notes', 'highlights', 'sightings', 'dreams', 'seeds', 'projects', 'links', 'reading', 'collections', 'favorites', 'seen']) counts[k] = (await S.all(k)).length;
    setPage(tabs('') + `
      <p class="center m">Everything here is yours and is kept only on this device. Back it up from time to time.</p>
      <div class="tiles">
        <a class="tile" href="#/mine/notes"><b>Notes</b><span>${plural(counts.notes, 'card')} with notes</span></a>
        <a class="tile" href="#/mine/highlights"><b>Highlights</b><span>${plural(counts.highlights, 'quote')} from your books</span></a>
        <a class="tile" href="#/mine/sightings"><b>Sightings</b><span>${plural(counts.sightings, 'symbol')} spotted in the world</span></a>
        <a class="tile" href="#/mine/dreams"><b>Dream log</b><span>${plural(counts.dreams, 'dream')}</span></a>
        <a class="tile" href="#/mine/seeds"><b>Story seeds</b><span>${plural(counts.seeds, 'object')} marked for your fiction, in ${plural(counts.projects, 'book')}</span></a>
        <a class="tile" href="#/mine/links"><b>My links</b><span>${plural(counts.links, 'link')} you made between cards</span></a>
        <a class="tile" href="#/mine/reading"><b>Reading</b><span>${plural(counts.reading, 'book')} tracked</span></a>
        <a class="tile" href="#/mine/collections"><b>Collections</b><span>${plural(counts.collections, 'collection')}</span></a>
        <a class="tile" href="#/mine/favorites"><b>Favourites</b><span>${counts.favorites} · tap ☆ on any card</span></a>
        <a class="tile" href="#/mine/backup"><b>Back up &amp; settings</b><span>${plural(counts.seen, 'card')} opened so far</span></a>
      </div>`);
  });

  async function notes() {
    const list = (await S.all('notes')).sort((a, b) => b.updated.localeCompare(a.updated));
    setPage(tabs('notes') + `<div class="leaf">${list.length ? list.map(n => `<div class="item"><b>${A.entryLink(n.slug)}</b> <span class="when">${fmtDate(n.updated)}</span><div style="white-space:pre-wrap">${esc(n.text)}</div></div>`).join('') : '<p class="center m">No notes yet. Every card has a “My notes” box at the end.</p>'}</div>`);
  }

  async function highlights(query) {
    const list = (await S.all('highlights')).sort((a, b) => b.added.localeCompare(a.added));
    const reading = await S.all('reading');
    const titles = [...new Set([...reading.map(r => r.title), ...Object.values(D.meta().refbooks || {}).map(b => b.title)])];
    setPage(tabs('highlights') + `
      <div class="leaf"><h2>Add a highlight</h2>
        <p class="m small">Type in a passage from a book you own, with its page. It stays on this device.</p>
        <div class="field"><label>Quote</label><textarea id="q"></textarea></div>
        <div class="row"><div class="field grow"><label>Book</label><input type="text" id="b" list="booklist" style="width:100%"><datalist id="booklist">${titles.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
          <div class="field"><label>Page</label><input type="text" id="p" size="6"></div></div>
        <div class="field"><label>Your note (optional)</label><input type="text" id="n" style="width:100%"></div>
        <div class="field"><label>Symbols it is about</label><div id="pick"></div></div>
        <button class="btn primary" id="save">Save highlight</button></div>
      <h2 class="orn">Your highlights</h2>
      <div class="leaf">${list.length ? list.map(h => `<div class="item"><blockquote>${esc(h.quote)}</blockquote>
        <div class="m small">${esc(h.book || '')}${h.page ? ', p. ' + esc(h.page) : ''} · ${fmtDate(h.added)} <button class="btn small" data-del="${h.id}">Delete</button></div>
        ${h.note ? `<p>${esc(h.note)}</p>` : ''}<div class="chips">${chipsFor(h.slugs)}</div></div>`).join('') : '<p class="center m">None yet.</p>'}</div>`);
    const get = picker(document.getElementById('pick'), query.get('add') ? [query.get('add')] : []);
    document.getElementById('save').onclick = async () => {
      const quote = document.getElementById('q').value.trim();
      if (!quote) { toast('Type the quote first'); return; }
      await S.put('highlights', { id: S.uid(), quote, book: document.getElementById('b').value.trim(), page: document.getElementById('p').value.trim(),
        note: document.getElementById('n').value.trim(), slugs: get(), added: S.now() });
      toast('Saved'); highlights(new URLSearchParams());
    };
    for (const b of document.querySelectorAll('[data-del]')) b.onclick = async () => { if (confirm('Delete this highlight?')) { await S.del('highlights', b.dataset.del); highlights(new URLSearchParams()); } };
  }

  async function sightings(query) {
    const list = (await S.all('sightings')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    setPage(tabs('sightings') + `
      <div class="leaf"><h2>Record a sighting</h2>
        <div class="field"><label>Photo</label><input type="file" id="ph" accept="image/*" capture="environment"></div>
        <div class="row"><div class="field grow"><label>Where</label><input type="text" id="pl" style="width:100%" placeholder="A church door in Bruges, a logo, a tattoo…"></div>
          <div class="field"><label>When</label><input type="date" id="dt" value="${today()}"></div></div>
        <div class="field"><label>Note</label><textarea id="nt" style="min-height:4rem"></textarea></div>
        <div class="field"><label>Which symbols?</label><div id="pick"></div></div>
        <button class="btn primary" id="save">Save sighting</button></div>
      <h2 class="orn">Your sightings</h2>
      <div class="leaf">${list.length ? list.map(x => `<div class="item">${x.photo ? `<img class="photo" src="${blobURL(x.photo)}" alt="">` : ''}
        <div><b>${esc(x.place || 'Somewhere')}</b> <span class="when">${fmtDate(x.date)}</span> <button class="btn small" data-del="${x.id}">Delete</button></div>
        ${x.note ? `<p>${esc(x.note)}</p>` : ''}<div class="chips">${chipsFor(x.slugs)}</div></div>`).join('') : '<p class="center m">None yet. Spot a symbol out in the world and keep it here.</p>'}</div>`);
    const get = picker(document.getElementById('pick'), query.get('add') ? [query.get('add')] : []);
    document.getElementById('save').onclick = async () => {
      const f = document.getElementById('ph').files[0];
      const photo = f ? await shrink(f) : null;
      await S.put('sightings', { id: S.uid(), photo, place: document.getElementById('pl').value.trim(), date: document.getElementById('dt').value,
        note: document.getElementById('nt').value.trim(), slugs: get(), added: S.now() });
      toast('Saved'); sightings(new URLSearchParams());
    };
    for (const b of document.querySelectorAll('[data-del]')) b.onclick = async () => { if (confirm('Delete this sighting?')) { await S.del('sightings', b.dataset.del); sightings(new URLSearchParams()); } };
  }

  async function dreams(query) {
    const list = (await S.all('dreams')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const open = query.get('open');
    if (open) {
      const d = await S.get('dreams', open);
      if (!d) { location.hash = '#/mine/dreams'; return; }
      // the books' readings, offered as lenses after her own associations
      const lenses = [];
      for (const s of d.slugs || []) {
        const c = await D.card(s), e = D.get(s);
        if (!e) continue;
        const rb = D.meta().refbooks || {};
        lenses.push(`<div class="passage"><div class="where">${A.entryLink(s)}</div>
          ${(c.refs || []).map(r => `<div class="text">${esc(r.sum)} <span class="m small">— ${esc((rb[r.b] || {}).author || r.b)}${r.pp ? ', p. ' + r.pp : ''}</span></div>`).join('') || `<div class="text">${esc(e.o)}</div>`}
          ${e.th.length ? `<div class="chips">${e.th.map(t => `<a class="chip kw" href="#/theme/${t}">${esc((D.meta().themes[t] || {}).name || t)}</a>`).join('')}</div>` : ''}</div>`);
      }
      setPage(tabs('dreams') + `<div class="leaf"><h2>${esc(d.title || 'A dream')}</h2><p class="m">${fmtDate(d.date)}</p>
        <div style="white-space:pre-wrap">${esc(d.text)}</div>
        <h3>What it brings up for me</h3>
        <p class="m small">Your own associations come first: what does each image mean in your life right now?</p>
        <textarea id="assoc" placeholder="It reminded me of…">${esc(d.assoc || '')}</textarea><span class="saved" id="saved"></span>
        ${lenses.length ? `<h3>Lenses from the books</h3><p class="m small">Optional readings from the reference library. They are one writer’s view each, not a diagnosis or a prediction; keep what rings true and leave the rest.</p>${lenses.join('')}` : ''}
        <p><a href="#/mine/dreams">← All dreams</a> · <button class="btn small" id="del">Delete this dream</button></p></div>`);
      let t;
      document.getElementById('assoc').oninput = ev => { clearTimeout(t); t = setTimeout(async () => { d.assoc = ev.target.value; await S.put('dreams', d); document.getElementById('saved').textContent = 'saved'; }, 500); };
      document.getElementById('del').onclick = async () => { if (confirm('Delete this dream?')) { await S.del('dreams', d.id); location.hash = '#/mine/dreams'; } };
      return;
    }
    setPage(tabs('dreams') + `
      <div class="leaf"><h2>Record a dream</h2>
        <div class="row"><div class="field grow"><label>Title</label><input type="text" id="ti" style="width:100%"></div><div class="field"><label>Night of</label><input type="date" id="dt" value="${today()}"></div></div>
        <div class="field"><label>The dream</label><textarea id="tx" style="min-height:9rem"></textarea></div>
        <div class="field"><label>Symbols in it</label><div id="pick"></div></div>
        <button class="btn primary" id="save">Save the dream</button></div>
      <h2 class="orn">Your dreams</h2>
      <div class="leaf">${list.length ? list.map(d => `<div class="item"><a href="#/mine/dreams?open=${d.id}"><b>${esc(d.title || 'A dream')}</b></a> <span class="when">${fmtDate(d.date)}</span>
        <div class="m small">${esc((d.text || '').slice(0, 160))}${(d.text || '').length > 160 ? '…' : ''}</div><div class="chips">${chipsFor(d.slugs)}</div></div>`).join('') : '<p class="center m">No dreams yet.</p>'}</div>`);
    const get = picker(document.getElementById('pick'), query.get('add') ? [query.get('add')] : []);
    document.getElementById('save').onclick = async () => {
      const text = document.getElementById('tx').value.trim();
      if (!text) { toast('Write the dream first'); return; }
      const id = S.uid();
      await S.put('dreams', { id, title: document.getElementById('ti').value.trim(), date: document.getElementById('dt').value, text, slugs: get(), added: S.now() });
      location.hash = '#/mine/dreams?open=' + id;
    };
  }

  async function seeds(query, rest) {
    const [all, projects] = await Promise.all([S.all('seeds'), S.all('projects')]);
    const list = all.filter(sd => D.get(sd.slug)).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    projects.sort((a, b) => a.name.localeCompare(b.name));
    const open = rest && rest[0];
    const proj = open && open !== 'unfiled' ? projects.find(p => p.id === open) : null;
    const shown = open === 'unfiled' ? list.filter(sd => !(sd.projects || []).length) : proj ? list.filter(sd => (sd.projects || []).includes(proj.id)) : list;
    const row = sd => { const e = D.get(sd.slug); return `<div class="item"><b>${A.entryLink(sd.slug)}</b> <span class="m small">${esc(e.cu.slice(0, 2).join(' · '))}</span>
      <div class="chips">${projects.map(p => `<button class="chip${(sd.projects || []).includes(p.id) ? ' on' : ''}" data-s="${sd.slug}" data-p="${p.id}">📁 ${esc(p.name)}</button>`).join('')}</div>
      <div class="m small">${esc(e.o)}</div>${sd.notes ? `<p style="white-space:pre-wrap">${esc(sd.notes)}</p>` : ''}</div>`; };
    setPage(tabs('seeds') + `
      <p class="center m">Objects and symbols marked for your fiction, filed in folders for each of your books. A seed can live in several books. Mark one from the “My notes” box of any card.</p>
      <div class="tiles">
        <a class="tile${!open ? ' on' : ''}" href="#/mine/seeds"><b>All seeds</b><span>${list.length}</span></a>
        ${projects.map(p => `<a class="tile" href="#/mine/seeds/${p.id}"><b>📁 ${esc(p.name)}</b><span>${list.filter(sd => (sd.projects || []).includes(p.id)).length} seeds</span></a>`).join('')}
        <a class="tile" href="#/mine/seeds/unfiled"><b>Not in a book yet</b><span>${list.filter(sd => !(sd.projects || []).length).length}</span></a>
      </div>
      <div class="leaf row"><input type="text" id="pname" class="grow" placeholder="New book (folder) name"><button class="btn primary" id="pnew">Create</button></div>
      ${proj ? `<div class="leaf"><h2>📁 ${esc(proj.name)}</h2>
        <div class="field"><label>About this book</label><textarea id="pabout" style="min-height:3rem">${esc(proj.about || '')}</textarea></div>
        <div class="row"><button class="btn small" id="psave">Save</button><button class="btn small" id="pren">Rename</button><button class="btn small" id="pdel">Delete folder</button>
        <span class="m small">Deleting a folder keeps the seeds.</span></div></div>` : ''}
      <div class="leaf">${shown.length ? shown.map(row).join('') : '<p class="center m">No story seeds here yet.</p>'}</div>
      ${shown.length > 1 ? `<p class="center"><button class="btn" id="spark">Draw three seeds for a story</button></p><div id="sparkbox"></div>` : ''}`);
    document.getElementById('pnew').onclick = async () => {
      const name = document.getElementById('pname').value.trim(); if (!name) return;
      const id = S.uid(); await S.put('projects', { id, name, about: '', added: S.now() }); location.hash = '#/mine/seeds/' + id;
    };
    for (const b of document.querySelectorAll('[data-p][data-s]')) b.onclick = async () => {
      const sd = await S.get('seeds', b.dataset.s); sd.projects = sd.projects || [];
      const i = sd.projects.indexOf(b.dataset.p); if (i >= 0) sd.projects.splice(i, 1); else sd.projects.push(b.dataset.p);
      sd.updated = S.now(); await S.put('seeds', sd); b.classList.toggle('on', i < 0);
    };
    if (proj) {
      document.getElementById('psave').onclick = async () => { proj.about = document.getElementById('pabout').value; await S.put('projects', proj); toast('Saved'); };
      document.getElementById('pren').onclick = async () => { const n = prompt('New name', proj.name); if (n) { proj.name = n; await S.put('projects', proj); seeds(query, rest); } };
      document.getElementById('pdel').onclick = async () => { if (confirm(`Delete the folder “${proj.name}”? The seeds stay.`)) {
        for (const sd of list) if ((sd.projects || []).includes(proj.id)) { sd.projects = sd.projects.filter(x => x !== proj.id); await S.put('seeds', sd); }
        await S.del('projects', proj.id); location.hash = '#/mine/seeds'; } };
    }
    const sp = document.getElementById('spark');
    if (sp) sp.onclick = () => {
      const three = shown.slice().sort(() => Math.random() - .5).slice(0, 3).map(sd => D.get(sd.slug));
      document.getElementById('sparkbox').innerHTML = `<ul class="entries">${three.map(A.entryTile).join('')}</ul><p class="center m">Who carries them, who wants them, and what does it cost?</p>`;
    };
  }

  async function links() {
    const list = (await S.all('links')).sort((a, b) => (b.added || '').localeCompare(a.added || ''));
    setPage(tabs('links') + `
      <div class="leaf"><h2>Make a link</h2><p class="m small">Connect two or more cards in your own way. Your links appear on each card and in the web.</p>
        <div class="field"><label>Cards</label><div id="pick"></div></div>
        <div class="row"><select id="ltype">${Object.entries(MY_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
          <input type="text" id="lnote" class="grow" placeholder="Why they belong together"></div>
        <button class="btn primary" id="save">Save link</button></div>
      <h2 class="orn">Your links</h2>
      <div class="leaf">${list.map(l => `<div class="item"><span class="ltype">${esc(MY_TYPES[l.type] || l.type)}</span> <div class="chips">${chipsFor(l.slugs)}</div>
        ${l.note ? `<p>${esc(l.note)}</p>` : ''}<button class="btn small" data-del="${l.id}">Remove</button></div>`).join('') || '<p class="center m">No links yet.</p>'}</div>
      ${list.length ? '<p class="center"><a class="btn" href="#/graph?mine=1">See your links as a web</a></p>' : ''}`);
    const get = picker(document.getElementById('pick'), []);
    document.getElementById('save').onclick = async () => {
      const slugs = get(); if (slugs.length < 2) { toast('Choose at least two cards'); return; }
      await S.put('links', { id: S.uid(), slugs, type: document.getElementById('ltype').value, note: document.getElementById('lnote').value.trim(), added: S.now() });
      links();
    };
    for (const b of document.querySelectorAll('[data-del]')) b.onclick = async () => { if (confirm('Remove this link?')) { await S.del('links', b.dataset.del); links(); } };
  }

  async function reading() {
    const list = (await S.all('reading')).sort((a, b) => (a.status || '').localeCompare(b.status || '') || a.title.localeCompare(b.title));
    const sugg = [...Object.values(D.meta().refbooks || {}).map(b => [b.title, b.author]), ...Object.values(D.meta().books).map(b => [b.title, b.author || b.translator || ''])];
    const STAT = { reading: 'Reading', 'to-read': 'To read', read: 'Read' };
    setPage(tabs('reading') + `
      <div class="leaf"><h2>Add a book</h2>
        <div class="row"><div class="field grow"><label>Title</label><input type="text" id="ti" list="sugg" style="width:100%"><datalist id="sugg">${sugg.map(([t]) => `<option value="${esc(t)}">`).join('')}</datalist></div>
          <div class="field"><label>Author</label><input type="text" id="au"></div>
          <div class="field"><label>Status</label><select id="st">${Object.entries(STAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
        <div class="field"><label>Cards it relates to</label><div id="pick"></div></div>
        <button class="btn primary" id="save">Add</button></div>
      ${['reading', 'to-read', 'read'].map(st => { const xs = list.filter(b => b.status === st); return xs.length ? `<h2 class="orn">${STAT[st]}</h2><div class="leaf">${xs.map(b => `<div class="item">
        <b><i>${esc(b.title)}</i></b>${b.author ? ', ' + esc(b.author) : ''}
        <select data-st="${b.id}">${Object.entries(STAT).map(([k, v]) => `<option value="${k}"${k === b.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn small" data-del="${b.id}">Remove</button>
        <div class="chips">${chipsFor(b.slugs)}</div>
        <textarea data-notes="${b.id}" placeholder="Notes on this book" style="min-height:3rem">${esc(b.notes || '')}</textarea></div>`).join('')}</div>` : ''; }).join('')}`);
    const get = picker(document.getElementById('pick'), []);
    const ti = document.getElementById('ti');
    ti.onchange = () => { const s = sugg.find(([t]) => t === ti.value); if (s && !document.getElementById('au').value) document.getElementById('au').value = s[1] || ''; };
    document.getElementById('save').onclick = async () => {
      if (!ti.value.trim()) { toast('Title first'); return; }
      await S.put('reading', { id: S.uid(), title: ti.value.trim(), author: document.getElementById('au').value.trim(), status: document.getElementById('st').value, slugs: get(), notes: '', added: S.now() });
      reading();
    };
    for (const s of document.querySelectorAll('[data-st]')) s.onchange = async () => { const b = await S.get('reading', s.dataset.st); b.status = s.value; await S.put('reading', b); reading(); };
    for (const b of document.querySelectorAll('[data-del]')) b.onclick = async () => { if (confirm('Remove this book?')) { await S.del('reading', b.dataset.del); reading(); } };
    for (const t of document.querySelectorAll('[data-notes]')) { let h; t.oninput = () => { clearTimeout(h); h = setTimeout(async () => { const b = await S.get('reading', t.dataset.notes); b.notes = t.value; await S.put('reading', b); }, 500); }; }
  }

  async function collections(query, rest) {
    const id = rest && rest[0];
    if (id) {
      const c = await S.get('collections', id);
      if (!c) { location.hash = '#/mine/collections'; return; }
      setPage(tabs('collections') + `<h2 class="orn">${esc(c.name)}</h2>
        <div class="leaf"><div class="field"><label>About this collection</label><textarea id="ab" style="min-height:3rem">${esc(c.about || '')}</textarea></div>
        <div class="field"><label>Its cards</label><div id="pick"></div></div>
        <div class="row"><button class="btn primary" id="save">Save</button><a class="btn" href="#/mine/collections">Back</a><button class="btn small" id="del">Delete collection</button></div></div>
        <ul class="entries">${(c.slugs || []).filter(s => D.get(s)).map(s => A.entryTile(D.get(s))).join('')}</ul>`, true);
      const get = picker(document.getElementById('pick'), c.slugs);
      document.getElementById('save').onclick = async () => { c.about = document.getElementById('ab').value; c.slugs = get(); c.updated = S.now(); await S.put('collections', c); toast('Saved'); collections(query, rest); };
      document.getElementById('del').onclick = async () => { if (confirm(`Delete “${c.name}”? The cards stay in the book.`)) { await S.del('collections', c.id); location.hash = '#/mine/collections'; } };
      return;
    }
    const list = (await S.all('collections')).sort((a, b) => a.name.localeCompare(b.name));
    setPage(tabs('collections') + `<div class="leaf row"><input type="text" id="nm" placeholder="Name of a new collection" class="grow"><button class="btn primary" id="new">Create</button></div>
      <div class="tiles">${list.map(c => `<a class="tile" href="#/mine/collections/${c.id}"><b>${esc(c.name)}</b><span>${plural((c.slugs || []).length, 'card')}${c.about ? ' · ' + esc(c.about.slice(0, 80)) : ''}</span></a>`).join('') || '<p class="center m">No collections yet.</p>'}</div>`);
    document.getElementById('new').onclick = async () => {
      const name = document.getElementById('nm').value.trim();
      if (!name) return;
      const nid = S.uid(); await S.put('collections', { id: nid, name, about: '', slugs: [], updated: S.now() });
      location.hash = '#/mine/collections/' + nid;
    };
  }

  async function favorites() {
    const list = (await S.all('favorites')).filter(f => D.get(f.slug));
    setPage(tabs('favorites') + `<ul class="entries">${list.map(f => A.entryTile(D.get(f.slug))).join('') || '<p class="center m">No favourites yet.</p>'}</ul>`, true);
  }

  async function backup() {
    const base = await A.fairiesBase();
    setPage(tabs('backup') + `
      <div class="leaf"><h2>Back up</h2>
        <p>Save everything you have written here (notes, highlights, sightings with their photos, dreams, story seeds, reading, collections, reviews) as one file. Keep it somewhere safe, or open it on another device with Restore.</p>
        <button class="btn primary" id="dl">Download a backup</button>
        <h2>Restore</h2><p>Read a backup file. Items in it are added to (or replace) what is here; nothing else is deleted.</p>
        <input type="file" id="up" accept="application/json,.json">
        <h2>Settings</h2>
        <div class="field"><label>Address of your Fairies book (for “In the tales” links)</label><input type="text" id="fb" value="${esc(base)}" style="width:100%"></div>
        <button class="btn" id="savefb">Save</button></div>`);
    document.getElementById('dl').onclick = async () => S.download(await S.backup(), `symbols-backup-${today()}.json`);
    document.getElementById('up').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try { const n = await S.restore(f); toast(`Restored ${n} items`); } catch (e) { toast(e.message); }
    };
    document.getElementById('savefb').onclick = async () => { await S.setSetting('fairiesBase', document.getElementById('fb').value.trim()); toast('Saved'); };
  }
})();
