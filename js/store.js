/* Everything Julie writes lives here, in this browser's IndexedDB (marked
 * persistent). Nothing is ever sent anywhere and nothing is in the repository.
 * "Back up" in My book saves it all (photos included) as one file; "Restore"
 * reads that file on another device. */
window.STORE = (function () {
  const DB = 'symbols-book', VERSION = 2;
  // store name -> key path
  const STORES = {
    notes: 'slug',        // My notes on a card
    seeds: 'slug',        // Story seeds: objects marked for fiction ({slug, notes, projects: [ids]})
    projects: 'id',       // her own books: folders for story seeds
    links: 'id',          // her own connections between two or more cards
    favorites: 'slug',
    collections: 'id',    // her own groupings
    highlights: 'id',     // quotes she types from books she owns
    sightings: 'id',      // a symbol spotted in the world, with a photo
    dreams: 'id',         // dream log
    reading: 'id',        // reading tracker
    reviews: 'slug',      // spaced repetition state
    seen: 'slug',         // which cards she has opened
    meta: 'key',          // settings, daily cards
  };
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB, VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, key] of Object.entries(STORES)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: key });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
    return dbp;
  }
  const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let result;
      Promise.resolve(fn(t.objectStore(store))).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
    });
  }
  const all = store => tx(store, 'readonly', s => req2p(s.getAll())).catch(() => []);
  const get = (store, key) => tx(store, 'readonly', s => req2p(s.get(key))).catch(() => undefined);
  const put = (store, val) => tx(store, 'readwrite', s => req2p(s.put(val)));
  const del = (store, key) => tx(store, 'readwrite', s => req2p(s.delete(key)));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();

  async function setting(key, fallback) { const v = await get('meta', 'set:' + key); return v ? v.value : fallback; }
  async function setSetting(key, value) { await put('meta', { key: 'set:' + key, value }); }

  async function markSeen(slug) {
    const v = (await get('seen', slug)) || { slug, first: now(), count: 0 };
    v.last = now(); v.count++;
    await put('seen', v);
  }

  /* ---------- backup ---------- */
  const blobToData = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  const dataToBlob = async d => (await fetch(d)).blob();
  async function backup() {
    const out = { app: 'symbols', version: 1, saved: now(), stores: {} };
    for (const name of Object.keys(STORES)) {
      const items = await all(name);
      for (const it of items) if (it.photo instanceof Blob) it.photo = { dataURL: await blobToData(it.photo) };
      out.stores[name] = items;
    }
    return new Blob([JSON.stringify(out)], { type: 'application/json' });
  }
  async function restore(file) {
    const data = JSON.parse(await file.text());
    if (data.app !== 'symbols') throw new Error('This is not a Symbols backup.');
    let n = 0;
    for (const [name, items] of Object.entries(data.stores || {})) {
      if (!STORES[name]) continue;
      for (const it of items) {
        if (it.photo && it.photo.dataURL) it.photo = await dataToBlob(it.photo.dataURL);
        await put(name, it); n++;
      }
    }
    return n;
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  return { all, get, put, del, uid, now, setting, setSetting, markSeen, backup, restore, download };
})();
