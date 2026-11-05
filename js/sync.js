/* Sync across my devices.
 *
 * The usual way: Supabase, the same project and the same sign-in as the Fairies book. Every item of
 * My book is one row of the table sync_items, under book = "symbols" (the Fairies rows are "main" and
 * the like, so the two books never mix). Row-level security lets each person see only their own
 * rows. Only what changed travels: new rows come down, changed items go up.
 *
 * The other way (kept for devices that already use it): a private GitHub gist, reached with a key
 * that has only the "gist" permission, like Calm Player.
 *
 * What syncs: everything in My book (notes, favourites, story seeds and book folders, my links,
 * highlights, sightings, dreams, reading, collections, reviews, cards seen, settings). With Supabase,
 * the photos of sightings travel too, made smaller first; with the gist they stay on their device.
 *
 * Two devices are combined item by item: the most recently changed copy of each item wins (every
 * item carries _m, the time it was changed), and a deletion wins over an older copy. */
window.SYNC = (function () {
  'use strict';
  const S = window.STORE;
  const META_KEY = 'symbols-sync';
  const BOOK = 'symbols';
  // The Fairies book's Supabase project. The address and the publishable key are public by design:
  // what protects the rows is the sign-in and the row-level security rule.
  const SUPABASE = { url: 'https://lucnmyzodwzvkfbbfczt.supabase.co', key: 'sb_publishable_4-pRgM5xZEmT2gyYDXppAg_Zxb75J40' };
  const DESC = 'Symbols sync (private)';
  const FILE = 'symbols-data.json';
  const GH = 'https://api.github.com';
  const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Symbols%20sync';

  let meta = readMeta();
  let busy = false, again = false, timer = null, lastRun = 0;
  const listeners = [];

  function readMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; } }
  function writeMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ } }
  const provider = () => meta.sb ? 'supabase' : (meta.token && meta.gistId) ? 'gist' : null;
  const connected = () => !!provider();

  function setStatus(text) {
    meta.status = text; meta.statusAt = Date.now(); writeMeta();
    for (const f of listeners) try { f(text); } catch (e) { /* ignore */ }
  }
  // Don't redraw the page while she is typing.
  function userBusy() {
    const ae = document.activeElement;
    return !!(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && !/^sync-/.test(ae.id));
  }
  const redraw = n => { if (n && !userBusy()) window.dispatchEvent(new HashChangeEvent('hashchange')); };
  const STAMP = it => it._m || 0;

  /* ---------- photos: a smaller copy travels with the sighting ---------- */
  const blobToData = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  async function shrink(blob) {
    try {
      const img = await createImageBitmap(blob);
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.8);
    } catch (e) { return blobToData(blob); }
  }
  async function forRow(it) {
    if (!(it.photo instanceof Blob)) return it;
    return Object.assign({}, it, { photo: { dataURL: await shrink(it.photo) } });
  }
  async function fromRow(it) {
    if (it.photo && it.photo.dataURL) it.photo = await (await fetch(it.photo.dataURL)).blob();
    return it;
  }

  /* ================= Supabase ================= */
  const jwt = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; } };
  function keepSession(s) {
    const p = jwt(s.access_token);
    meta.sb = {
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: +s.expires_at || p.exp || Math.floor(Date.now() / 1000) + (+s.expires_in || 3600),
      user_id: (s.user && s.user.id) || p.sub, email: (s.user && s.user.email) || p.email || meta.email || '',
    };
    writeMeta();
  }
  async function sbRaw(path, opts = {}, tok) {
    let r;
    try {
      r = await fetch(SUPABASE.url + path, Object.assign({ cache: 'no-store' }, opts, {
        headers: Object.assign({ apikey: SUPABASE.key, 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}, opts.headers || {}),
      }));
    } catch (e) { const er = new Error('Could not reach Supabase (are you offline?)'); er.offline = true; throw er; }
    if (!r.ok) {
      let body = {}; try { body = await r.json(); } catch (e) { /* ignore */ }
      const e = new Error(body.msg || body.error_description || body.message || body.error || ('status ' + r.status));
      e.status = r.status; e.code = body.error_code || body.code; throw e;
    }
    return r.status === 204 || r.status === 201 ? null : r.json().catch(() => null);
  }
  async function refresh() {
    if (!meta.sb) throw new Error('Please sign in again.');
    try {
      keepSession(await sbRaw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: meta.sb.refresh_token }) }));
    } catch (e) {
      if (e.offline) throw e;
      delete meta.sb; writeMeta();
      throw new Error('Your sign-in ran out. Please sign in again.');
    }
  }
  async function token() {
    if (!meta.sb) throw new Error('Please sign in again.');
    if (meta.sb.expires_at * 1000 - Date.now() < 120000) await refresh();
    return meta.sb.access_token;
  }
  async function sb(path, opts) {
    try { return await sbRaw(path, opts, await token()); }
    catch (e) { if (e.status !== 401) throw e; await refresh(); return sbRaw(path, opts, meta.sb.access_token); }
  }

  async function signIn(email, password, create) {
    email = email.trim(); meta.email = email; writeMeta();
    const body = JSON.stringify({ email, password });
    let r;
    try {
      r = create ? await sbRaw('/auth/v1/signup', { method: 'POST', body })
        : await sbRaw('/auth/v1/token?grant_type=password', { method: 'POST', body });
    } catch (e) {
      const m = e.message + ' ' + (e.code || '');
      if (/invalid login|invalid_credentials/i.test(m)) throw new Error('That email and password do not match. Use the same ones as in the Fairies book. Never signed in anywhere? Press “Create my account”.');
      if (/already registered|user_already_exists/i.test(m)) throw new Error('You already have an account (from the Fairies book): press “Sign in” instead.');
      if (/not confirmed|email_not_confirmed/i.test(m)) throw new Error('Supabase still wants the email confirmed: tap the link it emailed you, then sign in.');
      if (/password/i.test(e.message) && e.status === 422) throw new Error('Supabase wants a longer password (at least 6 characters).');
      throw e;
    }
    if (!r || !r.access_token) throw new Error('Account made, but Supabase wants the email confirmed first: tap the link in the email it sent, then sign in.');
    // switching from the gist: what is here goes up to Supabase
    delete meta.token; delete meta.gistId;
    meta.pushed = {}; meta.cursor = null;
    keepSession(r);
    await sync('connect');
    if (/^Couldn/.test(meta.status || '')) throw new Error(meta.status.replace(/^Couldn’t sync: /, ''));
    setStatus('Signed in and synced.');
  }

  const PAGE = 500;
  async function sbSync() {
    let changedHere = 0;
    const enc = encodeURIComponent, pushed = meta.pushed || (meta.pushed = {});
    const tomb = S.tombs();
    // what this device has
    const local = {};
    for (const name of Object.keys(S.STORES)) {
      local[name] = {};
      for (const it of await S.all(name)) local[name][String(it[S.STORES[name]])] = it;
    }
    // 1. bring down what changed elsewhere (with a little overlap, so nothing slips between two clocks)
    const since = meta.cursor ? new Date(Date.parse(meta.cursor) - 15000).toISOString() : '1970-01-01T00:00:00Z';
    let newest = meta.cursor || since;
    for (let off = 0; ; off += PAGE) {
      const rows = await sb(`/rest/v1/sync_items?select=store,key,data,updated,deleted,changed_at&book=eq.${BOOK}&changed_at=gte.${enc(since)}&order=changed_at.asc,store.asc,key.asc&limit=${PAGE}&offset=${off}`) || [];
      for (const row of rows) {
        if (Date.parse(row.changed_at) > Date.parse(newest)) newest = row.changed_at;
        if (!S.STORES[row.store]) continue;
        const k = row.store + '|' + row.key, mine = local[row.store][row.key], u = +row.updated || 0;
        if (row.deleted) {
          if (mine && STAMP(mine) <= u) { await S.delRaw(row.store, mine[S.STORES[row.store]]); delete local[row.store][row.key]; changedHere++; }
          tomb[k] = Math.max(tomb[k] || 0, u);
        } else if (!((tomb[k] || 0) >= u && !mine) && (!mine || STAMP(mine) < u)) {
          const it = await fromRow(JSON.parse(row.data));
          await S.putRaw(row.store, it); local[row.store][row.key] = it; delete tomb[k]; changedHere++;
        }
        pushed[k] = Math.max(pushed[k] || 0, u);
      }
      if (rows.length < PAGE) break;
    }
    meta.cursor = newest;
    // 2. send up what changed here (the first time, that is everything)
    const out = [];
    for (const name of Object.keys(S.STORES)) {
      for (const [key, it] of Object.entries(local[name])) {
        const k = name + '|' + key;
        if (pushed[k] === undefined || STAMP(it) > pushed[k]) {
          out.push({ k, row: { user_id: meta.sb.user_id, book: BOOK, store: name, key, data: JSON.stringify(await forRow(it)), updated: STAMP(it), deleted: false } });
        }
      }
    }
    const cutoff = Date.now() - 365 * 864e5;
    for (const [k, t] of Object.entries(tomb)) {
      if (t < cutoff) { delete tomb[k]; continue; }
      const i = k.indexOf('|'), name = k.slice(0, i), key = k.slice(i + 1);
      if (!S.STORES[name] || local[name][key]) continue;
      if (pushed[k] === undefined || t > pushed[k]) out.push({ k, row: { user_id: meta.sb.user_id, book: BOOK, store: name, key, data: null, updated: t, deleted: true } });
    }
    S.setTombs(tomb);
    // photos make rows big: send fewer at a time
    for (let i = 0; i < out.length;) {
      const part = [];
      let size = 0;
      while (i < out.length && part.length < 100 && (size < 2e6 || !part.length)) { size += (out[i].row.data || '').length; part.push(out[i++]); }
      await sb('/rest/v1/sync_items?on_conflict=user_id,book,store,key', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(part.map(x => x.row)),
      });
      for (const x of part) pushed[x.k] = x.row.updated;
      writeMeta();
    }
    writeMeta();
    return changedHere;
  }

  /* ================= GitHub gist (the other way) ================= */
  function gh(path, opts) {
    return fetch(GH + path, Object.assign({ cache: 'no-store' }, opts, {
      headers: { Authorization: 'Bearer ' + meta.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    })).then(r => {
      if (r.status === 401) throw new Error('GitHub refused the key. Make a new one with the “gist” permission.');
      if (r.status === 404) throw new Error('not-found');
      if (!r.ok) throw new Error('GitHub said ' + r.status);
      return r.status === 204 ? null : r.json();
    });
  }
  async function bundle() {
    const stores = {};
    for (const name of Object.keys(S.STORES)) {
      stores[name] = (await S.all(name)).map(it => {
        if (it.photo === undefined) return it;
        const c = Object.assign({}, it);
        delete c.photo;
        c.hasPhoto = true;
        return c;
      });
    }
    return { app: 'symbols', v: 1, stores, deleted: S.tombs() };
  }
  function merge(a, b) {
    const deleted = Object.assign({}, b.deleted || {});
    for (const [k, t] of Object.entries(a.deleted || {})) if (!(deleted[k] >= t)) deleted[k] = t;
    const stores = {};
    for (const name of Object.keys(S.STORES)) {
      const key = S.STORES[name], m = new Map();
      for (const it of (b.stores || {})[name] || []) m.set(String(it[key]), it);
      for (const it of (a.stores || {})[name] || []) {
        const o = m.get(String(it[key]));
        if (!o || STAMP(it) >= STAMP(o)) m.set(String(it[key]), it);
      }
      stores[name] = [...m.values()].filter(it => !(deleted[name + '|' + it[key]] >= STAMP(it)))
        .sort((x, y) => String(x[key]).localeCompare(String(y[key])));
    }
    return { app: 'symbols', v: 1, stores, deleted };
  }
  const strip = it => { const c = Object.assign({}, it); delete c.hasPhoto; delete c.photo; return JSON.stringify(c); };
  const sameData = (x, y) => JSON.stringify(x.stores) === JSON.stringify(y.stores) && JSON.stringify(x.deleted || {}) === JSON.stringify(y.deleted || {});
  async function apply(merged, local) {
    let n = 0;
    for (const name of Object.keys(S.STORES)) {
      const key = S.STORES[name];
      const here = new Map(((local.stores || {})[name] || []).map(it => [String(it[key]), it]));
      const keep = new Set();
      for (const it of merged.stores[name] || []) {
        const k = String(it[key]); keep.add(k);
        const h = here.get(k);
        if (h && strip(h) === strip(it)) continue;
        const val = Object.assign({}, it); delete val.hasPhoto;
        if (h && h.hasPhoto) { const full = await S.get(name, it[key]); if (full && full.photo) val.photo = full.photo; }
        await S.putRaw(name, val); n++;
      }
      for (const [k, h] of here) if (!keep.has(k)) { await S.delRaw(name, h[key]); n++; }
    }
    S.setTombs(merged.deleted || {});
    return n;
  }
  function readGist() {
    return gh('/gists/' + meta.gistId).then(g => {
      const f = g.files && g.files[FILE];
      if (!f) return null;
      if (!f.truncated) return JSON.parse(f.content || 'null');
      return fetch(f.raw_url, { cache: 'no-store' }).then(r => r.json());
    });
  }
  const writeGist = data => gh('/gists/' + meta.gistId, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(data) } } }) });
  async function gistSync() {
    const remote = await readGist();
    const local = await bundle();
    if (!remote || !remote.stores) { await writeGist(local); return 0; }
    const merged = merge(local, remote);
    if (!sameData(merged, remote)) await writeGist(merged);
    return apply(merged, local);
  }
  async function gistConnect(tok) {
    meta = { token: tok.trim() }; writeMeta();
    setStatus('Connecting…');
    try {
      const list = await gh('/gists?per_page=100');
      const found = (list || []).find(g => g.description === DESC && g.files && g.files[FILE]);
      if (found) {
        meta.gistId = found.id; writeMeta();
        await sync('connect');
        if (/^Couldn/.test(meta.status)) throw new Error(meta.status.replace(/^Couldn’t sync: /, ''));
        setStatus('Connected. Combined with what your other devices saved.');
      } else {
        const data = await bundle();
        const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(data) } } }) });
        meta.gistId = g.id; meta.lastSynced = Date.now(); writeMeta();
        setStatus('Connected. This is the first device, and everything is saved.');
      }
    } catch (e) {
      meta = { status: 'Couldn’t connect: ' + e.message }; writeMeta();
      setStatus(meta.status);
      throw e;
    }
  }

  /* ---------- syncing ---------- */
  async function sync(reason) {
    if (!connected() || !navigator.onLine) return;
    if (busy) { again = true; return; }
    busy = true; lastRun = Date.now();
    try {
      const n = provider() === 'supabase' ? await sbSync() : await gistSync();
      redraw(n);
      meta.lastSynced = Date.now(); meta.dirty = false; writeMeta();
      setStatus('Synced');
    } catch (e) {
      if (e.message === 'not-found') { delete meta.gistId; writeMeta(); setStatus('The sync gist was deleted. Connect again.'); }
      else if (/sync_items|relation|schema cache|PGRST205|42P01/i.test(e.message + ' ' + (e.code || ''))) setStatus('Couldn’t sync: the sync table is missing from the Supabase project (the Fairies book makes it).');
      else setStatus('Couldn’t sync: ' + e.message);
    } finally {
      busy = false;
      if (again) { again = false; schedule(1500); }
    }
  }
  function schedule(ms) {
    if (!connected()) return;
    clearTimeout(timer);
    timer = setTimeout(() => sync('change'), ms);
  }
  function disconnect() {
    if (meta.sb) sbRaw('/auth/v1/logout', { method: 'POST' }, meta.sb.access_token).catch(() => {});
    meta = { email: meta.email }; writeMeta();
    setStatus('Not syncing on this device');
  }

  S.onChange(() => { meta.dirty = true; writeMeta(); schedule(provider() === 'supabase' ? 2000 : 4000); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (Date.now() - lastRun > 30000) sync('focus'); }
    else if (meta.dirty) sync('leave');
  });
  window.addEventListener('online', () => sync('online'));
  // Supabase is light enough to look for news every minute while the app is open.
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const every = provider() === 'supabase' ? 55000 : 115000;
    if (Date.now() - lastRun > every) sync('timer');
  }, 60000);
  setTimeout(() => sync('open'), 1500);

  /* ---------- the panel in My book ---------- */
  function ago(t) {
    if (!t) return '';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString();
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const statusLine = () => esc(meta.status || '') + (connected() && meta.lastSynced ? ' · last synced ' + ago(meta.lastSynced) : '');

  function panel(box) {
    const p = provider();
    if (p) {
      box.innerHTML = `<p><b>This device is syncing</b> ${p === 'supabase' ? `through Supabase, signed in as <b>${esc(meta.sb.email || 'you')}</b>` : 'through a private GitHub gist'}.</p>
        <p class="m small" id="sync-status">${statusLine()}</p>
        <p>Everything in My book appears on every device you sign in on: when you open the app, a moment after each change${p === 'supabase' ? ', every minute while the app is open,' : ''} and when you come back to it.
        ${p === 'supabase' ? 'Photos of sightings travel too, in a smaller copy.' : 'Photos of sightings stay on the device that took them (Back up saves them).'}</p>
        <p><button class="btn primary" id="sync-now">Sync now</button> <button class="btn" id="sync-off">${p === 'supabase' ? 'Sign this device out' : 'Stop syncing on this device'}</button></p>
        ${p === 'gist' ? `<p><button class="btn" id="sync-tosb">Switch this device to Supabase</button><br><span class="m small">The same sign-in as the Fairies book. What is here goes up to Supabase when you sign in.</span></p>` : ''}`;
      box.querySelector('#sync-now').onclick = async () => { await sync('manual'); panel(box); };
      box.querySelector('#sync-off').onclick = () => { if (confirm('Stop syncing on this device? Everything stays here.')) { disconnect(); panel(box); } };
      const tosb = box.querySelector('#sync-tosb');
      if (tosb) tosb.onclick = () => { disconnect(); panel(box); };
      return;
    }
    box.innerHTML = `<p>Keep My book the same on your phone, laptop and any other device. Sign in with the <b>same email and sync password as in the Fairies book</b>: Symbols uses the same Supabase project, in its own rows, so nothing needs setting up.</p>
      <form id="sync-sb" class="syncform">
        <div class="field"><label for="sync-email">Email</label><input type="email" id="sync-email" name="email" autocomplete="email" value="${esc(meta.email || '')}" required style="width:100%"></div>
        <div class="field"><label for="sync-pass">Sync password</label><input type="password" id="sync-pass" name="password" autocomplete="current-password" minlength="6" required style="width:100%"></div>
        <p><button class="btn primary" name="go" value="in">Sign in and sync</button> <button class="btn" name="go" value="new">Never signed in anywhere? Create my account</button></p>
      </form>
      <p class="m small" id="sync-status">${esc(meta.status || '')}</p>
      <p class="m small">Only you can read your rows: Supabase checks your sign-in for every one. Use the same email and password on every device.</p>
      <details><summary class="m">The other way: a private GitHub gist</summary>
        <p><a class="btn" href="${TOKEN_URL}" target="_blank" rel="noopener">Get my key on GitHub ↗</a></p>
        <ol>
          <li>The button opens GitHub (sign in if asked) with a key already set to the <b>gist</b> permission only.</li>
          <li>Set <b>Expiration</b> to “No expiration”, press <b>Generate token</b>, and copy the key that starts with <code>ghp_</code>.</li>
          <li>Paste it below on each device. The Calm Player key works too. Photos don't travel this way.</li>
        </ol>
        <div class="field"><label for="sync-token">GitHub key</label><input type="password" id="sync-token" placeholder="ghp_…" autocomplete="off" style="width:100%"></div>
        <button class="btn" id="sync-connect">Connect with the gist</button>
      </details>`;
    box.querySelector('#sync-sb').onsubmit = async ev => {
      ev.preventDefault();
      const f = ev.target, create = ev.submitter && ev.submitter.value === 'new', b = ev.submitter || f.querySelector('button');
      b.disabled = true; b.textContent = create ? 'Creating…' : 'Signing in…';
      try { await signIn(f.email.value, f.password.value, create); }
      catch (e) { setStatus('Couldn’t sign in: ' + e.message); }
      panel(box);
    };
    box.querySelector('#sync-connect').onclick = async ev => {
      const v = box.querySelector('#sync-token').value;
      if (!v.trim()) return;
      ev.target.disabled = true; ev.target.textContent = 'Connecting…';
      try { await gistConnect(v); } catch (e) { /* the status says why */ }
      panel(box);
    };
  }
  listeners.push(() => { const el = document.getElementById('sync-status'); if (el) el.innerHTML = statusLine(); });

  return { sync, connected, provider, panel, status: () => meta.status || '' };
})();
