/* Learning: spaced-repetition review (SM-2), quizzes, connect the dots, progress.
 * Every card Julie opens joins her review deck, due the next day. */
(function () {
  const A = window.APP, D = window.DATA, S = window.STORE;
  const { esc, setPage, plural } = A;
  const DAY = 864e5;
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const sample = (a, n, not) => shuffle(a.filter(x => !not || !not(x))).slice(0, n);
  const uniq = a => [...new Set(a)];

  /* ---------- SM-2 ---------- */
  function grade(r, q) { // q: 0-5
    r = Object.assign({ ef: 2.5, interval: 0, reps: 0, lapses: 0 }, r);
    if (q < 3) { r.reps = 0; r.interval = 1; r.lapses++; }
    else { r.reps++; r.interval = r.reps === 1 ? 1 : r.reps === 2 ? 6 : Math.round(r.interval * r.ef); }
    r.ef = Math.max(1.3, r.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    r.due = Date.now() + r.interval * DAY; r.last = Date.now();
    r.history = (r.history || []).concat([[Date.now(), q]]).slice(-30);
    return r;
  }
  async function deck() {
    // every card she has opened is in the deck; new ones are due at once
    const [seen, reviews] = await Promise.all([S.all('seen'), S.all('reviews')]);
    const have = new Map(reviews.map(r => [r.slug, r]));
    for (const s of seen) if (!have.has(s.slug) && D.get(s.slug)) {
      const r = { slug: s.slug, ef: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), added: Date.now() };
      await S.put('reviews', r); have.set(s.slug, r);
    }
    return [...have.values()].filter(r => D.get(r.slug));
  }

  /* ---------- questions ---------- */
  // Each maker returns null when the entry lacks what that question needs.
  const makers = {
    async owner(e) {
      // no giveaways: skip when the owner's name is in the object's name ("Heracles's arrows")
      const words = A.fold([e.t, ...e.a].join(' '));
      const own = (e.ow || []).filter(o => !words.includes(A.fold(o).split(/[ (]/)[0]) && A.fold(o) !== A.fold(e.t));
      if (!own.length) return null;
      const right = own[0];
      // wrong answers: other owners from the same culture first, so the culture does not give it away
      const sameCult = uniq(D.entries().filter(x => x.ow && x.ow.length && x.cu.some(c => e.cu.includes(c))).map(x => x.ow[0])).filter(o => !e.ow.includes(o));
      const any = uniq(D.entries().filter(x => x.ow && x.ow.length).map(x => x.ow[0])).filter(o => !e.ow.includes(o));
      const wrong = uniq([...sample(sameCult, 3), ...sample(any, 6)]).slice(0, 3);
      if (wrong.length < 3) return null;
      return { kind: 'Whose object is this?', q: `Whose is <b>${esc(e.t)}</b>?`, right, opts: shuffle([right, ...wrong]) };
    },
    async belongs(e) {
      // the reverse: which of these belongs to X?
      const own = (e.ow || []).find(o => !A.fold([e.t, ...e.a].join(' ')).includes(A.fold(o).split(/[ (]/)[0]) && A.fold(o) !== A.fold(e.t));
      if (!own) return null;
      const pool = D.entries().filter(x => x.s !== e.s && x.c[0] === e.c[0] && !(x.ow || []).includes(own) && !A.fold(x.t).includes(A.fold(own).split(' ')[0]));
      const same = pool.filter(x => x.cu.some(c => e.cu.includes(c)));
      const wrong = uniq([...sample(same, 3), ...sample(pool, 6)].map(x => x.t)).filter(t => t !== e.t).slice(0, 3);
      if (wrong.length < 3) return null;
      return { kind: 'Whose object is this?', q: `Which of these belongs to <b>${esc(own)}</b>?`, right: e.t, opts: shuffle([e.t, ...wrong]) };
    },
    async culture(e) {
      const right = e.cu[0] || (e.tr || [])[0];
      if (!right) return null;
      // no giveaways: skip when a word of the culture is in the name ("Norse", "Irish", "Greek")
      const words = A.fold([e.t, ...e.a].join(' '));
      if (A.fold(right).split(/\W+/).some(w => w.length > 3 && !/mytholog|tradition|folklore|legend|religion/.test(w) && words.includes(w))) return null;
      // wrong answers: well-known cultures, so the answer is not the only famous one
      const big = Object.entries(D.meta().cultures).filter(([c, v]) => v.n >= 8 && c !== right && !e.cu.includes(c) && !(e.tr || []).includes(c)).map(([c]) => c);
      return { kind: 'Which culture?', q: `Where does <b>${esc(e.t)}</b> come from?`, right, opts: shuffle([right, ...sample(big, 3)]) };
    },
    async era(e) {
      if (e.y == null) return null;
      const label = y => {
        if (y < -1000) return 'Before 1000 BCE';
        const c = y < 0 ? Math.ceil(-y / 100) : Math.floor(y / 100) + 1;
        const suf = c % 100 >= 11 && c % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[c % 10] || 'th');
        return `${c}${suf} century${y < 0 ? ' BCE' : ''}`;
      };
      const right = label(e.y);
      const others = uniq([-1500, -700, -300, 100, 500, 900, 1150, 1350, 1600, 1850, 1950].filter(y => Math.abs(y - e.y) > 250).map(label)).filter(x => x !== right);
      if (others.length < 3) return null;
      return { kind: 'When?', q: `When does <b>${esc(e.t)}</b> first appear?`, right, opts: shuffle([right, ...sample(others, 3)]) };
    },
    async whichbook(e) {
      // read a book's reading with the name hidden: which entry is it?
      const c = await D.card(e.s);
      const refs = (c.refs || []).filter(r => r.sum && !A.fold(r.sum).includes(A.fold(r.h)));
      if (!refs.length) return null;
      const r = pick(refs), book = (D.meta().refbooks || {})[r.b] || {};
      const others = sample(D.entries().filter(x => x.s !== e.s && (x.rb || []).includes(r.b)), 3).map(x => x.t);
      if (others.length < 3) return null;
      return { kind: 'What does it symbolize?', q: `Which one does <i>${esc(book.title || r.b)}</i> read like this?`, clue: r.sum, right: e.t, opts: shuffle([e.t, ...others]) };
    },
    async oddone(e) {
      const c = await D.card(e.s);
      const linked = uniq((c.conn || []).map(x => x.to)).filter(s => D.get(s));
      if (linked.length < 3) return null;
      const three = sample(linked, 3).map(s => D.get(s).t);
      const odd = pick(D.entries().filter(x => x.s !== e.s && !linked.includes(x.s) && x.c[0] === e.c[0] && x.cu.some(c => e.cu.includes(c))) .concat([]))
        || pick(D.entries().filter(x => x.s !== e.s && !linked.includes(x.s) && x.c[0] === e.c[0]));
      if (!odd) return null;
      return { kind: 'Match the parallels', q: `Which of these is <i>not</i> connected to <b>${esc(e.t)}</b>?`, right: odd.t, opts: shuffle([odd.t, ...three]) };
    },
    async meaning(e) {
      const c = await D.card(e.s);
      const refs = c.refs || [];
      if (!refs.length) return null;
      const r = pick(refs);
      const book = (D.meta().refbooks || {})[r.b] || {};
      // wrong answers: readings of other headwords in the same book
      const others = D.entries().filter(x => x.s !== e.s && (x.rb || []).includes(r.b));
      const wrongSlugs = sample(others, 3);
      const wrong = [];
      for (const w of wrongSlugs) { const wc = await D.card(w.s); const wr = (wc.refs || []).find(x => x.b === r.b); if (wr) wrong.push(wr.sum); }
      if (wrong.length < 3) return null;
      return { kind: 'What does it symbolize?', q: `How does <i>${esc(book.title || r.b)}</i> read <b>${esc(e.t)}</b>?`, right: r.sum, opts: shuffle([r.sum, ...wrong]) };
    },
    async themes(e) {
      const mine = e.th.filter(Boolean);
      if (!mine.length) return null;
      const right = D.meta().themes[pick(mine)];
      if (!right) return null;
      const wrong = sample(Object.entries(D.meta().themes).filter(([k]) => !mine.includes(k)).map(([, t]) => t.name), 3);
      return { kind: 'What does it symbolize?', q: `Which theme belongs to <b>${esc(e.t)}</b>?`, right: right.name, opts: shuffle([right.name, ...wrong]) };
    },
    async name(e) {
      if (!e.o || e.o.length < 60) return null;
      const words = [e.t, ...e.a].flatMap(n => n.split(/[\s,()]+/)).filter(w => w.length > 3);
      let clue = e.o;
      for (const n of [e.t, ...e.a].sort((a, b) => b.length - a.length)) clue = clue.split(n).join('…');
      for (const w of words) clue = clue.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '…');
      const similar = D.entries().filter(x => x.s !== e.s && x.c[0] === e.c[0] && (x.g.some(g => e.g.includes(g)) || x.cu.some(c => e.cu.includes(c))));
      const wrong = sample(similar.length >= 3 ? similar : D.entries().filter(x => x.s !== e.s && x.c[0] === e.c[0]), 3).map(x => x.t);
      return { kind: 'Name it', q: 'Which one is this?', clue, right: e.t, opts: shuffle([e.t, ...wrong]) };
    },
    async parallels(e) {
      const c = await D.card(e.s);
      const links = (c.conn || []).filter(x => D.get(x.to));
      if (!links.length) return null;
      const l = pick(links);
      const linked = new Set(links.map(x => x.to));
      const wrong = sample(D.entries().filter(x => x.s !== e.s && !linked.has(x.s) && x.c[0] === D.get(l.to).c[0]), 3).map(x => x.t);
      return { kind: 'Match the parallels', q: `Which of these is linked to <b>${esc(e.t)}</b>?`, right: D.get(l.to).t, opts: shuffle([D.get(l.to).t, ...wrong]),
        after: `${esc(D.LINK_TYPES[l.type] || l.type)}: ${l.reason}` };
    },
  };
  // the harder kinds first; themes and name-it only when nothing else can be asked
  async function question(e, prefer) {
    const order = [...shuffle(['owner', 'belongs', 'culture', 'era', 'meaning', 'whichbook', 'parallels', 'oddone']), ...shuffle(['name', 'themes'])];
    if (prefer) order.unshift(prefer);
    for (const k of order) { const q = await makers[k](e); if (q) return q; }
    return null;
  }

  function renderQuestion(box, e, q, onDone) {
    box.innerHTML = `<div class="quiz leaf"><div class="m">${esc(q.kind)}</div>
      <div class="q">${q.q}</div>${q.clue ? `<p class="clue">“${esc(q.clue)}”</p>` : ''}
      <div class="opts">${q.opts.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join('')}</div>
      <div id="after"></div></div>`;
    for (const b of box.querySelectorAll('.opt')) b.onclick = () => {
      const chosen = q.opts[+b.dataset.i], right = chosen === q.right;
      for (const x of box.querySelectorAll('.opt')) { x.disabled = true; if (q.opts[+x.dataset.i] === q.right) x.classList.add('right'); }
      if (!right) b.classList.add('wrong');
      box.querySelector('#after').innerHTML = `<p>${right ? '✦ Yes.' : 'Not quite.'} <a href="#/e/${e.s}">Open ${esc(e.t)}</a></p>
        ${q.after ? `<p class="m small">${q.after}</p>` : ''}
        <div class="row" style="justify-content:center">${right ? `<button class="btn" data-q="4">Next</button><button class="btn" data-q="5">That was easy</button>` : `<button class="btn" data-q="1">Next</button>`}</div>`;
      for (const n of box.querySelectorAll('[data-q]')) n.onclick = () => onDone(+n.dataset.q);
    };
  }

  /* ---------- views ---------- */
  A.register('learn', async function (args) {
    const sub = args[0] || '';
    if (sub === 'review') return review();
    if (sub === 'quiz') return quiz();
    if (sub === 'dots') return dots();
    if (sub === 'progress') return progress();
    const d = await deck();
    const due = d.filter(r => r.due <= Date.now()).length;
    setPage(`<h1>Learn</h1>
      <p class="center m">Every card you open joins your review deck. Reviews come back on a growing schedule (the SM-2 method): soon at first, then days, weeks and months apart.</p>
      <div class="tiles">
        <a class="tile" href="#/learn/review"><b>Review</b><span>${due ? plural(due, 'card') + ' due now' : 'Nothing due right now'} · ${plural(d.length, 'card')} in your deck</span></a>
        <a class="tile" href="#/learn/quiz"><b>Quiz</b><span>Whose object? Which culture? What does it symbolize? Match the parallels.</span></a>
        <a class="tile" href="#/learn/dots"><b>Connect the dots</b><span>Two cards: guess what links them, then see.</span></a>
        <a class="tile" href="#/learn/progress"><b>Progress</b><span>Seen, learned and mastered, by category and culture</span></a>
        <a class="tile" href="#/"><b>Today’s card</b><span>One new entry a day, turning through the three books</span></a>
      </div>`);
  });

  async function review() {
    const d = (await deck()).filter(r => r.due <= Date.now()).sort((a, b) => a.due - b.due);
    if (!d.length) { setPage(`<h1>Review</h1><p class="center">Nothing is due. <a href="#/learn/quiz">Take a quiz</a> or <a href="#/">open today’s card</a>.</p>`); return; }
    let i = 0, right = 0;
    setPage(`<h1>Review</h1><p class="center m" id="count"></p><div id="qbox"></div>`);
    const box = document.getElementById('qbox');
    async function next() {
      if (i >= d.length) { box.innerHTML = `<div class="leaf center"><p>Done for now: ${right} of ${d.length} remembered.</p><a class="btn" href="#/learn/progress">See your progress</a></div>`; return; }
      document.getElementById('count').textContent = `${i + 1} of ${d.length}`;
      const r = d[i], e = D.get(r.slug);
      const q = await question(e);
      if (!q) { i++; return next(); }
      renderQuestion(box, e, q, async g => { if (g >= 3) right++; await S.put('reviews', grade(r, g)); i++; next(); });
    }
    next();
  }

  async function quiz() {
    setPage(`<h1>Quiz</h1>
      <div class="tabs">${[['', 'Any'], ['owner', 'Whose object?'], ['belongs', 'Which belongs to…?'], ['culture', 'Which culture?'], ['era', 'When?'], ['meaning', 'What does it symbolize?'], ['whichbook', 'Which one, by its reading?'], ['parallels', 'Match the parallels'], ['oddone', 'Odd one out'], ['name', 'Name it']]
        .map(([k, l]) => `<button class="chip" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="row" style="justify-content:center"><label><input type="checkbox" id="mineonly"> Only cards I have opened</label></div>
      <p class="center m" id="score"></p><div id="qbox"></div>`);
    let kind = '', n = 0, right = 0;
    const box = document.getElementById('qbox');
    const seen = new Set((await S.all('seen')).map(s => s.slug));
    async function next() {
      const mine = document.getElementById('mineonly').checked;
      const pool = D.entries().filter(e => (!mine || seen.has(e.s)) && (e.o || e.ow.length));
      for (let tries = 0; tries < 40; tries++) {
        const e = pick(pool.length ? pool : D.entries());
        const q = kind ? await makers[kind](e) : await question(e);
        if (!q) continue;
        renderQuestion(box, e, q, async g => {
          n++; if (g >= 3) right++;
          document.getElementById('score').textContent = `${right} of ${n}`;
          const r = await S.get('reviews', e.s);
          if (r) await S.put('reviews', grade(r, g));
          next();
        });
        return;
      }
      box.innerHTML = '<p class="center m">No question of that kind could be made. Try another kind.</p>';
    }
    for (const b of document.querySelectorAll('.tabs .chip')) b.onclick = () => {
      kind = b.dataset.k; for (const x of document.querySelectorAll('.tabs .chip')) x.classList.toggle('on', x === b); next();
    };
    document.querySelector('.tabs .chip').classList.add('on');
    document.getElementById('mineonly').onchange = next;
    next();
  }

  async function dots() {
    setPage(`<h1>Connect the dots</h1><p class="center m">Two cards. What links them? Think, or write your guess, then reveal.</p><div id="dbox"></div>`);
    const box = document.getElementById('dbox');
    const cands = D.entries().filter(e => e.n[2] > 0);
    async function next() {
      let a, l;
      for (let t = 0; t < 30; t++) {
        a = pick(cands);
        const c = await D.card(a.s);
        // prefer links with a hand-written or book reason
        const ls = (c.conn || []).filter(x => D.get(x.to));
        const good = ls.filter(x => x.origin === 'card' || x.origin === 'book');
        l = pick(good.length ? good : ls);
        if (l) break;
      }
      const b = D.get(l.to);
      const side = e => `<div class="entry" style="text-align:center">${e.im ? `<img class="thumb" src="${esc(A.thumb(e.im, 330))}" alt="">` : `<div class="thumb none">${A.initial(e.t)}</div>`}
        <div class="body"><div class="name">${esc(e.t)}</div><div class="sub">${A.catBadges(e, false)} ${esc(e.cu.slice(0, 2).join(' · '))}</div><div class="blurb">${esc(e.o)}</div></div></div>`;
      box.innerHTML = `<div class="dots-pair">${side(a)}<div class="vs">⟷</div>${side(b)}</div>
        <div class="leaf"><div class="field"><label>Your guess</label><input type="text" id="guess" style="width:100%" placeholder="They are both…"></div>
        <div class="row" style="justify-content:center"><button class="btn primary" id="reveal">Reveal</button></div><div id="ans"></div></div>`;
      document.getElementById('reveal').onclick = () => {
        document.getElementById('ans').innerHTML = `<p><span class="ltype">${esc(D.LINK_TYPES[l.type] || l.type)}</span> ${l.reason}</p>
          <div class="row" style="justify-content:center"><a class="btn small" href="#/e/${a.s}">Open ${esc(a.t)}</a><a class="btn small" href="#/e/${b.s}">Open ${esc(b.t)}</a><button class="btn" id="again">Another pair</button></div>`;
        document.getElementById('again').onclick = next;
      };
    }
    next();
  }

  async function progress() {
    const [seen, reviews] = await Promise.all([S.all('seen'), S.all('reviews')]);
    const seenS = new Set(seen.map(s => s.slug));
    const learned = new Set(reviews.filter(r => r.reps >= 1).map(r => r.slug));
    const mastered = new Set(reviews.filter(r => r.interval >= 21).map(r => r.slug));
    const row = (label, list) => {
      const n = list.length, s = list.filter(e => seenS.has(e.s)).length, l = list.filter(e => learned.has(e.s)).length, m = list.filter(e => mastered.has(e.s)).length;
      return `<div>${esc(label)}</div><div class="bar" title="seen ${s}, learned ${l}, mastered ${m}"><span style="width:${n ? (s / n * 100).toFixed(1) : 0}%"></span></div>
        <div class="m small">${s}/${n} · ${l} · ${m}</div>`;
    };
    const cats = Object.entries(D.CATS).map(([k, v]) => row(v, D.entries().filter(e => e.c.includes(k))));
    const cultures = Object.entries(D.meta().cultures).sort((a, b) => b[1].n - a[1].n).slice(0, 25)
      .map(([c]) => row(c, D.entries().filter(e => e.cu.includes(c) || (e.tr || []).includes(c))));
    setPage(`<h1>Progress</h1>
      <div class="stats"><span><b>${seenS.size}</b> seen</span><span><b>${learned.size}</b> learned</span><span><b>${mastered.size}</b> mastered (three weeks or more between reviews)</span></div>
      <h2 class="orn">By book</h2><div class="leaf progress-grid">${cats.join('')}</div>
      <h2 class="orn">By culture</h2><div class="leaf progress-grid">${cultures.join('')}</div>
      <p class="m small center">Each row: the bar shows how much you have seen; then seen / all · learned · mastered.</p>`);
  }
})();
