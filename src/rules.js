// ─── RULES: shopping list, closing timer, wanted level, score/combo, win/lose ─
(function () {
  const C = BR.config, bus = BR.bus;
  const GAS = C.GAS_TYPES;
  const LS_BEST = 'bumRush.best';
  const PTS = {
    item: 500, knock: 100, drift: 60, air: 250, nearMiss: 150, fart: 25, gassed: 150,
    timeBonus: 25, starBonus: 250, cleanBonus: 1000,
  };
  const COMBO_WINDOW = 2, COMBO_MAX = 5, CALM_DELAY = 4, NEAR_SPEED = 8;
  const PA = {
    start: 'Welcome to BULKZILLA WAREHOUSE. The store closes in four minutes. Please shop responsibly.',
    120: 'Attention shoppers: two minutes to closing. Free samples are for tasting, not for fuel.',
    60: 'Attention shoppers: BULKZILLA closes in ONE minute. Bring your final purchases, and your dignity, to the checkout.',
    30: 'Thirty seconds to closing. To the gentleman in the cart that smells like chili: we see you.',
    10: 'Ten seconds! Staff, lower the gates! And somebody please open a window!',
    allItems: 'Checkout lane one is now open. Please do not arrive at rocket speed.',
    checkout: 'Cha-ching! Thank you for shopping at BULKZILLA. Please never come back.',
    closed: 'The store is now closed. Please exit the building. Yes, you. With the cart.',
    caught: 'Security has escorted a customer out. Cleanup on every aisle.',
  };

  let core = null;
  const st = {};             // private run state
  let extNearMiss = false;   // people.js emits 'nearMiss' itself

  const R = BR.rules = {
    running: false, timeLeft: C.RUN_SECONDS, list: [], wanted: 0, stars: 0, chaos: 0,
    score: 0, combo: 0, comboMult: 1, gasSel: 'beans', checkingOut: false,
    breakdown: [], parts: { items: 0, style: 0, chaos: 0 },

    init(c) { core = c; hook(); },

    startRun(seed) {
      const rnd = BR.rng(seed == null ? (Math.random() * 1e9) | 0 : seed);
      const pool = C.LIST_ITEMS.slice();
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      const [lo, hi] = C.LIST_SIZE || [6, 8];
      const n = lo + Math.floor(rnd() * (hi - lo + 1));
      R.list = pool.slice(0, n).map(it => ({ id: it.id, name: it.name, icon: it.icon, dept: it.dept, taken: false }));
      if (BR.store && typeof BR.store.setupRun === 'function') BR.store.setupRun(seed, R.list.map(i => Object.assign({}, i)));
      Object.assign(R, { running: true, timeLeft: C.RUN_SECONDS, wanted: 0, stars: 0, chaos: 0, score: 0, combo: 0, comboMult: 1,
        checkingOut: false, breakdown: [], parts: { items: 0, style: 0, chaos: 0 } });
      Object.assign(st, { said: {}, lastKnockT: -99, clock: 0, chainN: 0, lastFartT: -99, lastFartType: null,
        drift: 0, air: 0, near: new Map(), knockBuf: null, coT: 0, missT: -99, allSaid: false, stats: { drift: 0, air: 0, near: 0, knocks: 0, farts: 0, bestChain: 0 } });
      R.gasSel = firstWithGas() || 'beans';
      syncCart();
      announce(PA.start);
    },

    update(dt, c) {
      core = c || core;
      if (!R.running) return;
      st.clock += dt;
      if (R.checkingOut) { tickCheckout(); return; }
      tickGas(core && core.input);
      tickTimer(dt); if (!R.running) return;
      tickWanted(dt);
      tickCombo();
      tickStyle(dt);
      flushKnocks(false);
      tickCheckoutZone();
    },

    missing() { return R.list.filter(i => !i.taken); },
    inCheckout(pos) { return inZone(pos || cartPos()); },
  };

  // ── helpers ────────────────────────────────────────────────────────────────
  const now = () => st.clock || 0;
  const cart = () => BR.cart || null;
  function cartPos() { const c = cart(); return c && c.pos ? c.pos : { x: C.START.x, y: 0, z: C.START.z }; }
  function popPos(p) { const q = p || cartPos(); return { x: q.x || 0, y: (q.y || 0) + 1.5, z: q.z || 0 }; }
  function announce(text) { bus.emit('announce', { text }); }
  function sfx(name, o) { if (BR.audio && typeof BR.audio.sfx === 'function') BR.audio.sfx(name, o); }
  function award(points, reason, pos, part) {
    points = Math.round(points); if (!points) return;
    R.score += points; R.parts[part || 'style'] += points;
    bus.emit('score', { points, reason, pos: popPos(pos) });
  }
  function gasOf(t) { const c = cart(); return c && c.gas ? c.gas[t] || 0 : 0; }
  function firstWithGas() { return GAS.find(t => gasOf(t) > 0.001) || null; }
  function syncCart() { const c = cart(); if (c) c.gasSel = R.gasSel; }
  function personPos(p) { return p.pos || (p.mesh && p.mesh.position) || (p.group && p.group.position) || (p.x != null ? p : null); }
  function isStaff(p) { const k = String(p.kind || p.type || p.role || ''); return /staff|security|guard|sample|employee|clerk/i.test(k); }

  // ── gas selection ──────────────────────────────────────────────────────────
  function cycle(dir) {
    const i0 = Math.max(0, GAS.indexOf(R.gasSel));
    const any = GAS.some(t => gasOf(t) > 0.001);
    for (let k = 1; k <= GAS.length; k++) {
      const t = GAS[(i0 + dir * k + GAS.length * 5) % GAS.length];
      if (!any || gasOf(t) > 0.001) { R.gasSel = t; break; }
    }
    sfx('click');
  }
  function tickGas(inp) {
    if (inp) {
      if (inp.gasNext) cycle(1);
      if (inp.gasPrev) cycle(-1);
      for (let i = 1; i <= 5; i++) if (inp['gas' + i]) R.gasSel = GAS[i - 1];
      if (inp.gasPick != null && inp.gasPick !== false) {
        const g = typeof inp.gasPick === 'number' ? GAS[inp.gasPick - 1] : inp.gasPick;
        if (GAS.includes(g)) R.gasSel = g;
      }
    }
    if (!GAS.includes(R.gasSel)) R.gasSel = 'beans';
    syncCart();
  }

  // ── timer ──────────────────────────────────────────────────────────────────
  function tickTimer(dt) {
    R.timeLeft = Math.max(0, R.timeLeft - dt);
    [120, 60, 30, 10].forEach(s => {
      if (R.timeLeft <= s && !st.said[s] && R.timeLeft > s - 3) { st.said[s] = true; announce(PA[s]); }
      else if (R.timeLeft <= s - 3) st.said[s] = true; // skipped past (debug.time): stay quiet
    });
    if (R.timeLeft <= 0) { announce(PA.closed); end(false, 'closed'); }
  }

  // ── wanted ─────────────────────────────────────────────────────────────────
  function addWanted(v) {
    R.wanted = Math.min(5, Math.max(0, R.wanted + v));
    st.lastKnockT = now();
  }
  function tickWanted(dt) {
    if (now() - st.lastKnockT > CALM_DELAY) R.wanted = Math.max(0, R.wanted - C.WANTED.decay * dt);
    R.wanted = Math.min(5, Math.max(0, +R.wanted || 0));
    R.stars = Math.floor(R.wanted + 1e-6);
  }

  // ── combo (fart chain) ─────────────────────────────────────────────────────
  function tickCombo() {
    if (st.chainN > 0 && now() - st.lastFartT > COMBO_WINDOW) { st.chainN = 0; R.comboMult = 1; R.combo = 0; }
  }
  function onFart(d) {
    if (!R.running || R.checkingOut) return;
    const t = now(), gap = t - st.lastFartT;
    const stream = gap < 0.35 && d.type === st.lastFartType; // held beans: one fart, not a chain
    st.lastFartT = t; st.lastFartType = d.type;
    if (stream) return;
    st.stats.farts++;
    st.chainN = gap <= COMBO_WINDOW ? st.chainN + 1 : 1;
    R.comboMult = Math.min(COMBO_MAX, Math.max(1, st.chainN));
    R.combo = R.comboMult >= 2 ? R.comboMult : 0;
    st.stats.bestChain = Math.max(st.stats.bestChain, R.comboMult);
    if (R.comboMult >= 2) award(PTS.fart * R.comboMult, 'FART COMBO x' + R.comboMult, d.pos);
    fartHits(d);
  }
  function fartHits(d) {
    if (d.type === 'cheese' || !BR.people || !Array.isArray(BR.people.list)) return;
    const p0 = d.pos || cartPos();
    let staffNear = false, gassed = 0;
    BR.people.list.forEach(p => {
      const q = personPos(p); if (!q) return;
      const dd = Math.hypot(q.x - p0.x, q.z - p0.z);
      if (dd < 4) gassed++;
      if (dd < 7 && isStaff(p)) staffNear = true;
    });
    if (gassed) award(PTS.gassed * gassed * R.comboMult, gassed > 1 ? 'GASSED x' + gassed : 'GASSED A SHOPPER', p0);
    if (staffNear) addWanted(0.5);
  }

  // ── style: drift, air, near misses ─────────────────────────────────────────
  function tickStyle(dt) {
    const c = cart(); if (!c) return;
    if (c.drifting) st.drift += dt;
    else if (st.drift > 0) { if (st.drift >= 0.6) { award(PTS.drift * st.drift * R.comboMult, 'DRIFT ' + st.drift.toFixed(1) + 's'); st.stats.drift += st.drift; } st.drift = 0; }
    if (c.airborne) st.air += dt;
    else if (st.air > 0) { if (st.air >= 0.35) { award(PTS.air * st.air * R.comboMult, 'AIR ' + st.air.toFixed(1) + 's'); st.stats.air += st.air; } st.air = 0; }
    if (!extNearMiss) nearMisses(c);
  }
  function nearMisses(c) {
    if (!BR.people || !Array.isArray(BR.people.list) || !c.pos) return;
    const sp = Math.abs(c.speed || 0), seen = new Set();
    BR.people.list.forEach(p => {
      const q = personPos(p); if (!q) return;
      const d = Math.hypot(q.x - c.pos.x, q.z - c.pos.z), rec = st.near.get(p);
      if (d < 2.6) {
        seen.add(p);
        if (!rec) st.near.set(p, { min: d, fast: sp >= NEAR_SPEED, cool: 0 });
        else { rec.min = Math.min(rec.min, d); rec.fast = rec.fast || sp >= NEAR_SPEED; }
      }
    });
    st.near.forEach((rec, p) => {
      if (seen.has(p)) return;
      const q = personPos(p);
      if (rec.fast && rec.min > 1.2 && !p.down && !p.fallen) {
        st.stats.near++;
        award(PTS.nearMiss * R.comboMult, /fork/i.test(String(p.kind || p.type || '')) ? 'FORKLIFT NEAR MISS!' : 'NEAR MISS!', q);
      }
      st.near.delete(p);
    });
  }

  // ── knocks (aggregated so a can cascade gives one popup) ───────────────────
  function onKnock(d) {
    if (!R.running || R.checkingOut) return;
    const v = d.value != null ? +d.value || 0 : 1;
    addWanted(C.WANTED.perKnock * v);
    R.chaos += v; st.stats.knocks++;
    const b = st.knockBuf || (st.knockBuf = { v: 0, n: 0, pos: d.pos, kind: d.kind, t: 0 });
    b.v += v; b.n++; b.t = now(); if (d.kind && /pyramid/i.test(d.kind)) b.kind = d.kind;
    if (!b.pos) b.pos = d.pos;
  }
  function flushKnocks(force) {
    const b = st.knockBuf; if (!b || (!force && now() - b.t < 0.35)) return;
    st.knockBuf = null;
    const k = String(b.kind || '');
    const label = /pyramid/i.test(k) ? 'PYRAMID TOPPLED!' : b.n > 4 ? 'CLEANUP ON AISLE ' + (1 + Math.floor(Math.random() * 30)) : 'KNOCKED ' + (k ? k.toUpperCase() : 'IT OVER');
    award(PTS.knock * b.v * R.comboMult, label, b.pos, 'chaos');
  }

  // ── collect + checkout ─────────────────────────────────────────────────────
  function onCollect(d) {
    if (!R.running) return;
    const raw = d.item, id = raw && typeof raw === 'object' ? raw.id : raw;
    const it = R.list.find(i => i.id === id && !i.taken); if (!it) return;
    it.taken = true;
    award(PTS.item, 'GOT: ' + it.name.toUpperCase(), raw && raw.x != null ? { x: raw.x, y: 0, z: raw.z } : null, 'items');
    if (!R.missing().length && !st.allSaid) { st.allSaid = true; announce(PA.allItems); }
  }
  function zone() { const s = BR.store && BR.store.spots; return s && s.checkoutZone; }
  function inZone(p) {
    if (!p) return false;
    if (BR.store && typeof BR.store.inCheckout === 'function') return !!BR.store.inCheckout(p);
    const z = zone();
    if (!z) return p.z >= 46 && Math.abs(p.x) <= 40; // fallback: the south checkout strip
    if (z.minX != null) return p.x >= z.minX && p.x <= z.maxX && p.z >= z.minZ && p.z <= z.maxZ;
    const cx = z.x || 0, cz = z.z || 0, r = z.r || z.radius;
    if (r) return Math.hypot(p.x - cx, p.z - cz) <= r;
    const w = z.w || z.width, dz = z.d || z.depth || z.h;
    if (w && dz) return Math.abs(p.x - cx) <= w / 2 && Math.abs(p.z - cz) <= dz / 2;
    return Math.hypot(p.x - cx, p.z - cz) <= 6;
  }
  function tickCheckoutZone() {
    const p = cartPos(), inside = inZone(p), entered = inside && st.wasOut;
    st.wasOut = !inside; // the spawn sits by the checkouts: only nag on a real arrival
    if (!inside) return;
    const miss = R.missing();
    if (!miss.length) { startCheckout(); return; }
    if (entered && now() - st.missT > 10) {
      st.missT = now();
      const names = miss.slice(0, 3).map(i => i.name).join(', ');
      announce('Customer at checkout: you are still missing ' + names + (miss.length > 3 ? ', and more' : '') + '.');
    }
  }
  function startCheckout() {
    R.checkingOut = true; st.coT = core ? core.time : 0;
    flushKnocks(true);
    if (core && core.slowmo) core.slowmo(0.3, 1.5);
    sfx('register'); announce(PA.checkout);
  }
  function tickCheckout() {
    const t = core ? core.time : st.coT + 2;
    if (t - st.coT >= 1.5) end(true, 'checkout');
  }

  // ── end of run ─────────────────────────────────────────────────────────────
  function end(win, reason) {
    if (!R.running) return;
    flushKnocks(true);
    const bd = [
      { label: 'Items (' + R.list.filter(i => i.taken).length + '/' + R.list.length + ')', points: R.parts.items },
      { label: 'Style', points: R.parts.style },
      { label: 'Chaos', points: R.parts.chaos },
    ];
    if (win) {
      const tb = Math.floor(R.timeLeft) * PTS.timeBonus;
      bd.push({ label: 'Time bonus (' + Math.floor(R.timeLeft) + 's left)', points: tb }); R.score += tb;
      const stars = Math.floor(R.wanted + 1e-6);
      if (stars > 0) { const sb = stars * PTS.starBonus; bd.push({ label: 'Most wanted (' + stars + ' stars)', points: sb }); R.score += sb; }
      else if (R.chaos < 1) { bd.push({ label: 'Model citizen', points: PTS.cleanBonus }); R.score += PTS.cleanBonus; }
    } else {
      bd.push({ label: reason === 'caught' ? 'Thrown out' : 'Store closed', points: 0 });
    }
    R.score = Math.round(R.score);
    bd.push({ label: 'TOTAL', points: R.score });
    R.breakdown = bd; R.running = false; R.checkingOut = false; R.combo = 0; R.comboMult = 1;
    let best = 0, isBest = false;
    try { best = +localStorage.getItem(LS_BEST) || 0; if (R.score > best) { localStorage.setItem(LS_BEST, String(R.score)); best = R.score; isBest = true; } } catch (e) { best = Math.max(best, R.score); }
    bus.emit('runEnd', { win, reason, score: R.score, breakdown: bd, best, newBest: isBest, missing: R.missing().map(i => i.name), stats: Object.assign({}, st.stats) });
  }

  // ── bus ────────────────────────────────────────────────────────────────────
  function hook() {
    if (R._hooked) return; R._hooked = true;
    bus.on('knock', d => onKnock(d));
    bus.on('fart', d => onFart(d));
    bus.on('collect', d => onCollect(d));
    bus.on('caught', () => { if (R.running && !R.checkingOut) { announce(PA.caught); end(false, 'caught'); } });
    bus.on('eat', d => { if (R.running && gasOf(R.gasSel) <= 0.001 && d && GAS.includes(d.gas)) { R.gasSel = d.gas; syncCart(); } });
    bus.on('nearMiss', d => {
      extNearMiss = true;
      if (!R.running || R.checkingOut) return;
      st.stats.near++;
      award(PTS.nearMiss * R.comboMult, (d && d.label) || 'NEAR MISS!', d && d.pos);
    });
    bus.on('fartHit', d => { // optional from people.js: {kind, pos, staff}
      if (!R.running || !d) return;
      if (d.staff || isStaff(d)) addWanted(0.5);
    });
  }
})();
