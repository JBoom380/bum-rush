// ─── UI: BUM RUSH cartoon overlay (title, how-to, HUD, pause, results) ───────
window.BR = window.BR || {};
(function () {
  const W = 1280, H = 720, TAU = Math.PI * 2;
  const FONT = "'Arial Black','Arial Rounded MT Bold',Impact,'Helvetica Neue',sans-serif";
  const EMOJI = "'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
  const INK = '#2a1204';
  const CFG = () => BR.config || {};
  const GAS = () => CFG().GAS_TYPES || ['beans', 'hotdog', 'burrito', 'broccoli', 'cheese'];
  const GI = {
    beans: { name: 'BEANS', col: '#b5541c', hi: '#f0964e', burst: '#e07a2c', fx: 'Steady thrust. Hold to cruise.', icon: '🥫', words: ['PFFT!', 'PFFFBT!', 'PBBBT!', 'FRRRT!', 'PHHBBT!'] },
    hotdog: { name: 'HOT DOG', col: '#e89a10', hi: '#ffd860', burst: '#ffc830', fx: 'Quick burst of speed.', icon: '🌭', words: ['BLAT!', 'THPPT!', 'PFT!', 'BRAP!'] },
    burrito: { name: 'BURRITO', col: '#ff4a14', hi: '#ffb040', burst: '#ff5a1a', fx: 'ROCKET LAUNCH! Fly over stuff.', icon: '🌯', words: ['KA-BLAMMO!', 'KA-BLAMMO!', 'KA-BRAAAP!'] },
    broccoli: { name: 'BROCCOLI', col: '#2e9a38', hi: '#8ae070', burst: '#62c848', fx: 'Stink cloud. Stuns the guards.', icon: '🥦', words: ['BRAAAP!', 'SPLRRRT!', 'THPPPT!', 'BLORRP!'] },
    cheese: { name: 'CHEESE', col: '#d8b810', hi: '#fff080', burst: '#fff0a0', fx: 'Silent but deadly. Guards lose you.', icon: '🧀', words: ['...*squeak*', '...*squeak*', '...*hiss*'] },
  };
  const gi = id => GI[id] || GI.beans;
  const icon = id => { const f = (CFG().FOODS || {})[id]; return (f && f.icon) || gi(id).icon; };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sat = v => clamp(v, 0, 1);
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeOut = x => 1 - Math.pow(1 - sat(x), 3);
  const easeOutBack = x => { x = sat(x); const c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const elastic = x => { x = sat(x); return x === 0 || x === 1 ? x : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * TAU / 3) + 1; };
  const fmt = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const pick = a => a[(Math.random() * a.length) | 0];
  function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  function font(g, px, fam) { g.font = `900 ${Math.round(px)}px ${fam || FONT}`; }
  function txt(g, s, x, y, px, col, o) {
    o = o || {}; font(g, px, o.fam);
    g.textAlign = o.align || 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    if (o.shadow) { g.fillStyle = 'rgba(42,18,4,0.55)'; if (o.stroke !== false) { g.lineWidth = o.lw || Math.max(3, px * 0.22); g.strokeStyle = 'rgba(42,18,4,0.55)'; g.strokeText(s, x + o.shadow, y + o.shadow); } g.fillText(s, x + o.shadow, y + o.shadow); }
    if (o.stroke !== false) { g.lineWidth = o.lw || Math.max(3, px * 0.22); g.strokeStyle = o.stroke || INK; g.strokeText(s, x, y); }
    g.fillStyle = col; g.fillText(s, x, y);
  }
  function tw(g, s, px) { font(g, px); return g.measureText(s).width; }
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function starPath(g, cx, cy, r1, r2, n, seed, jit) {
    let s = seed || 1; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = i / (n * 2) * TAU - Math.PI / 2 + (rnd() - 0.5) * (jit || 0) * 0.3, r = (i % 2 ? r2 : r1) * (1 + (rnd() - 0.5) * (jit || 0));
      i ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
  }
  const cache = {};
  function once(k, fn) { return cache[k] || (cache[k] = fn()); }
  function emo(ch) {
    return once('E' + ch, () => {
      const c = mk(120, 120), g = c.getContext('2d'); g.font = `92px ${EMOJI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(ch, 60, 66);
      if (!colourful(g)) { g.clearRect(0, 0, 120, 120); (FALLBACK[ch] || FALLBACK._)(g); }
      return c;
    });
  }
  function colourful(g) {
    try { const d = g.getImageData(0, 0, 120, 120).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 100 && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) n++; return n > 20; } catch (e) { return true; }
  }
  const FALLBACK = {
    '🛞': g => { g.beginPath(); g.arc(60, 60, 44, 0, TAU); g.fillStyle = '#222'; g.fill(); g.beginPath(); g.arc(60, 60, 24, 0, TAU); g.fillStyle = '#b8c0c8'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#555'; g.stroke(); for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; g.fillStyle = '#444'; g.fillRect(60 + Math.cos(a) * 36 - 3, 60 + Math.sin(a) * 36 - 3, 6, 6); } },
    '🫙': g => { rr(g, 28, 34, 64, 74, 16); g.fillStyle = '#f6f0dc'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#8a7a60'; g.stroke(); rr(g, 32, 14, 56, 22, 6); g.fillStyle = '#3a78d8'; g.fill(); g.stroke(); rr(g, 38, 56, 44, 30, 6); g.fillStyle = '#ffd23a'; g.fill(); },
    _: g => { rr(g, 26, 40, 68, 64, 12); g.fillStyle = '#ff7a2a'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#7a3c10'; g.stroke(); g.beginPath(); g.arc(60, 42, 16, Math.PI, 0); g.stroke(); },
  };
  function drawEmo(g, ch, x, y, size) { if (!ch) return; const s = size / 92; g.drawImage(emo(ch), x - 60 * s, y - 60 * s, 120 * s, 120 * s); }
  function glowSpr(col) {
    return once('G' + col, () => {
      const c = mk(128, 128), g = c.getContext('2d'), q = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      q.addColorStop(0, col); q.addColorStop(1, 'rgba(255,255,255,0)'); g.globalAlpha = 0.9; g.fillStyle = q; g.fillRect(0, 0, 128, 128); return c;
    });
  }
  function drawC(g, c, x, y, s, rot, a) {
    s = s == null ? 1 : s; if (a != null && a <= 0) return;
    g.save(); g.translate(x, y); if (rot) g.rotate(rot); if (a != null) g.globalAlpha = sat(a);
    g.drawImage(c, -c.width * s / 2, -c.height * s / 2, c.width * s, c.height * s); g.restore();
  }

  // Sticker panel: dark outline, white rim, candy fill, gloss, hard shadow.
  function sticker(w, h, col, o) {
    o = o || {};
    return once(['P', w, h, col, o.r, o.rim, o.gloss].join(), () => {
      const r = o.r != null ? o.r : 18, sh = 7, c = mk(w + sh + 4, h + sh + 4), g = c.getContext('2d');
      rr(g, 2 + sh, 2 + sh, w, h, r); g.fillStyle = 'rgba(42,18,4,0.45)'; g.fill();
      rr(g, 2, 2, w, h, r); g.fillStyle = INK; g.fill();
      const rim = o.rim != null ? o.rim : 4;
      if (rim) { rr(g, 6, 6, w - 8, h - 8, Math.max(2, r - 4)); g.fillStyle = '#fffaf0'; g.fill(); }
      const k = 6 + rim; rr(g, k, k, w - 2 * k + 4, h - 2 * k + 4, Math.max(2, r - k + 2));
      const q = g.createLinearGradient(0, k, 0, h - k); q.addColorStop(0, shade(col, 0.25)); q.addColorStop(1, shade(col, -0.18)); g.fillStyle = q; g.fill();
      if (o.gloss !== false) { g.save(); g.clip(); g.fillStyle = 'rgba(255,255,255,0.28)'; rr(g, k + 4, k + 2, w - 2 * k - 4, (h - 2 * k) * 0.42, Math.max(2, r - k)); g.fill(); g.restore(); }
      return c;
    });
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16), f = v => clamp(Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  // Chunky extruded cartoon lettering (any string). face = [top, mid, bottom, extrusion].
  function wordSpr(s, px, face) {
    return once(['W', s, px, face].join(), () => {
      const m = mk(4, 4).getContext('2d'); font(m, px);
      const w = Math.ceil(m.measureText(s).width), pad = Math.ceil(px * 0.2), ext = Math.max(3, Math.round(px * 0.09)), lw = Math.max(6, px * 0.17);
      const c = mk(w + pad * 2 + ext, px * 1.2 + pad * 2 + ext), g = c.getContext('2d');
      const cx = pad + w / 2, cy = pad + px * 0.62;
      const setF = q => { font(q, px); q.textAlign = 'center'; q.textBaseline = 'middle'; q.lineJoin = 'round'; };
      setF(g); g.strokeStyle = INK; g.lineWidth = lw;
      for (let d = ext; d >= 0; d -= 2) g.strokeText(s, cx + d * 0.45, cy + d);
      g.fillStyle = face[3];
      for (let d = ext; d >= 1; d--) g.fillText(s, cx + d * 0.45, cy + d);
      const f = mk(c.width, c.height), q = f.getContext('2d'); setF(q);
      const gr = q.createLinearGradient(0, cy - px * 0.42, 0, cy + px * 0.42);
      gr.addColorStop(0, face[0]); gr.addColorStop(0.5, face[1]); gr.addColorStop(1, face[2]);
      q.fillStyle = gr; q.fillText(s, cx, cy);
      q.globalCompositeOperation = 'source-atop';
      q.fillStyle = 'rgba(255,255,255,0.5)'; q.beginPath(); q.ellipse(cx, cy - px * 0.4, w * 0.62, px * 0.2, 0, 0, TAU); q.fill();
      g.drawImage(f, 0, 0);
      g.lineWidth = Math.max(1.5, px * 0.02); g.strokeStyle = 'rgba(42,18,4,0.8)'; g.strokeText(s, cx, cy);
      c.cx = cx; c.cy = cy; return c;
    });
  }
  const MUSTARD = ['#fff27a', '#ffc81e', '#e8870c', '#7a3c10'];
  const GREEN = ['#d8ff8a', '#62d84a', '#2a9a30', '#1e5a16'];
  const RED = ['#ffb09a', '#ff4a30', '#c01810', '#5a0a04'];
  const PURPLE = ['#e0c8ff', '#9a6af0', '#5a30b0', '#2a1060'];
  const WHITE = ['#ffffff', '#fff6e0', '#ffd88a', '#7a3c10'];

  // Fart cloud puff (3 colour variants).
  const PUFF_COL = [['#c4e070', '#8aa83a'], ['#d8a870', '#9a6a3a'], ['#fff08a', '#c8b040']];
  function puffSpr(k) {
    return once('puff' + k, () => {
      const c = mk(140, 110), g = c.getContext('2d'), P = [[70, 60, 34], [40, 66, 24], [100, 66, 26], [55, 40, 22], [88, 40, 24], [70, 78, 24]];
      g.fillStyle = INK; P.forEach(p => { g.beginPath(); g.arc(p[0], p[1], p[2] + 4, 0, TAU); g.fill(); });
      g.fillStyle = PUFF_COL[k][0]; P.forEach(p => { g.beginPath(); g.arc(p[0], p[1], p[2], 0, TAU); g.fill(); });
      g.fillStyle = PUFF_COL[k][1]; P.forEach(p => { g.beginPath(); g.arc(p[0] + 3, p[1] + p[2] * 0.45, p[2] * 0.5, 0, TAU); g.fill(); });
      g.fillStyle = 'rgba(255,255,255,0.7)'; P.slice(0, 3).forEach(p => { g.beginPath(); g.arc(p[0] - p[2] * 0.35, p[1] - p[2] * 0.4, p[2] * 0.22, 0, TAU); g.fill(); });
      return c;
    });
  }

  // Cartoon shopping cart with the scruffy rider (faces right).
  const cartSpr = () => once('cart', () => {
    const c = mk(260, 200), g = c.getContext('2d'); g.lineJoin = g.lineCap = 'round';
    const L = (pts, col, w) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.strokeStyle = col; g.lineWidth = w; g.stroke(); };
    // legs + flip-flops on the rear bar
    L([[44, 150], [40, 172]], INK, 13); L([[58, 150], [60, 172]], INK, 13); L([[44, 150], [40, 172]], '#f2c29a', 7); L([[58, 150], [60, 172]], '#f2c29a', 7);
    rr(g, 26, 118, 44, 36, 10); g.fillStyle = INK; g.fill(); rr(g, 29, 121, 38, 30, 8); g.fillStyle = '#3a78d8'; g.fill();
    // frame + wheels
    L([[36, 176], [228, 176]], INK, 9); L([[36, 176], [228, 176]], '#c8d2dc', 4);
    L([[96, 140], [80, 176]], INK, 8); L([[210, 140], [214, 176]], INK, 8);
    [[70, 184], [208, 184]].forEach(p => { g.beginPath(); g.arc(p[0], p[1], 13, 0, TAU); g.fillStyle = INK; g.fill(); g.beginPath(); g.arc(p[0], p[1], 5, 0, TAU); g.fillStyle = '#c8d2dc'; g.fill(); });
    // basket
    g.beginPath(); g.moveTo(84, 74); g.lineTo(246, 70); g.lineTo(226, 142); g.lineTo(98, 142); g.closePath();
    g.fillStyle = 'rgba(210,225,240,0.55)'; g.fill();
    g.save(); g.clip(); g.strokeStyle = '#8a9aac'; g.lineWidth = 3;
    for (let x = 90; x < 250; x += 16) { g.beginPath(); g.moveTo(x, 70); g.lineTo(x + 6, 145); g.stroke(); }
    for (let y = 88; y < 145; y += 14) { g.beginPath(); g.moveTo(80, y); g.lineTo(250, y); g.stroke(); }
    g.restore();
    g.beginPath(); g.moveTo(84, 74); g.lineTo(246, 70); g.lineTo(226, 142); g.lineTo(98, 142); g.closePath(); g.strokeStyle = INK; g.lineWidth = 6; g.stroke();
    L([[84, 74], [246, 70]], '#eef4fa', 3);
    // groceries peeking out
    rr(g, 150, 46, 34, 30, 4); g.fillStyle = INK; g.fill(); rr(g, 153, 49, 28, 24, 3); g.fillStyle = '#ff5a8a'; g.fill();
    rr(g, 188, 36, 22, 40, 4); g.fillStyle = INK; g.fill(); rr(g, 191, 39, 16, 34, 3); g.fillStyle = '#ffd23a'; g.fill();
    // handle
    L([[84, 74], [66, 56]], INK, 8); L([[84, 74], [66, 56]], '#c8d2dc', 3);
    L([[60, 50], [72, 62]], INK, 14); L([[60, 50], [72, 62]], '#e8302a', 8);
    // body (tank top, big belly)
    g.beginPath(); g.ellipse(48, 96, 30, 36, 0.15, 0, TAU); g.fillStyle = INK; g.fill();
    g.beginPath(); g.ellipse(48, 96, 26, 32, 0.15, 0, TAU); g.fillStyle = '#fbf6e8'; g.fill();
    g.beginPath(); g.ellipse(56, 108, 7, 5, 0.4, 0, TAU); g.fillStyle = '#d8a860'; g.fill();
    g.beginPath(); g.ellipse(40, 90, 4, 3, 0, 0, TAU); g.fillStyle = '#e0b870'; g.fill();
    // arm to the handle
    L([[52, 76], [66, 58]], INK, 12); L([[52, 76], [66, 58]], '#f2c29a', 7);
    // head, beard, beanie
    g.beginPath(); g.arc(46, 44, 21, 0, TAU); g.fillStyle = INK; g.fill();
    g.beginPath(); g.arc(46, 44, 18, 0, TAU); g.fillStyle = '#f2c29a'; g.fill();
    g.beginPath(); g.arc(48, 50, 17, 0.1, Math.PI - 0.1); g.lineTo(34, 50); g.fillStyle = '#7a4a22'; g.fill();
    g.beginPath(); g.arc(54, 52, 5, 0, Math.PI); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
    g.beginPath(); g.arc(54, 40, 3, 0, TAU); g.fillStyle = INK; g.fill();
    g.beginPath(); g.arc(61, 45, 5, 0, TAU); g.fillStyle = '#f0a078'; g.fill(); g.stroke();
    g.beginPath(); g.arc(46, 36, 19, Math.PI * 1.05, Math.PI * 1.95); g.closePath(); g.fillStyle = INK; g.fill();
    g.beginPath(); g.arc(46, 36, 16, Math.PI * 1.05, Math.PI * 1.95); g.closePath(); g.fillStyle = '#e8302a'; g.fill();
    rr(g, 26, 32, 40, 8, 4); g.fillStyle = INK; g.fill(); rr(g, 28, 33, 36, 6, 3); g.fillStyle = '#ff7a5a'; g.fill();
    g.beginPath(); g.arc(46, 16, 7, 0, TAU); g.fillStyle = INK; g.fill(); g.beginPath(); g.arc(46, 16, 5, 0, TAU); g.fillStyle = '#fff'; g.fill();
    return c;
  });

  // ── State ──────────────────────────────────────────────────────────────────
  const S = {
    state: null, prev: null, stateT: 0, lastT: 0, sel: 0, mx: -1, my: -1, mouse: false, how: false, howT: 0,
    pops: [], farts: [], eats: [], puffs: [], pa: { q: [], cur: null, t0: 0, w: 0 }, fartLast: {},
    takenAt: {}, dispScore: 0, scoreBump: -9, comboLast: 0, comboT: -9, wantLast: 0, wantT: -9, wantI: -1,
    slotPop: {}, runT: -9, bestRef: 0, resLine: '', resSkip: false, puffT: 0, cartPuffT: 0,
  };
  const now = () => (BR.core && BR.core.time != null ? BR.core.time : S.lastT);
  const inside = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

  function project(pos) {
    try {
      const c = BR.core && BR.core.camera, T = BR.core && BR.core.THREE;
      if (!c || !T || !pos) return null;
      const v = new T.Vector3(pos.x || 0, pos.y || 0, pos.z || 0).project(c);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
      return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
    } catch (e) { return null; }
  }

  // ── Bus ────────────────────────────────────────────────────────────────────
  function popSpr(points, reason) {
    const c0 = mk(4, 4).getContext('2d'), a = (points >= 0 ? '+' : '') + fmt(points), b = reason ? ' ' + String(reason).toUpperCase().replace(/!*$/, '!') : '';
    const pa = 44, pb = 30, wa = tw(c0, a, pa), wb = b ? tw(c0, b, pb) : 0, w = wa + wb + 30, c = mk(w, 80), g = c.getContext('2d');
    txt(g, a, 15 + wa / 2, 42, pa, '#ffe23a', { shadow: 4, lw: 11 });
    if (b) txt(g, b, 15 + wa + wb / 2, 44, pb, '#ffffff', { shadow: 3, lw: 9 });
    return c;
  }
  function burstSpr(type, power) {
    const I = gi(type), word = pick(I.words);
    if (type === 'cheese') {
      const c = mk(300, 120), g = c.getContext('2d');
      g.strokeStyle = 'rgba(230,210,90,0.8)'; g.lineWidth = 4; g.lineCap = 'round';
      for (let i = 0; i < 3; i++) { g.beginPath(); for (let k = 0; k <= 20; k++) { const x = 70 + i * 70 + Math.sin(k * 0.8) * 8, y = 110 - k * 4; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
      g.save(); g.transform(1, 0, -0.2, 1, 12, 0); txt(g, word, 150, 50, 34, '#fffbe0', { lw: 7, stroke: 'rgba(90,70,10,0.8)' }); g.restore();
      return c;
    }
    const big = type === 'burrito', px = big ? 70 : 40 + clamp(power || 0.5, 0, 1) * 14;
    const m = mk(4, 4).getContext('2d'), w = tw(m, word, px), r1 = Math.max(w * 0.62 + 30, px * 1.5), r2 = r1 * 0.74;
    const c = mk(r1 * 2 + 30, r1 * 1.5 + 30), g = c.getContext('2d'), cx = c.width / 2, cy = c.height / 2, sy = 0.68;
    const seed = 1 + ((Math.random() * 1e6) | 0), n = big ? 18 : 13;
    g.save(); g.translate(cx, cy); g.scale(1, sy);
    starPath(g, 6, 8 / sy, r1, r2, n, seed, 0.25); g.fillStyle = 'rgba(42,18,4,0.5)'; g.fill();
    starPath(g, 0, 0, r1, r2, n, seed, 0.25); g.fillStyle = INK; g.fill();
    starPath(g, 0, 0, r1 - 8, r2 - 8, n, seed, 0.25); g.fillStyle = I.burst; g.fill();
    if (big) { starPath(g, 0, 0, r1 * 0.72, r2 * 0.7, n, seed + 7, 0.3); g.fillStyle = '#ffd23a'; g.fill(); }
    g.restore();
    txt(g, word, cx, cy + 2, px, big ? '#ffffff' : '#ffffff', { lw: px * 0.26, shadow: 4 });
    return c;
  }
  if (BR.bus) {
    BR.bus.on('score', d => {
      if (S.state !== 'PLAY' || !d || !d.points) return;
      const sp = project(d.pos), n = S.pops.length;
      S.pops.push({ c: popSpr(d.points, d.reason), t0: now(), x: clamp(sp ? sp.x : 640 + (Math.random() - 0.5) * 160, BR.core && BR.core.isTouch ? 600 : 300, BR.core && BR.core.isTouch ? 800 : 980), y: clamp(sp ? sp.y - 40 : 330, 220, 470) - (n % 3) * 44 });
      if (S.pops.length > 6) S.pops.shift();
      S.scoreBump = now();
    });
    BR.bus.on('fart', d => {
      if (S.state !== 'PLAY' || !d) return;
      const type = GI[d.type] ? d.type : 'beans', t = now(), gap = type === 'beans' ? 0.55 : 0.2;
      if (t - (S.fartLast[type] || -9) < gap) return;
      S.fartLast[type] = t;
      const big = type === 'burrito', touch = !!(BR.core && BR.core.isTouch);
      const x = big ? (touch ? 680 : 640) : (touch ? 580 + Math.random() * 220 : 330 + Math.random() * 620), y = big ? (touch ? 380 : 420) : (touch ? 320 + Math.random() * 80 : 470 + Math.random() * 70);
      S.farts.push({ c: burstSpr(type, d.power), t0: t, x, y, sc: touch ? 0.7 : 1, rot: (Math.random() - 0.5) * 0.35, big, life: big ? 1.5 : type === 'cheese' ? 1.6 : 1.0, cheese: type === 'cheese' });
      if (S.farts.length > 6) S.farts.shift();
    });
    BR.bus.on('eat', d => {
      if (!d) return;
      let g = typeof d.gas === 'string' ? d.gas : null;
      const F = CFG().FOODS || {};
      if (!g && typeof d.food === 'string') g = (F[d.food] && F[d.food].gas) || d.food;
      if (!g && d.food && typeof d.food === 'object') g = d.food.gas || d.food.type || d.food.id;
      if (!GI[g]) g = 'beans';
      S.eats.push({ gas: g, t0: now() }); if (S.eats.length > 5) S.eats.shift();
      S.slotPop[g] = now();
    });
    BR.bus.on('collect', d => {
      const it = d && d.item, rl = (BR.rules && BR.rules.list) || [];
      const id = it && typeof it === 'object' ? it.id : it, name = (it && it.name) || ((rl.find(x => x.id === id) || (CFG().LIST_ITEMS || []).find(x => x.id === id)) || {}).name;
      if (name) S.takenAt[name] = now();
    });
    BR.bus.on('announce', d => { if (d && d.text) { S.pa.q.push(String(d.text)); if (S.pa.q.length > 4) S.pa.q.shift(); } });
  }
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const cv = document.getElementById('ui'); if (!cv) return;
    const r = cv.getBoundingClientRect(); S.mx = (e.clientX - r.left) / r.width * W; S.my = (e.clientY - r.top) / r.height * H; S.mouse = true;
  });

  // ── Button layouts (shared by draw + hit) ─────────────────────────────────
  const B = (label, act, x, y, w, h, col) => ({ label, act, x, y, w, h, col });
  function titleBtns() { return [B('PLAY', { type: 'play' }, 470, 466, 340, 90, '#3cc84a'), B('HOW TO PLAY', { type: 'how' }, 495, 572, 290, 66, '#3a9cff')]; }
  const HOW = { x: 120, y: 30, w: 1040, h: 660 };
  function howBtns() { return [B('X', { type: 'closeHow' }, HOW.x + HOW.w - 84, HOW.y + 14, 66, 66, '#ff4a30'), B('GOT IT!', { type: 'closeHow' }, 640 - 150, HOW.y + HOW.h - 84, 300, 68, '#3cc84a')]; }
  function pauseBtns() { return [B('RESUME', { type: 'resume' }, 490, 350, 300, 84, '#3cc84a'), B('QUIT TO TITLE', { type: 'title' }, 490, 452, 300, 68, '#ff7a2a')]; }
  function resultsBtns() { return [B('PLAY AGAIN', { type: 'again' }, 345, 634, 300, 72, '#3cc84a'), B('TITLE', { type: 'title' }, 675, 634, 260, 72, '#3a9cff')]; }
  function gasPanel(v) {
    return v.isTouch ? { x: 516, y: 632, w: 312, h: 80, sw: 60, pad: 6 } : { x: 420, y: 600, w: 440, h: 108, sw: 84, pad: 10 };
  }
  function gasSlots(v) {
    const P = gasPanel(v); return GAS().map((id, i) => ({ id, x: P.x + P.pad + i * P.sw, y: P.y, w: P.sw, h: P.h, act: { type: 'gas', id } }));
  }
  function menuBtns(v) {
    if (v.state === 'TITLE') return v.how ? howBtns() : titleBtns();
    if (v.state === 'PAUSE') return pauseBtns();
    if (v.state === 'RESULTS') return resultsBtns();
    if (v.state === 'PLAY' && !v.isTouch) return gasSlots(v);
    return [];
  }
  function hoverSel(btns, v) { if (v.isTouch || !S.mouse) return; const i = btns.findIndex(b => inside(b, S.mx, S.my)); if (i >= 0) S.sel = i; }

  function drawBtn(g, b, hot, t) {
    const spr = sticker(b.w, b.h, b.col, { r: b.h / 2 }), s = hot ? 1.07 + Math.sin(t * 9) * 0.025 : 1, rot = hot ? Math.sin(t * 5) * 0.025 : 0;
    g.save(); g.translate(b.x + b.w / 2, b.y + b.h / 2); g.rotate(rot); g.scale(s, s);
    g.drawImage(spr, -b.w / 2 - 2, -b.h / 2 - 2);
    txt(g, b.label, 0, 1, b.label === 'X' ? 34 : Math.min(b.h * 0.42, (b.w - 40) / (b.label.length * 0.62)), '#ffffff', { lw: 8 });
    g.restore();
    if (hot && b.label !== 'X') {
      const x = b.x - 26 + Math.sin(t * 10) * 7, y = b.y + b.h / 2;
      g.beginPath(); g.moveTo(x, y - 16); g.lineTo(x + 24, y); g.lineTo(x, y + 16); g.closePath();
      g.fillStyle = '#ffd23a'; g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke(); g.fill();
    }
  }
  function drawBtns(g, btns, t, v) {
    hoverSel(btns, v); S.sel = clamp(S.sel, 0, btns.length - 1);
    btns.forEach((b, i) => drawBtn(g, b, !v.isTouch && i === S.sel, t));
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  const rays = () => once('rays', () => {
    const c = mk(900, 900), g = c.getContext('2d'), n = 22;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * TAU, a1 = (i + 0.5) / n * TAU;
      g.beginPath(); g.moveTo(450, 450); g.arc(450, 450, 450, a0, a1); g.closePath();
      g.fillStyle = i % 2 ? 'rgba(255,200,40,0.55)' : 'rgba(255,140,40,0.45)'; g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    const q = g.createRadialGradient(450, 450, 60, 450, 450, 450); q.addColorStop(0, 'rgba(0,0,0,1)'); q.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = q; g.fillRect(0, 0, 900, 900); return c;
  });
  const vign = () => once('vign', () => {
    const c = mk(320, 180), g = c.getContext('2d'), q = g.createRadialGradient(160, 80, 40, 160, 90, 200);
    q.addColorStop(0, 'rgba(60,30,8,0)'); q.addColorStop(1, 'rgba(50,22,6,0.6)'); g.fillStyle = q; g.fillRect(0, 0, 320, 180);
    const b = g.createLinearGradient(0, 100, 0, 180); b.addColorStop(0, 'rgba(40,18,4,0)'); b.addColorStop(1, 'rgba(40,18,4,0.5)'); g.fillStyle = b; g.fillRect(0, 100, 320, 80);
    return c;
  });
  const LOGO = { y: 178, px: 170, maxW: 1150 };
  const logoLetters = () => once('logoL', () => {
    const s = 'BUM RUSH', m = mk(4, 4).getContext('2d'); font(m, LOGO.px);
    const adv = [...s].map(ch => (ch === ' ' ? LOGO.px * 0.32 : m.measureText(ch).width + LOGO.px * 0.02));
    const total = adv.reduce((a, b) => a + b, 0), k = Math.min(1, LOGO.maxW / total);
    let x = 640 - total * k / 2; const out = [];
    [...s].forEach((ch, i) => { if (ch !== ' ') out.push({ ch, x: x + adv[i] * k / 2, spr: wordSpr(ch, LOGO.px, MUSTARD), k, i }); x += adv[i] * k; });
    return out;
  });
  const tagSpr = () => once('tag', () => {
    const c = mk(260, 170), g = c.getContext('2d');
    starPath(g, 136, 90, 118, 96, 16, 5, 0.1); g.fillStyle = 'rgba(42,18,4,0.45)'; g.fill();
    starPath(g, 130, 84, 118, 96, 16, 5, 0.1); g.fillStyle = INK; g.fill();
    starPath(g, 130, 84, 110, 88, 16, 5, 0.1); g.fillStyle = '#ff4a8a'; g.fill();
    txt(g, 'EAT.', 130, 50, 30, '#ffffff', { lw: 7 }); txt(g, 'FART.', 130, 84, 34, '#ffe23a', { lw: 8 }); txt(g, 'CHECKOUT.', 130, 118, 26, '#ffffff', { lw: 7 });
    return c;
  });

  function spawnPuff(x, y, vx, vy, k, s) { S.puffs.push({ x, y, vx, vy, k, s: s || 1, t0: S.lastT, life: 1.1 + Math.random() * 0.5, rot: Math.random() * TAU }); if (S.puffs.length > 46) S.puffs.shift(); }
  function drawPuffs(g, t, dt) {
    S.puffs = S.puffs.filter(p => t - p.t0 < p.life);
    S.puffs.forEach(p => {
      const a = (t - p.t0) / p.life; p.x += p.vx * dt; p.y += p.vy * dt;
      drawC(g, puffSpr(p.k), p.x, p.y, p.s * (0.3 + easeOutBack(a * 2.2) * 0.7 + a * 0.4), p.rot + a * 0.8, (1 - a) * 1.4);
    });
  }

  function drawTitle(g, t, v, dt) {
    const T = t - S.stateT;
    g.drawImage(vign(), 0, 0, W, H);
    drawC(g, rays(), 640, LOGO.y + 10, 1.45, t * 0.12, 0.85);
    // puffs popping from behind the letters
    const L = logoLetters();
    S.puffT -= dt;
    if (S.puffT <= 0 && T > 0.8) {
      S.puffT = 0.16 + Math.random() * 0.2; const l = pick(L), side = Math.random() < 0.5 ? -1 : 1;
      spawnPuff(l.x + side * 40, LOGO.y + 40 + Math.random() * 30, side * (60 + Math.random() * 80), -30 - Math.random() * 50, (Math.random() * 3) | 0, 0.7 + Math.random() * 0.5);
    }
    // cart zooming across the lane
    const per = 6.5, ph = ((t + 2) % per) / per, cx = -200 + ph * 1700, cy = 405 + Math.abs(Math.sin(t * 13)) * -5;
    if (cx > -150 && cx < 1450) {
      S.cartPuffT -= dt;
      if (S.cartPuffT <= 0) { S.cartPuffT = 0.07; spawnPuff(cx - 125, cy + 40 + (Math.random() - 0.5) * 20, -120 - Math.random() * 60, -20 - Math.random() * 30, 1, 0.55 + Math.random() * 0.3); }
    }
    drawPuffs(g, t, dt);
    if (cx > -150 && cx < 1450) {
      g.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const y = cy - 40 + i * 20, len = 140 + ((i * 53 + t * 700) % 120);
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 6; g.beginPath(); g.moveTo(cx - 140 - i * 10, y); g.lineTo(cx - 140 - len - i * 10, y); g.stroke();
      }
      drawC(g, cartSpr(), cx, cy, 0.78, Math.sin(t * 13) * 0.04 - 0.05);
    }
    // logo letters: drop in, then wobble
    L.forEach((l, j) => {
      const e = easeOutBack((T - j * 0.07) / 0.55); if (e <= 0) return;
      const y = LOGO.y - (1 - e) * 420 + Math.sin(t * 4 + j * 0.8) * 7;
      const rot = Math.sin(t * 2.8 + j * 1.1) * 0.07, sq = 1 + Math.sin(t * 6 + j) * 0.035;
      const c = l.spr;
      g.save(); g.translate(l.x, y); g.rotate(rot); g.scale(l.k * (2 - sq), l.k * sq);
      g.drawImage(c, -c.cx, -c.cy); g.restore();
    });
    // subtitle + tagline
    const se = easeOutBack((T - 0.8) / 0.5);
    if (se > 0) { g.save(); g.translate(640, 300); g.scale(se, se); txt(g, 'a game by Jon Hill', 0, 0, 34, '#ffffff', { lw: 9, shadow: 4 }); g.restore(); }
    const te = easeOutBack((T - 1.1) / 0.5);
    if (te > 0) drawC(g, tagSpr(), 1098, 318, te * (1 + Math.sin(t * 3) * 0.04), -0.2 + Math.sin(t * 1.7) * 0.05);
    // buttons + best
    if (!v.how) drawBtns(g, titleBtns(), t, v); else titleBtns().forEach(b => drawBtn(g, b, false, t));
    const best = v.best || 0, rb = best > 0 ? 'BEST: ' + fmt(best) : 'BEST: none yet';
    const rw = tw(g, rb, 26) + 70;
    g.drawImage(sticker(rw, 46, '#ffc81e', { r: 12 }), 640 - rw / 2, 656);
    txt(g, rb, 640, 681, 26, '#ffffff', { lw: 7 });
  }

  // ── How to play ────────────────────────────────────────────────────────────
  const howSpr = touch => once('how' + touch, () => {
    const P = HOW, c = mk(W, H), g = c.getContext('2d');
    g.drawImage(sticker(P.w, P.h, '#fff4d6', { r: 30, gloss: false }), P.x - 2, P.y - 2);
    const hw = wordSpr('HOW TO PLAY', 56, MUSTARD); g.drawImage(hw, 640 - hw.cx, P.y + 50 - hw.cy);
    const lx = P.x + 40;
    // food -> gas
    txt(g, '1. GRAB FOOD = GET GAS', lx, P.y + 118, 26, '#ff4a8a', { align: 'left', lw: 7 });
    const rows = GAS();
    rows.forEach((id, i) => {
      const y = P.y + 164 + i * 54, I = gi(id);
      g.beginPath(); g.arc(lx + 28, y, 26, 0, TAU); g.fillStyle = INK; g.fill();
      g.beginPath(); g.arc(lx + 28, y, 22, 0, TAU); g.fillStyle = '#ffffff'; g.fill();
      drawEmo(g, icon(id), lx + 28, y, 36);
      txt(g, I.name, lx + 66, y - 1, 24, I.col, { align: 'left', lw: 7, stroke: INK });
      font(g, 19); g.textAlign = 'left'; g.fillStyle = INK; g.fillText(I.fx, lx + 220, y + 1);
    });
    txt(g, '2. THE MISSION', lx, P.y + 448, 26, '#3a9cff', { align: 'left', lw: 7 });
    [['🧾', 'Grab EVERYTHING on the shopping list.'], ['🛒', 'Reach CHECKOUT before the store closes.'], ['🚨', 'Knock stuff over = WANTED. Do not get caught!']].forEach((r, i) => {
      const y = P.y + 484 + i * 31; drawEmo(g, r[0], lx + 18, y, 26);
      font(g, 19); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(r[1], lx + 44, y + 1);
    });
    // controls column
    const cx = P.x + 670, cw = P.w - 700;
    rr(g, cx - 14, P.y + 96, cw + 14, 470, 20); g.fillStyle = 'rgba(42,18,4,0.08)'; g.fill();
    txt(g, touch ? 'TOUCH CONTROLS' : 'KEYS', cx + cw / 2 - 7, P.y + 124, 26, '#62c848', { lw: 7 });
    const K = touch
      ? [['LEFT SLIDER', 'Steer'], ['KICK', 'Push off'], ['DRIFT', 'Slide the corners'], ['FART', 'Blast! (hold for beans)'], ['FOOD ICONS', 'Pick your gas'], ['II', 'Pause']]
      : [['W / UP', 'Kick forward'], ['S / DOWN', 'Brake'], ['A / D', 'Steer'], ['SPACE', 'Drift'], ['SHIFT / E', 'FART! (hold beans)'], ['Q / R', 'Change gas'], ['1 - 5', 'Pick gas'], ['H', 'Horn'], ['ESC', 'Pause']];
    const rh = touch ? 62 : 46;
    K.forEach((k, i) => {
      const y = P.y + 170 + i * rh, kw = Math.max(46, tw(g, k[0], 17) + 22);
      rr(g, cx, y - 17, kw, 36, 9); g.fillStyle = INK; g.fill(); rr(g, cx + 2, y - 15, kw - 4, 28, 7); g.fillStyle = '#ffffff'; g.fill();
      font(g, 17); g.textAlign = 'center'; g.fillStyle = INK; g.fillText(k[0], cx + kw / 2, y - 1);
      font(g, 18); g.textAlign = 'left'; g.fillText(k[1], cx + kw + 12, y + 1);
    });
    return c;
  });
  function drawHow(g, t, v) {
    const e = easeOutBack((t - S.howT) / 0.4);
    g.fillStyle = `rgba(40,18,4,${0.55 * sat((t - S.howT) / 0.2)})`; g.fillRect(0, 0, W, H);
    g.save(); g.translate(640, 360); g.scale(e, e); g.rotate((1 - e) * 0.1); g.translate(-640, -360);
    g.drawImage(howSpr(!!v.isTouch), 0, 0);
    drawBtns(g, howBtns(), t, v);
    g.restore();
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  function hudL(v) {
    return v.isTouch ? { right: 1180, speedo: false } : { right: 1258, speedo: true };
  }
  const itemIcon = it => it.icon || ((CFG().LIST_ITEMS || []).find(x => x.name === it.name || x.id === it.id) || {}).icon || '🛍️';
  function paperPath(g, x, y, w, h, tt) {
    g.beginPath(); g.moveTo(x, y + tt); let k = 0;
    for (let i = tt; i < w; i += tt) g.lineTo(x + i, y + (k++ % 2 ? tt : 0));
    g.lineTo(x + w, y + tt); g.lineTo(x + w, y + h - tt); k = 0;
    for (let i = w - tt; i > 0; i -= tt) g.lineTo(x + i, y + h - (k++ % 2 ? tt : 0));
    g.lineTo(x, y + h - tt); g.closePath();
  }
  function crumple(g, w, h, seed) {
    let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 10; i++) {
      const x = r() * w, y = r() * h, a = r() * TAU, l = 40 + r() * 120;
      g.strokeStyle = `rgba(140,110,70,${0.1 + r() * 0.12})`; g.lineWidth = 1 + r() * 1.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 4; i++) { const q = g.createRadialGradient(r() * w, r() * h, 0, r() * w, r() * h, 60); q.addColorStop(0, 'rgba(150,120,80,0.08)'); q.addColorStop(1, 'rgba(150,120,80,0)'); g.fillStyle = q; g.fillRect(0, 0, w, h); }
  }
  function checkPath(g, x, y, s) { g.beginPath(); g.moveTo(x - 9 * s, y); g.lineTo(x - 2 * s, y + 8 * s); g.lineTo(x + 12 * s, y - 10 * s); }
  function checkoutInfo() {
    const c = BR.cart; if (!c || !c.pos) return null;
    const st = BR.store, s = st && st.spots; let cand = [];
    const add = o => { if (Array.isArray(o)) o.forEach(add); else if (o && o.x != null && o.z != null) cand.push(o); };
    if (s) {
      if (Array.isArray(s)) s.forEach(o => { if (o && /checkout/i.test(o.name || o.id || '')) add(o); });
      else Object.keys(s).forEach(k => { if (/checkout/i.test(k)) add(s[k]); else if (s[k] && /checkout/i.test(s[k].name || '')) add(s[k]); });
    }
    if (!cand.length) cand = [{ x: 0, z: 55 }];
    let best = null, bd = 1e9;
    cand.forEach(p => { const d = Math.hypot(p.x - c.pos.x, p.z - c.pos.z); if (d < bd) { bd = d; best = p; } });
    const dx = best.x - c.pos.x, dz = best.z - c.pos.z, yaw = c.yaw || 0;
    const fwd = -Math.sin(yaw) * dx - Math.cos(yaw) * dz, rgt = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
    return { dist: bd, ang: Math.atan2(rgt, fwd) };
  }
  // Compact list: item icon chips under the clock (names only in a 2 s tooltip on collect).
  const ROW = { cy: 172, chip: 44, gap: 7 };
  function drawItems(g, t, v, near) {
    const list = v.list || []; if (!list.length) return;
    const T = t - S.runT, n = list.length, step = ROW.chip + ROW.gap, x0 = 640 - (n * step - ROW.gap) / 2 + ROW.chip / 2;
    list.forEach(it => {
      if (it.taken && S.takenAt[it.name] == null) S.takenAt[it.name] = T < 0.3 ? -9 : t;
      if (!it.taken) delete S.takenAt[it.name];
    });
    const tips = [];
    list.forEach((it, i) => {
      const x = x0 + i * step, a = t - (S.takenAt[it.name] || -9), inE = easeOutBack((T - 0.15 - i * 0.05) / 0.4);
      if (inE <= 0) return;
      const pop = it.taken && a < 0.5 ? 1 + (1 - elastic(a / 0.5)) * 0.5 : 1, pulse = !it.taken && near ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
      const s = inE * pop * (1 + pulse * 0.1), h = ROW.chip;
      g.save(); g.translate(x, ROW.cy); g.scale(s, s);
      g.globalAlpha = it.taken && a > 0.5 ? 0.55 : 1;
      rr(g, -h / 2 + 3, -h / 2 + 4, h, h, 12); g.fillStyle = 'rgba(42,18,4,0.4)'; g.fill();
      rr(g, -h / 2, -h / 2, h, h, 12); g.fillStyle = INK; g.fill();
      rr(g, -h / 2 + 3, -h / 2 + 3, h - 6, h - 6, 10); g.fillStyle = pulse ? `rgb(255,${Math.round(220 - pulse * 140)},${Math.round(200 - pulse * 150)})` : it.taken ? '#d8f4c8' : '#fff4d6'; g.fill();
      drawEmo(g, itemIcon(it), 0, 1, h * 0.72);
      g.globalAlpha = 1;
      if (it.taken) {
        const cs = a > 1 ? 1 : 0.2 + easeOutBack(a / 0.35) * 0.8;
        g.translate(h * 0.3, h * 0.28); g.scale(cs * 0.8, cs * 0.8); g.lineCap = g.lineJoin = 'round';
        checkPath(g, 0, 0, 1); g.strokeStyle = INK; g.lineWidth = 9; g.stroke(); g.strokeStyle = '#3cc84a'; g.lineWidth = 4.5; g.stroke();
      } else if (pulse) {
        rr(g, -h / 2 - 2, -h / 2 - 2, h + 4, h + 4, 13); g.lineWidth = 3; g.strokeStyle = `rgba(255,40,30,${0.4 + pulse * 0.6})`; g.stroke();
      }
      g.restore();
      if (it.taken && a < 2) tips.push({ x, a, it });
    });
    tips.forEach(tp => {
      const e = easeOutBack(tp.a / 0.3), al = sat((2 - tp.a) / 0.3), s = '+ ' + tp.it.name, w = tw(g, s, 18) + 28;
      const x = clamp(tp.x, w / 2 + 330, 950 - w / 2), y = ROW.cy + 46;
      g.save(); g.globalAlpha = al; g.translate(x, y); g.scale(e, e);
      g.beginPath(); g.moveTo(tp.x - x - 9, -16); g.lineTo(tp.x - x, -26); g.lineTo(tp.x - x + 9, -16); g.closePath(); g.fillStyle = INK; g.fill();
      g.drawImage(sticker(w, 34, '#3cc84a', { r: 17, rim: 0 }), -w / 2 - 2, -19);
      txt(g, s, 0, -1, 18, '#ffffff', { lw: 5 }); g.restore();
    });
  }
  const clockFace = () => once('clockF', () => {
    const c = mk(84, 84), g = c.getContext('2d');
    g.beginPath(); g.arc(42, 42, 38, 0, TAU); g.fillStyle = INK; g.fill();
    g.beginPath(); g.arc(42, 42, 33, 0, TAU); g.fillStyle = '#ffffff'; g.fill();
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.strokeStyle = INK; g.lineWidth = i % 3 ? 2 : 4; g.beginPath(); g.moveTo(42 + Math.cos(a) * 26, 42 + Math.sin(a) * 26); g.lineTo(42 + Math.cos(a) * 31, 42 + Math.sin(a) * 31); g.stroke(); }
    return c;
  });
  function drawClock(g, t, v) {
    const tl = Math.max(0, v.timeLeft || 0), run = CFG().RUN_SECONDS || 240, urgent = tl < 30;
    const pw = 300, ph = 88, cx = 640, cy = 96;
    const s = urgent ? 1 + Math.pow(Math.abs(Math.sin(t * (tl < 10 ? 7 : 4.5))), 3) * 0.1 : 1;
    const shk = urgent && tl < 10 ? Math.sin(t * 60) * 2 : 0;
    g.save(); g.translate(cx + shk, cy); g.scale(s, s);
    g.drawImage(sticker(pw, ph, urgent ? '#ff3a2a' : '#ffc81e', { r: 26 }), -pw / 2 - 2, -ph / 2 - 2);
    const fx = -pw / 2 + 50;
    g.drawImage(clockFace(), fx - 42, -42);
    const frac = sat(tl / run);
    g.beginPath(); g.moveTo(fx, 0); g.arc(fx, 0, 24, -Math.PI / 2, -Math.PI / 2 + frac * TAU); g.closePath();
    g.fillStyle = frac > 0.5 ? 'rgba(60,200,74,0.55)' : frac > 0.125 ? 'rgba(255,170,30,0.6)' : 'rgba(255,50,40,0.65)'; g.fill();
    const ha = -Math.PI / 2 + frac * TAU; g.lineCap = 'round';
    g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.moveTo(fx, 0); g.lineTo(fx + Math.cos(ha) * 22, Math.sin(ha) * 22); g.stroke();
    const ma = t * 6; g.lineWidth = 3; g.strokeStyle = '#e8302a'; g.beginPath(); g.moveTo(fx, 0); g.lineTo(fx + Math.cos(ma) * 28, Math.sin(ma) * 28); g.stroke();
    g.beginPath(); g.arc(fx, 0, 4, 0, TAU); g.fillStyle = INK; g.fill();
    const m = Math.floor(tl / 60), sec = Math.floor(tl % 60), str = m + ':' + (sec < 10 ? '0' : '') + sec;
    txt(g, urgent ? 'CLOSING!!' : 'STORE CLOSES IN', 50, -24, 15, '#ffffff', { lw: 5 });
    txt(g, str, 50, 12, 50, '#ffffff', { lw: 10 });
    g.restore();
  }
  const ledDots = () => once('led', () => {
    const c = mk(620, 30), g = c.getContext('2d'); g.fillStyle = 'rgba(20,8,2,0.55)';
    for (let x = 0; x < 620; x += 3) g.fillRect(x, 0, 1, 30);
    for (let y = 0; y < 30; y += 3) g.fillRect(0, y, 620, 1);
    return c;
  });
  const IDLE = '★ BULKZILLA WAREHOUSE ★ EVERYTHING IN BULK ★ NO RUNNING IN THE AISLES ★ FREE SAMPLES IN AISLE 9 ★ ';
  function drawTicker(g, t, v) {
    const x = 330, y = 6, w = 620, h = 34, pa = S.pa;
    if (!pa.cur && pa.q.length) { pa.cur = pa.q.shift().toUpperCase(); pa.t0 = t; pa.w = tw(g, 'PA: ' + pa.cur, 20); }
    const live = !!pa.cur, blink = live && Math.sin(t * 12) > 0;
    rr(g, x - 4, y - 2, w + 8, h + 4, 10); g.fillStyle = INK; g.fill();
    rr(g, x, y + 2, w, h - 4, 7); g.fillStyle = '#1e0f06'; g.fill();
    g.save(); rr(g, x + 4, y + 4, w - 8, h - 8, 5); g.clip();
    font(g, 20); g.textBaseline = 'middle'; g.textAlign = 'left';
    const col = live ? '#ffb020' : '#ff7a2a';
    g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 8;
    if (live) {
      const px = x + w - (t - pa.t0) * 170;
      g.fillText('PA: ' + pa.cur, px, y + h / 2 + 1);
      if (px + pa.w < x) pa.cur = null;
    } else {
      const iw = S.idleW || (S.idleW = tw(g, IDLE, 20)); font(g, 20);
      const off = (t * 70) % iw;
      g.fillText(IDLE, x - off, y + h / 2 + 1); g.fillText(IDLE, x - off + iw, y + h / 2 + 1);
    }
    g.shadowBlur = 0; g.restore();
    g.drawImage(ledDots(), x + 4, y + 4, w - 8, h - 8);
    if (live) { g.lineWidth = 3; g.strokeStyle = blink ? '#ff3a2a' : '#ffb020'; rr(g, x - 4, y - 2, w + 8, h + 4, 10); g.stroke(); }
  }
  function badgeSpr(lit) {
    return once('badge' + lit, () => {
      const c = mk(64, 64), g = c.getContext('2d'), cx = 32, cy = 33, R = 25;
      const pts = []; for (let i = 0; i < 12; i++) { const a = i / 12 * TAU - Math.PI / 2; pts.push([cx + Math.cos(a) * (i % 2 ? R * 0.55 : R), cy + Math.sin(a) * (i % 2 ? R * 0.55 : R)]); }
      const path = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      g.lineJoin = 'round'; path(); g.lineWidth = 8; g.strokeStyle = INK; g.stroke();
      const q = g.createLinearGradient(0, 6, 0, 60);
      if (lit) { q.addColorStop(0, '#fff6a0'); q.addColorStop(0.5, '#ffc81e'); q.addColorStop(1, '#c87a08'); } else { q.addColorStop(0, 'rgba(200,190,170,0.75)'); q.addColorStop(1, 'rgba(120,110,95,0.75)'); }
      path(); g.fillStyle = q; g.fill();
      pts.forEach((p, i) => { if (i % 2) return; g.beginPath(); g.arc(p[0], p[1], 4.5, 0, TAU); g.fillStyle = INK; g.fill(); g.beginPath(); g.arc(p[0], p[1], 3, 0, TAU); g.fillStyle = lit ? '#ffe070' : '#b0a898'; g.fill(); });
      g.beginPath(); g.arc(cx, cy, 10, 0, TAU); g.fillStyle = lit ? '#e8a010' : 'rgba(110,100,90,0.8)'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = INK; g.stroke();
      if (lit) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(cx - 7, cy - 12, 5, 3, -0.5, 0, TAU); g.fill(); }
      return c;
    });
  }
  function drawWanted(g, t, v, L) {
    const w = clamp(v.wanted || 0, 0, 5), n = Math.floor(w + 1e-6);
    if (n > S.wantLast) { S.wantT = t; S.wantI = n - 1; }
    S.wantLast = n;
    const fl = t - S.wantT, x0 = L.right - 25 - 4 * 50, y = 52;
    if (n > 0) {
      const a = 0.25 + 0.2 * Math.sin(t * 10);
      g.globalAlpha = sat(a + (fl < 1 ? 0.5 : 0)); g.drawImage(glowSpr(Math.sin(t * 10) > 0 ? '#ff3a2a' : '#3a6aff'), L.right - 260, y - 60, 280, 120); g.globalAlpha = 1;
    }
    txt(g, n ? 'WANTED!' : 'WANTED', L.right - 125, 14, 15, n ? '#ffe23a' : '#ffffff', { lw: 5 });
    for (let i = 0; i < 5; i++) {
      const lit = i < n, bx = x0 + i * 50;
      let s = 0.78, rot = 0;
      if (lit) { s = 0.8 + Math.sin(t * 6 + i) * 0.02; rot = Math.sin(t * 3 + i) * 0.08; }
      if (i === S.wantI && fl < 0.8) { s *= 1 + (1 - elastic(fl / 0.8)) * 0.9; rot += (1 - fl / 0.8) * 1.2; }
      drawC(g, badgeSpr(false), bx, y, 0.78);
      if (lit) drawC(g, badgeSpr(true), bx, y, s, rot);
      else if (i === n && w - n > 0.05) drawC(g, badgeSpr(true), bx, y, 0.78, 0, (w - n) * 0.45);
    }
    if (fl < 0.35) { g.globalAlpha = 0.6 * (1 - fl / 0.35); g.drawImage(glowSpr('#ffffff'), x0 + S.wantI * 50 - 50, y - 50, 100, 100); g.globalAlpha = 1; }
  }
  function drawScore(g, t, v, L) {
    const sc = v.score || 0, dt = Math.min(0.1, t - (S.scoreLastT || t)); S.scoreLastT = t;
    S.dispScore += (sc - S.dispScore) * Math.min(1, dt * 7); if (Math.abs(sc - S.dispScore) < 1) S.dispScore = sc;
    const b = t - S.scoreBump, s = b < 0.4 ? 1 + (1 - elastic(b / 0.4)) * 0.3 : 1, str = fmt(S.dispScore);
    txt(g, 'SCORE', L.right, 92, 15, '#ffffff', { align: 'right', lw: 5 });
    g.save(); g.translate(L.right, 124); g.scale(s, s); txt(g, str, 0, 0, 40, '#ffe23a', { align: 'right', lw: 10, shadow: 4 }); g.restore();
    const combo = v.combo || 0;
    if (combo !== S.comboLast) { if (combo > S.comboLast) S.comboT = t; S.comboLast = combo; }
    if (combo >= 2) {
      const sw = tw(g, str, 40), cx = L.right - sw - 58, cy = 122, e = t - S.comboT, cs = e < 0.5 ? 0.4 + elastic(e / 0.5) * 0.6 : 1 + Math.sin(t * 7) * 0.05;
      g.save(); g.translate(cx, cy); g.rotate(Math.sin(t * 4) * 0.12); g.scale(cs, cs);
      starPath(g, 0, 0, 40, 30, 12, 3, 0); g.fillStyle = INK; g.fill();
      starPath(g, 0, 0, 34, 25, 12, 3, 0); g.fillStyle = '#ff8a1a'; g.fill();
      txt(g, 'x' + combo, 0, -3, 26, '#ffffff', { lw: 7 });
      txt(g, 'COMBO', 0, 20, 11, '#ffe23a', { lw: 4 });
      g.restore();
    }
  }
  const tubeBg = h => once('tube' + h, () => {
    const c = mk(20, h + 4), g = c.getContext('2d'); rr(g, 2, 2, 16, h, 8); g.fillStyle = INK; g.fill(); rr(g, 4, 4, 12, h - 4, 6); g.fillStyle = '#4a3020'; g.fill(); return c;
  });
  function drawGas(g, t, v) {
    const P = gasPanel(v), slots = gasSlots(v), gas = v.gas || {}, sel = v.gasSel;
    g.drawImage(sticker(P.w, P.h, '#fff0c8', { r: 22, gloss: false }), P.x - 2, P.y - 2);
    const th = P.h - 26;
    slots.forEach((sl, i) => {
      const id = sl.id, I = gi(id), f = sat(gas[id] || 0), on = id === sel;
      const gx = sl.x + 6, gy = P.y + 13;
      g.drawImage(tubeBg(th), gx - 2, gy - 2);
      if (f > 0.01) {
        const fh = (th - 4) * f, fy = gy + 2 + (th - 4) - fh;
        g.save(); rr(g, gx + 2, gy + 2, 12, th - 4, 6); g.clip();
        const q = g.createLinearGradient(0, fy, 0, gy + th); q.addColorStop(0, I.hi); q.addColorStop(1, I.col);
        g.fillStyle = q; g.fillRect(gx + 2, fy, 12, fh);
        g.fillStyle = 'rgba(255,255,255,0.45)';
        for (let k = 0; k < 3; k++) { const by = gy + th - ((t * 30 + k * 23 + i * 11) % Math.max(8, fh)); g.beginPath(); g.arc(gx + 6 + (k % 2) * 4, by, 2, 0, TAU); g.fill(); }
        g.fillRect(gx + 4, fy, 3, fh);
        g.restore();
        if (f >= 0.99) { g.globalAlpha = 0.4 + 0.3 * Math.sin(t * 8); g.drawImage(glowSpr(I.hi), gx - 18, gy - 10, 52, th + 20); g.globalAlpha = 1; }
      }
      const pop = t - (S.slotPop[id] || -9), ps = pop < 0.5 ? 1 + (1 - elastic(pop / 0.5)) * 0.5 : 1;
      const icx = sl.x + (v.isTouch ? 38 : 50), icy = P.y + (v.isTouch ? 38 : 48) - (on ? 8 + Math.abs(Math.sin(t * 5)) * 3 : 0);
      const s = (on ? 1.2 : 1) * ps, r = (v.isTouch ? 17 : 26) * s;
      if (on) { g.globalAlpha = 0.85; g.drawImage(glowSpr(I.hi), icx - r * 2, icy - r * 2, r * 4, r * 4); g.globalAlpha = 1; }
      g.beginPath(); g.arc(icx, icy, r + 4, 0, TAU); g.fillStyle = INK; g.fill();
      g.beginPath(); g.arc(icx, icy, r, 0, TAU); g.fillStyle = on ? '#ffffff' : '#f4e8d0'; g.fill();
      if (on) { g.lineWidth = 3; g.strokeStyle = I.col; g.stroke(); }
      g.globalAlpha = f < 0.03 && !on ? 0.4 : 1; drawEmo(g, icon(id), icx, icy, r * 1.4); g.globalAlpha = 1;
      if (on) txt(g, I.name, icx - 6, P.y + P.h - 10, v.isTouch ? 14 : 15, I.hi, { lw: 5 });
      if (!v.isTouch) {
        const kx = sl.x + sl.w - 12, ky = P.y + 16;
        rr(g, kx - 10, ky - 10, 20, 20, 5); g.fillStyle = INK; g.fill(); rr(g, kx - 8, ky - 8, 16, 16, 4); g.fillStyle = '#ffffff'; g.fill();
        font(g, 12); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(String(i + 1), kx, ky + 1);
      }
      if (!v.isTouch && S.mouse && inside(sl, S.mx, S.my) && !on) { rr(g, sl.x + 2, P.y + 6, sl.w - 4, P.h - 12, 12); g.lineWidth = 3; g.strokeStyle = 'rgba(42,18,4,0.5)'; g.stroke(); }
    });
    if (!v.isTouch) {
      const si = Math.max(0, GAS().indexOf(sel)), sl = slots[si], hx = sl.x + sl.w / 2, hs = 'SHIFT / E = FART!', hw = tw(g, hs, 14) + 26;
      g.drawImage(sticker(hw, 28, gi(sel).col, { r: 14, rim: 0 }), hx - hw / 2, P.y - 36);
      txt(g, hs, hx + 2, P.y - 21, 14, '#ffffff', { lw: 4 });
      [['Q', P.x - 30, -1], ['R', P.x + P.w + 30, 1]].forEach(k => {
        const x = k[1], y = P.y + 54;
        rr(g, x - 17, y - 17, 34, 34, 8); g.fillStyle = INK; g.fill(); rr(g, x - 14, y - 14, 28, 28, 6); g.fillStyle = '#ffffff'; g.fill();
        txt(g, k[0], x, y + 1, 18, INK, { stroke: false });
        g.beginPath(); g.moveTo(x + k[2] * 22, y - 9); g.lineTo(x + k[2] * 34, y); g.lineTo(x + k[2] * 22, y + 9); g.closePath(); g.fillStyle = '#ffc81e'; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
      });
    } else {
      const mph = Math.round(Math.abs(v.speed || 0) * 2.237), s = mph + ' MPH', sw = tw(g, s, 18) + 30;
      g.drawImage(sticker(sw, 32, mph > 35 ? '#ff4a30' : '#3a9cff', { r: 16, rim: 0 }), 672 - sw / 2, P.y - 36);
      txt(g, s, 674, P.y - 19, 18, '#ffffff', { lw: 5 });
    }
    // +GAS pickups
    S.eats = S.eats.filter(e => t - e.t0 < 1.1);
    S.eats.forEach(e => {
      const sl = slots[Math.max(0, GAS().indexOf(e.gas))], a = (t - e.t0) / 1.1, x = sl.x + sl.w / 2, y = P.y - 20 - easeOut(a) * 70;
      const c = once('eat' + e.gas, () => {
        const c = mk(170, 60), q = c.getContext('2d'); drawEmo(q, icon(e.gas), 28, 30, 36); txt(q, '+GAS!', 100, 32, 28, gi(e.gas).hi, { lw: 8 }); return c;
      });
      drawC(g, c, x, y, 0.5 + easeOutBack(a * 3) * 0.5, 0, (1 - a) * 2);
    });
  }
  const speedFace = () => once('speedo', () => {
    const c = mk(160, 160), g = c.getContext('2d'), cx = 80, cy = 80, R = 68, a0 = Math.PI * 0.75, sw = Math.PI * 1.5;
    g.beginPath(); g.arc(cx + 4, cy + 5, R, 0, TAU); g.fillStyle = 'rgba(42,18,4,0.45)'; g.fill();
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fillStyle = INK; g.fill();
    g.beginPath(); g.arc(cx, cy, R - 6, 0, TAU); g.fillStyle = '#fff4d6'; g.fill();
    [[0, 0.25, '#62c848'], [0.25, 0.7, '#ffc81e'], [0.7, 1, '#ff4a30']].forEach(b => {
      g.beginPath(); g.arc(cx, cy, R - 16, a0 + sw * b[0], a0 + sw * b[1]); g.strokeStyle = b[2]; g.lineWidth = 12; g.stroke();
    });
    for (let i = 0; i <= 10; i++) {
      const a = a0 + sw * i / 10; g.strokeStyle = INK; g.lineWidth = i % 5 ? 2 : 4;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); g.lineTo(cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24)); g.stroke();
    }
    font(g, 11); g.textAlign = 'center'; g.fillStyle = INK; g.fillText('MPH', cx, cy + 28);
    return c;
  });
  function drawSpeedo(g, t, v) {
    const cx = 1172, cy = 632, mph = Math.abs(v.speed || 0) * 2.237, f = sat(mph / 50), a0 = Math.PI * 0.75;
    g.drawImage(speedFace(), cx - 80, cy - 80);
    const a = a0 + Math.PI * 1.5 * f + Math.sin(t * 45) * 0.03 * f;
    g.lineCap = 'round'; g.strokeStyle = INK; g.lineWidth = 8; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50); g.stroke();
    g.strokeStyle = f > 0.7 ? '#ff4a30' : '#e8302a'; g.lineWidth = 4; g.stroke();
    g.beginPath(); g.arc(cx, cy, 8, 0, TAU); g.fillStyle = INK; g.fill();
    txt(g, String(Math.round(mph)), cx, cy + 46, 22, f > 0.7 ? '#ff4a30' : '#ffffff', { lw: 6 });
    if (f > 0.7) txt(g, 'WHOOSH!', cx, cy - 86, 16, '#ffe23a', { lw: 5 });
  }
  const arrowSpr = () => once('arrow', () => {
    const c = mk(110, 120), g = c.getContext('2d'), P = [[55, 6], [104, 58], [74, 58], [74, 112], [36, 112], [36, 58], [6, 58]];
    const path = () => { g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
    g.lineJoin = 'round'; path(); g.lineWidth = 10; g.strokeStyle = INK; g.stroke();
    const q = g.createLinearGradient(0, 0, 0, 112); q.addColorStop(0, '#b8ff7a'); q.addColorStop(1, '#2a9a30'); path(); g.fillStyle = q; g.fill();
    return c;
  });
  function drawCheckout(g, t, v, info) {
    const e = easeOutBack((t - (S.allT || t)) / 0.5), s = e * (1 + Math.sin(t * 6) * 0.05), lw = 330;
    g.save(); g.translate(640, 172); g.scale(s, s);
    g.drawImage(sticker(lw, 44, '#3cc84a', { r: 22 }), -lw / 2, -22);
    txt(g, 'GO TO CHECKOUT!', 2, 1, 24, '#ffffff', { lw: 7 }); g.restore();
    const ang = info ? info.ang : Math.PI, bob = Math.sin(t * 8) * 6;
    g.save(); g.translate(640, 250); g.rotate(ang); g.translate(0, -bob); g.scale(0.6 * e, 0.6 * e); g.drawImage(arrowSpr(), -55, -60); g.restore();
    if (info) txt(g, Math.round(info.dist) + ' m', 640, 312, 18, '#ffffff', { lw: 5 });
  }
  function drawPops(g, t) {
    S.farts = S.farts.filter(f => t - f.t0 < f.life);
    S.farts.forEach(f => {
      const a = (t - f.t0) / f.life, e = f.cheese ? easeOut(a * 3) : elastic(a * (f.big ? 2 : 2.6));
      const shk = f.big && a < 0.4 ? (Math.random() - 0.5) * 12 : 0;
      drawC(g, f.c, f.x + shk, f.y + shk - (f.cheese ? a * 40 : 0), (f.sc || 1) * (f.big ? 0.85 : 0.8) * (0.2 + e * 0.8), f.rot, f.cheese ? (1 - a) * 1.2 * 0.8 : (1 - a) * 3);
    });
    S.pops = S.pops.filter(p => t - p.t0 < 1.5);
    S.pops.forEach(p => {
      const a = (t - p.t0) / 1.5, s = 0.3 + easeOutBack(a * 4) * 0.7;
      drawC(g, p.c, p.x, p.y - easeOut(a) * 80, s * 0.9, Math.sin((t - p.t0) * 9) * 0.05, (1 - a) * 3);
    });
  }
  function drawGo(g, t) {
    const T = t - S.runT; if (T > 1.8) return;
    const w1 = wordSpr('GRAB THE LIST!', 60, WHITE), w2 = wordSpr('GO!', 120, GREEN);
    if (T < 0.9) drawC(g, w1, 640, 330, easeOutBack(T / 0.35), -0.05, (0.9 - T) * 5);
    else drawC(g, w2, 640, 330, elastic((T - 0.9) / 0.5) * (1 + (T - 0.9) * 0.3), 0.08, (1.8 - T) * 3);
  }
  function drawHUD(g, t, v) {
    const L = hudL(v), list = v.list || [], info = checkoutInfo();
    const allGot = list.length > 0 && list.every(i => i.taken);
    if (allGot && !S.allT) S.allT = t; if (!allGot) S.allT = 0;
    const near = !allGot && !!info && info.dist < 20;
    drawTicker(g, t, v);
    drawClock(g, t, v);
    if (!allGot) drawItems(g, t, v, near);
    drawWanted(g, t, v, L);
    drawScore(g, t, v, L);
    if (allGot) drawCheckout(g, t, v, info);
    if (!v.isTouch) drawGas(g, t, v);
    if (L.speedo) drawSpeedo(g, t, v);
    drawPops(g, t);
    drawGo(g, t);
  }

  // ── Pause ──────────────────────────────────────────────────────────────────
  function drawPause(g, t, v) {
    const e = easeOutBack((t - S.stateT) / 0.35);
    g.fillStyle = 'rgba(40,18,4,0.55)'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(640, 360); g.scale(e, e); g.translate(-640, -360);
    g.drawImage(sticker(460, 400, '#fff0c8', { r: 30, gloss: false }), 410 - 2, 150 - 2);
    const w = wordSpr('PAUSED', 80, MUSTARD); drawC(g, w, 640, 222, 1 + Math.sin(t * 3) * 0.03, Math.sin(t * 2) * 0.04);
    txt(g, 'Hold it in...', 640, 300, 22, '#b5541c', { stroke: false });
    drawBtns(g, pauseBtns(), t, v);
    g.restore();
  }

  // ── Results ────────────────────────────────────────────────────────────────
  const LINES = {
    win: ['The cashier needs a minute. And a gas mask.', 'Paper or plastic? Neither. Pure gas.', 'Fastest checkout in store history.'],
    caught: ['Security dragged you out by the waistband.', 'Banned from free samples. For life.', 'The guard needs a new nose. And a raise.'],
    time: ['The lights went out. The beans went cold.', 'Closing time. The cart goes back to the corral.', 'Store closed. Your gas was not enough.'],
  };
  function resInfo(v) {
    const r = v.results || {}, win = !!r.win, caught = !win && /caught|thrown|guard|security/i.test(r.reason || '');
    const bd = Array.isArray(r.breakdown) ? r.breakdown.filter(b => b && b.label != null && !/^\s*total\s*$/i.test(String(b.label))) : [];
    const total = r.score != null ? r.score : bd.reduce((a, b) => a + (+b.points || 0), 0);
    const newBest = win && total > 0 && (r.newBest != null ? !!r.newBest : total > S.bestRef);
    return { r, win, caught, bd, total, newBest };
  }
  function resReceipt(R) {
    const key = 'RR' + R.win + R.caught + R.total + R.bd.map(b => b.label + b.points).join('|');
    if (S.rrKey === key) return S.rrSpr;
    const n = Math.max(1, R.bd.length), rowH = Math.min(32, 250 / n), w = 460, top = 104, h = top + n * rowH + 20 + 56 + 70;
    const c = mk(w + 10, h + 10), g = c.getContext('2d');
    paperPath(g, 6, 7, w, h, 10); g.fillStyle = 'rgba(42,18,4,0.35)'; g.fill();
    paperPath(g, 0, 0, w, h, 10); g.fillStyle = '#fffcf4'; g.fill();
    g.save(); g.clip(); crumple(g, w, h, 31); g.restore();
    paperPath(g, 0, 0, w, h, 10); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
    const mono = "'Courier New',Courier,monospace", ctr = (s, y, px, col) => { font(g, px, mono); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col || INK; g.fillText(s, w / 2, y); };
    txt(g, 'BULKZILLA', w / 2, 34, 30, INK, { stroke: false });
    ctr('WAREHOUSE  *  REG 04  *  LANE 7', 60, 14, '#6a5a48');
    ctr(R.win ? 'THANK YOU FOR SHOPPING!' : (R.caught ? '*** CUSTOMER REMOVED ***' : '*** STORE CLOSED ***'), 82, 15);
    const dash = y => { g.setLineDash([6, 5]); g.strokeStyle = '#a89880'; g.lineWidth = 2; g.beginPath(); g.moveTo(16, y); g.lineTo(w - 16, y); g.stroke(); g.setLineDash([]); };
    dash(top - 6);
    (R.bd.length ? R.bd : [{ label: 'Score', points: R.total }]).forEach((b, i) => {
      const y = top + i * rowH + rowH / 2;
      font(g, Math.min(19, rowH * 0.62), mono); g.textBaseline = 'middle'; g.fillStyle = INK;
      g.textAlign = 'left'; const lab = String(b.label).toUpperCase(); g.fillText(lab.length > 26 ? lab.slice(0, 25) + '.' : lab, 20, y);
      g.textAlign = 'right'; g.fillText(typeof b.points === 'number' ? fmt(b.points) : String(b.points), w - 20, y);
    });
    const ty = top + n * rowH + 12; dash(ty);
    c.totalY = ty + 30; c.top = top; c.rowH = rowH;
    txt(g, 'TOTAL', 22, ty + 30, 28, INK, { stroke: false, align: 'left' });
    // barcode
    let s = 11; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const by = ty + 64; g.fillStyle = INK; for (let x = 90; x < w - 90;) { const bw = 1 + ((rnd() * 4) | 0); g.fillRect(x, by, bw, 34); x += bw + 1 + ((rnd() * 3) | 0); }
    ctr('NO REFUNDS. NO RETURNS. NO SMELL CHECKS.', by + 50, 12, '#6a5a48');
    S.rrKey = key; S.rrSpr = c; return c;
  }
  function stamp(g, s, x, y, col, t0, t, rot) {
    const a = t - t0; if (a < 0) return;
    const sc = a < 0.25 ? 2.6 - easeOut(a / 0.25) * 1.6 : 1;
    const c = once('stamp' + s + col, () => {
      const m = mk(4, 4).getContext('2d'), w = tw(m, s, 46) + 50, c = mk(w, 86), q = c.getContext('2d');
      rr(q, 5, 5, w - 10, 76, 14); q.lineWidth = 7; q.strokeStyle = col; q.stroke();
      rr(q, 13, 13, w - 26, 60, 9); q.lineWidth = 2.5; q.stroke();
      font(q, 46); q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillStyle = col; q.fillText(s, w / 2, 45);
      q.globalCompositeOperation = 'destination-out'; let z = 5; const rnd = () => { z = (z * 16807) % 2147483647; return z / 2147483647; };
      for (let i = 0; i < 160; i++) { q.globalAlpha = rnd() * 0.8; q.fillRect(rnd() * w, rnd() * 86, 1 + rnd() * 3, 1 + rnd() * 2); }
      return c;
    });
    drawC(g, c, x, y, sc, rot, Math.min(1, a / 0.12) * 0.92);
  }
  function drawResults(g, t, v) {
    const T = S.resSkip ? t - S.stateT + 10 : t - S.stateT, R = resInfo(v);
    g.fillStyle = `rgba(40,18,4,${0.5 * sat(T / 0.4)})`; g.fillRect(0, 0, W, H);
    if (R.win) drawC(g, rays(), 640, 330, 1.6, t * 0.15, 0.55 * sat(T / 0.6));
    const title = R.win ? 'CHECKED OUT!' : R.caught ? 'THROWN OUT!' : 'STORE CLOSED!';
    const ws = wordSpr(title, 84, R.win ? GREEN : R.caught ? RED : PURPLE);
    drawC(g, ws, 640, 70, elastic(T / 0.8) * (1 + Math.sin(t * 3) * 0.02), Math.sin(t * 2.2) * 0.03);
    txt(g, S.resLine, 640, 138, 22, '#ffffff', { lw: 7 });
    // printed receipt
    const c = resReceipt(R), rx = 640 - (c.width - 10) / 2, ry = 170, full = c.height;
    const shown = clamp((T - 0.6) * 420, 0, full);
    rr(g, rx - 26, ry - 14, c.width + 42, 22, 11); g.fillStyle = INK; g.fill(); rr(g, rx - 22, ry - 10, c.width + 34, 14, 7); g.fillStyle = '#5a5a60'; g.fill();
    if (shown > 0) g.drawImage(c, 0, 0, c.width, shown, rx, ry, c.width, shown);
    rr(g, rx - 10, ry - 6, c.width + 10, 6, 3); g.fillStyle = '#1a1a1e'; g.fill();
    const doneT = 0.6 + full / 420;
    if (shown >= c.totalY + 16) {
      const k = sat((T - (0.6 + (c.totalY + 16) / 420)) / 0.9);
      txt(g, fmt(R.total * easeOut(k)), rx + c.width - 30, ry + c.totalY, 30, '#e8302a', { align: 'right', stroke: false });
    }
    if (R.newBest) {
      stamp(g, 'NEW BEST!', rx + c.width + 175, ry + c.totalY - 40, '#e8302a', S.stateT + (S.resSkip ? -10 : doneT + 0.2), t, 0.25);
      if (T > doneT + 0.5) { const e = t - S.stateT; for (let i = 0; i < 3; i++) drawC(g, glowSpr('#ffe23a'), rx + c.width + 175 + Math.cos(e * 3 + i * 2) * 150, ry + c.totalY - 40 + Math.sin(e * 3 + i * 2) * 40, 0.2, 0, 0.8); }
    }
    if (!R.win) stamp(g, R.caught ? 'BANNED' : 'CLOSED', 640 + 20, ry + c.totalY + 62, R.caught ? '#e8302a' : '#7a4ae0', S.stateT + (S.resSkip ? -10 : doneT + 0.2), t, -0.22);
    if (T > 0.8) drawBtns(g, resultsBtns(), t, v);
  }

  // ── Main entry points ──────────────────────────────────────────────────────
  function onEnter(v, t) {
    if (v.state === 'PLAY' && S.prev !== 'PAUSE') {
      S.pops = []; S.farts = []; S.eats = []; S.takenAt = {}; S.dispScore = 0; S.wantLast = 0; S.wantT = -9; S.comboLast = 0; S.allT = 0; S.runT = t;
    }
    if (v.state === 'RESULTS') {
      const R = resInfo(v); S.resSkip = false; S.resLine = pick(R.win ? LINES.win : R.caught ? LINES.caught : LINES.time);
    }
    if (v.state === 'TITLE') S.puffs = [];
  }
  function draw(g, t, v) {
    if (!g || !v) return;
    const dt = clamp(t - S.lastT, 0, 0.1); S.lastT = t;
    if (v.state !== S.state) { S.prev = S.state; S.state = v.state; S.stateT = t; S.sel = 0; onEnter(v, t); }
    if (!!v.how !== S.how) { S.how = !!v.how; S.howT = t; S.sel = S.how ? 1 : 0; }
    if (v.state !== 'RESULTS') S.bestRef = v.best || 0;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.textBaseline = 'middle';
    switch (v.state) {
      case 'TITLE': drawTitle(g, t, v, dt); if (v.how) drawHow(g, t, v); break;
      case 'PLAY': drawHUD(g, t, v); break;
      case 'PAUSE': drawHUD(g, t, v); drawPause(g, t, v); break;
      case 'RESULTS': drawResults(g, t, v); break;
    }
    g.restore();
  }
  function hit(x, y, v) {
    if (!v) return null;
    if (v.state === 'TITLE' && v.how) {
      const b = howBtns().find(b => inside(b, x, y)); if (b) return Object.assign({}, b.act);
      return inside(HOW, x, y) ? null : { type: 'closeHow' };
    }
    if (v.state === 'RESULTS') {
      const T = S.lastT - S.stateT, b = resultsBtns().find(b => inside(b, x, y));
      if (b) return Object.assign({}, b.act);
      if (T < 3) S.resSkip = true;
      return null;
    }
    if (v.state === 'PLAY' && v.isTouch) return null;
    const b = menuBtns(v).find(b => inside(b, x, y));
    return b ? Object.assign({}, b.act) : null;
  }
  function key(e, v) {
    if (!e || !v) return null;
    const k = e.key, up = k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'ArrowLeft' || k === 'a' || k === 'A';
    const dn = k === 'ArrowDown' || k === 's' || k === 'S' || k === 'ArrowRight' || k === 'd' || k === 'D', ok = k === 'Enter' || k === ' ';
    S.mouse = false;
    if (v.state === 'TITLE' && v.how) return (ok || k === 'Escape' || k === 'h' || k === 'H') ? { type: 'closeHow' } : null;
    if (v.state === 'RESULTS' && ok && !S.resSkip && S.lastT - S.stateT < 3) { S.resSkip = true; return null; }
    if (v.state === 'TITLE' && (k === 'h' || k === 'H')) return { type: 'how' };
    if (v.state === 'PAUSE' && (k === 'Escape' || k === 'p' || k === 'P')) return { type: 'resume' };
    if (v.state === 'RESULTS' && k === 'Escape') return { type: 'title' };
    const btns = v.state === 'PLAY' ? [] : menuBtns(v), n = btns.length; if (!n) return null;
    if (up) S.sel = (S.sel + n - 1) % n; else if (dn) S.sel = (S.sel + 1) % n;
    else if (ok) return Object.assign({}, btns[clamp(S.sel, 0, n - 1)].act);
    return null;
  }
  // Test hook: the clickable rects of the current screen.
  function _btns(v) { return menuBtns(v); }
  BR.ui = { draw, hit, key, _btns };
})();
