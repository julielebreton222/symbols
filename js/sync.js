/* Sync across my devices, through a private GitHub gist (the same way as Calm Player).
 *
 * What syncs: everything in My book (notes, favourites, story seeds and book folders, my links,
 * highlights, sightings, dreams, reading, collections, reviews, cards seen, settings).
 * What doesn't: the photos of sightings (too big for a gist); they stay on the device that took
 * them, and Back up still saves them.
 *
 * How: a GitHub key with only the "gist" permission is pasted once per device. It stays in this
 * browser. The app keeps one secret gist named "Symbols sync (private)". Two devices are combined
 * item by item: the most recently changed copy of each item wins, and a deletion wins over an
 * older copy, so nothing written on either device is lost. */
window.SYNC = (function () {
  'use strict';
  const S = window.STORE;
  const META_KEY = 'symbols-sync';
  const DESC = 'Symbols sync (private)';
  const FILE = 'symbols-data.json';
  const API = 'https://api.github.com';
  const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Symbols%20sync';

  let meta = readMeta();
  let busy = false, again = false, timer = null;
  const listeners = [];

  function readMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; } }
  function writeMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ } }
  const connected = () => !!(meta.token && meta.gistId);

  function setStatus(text) {
    meta.status = text; meta.statusAt = Date.now(); writeMeta();
    for (const f of listeners) try { f(text); } catch (e) { /* ignore */ }
  }

  function api(path, opts) {
    return fetch(API + path, Object.assign({ cache: 'no-store' }, opts, {
      headers: { Authorization: 'Bearer ' + meta.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    })).then(r => {
      if (r.status === 401) throw new Error('GitHub refused the key. Make a new one with the “gist” permission.');
      if (r.status === 404) throw new Error('not-found');
      if (!r.ok) throw new Error('GitHub said ' + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  /* ---------- the data ---------- */
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

  // Combine two copies: per item the newer change wins; a deletion newer than an item removes it.
  function merge(a, b) {
    const deleted = Object.assign({}, b.deleted || {});
    for (const [k, t] of Object.entries(a.deleted || {})) if (!(deleted[k] >= t)) deleted[k] = t;
    const stores = {};
    for (const name of Object.keys(S.STORES)) {
      const key = S.STORES[name], m = new Map();
      for (const it of (b.stores || {})[name] || []) m.set(String(it[key]), it);
      for (const it of (a.stores || {})[name] || []) {
        const o = m.get(String(it[key]));
        if (!o || (it._m || 0) >= (o._m || 0)) m.set(String(it[key]), it);
      }
      stores[name] = [...m.values()].filter(it => !(deleted[name + '|' + it[key]] >= (it._m || 0)))
        .sort((x, y) => String(x[key]).localeCompare(String(y[key])));
    }
    return { app: 'symbols', v: 1, stores, deleted };
  }
  const strip = it => { const c = Object.assign({}, it); delete c.hasPhoto; delete c.photo; return JSON.stringify(c); };
  const sameData = (x, y) => JSON.stringify(x.stores) === JSON.stringify(y.stores) && JSON.stringify(x.deleted || {}) === JSON.stringify(y.deleted || {});

  // Write what is new from the merged copy into this device. Returns how many items changed.
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
    return api('/gists/' + meta.gistId).then(g => {
      const f = g.files && g.files[FILE];
      if (!f) return null;
      if (!f.truncated) return JSON.parse(f.content || 'null');
      return fetch(f.raw_url, { cache: 'no-store' }).then(r => r.json());
    });
  }
  const writeGist = data => api('/gists/' + meta.gistId, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(data) } } }) });

  /* ---------- syncing ---------- */
  async function sync(reason) {
    if (!connected() || !navigator.onLine) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const remote = await readGist();
      const local = await bundle();
      if (!remote || !remote.stores) {
        await writeGist(local);
      } else {
        const merged = merge(local, remote);
        if (!sameData(merged, remote)) await writeGist(merged);
        const n = await apply(merged, local);
        if (n && !userBusy()) window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      meta.lastSynced = Date.now(); meta.dirty = false; writeMeta();
      setStatus('Synced');
    } catch (e) {
      if (e.message === 'not-found') { meta.gistId = ''; writeMeta(); setStatus('The sync gist was deleted. Connect again.'); }
      else setStatus('Couldn’t sync: ' + e.message);
    } finally {
      busy = false;
      if (again) { again = false; schedule(1500); }
    }
  }
  // Don't redraw the page while she is typing.
  function userBusy() {
    const ae = document.activeElement;
    return !!(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.id !== 'sync-token');
  }
  function schedule(ms) {
    if (!connected()) return;
    clearTimeout(timer);
    timer = setTimeout(() => sync('change'), ms);
  }

  async function connect(token) {
    meta.token = token.trim(); writeMeta();
    setStatus('Connecting…');
    try {
      const list = await api('/gists?per_page=100');
      const found = (list || []).find(g => g.description === DESC && g.files && g.files[FILE]);
      if (found) {
        meta.gistId = found.id; writeMeta();
        await sync('connect');
        if (/^Couldn/.test(meta.status)) throw new Error(meta.status.replace(/^Couldn’t sync: /, ''));
        setStatus('Connected. Combined with what your other devices saved.');
      } else {
        const data = await bundle();
        const g = await api('/gists', { method: 'POST', body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(data) } } }) });
        meta.gistId = g.id; meta.lastSynced = Date.now(); writeMeta();
        setStatus('Connected. This is the first device, and everything is saved.');
      }
    } catch (e) {
      meta = { status: 'Couldn’t connect: ' + e.message }; writeMeta();
      setStatus(meta.status);
      throw e;
    }
  }
  function disconnect() { meta = {}; writeMeta(); setStatus('Not syncing on this device'); }

  /* ---------- when to sync ---------- */
  S.onChange(() => { meta.dirty = true; writeMeta(); schedule(4000); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync('focus');
    else if (meta.dirty) sync('leave');
  });
  window.addEventListener('online', () => sync('online'));
  setInterval(() => { if (document.visibilityState === 'visible') sync('timer'); }, 2 * 60 * 1000);
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
  function panel(box) {
    const status = () => (meta.status || '') + (connected() && meta.lastSynced ? ' · last synced ' + ago(meta.lastSynced) : '');
    if (connected()) {
      box.innerHTML = `<p><b>This device is syncing.</b></p>
        <p class="m small" id="sync-status">${status()}</p>
        <p>Everything in My book is kept in a private gist in your GitHub account and appears on every device you connect. Photos of sightings stay on the device that took them (Back up saves them).</p>
        <p><button class="btn primary" id="sync-now">Sync now</button> <button class="btn" id="sync-off">Stop syncing on this device</button></p>`;
      box.querySelector('#sync-now').onclick = async () => { await sync('manual'); panel(box); };
      box.querySelector('#sync-off').onclick = () => { if (confirm('Stop syncing on this device? Everything stays here and in the gist.')) { disconnect(); panel(box); } };
    } else {
      box.innerHTML = `<p>Keep My book the same on your phone, laptop and any other device. It is saved in a <b>private</b> gist in your own GitHub account that only you can see.</p>
        <p><a class="btn primary" href="${TOKEN_URL}" target="_blank" rel="noopener">Get my key on GitHub ↗</a></p>
        <ol>
          <li>Press the button above. It opens GitHub (sign in if asked) with a new key already set up for you.</li>
          <li>Set <b>Expiration</b> to “No expiration” (or a date far away). Only <b>gist</b> should be ticked.</li>
          <li>Scroll down, press <b>Generate token</b>, and copy the key that starts with <code>ghp_</code>.</li>
          <li>Paste it below and press Connect. Do the same on each device. You can reuse the same key, including the one you made for Calm Player.</li>
        </ol>
        <div class="field"><label for="sync-token">GitHub key</label><input type="password" id="sync-token" placeholder="ghp_…" autocomplete="off" style="width:100%"></div>
        <p class="m small" id="sync-status">${meta.status || ''}</p>
        <button class="btn primary" id="sync-connect">Connect this device</button>
        <p class="m small">The key stays in this browser. It can only read and write gists, not your code or anything else.</p>`;
      box.querySelector('#sync-connect').onclick = async ev => {
        const v = box.querySelector('#sync-token').value;
        if (!v.trim()) return;
        ev.target.disabled = true; ev.target.textContent = 'Connecting…';
        try { await connect(v); } catch (e) { /* the status says why */ }
        panel(box);
      };
    }
  }
  listeners.push(text => { const el = document.getElementById('sync-status'); if (el) el.textContent = text + (meta.lastSynced ? ' · last synced ' + ago(meta.lastSynced) : ''); });

  return { sync, connected, panel, status: () => meta.status || '' };
})();
