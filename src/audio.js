// ─── AUDIO: procedural fart synth, warehouse foley, muzak score. All synthesised ──
// No files, no network. Crash-safety (engine from our earlier game): no onended callbacks;
// every music chunk and every sfx plays into its own GainNode bus that a setTimeout
// disconnects after its tail; a look-ahead scheduler (250 ms tick, 2 s horizon) drops
// stale notes after a stall; voice caps (64 music, 32 sfx); glue + limiter + soft clip.
// API: BR.audio.init(), setMusic('title'|'shop'|'chase'|'results'|null), sfx(name, opts), speak(text), setVolume(v).
// Farts: sfx('fart', {type, power}) plays a fresh random fart. sfx('fart', {type:'beans', power, hold:true})
// returns a handle {set(power), stop()} for a continuous thrust loop; repeated beans calls < 0.45 s apart
// turn into the same loop automatically (it stops 0.45 s after the last call). sfx('fartStop') stops it.
window.BR = window.BR || {};
(function () {
  const AC = window.AudioContext || window.webkitAudioContext;
  const LOOK = 2.0, TICK = 250, TAIL = 3.5, CAP_M = 64, CAP_S = 32, FSR = 22050;
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rr = (a, b) => a + Math.random() * (b - a);
  const nowS = () => (window.performance ? performance.now() : Date.now()) / 1000;
  const KR = p => { try { p.automationRate = 'k-rate'; } catch (e) { } return p; };
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0; let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = s => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

  // ── Per-context caches ─────────────────────────────────────────────────────
  const store = new WeakMap();
  function cacheOf(ctx) { let c = store.get(ctx); if (!c) store.set(ctx, c = { buf: new Map(), curve: {} }); return c; }
  function mkBuf(ctx, key, secs, fill, ch, rate) {
    const c = cacheOf(ctx).buf, hit = c.get(key);
    if (hit) { c.delete(key); c.set(key, hit); return hit; }
    const sr = rate ? Math.min(rate, ctx.sampleRate) : ctx.sampleRate, b = ctx.createBuffer(ch || 1, Math.max(1, Math.floor(secs * sr)), sr);
    for (let k = 0; k < (ch || 1); k++) fill(b.getChannelData(k), sr, k);
    c.set(key, b); if (c.size > 260) c.delete(c.keys().next().value);
    return b;
  }
  function dataBuf(ctx, d, sr) { const b = ctx.createBuffer(1, d.length, sr); b.getChannelData(0).set(d); return b; }
  function normalize(d, peak) { let m = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; } if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m; }
  function fadeEnds(d, sr, fin, fout) {
    const a = Math.floor(fin * sr), b = Math.floor(fout * sr);
    for (let i = 0; i < a && i < d.length; i++) d[i] *= i / a;
    for (let i = 0; i < b && i < d.length; i++) d[d.length - 1 - i] *= i / b;
  }
  const sat = (d, k) => { const n = Math.tanh(k); for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * k) / n; return d; };
  function biq(d, sr, type, f, q) {
    const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2; const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; }
    else if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < d.length; i++) {
      const x = d[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
    }
    return d;
  }
  function svf(x, sr, fc, q) {
    const y = new Float32Array(x.length), qd = 1 / q; let lo = 0, bp = 0;
    for (let i = 0; i < x.length; i++) {
      const f = 2 * Math.sin(Math.PI * clamp(fc(i / sr), 20, sr / 7) / sr);
      const hi = x[i] - lo - qd * bp; bp += f * hi; lo += f * bp; y[i] = bp;
    }
    return y;
  }
  // Decaying sine partials (modal resonator): parts = [[ratio, amp, t60]].
  function modal(d, sr, off, f0, parts, tsc, amp) {
    parts.forEach(([ratio, a, t60]) => {
      const f = f0 * ratio; if (f > sr * 0.45) return;
      const w = 2 * Math.PI * f / sr, c2 = 2 * Math.cos(w), k = Math.exp(-6.9 / (t60 * tsc * sr));
      let s1 = Math.sin(-w), s2 = Math.sin(-2 * w), e = a * amp;
      for (let i = off; i < d.length && e > 1e-5; i++) { const s = c2 * s1 - s2; s2 = s1; s1 = s; d[i] += s * e; e *= k; }
    });
  }
  const white = (n, seed) => { const r = rng(seed), d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = r() * 2 - 1; return d; };
  const noiseBuf = ctx => mkBuf(ctx, 'noise', 2, (d) => d.set(white(d.length, 99)));
  function loopBuf(ctx, key, secs, gen, rate) {
    return mkBuf(ctx, key, secs, (d, sr) => {
      const n = d.length, X = Math.floor(0.3 * sr), e = new Float32Array(n + X); gen(e, sr);
      for (let i = 0; i < n; i++) d[i] = e[i];
      for (let i = 0; i < X; i++) { const a = i / X; d[i] = e[i] * Math.sqrt(a) + e[n + i] * Math.sqrt(1 - a); }
    }, 1, rate);
  }
  const lerpPts = pts => t => {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * (t - a) / Math.max(1e-6, b - a); }
    return pts[pts.length - 1][1];
  };
  // A smooth random wobble around 1 (two slow sines).
  function wob(r, depth, f1, f2) {
    const a = r() * 6.283, b = r() * 6.283, fa = f1 * (0.7 + 0.6 * r()), fb = f2 * (0.7 + 0.6 * r());
    return t => 1 + depth * (0.6 * Math.sin(6.283 * fa * t + a) + 0.4 * Math.sin(6.283 * fb * t + b));
  }

  // ══ THE FART SYNTH ═════════════════════════════════════════════════════════
  // One voice: a pulse/saw buzz + pink-ish noise, gated by a sphincter flutter (a raised-sine
  // gate per cycle, random cycle amplitude, random missed cycles = sputter), through a resonant
  // state-variable filter (the cheeks) whose cutoff follows the gate, then an asymmetric tanh rasp.
  function fartCore(d, sr, r, p) {
    const off = Math.floor((p.at || 0) * sr), n = Math.min(Math.floor(p.dur * sr), d.length - off);
    const qd = 1 / (p.q || 4), bias = p.bias || 0, tb = Math.tanh(bias), gk = p.gk || 1.5, duty = p.duty || 0.3;
    const buzz = p.buzz == null ? 1 : p.buzz, noise = p.noise || 0.3, drive = p.drive || 2, lpm = p.lp == null ? 1 : p.lp, bpm = p.bp == null ? 0.5 : p.bp, lv = p.lv || 1;
    let ph = r(), fph = 0, j = 1, open = true, amp = 1, lo = 0, bp = 0, nl = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      fph += p.fl(t) * j / sr;
      if (fph >= 1) { fph -= 1; j = 1 + (r() - 0.5) * (p.jit || 0.2); open = r() >= (p.miss ? p.miss(t) : 0); amp = 0.5 + 0.5 * r(); }
      const gate = open ? amp * Math.pow(Math.sin(Math.PI * fph), gk) : 0;
      ph += p.f0(t) / sr; ph -= Math.floor(ph);
      const src = ((ph < duty ? 1 : -duty / (1 - duty)) * 0.6 + (2 * ph - 1) * 0.4) * buzz;
      nl += 0.35 * ((r() * 2 - 1) - nl);
      const x = (src + nl * noise * 2.2) * gate;
      const fc = Math.min(sr / 6.5, p.cut(t) * (0.55 + 0.7 * gate)), f = 2 * Math.sin(Math.PI * fc / sr);
      const hi = x - lo - qd * bp; bp += f * hi; lo += f * bp;
      const y = Math.tanh((lo * lpm + bp * bpm) * drive + bias) - tb;
      d[off + i] += y * p.env(t) * lv;
    }
  }
  // A wet bubble: a short sine ping whose pitch rises as it closes (Minnaert).
  function bubble(d, sr, s, f0, tau, rise, a) {
    const s0 = Math.floor(s * sr), L = Math.floor(tau * 5 * sr); let ph = 0;
    for (let i = 0; i < L && s0 + i < d.length; i++) { const t = i / sr; ph += 6.2832 * f0 * (1 + rise * t) / sr; d[s0 + i] += Math.sin(ph) * a * Math.exp(-t / tau) * Math.min(1, t / 0.0015); }
  }
  function bubbles(d, sr, r, k, t0, t1, fLo, fHi, amp) {
    for (let b = 0; b < k; b++) bubble(d, sr, t0 + r() * (t1 - t0), fLo * Math.pow(fHi / fLo, r()), 0.005 + 0.02 * r(), 2 + 8 * r(), amp * (0.3 + 0.7 * r()));
  }
  // The squeak: a high rubbery sine glide with vibrato and a little buzz.
  function squeak(d, sr, r, s, dur, f1, f2, amp) {
    const s0 = Math.floor(s * sr), L = Math.floor(dur * sr), vr = 7 + 5 * r(), am = 45 + 40 * r(); let ph = 0;
    for (let i = 0; i < L && s0 + i < d.length; i++) {
      const u = i / L, t = i / sr, f = f1 * Math.pow(f2 / f1, u) * (1 + 0.025 * Math.sin(6.283 * vr * t));
      ph += 6.2832 * f / sr;
      const e = Math.min(1, t / 0.012) * Math.min(1, (1 - u) / 0.3);
      d[s0 + i] += (Math.sin(ph) + 0.3 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph)) * (0.8 + 0.2 * Math.sin(6.283 * am * t)) * e * amp;
    }
  }
  // The RIP: gated bright noise at ~120 Hz with a click (fabric of reality tearing).
  function crack(d, sr, r, s, dur, amp) {
    const s0 = Math.floor(s * sr), L = Math.floor(dur * sr), rate = 90 + 60 * r(); let lp = 0, ph = 0;
    for (let i = 0; i < L && s0 + i < d.length; i++) {
      const t = i / sr, u = i / L, x = r() * 2 - 1; lp += 0.2 * (x - lp); ph += rate * (1 - 0.4 * u) / sr; ph -= Math.floor(ph);
      d[s0 + i] += ((x - lp) * 1.2 + lp * 0.9) * (ph < 0.45 ? 1 : 0.15) * amp * Math.exp(-u * 2.5) * Math.min(1, t / 0.002);
    }
    if (s0 + 2 < d.length) { d[s0] += amp; d[s0 + 1] -= amp * 0.6; }
  }
  function drop(d, sr, s, dur, fa, fb, amp) {
    const s0 = Math.floor(s * sr), L = Math.floor(dur * sr); let ph = 0;
    for (let i = 0; i < L && s0 + i < d.length; i++) { const u = i / L; ph += 6.2832 * fa * Math.pow(fb / fa, u) / sr; d[s0 + i] += Math.sin(ph) * amp * Math.min(1, i / sr / 0.01) * Math.pow(1 - u, 1.5); }
  }
  const FT = { beans: 0.85, hotdog: 0.9, burrito: 1.0, broccoli: 0.8, cheese: 0.34, nogas: 0.55, tail: 0.6 };
  // Bake one random fart as raw samples at 22.05 kHz.
  function fartData(type, power, seed) {
    const r = rng(seed), R = (a, b) => a + r() * (b - a), sr = FSR, P = clamp(power == null ? 0.8 : power, 0, 1);
    let dur = 1, d = null;
    const alloc = s => (d = new Float32Array(Math.floor(s * sr)));
    const fade = (a, rel) => t => Math.min(1, t / a) * (t > dur * (1 - rel) ? Math.max(0, 1 - (t / dur - (1 - rel)) / rel) : 1);
    if (type === 'hotdog') {   // short sharp BLAT + squeaky tail
      dur = R(0.2, 0.38) * (0.8 + 0.3 * P); alloc(dur + 0.9);
      const fa = R(140, 200), ca = R(2200, 3200), up = r() < 0.7;
      fartCore(d, sr, r, { dur, f0: t => fa * Math.pow(0.62, t / dur), fl: () => 58, jit: 0.15, cut: t => ca * Math.pow(0.3, t / dur), q: R(3, 5), drive: R(3, 5), bias: R(0.15, 0.3), noise: 0.25, gk: 1, env: fade(0.004, 0.3), miss: () => 0.02 });
      fartCore(d, sr, r, { dur: dur * 0.7, f0: t => fa * 2.01, fl: () => 58, cut: () => ca, q: 3, drive: 2, noise: 0.1, gk: 1, env: fade(0.003, 0.5), lv: 0.3 });
      const f1 = R(550, 800); squeak(d, sr, r, dur - 0.02, R(0.12, 0.3), f1, f1 * (up ? R(1.6, 2.3) : R(0.55, 0.7)), 0.45);
    } else if (type === 'burrito') {   // massive thunderous RIP: crack, rumble, ragged tail, bass drop
      dur = R(2.4, 3.3) * (0.75 + 0.35 * P); alloc(dur + 1.2);
      crack(d, sr, r, 0, R(0.12, 0.22), 0.9);
      const m = R(42, 52), f0 = lerpPts([[0, R(72, 92)], [0.3, m], [dur * 0.5, m * R(1.1, 1.3)], [dur, m * 0.72]]), fw = wob(r, 0.1, 0.8, 2.7);
      const fl0 = R(18, 28), flw = wob(r, 0.3, 0.6, 1.9), cut = lerpPts([[0, 2200], [0.25, 1200], [dur * 0.6, 550], [dur, 250]]), cw = wob(r, 0.25, 1.3, 3.1);
      const miss = t => 0.02 + (t > 0.55 * dur ? 0.7 * Math.pow((t / dur - 0.55) / 0.45, 1.5) : 0);
      const env = t => Math.min(1, t / 0.01) * (t < dur * 0.6 ? 1 : Math.pow(Math.max(0, 1 - (t / dur - 0.6) / 0.4), 0.8));
      fartCore(d, sr, r, { dur, f0: t => f0(t) * fw(t), fl: t => clamp(fl0 * flw(t), 12, 45), jit: 0.4, cut: t => cut(t) * cw(t), q: R(2.5, 4), buzz: 1.2, noise: 0.6, drive: R(4, 6), bias: 0.2, gk: 1.3, duty: 0.25, miss, env });
      fartCore(d, sr, r, { dur: dur * 0.85, f0: t => f0(t) * fw(t) * 2.02, fl: t => clamp(fl0 * flw(t) * 1.5, 12, 70), jit: 0.3, cut: t => cut(t) * 1.4, q: 3, drive: 3, noise: 0.3, gk: 1.6, miss, env, lv: 0.35 });
      drop(d, sr, 0.04, R(1.1, 1.5), R(100, 125), 28, 0.55);
      drop(d, sr, 0.3, dur * 0.7, m * 0.9, m * 0.6, 0.18);
      bubbles(d, sr, r, Math.floor(R(8, 16)), dur * 0.6, dur, 150, 600, 0.3);
      if (r() < 0.45) { const f1 = R(500, 750); squeak(d, sr, r, dur - 0.05, R(0.15, 0.35), f1, f1 * R(1.3, 1.9), 0.35); }
    } else if (type === 'broccoli') {   // wet gurgling bubbly cloud
      dur = R(1.0, 1.7) * (0.7 + 0.4 * P); alloc(dur + 0.7);
      const fb = R(55, 85), fw = wob(r, 0.2, 1.1, 3.3), fl0 = R(14, 26), flw = wob(r, 0.5, 0.9, 2.2), cuts = [];
      for (let t = 0; t < dur + 0.1; t += 0.035) cuts.push([t, R(250, 1400)]);
      const cut = lerpPts(cuts);
      fartCore(d, sr, r, { dur, f0: t => fb * fw(t), fl: t => clamp(fl0 * flw(t), 8, 45), jit: 0.6, cut, q: R(6, 9), buzz: 0.5, noise: 0.9, gk: 2.5, drive: 1.6, bp: 0.9, lp: 0.6, miss: () => 0.15, env: fade(0.08, 0.2) });
      bubbles(d, sr, r, Math.floor(R(60, 120) * (0.6 + 0.6 * P)), 0, dur + 0.2, 160, 950, 0.5);
      bubble(d, sr, dur + 0.05, R(140, 200), 0.05, 3, 0.9);
    } else if (type === 'cheese') {   // silent but deadly: a long hiss, then a tiny comic squeak
      dur = R(1.3, 2.1); const gap = R(0.06, 0.18), sq = R(0.07, 0.14); alloc(dur + gap + sq + 0.6);
      const n = Math.floor(dur * sr), h = biq(white(n, seed), sr, 'bp', R(1800, 3200), 1.2), lo = biq(white(n, seed + 1), sr, 'lp', 500, 0.7), fr = R(6, 12);
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] = (h[i] * 0.9 + lo[i] * 0.5) * Math.min(1, t / 0.35) * (t > dur * 0.7 ? Math.max(0, 1 - (t / dur - 0.7) / 0.3) : 1) * (0.8 + 0.2 * Math.sin(6.283 * fr * t)) * 0.28; }
      const f1 = R(1100, 1500); squeak(d, sr, r, dur + gap, sq, f1, f1 * R(1.3, 1.7), 0.9);
      if (r() < 0.3) squeak(d, sr, r, dur + gap + sq + 0.05, sq * 0.7, f1 * 1.2, f1 * 1.5, 0.6);
    } else if (type === 'nogas') {   // pfft... and a sad little squeak
      dur = 0.12; alloc(0.8);
      fartCore(d, sr, r, { dur, f0: () => 120, fl: () => 40, cut: () => 900, noise: 0.8, buzz: 0.4, env: fade(0.005, 0.5), lv: 0.5 });
      const f1 = R(800, 950); squeak(d, sr, r, 0.1, R(0.3, 0.42), f1, f1 * R(0.45, 0.55), 0.6);
    } else if (type === 'tail') {   // the end of a held beans stream: a sputter out
      dur = R(0.3, 0.6); alloc(dur + 0.6);
      const fb = R(70, 95), fl0 = R(22, 32);
      fartCore(d, sr, r, { dur, f0: t => fb * (1 - 0.25 * t / dur), fl: t => fl0 * (1 - 0.5 * t / dur), jit: 0.3, cut: t => 900 * (1 - 0.5 * t / dur), q: 4, drive: 2.5, noise: 0.35, gk: 1.6, miss: t => 0.1 + 0.6 * t / dur, env: t => Math.min(1, t / 0.01) * (1 - t / dur) });
      if (r() < 0.35) { const f1 = R(500, 700); squeak(d, sr, r, dur - 0.03, R(0.1, 0.22), f1, f1 * R(1.4, 1.9), 0.4); }
    } else {   // beans: a long sputtering motorboat
      dur = R(1.2, 2.1) * (0.65 + 0.55 * P); alloc(dur + 0.7);
      const shape = Math.floor(r() * 3), fb = R(70, 110), fw = wob(r, 0.12, 0.7, 2.3), sh = R(0.6, 1.3);
      const flb = R(20, 30), mf = R(0.4, 0.9), mp = r() * 6.28, sp = R(-0.3, 0.6), cb = R(550, 1100), cw = wob(r, 0.35, 0.8, 2.1);
      const f0 = t => fb * fw(t) * (shape === 0 ? 1 + 0.35 * t / dur : shape === 1 ? 1.25 - 0.4 * t / dur : 1 + 0.18 * Math.sin(6.283 * sh * t));
      fartCore(d, sr, r, {
        dur, f0, fl: t => clamp(flb * (1 + 0.55 * Math.sin(6.283 * mf * t + mp)) * (1 + sp * t / dur), 15, 65), jit: 0.25,
        cut: t => cb * cw(t), q: R(3, 6), noise: R(0.2, 0.45), gk: R(1.2, 2), drive: R(1.6, 3), bias: R(0, 0.25), duty: R(0.2, 0.4), bp: R(0.3, 0.8),
        miss: t => 0.04 + (t > dur * 0.7 ? 0.55 * (t / dur - 0.7) / 0.3 : 0), env: t => fade(0.015, 0.15)(t) * (1 - 0.25 * t / dur),
      });
      if (r() < 0.5) bubbles(d, sr, r, Math.floor(R(4, 10)), dur * 0.6, dur + 0.1, 200, 700, 0.3);
      if (r() < 0.35) { const f1 = R(500, 700); squeak(d, sr, r, dur - 0.03, R(0.12, 0.25), f1, f1 * R(1.3, 1.8), 0.35); }
    }
    if (type !== 'cheese') biq(d, sr, 'lp', type === 'burrito' ? 3800 : 5200, 0.7);
    normalize(d, 0.9); fadeEnds(d, sr, 0.0008, 0.03);
    return d;
  }
  // The held beans loop: a seamless motorboat whose flutter wanders (rate and filter follow the thrust live).
  function holdData(seed) {
    const r = rng(seed), R = (a, b) => a + r() * (b - a), sr = FSR, secs = 2.6, n = Math.floor(secs * sr), X = Math.floor(0.3 * sr), e = new Float32Array(n + X);
    const fb = R(80, 105), fw = wob(r, 0.12, 0.5, 1.7), flb = R(24, 34), flw = wob(r, 0.4, 0.4, 1.3), cb = R(700, 1100), cw = wob(r, 0.35, 0.7, 2.3);
    fartCore(e, sr, r, { dur: (n + X) / sr, f0: t => fb * fw(t), fl: t => clamp(flb * flw(t), 15, 60), jit: 0.3, cut: t => cb * cw(t), q: R(3, 5), noise: 0.35, gk: 1.5, drive: 2.4, bias: 0.15, bp: 0.6, miss: () => 0.06, env: () => 1 });
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = e[i];
    for (let i = 0; i < X; i++) { const a = i / X; d[i] = e[i] * Math.sqrt(a) + e[n + i] * Math.sqrt(1 - a); }
    normalize(d, 0.85);
    return d;
  }

  // ══ Baked instruments ═════════════════════════════════════════════════════
  function epBuf(ctx, m) {   // FM electric piano (Rhodes-ish): tine + bark
    return mkBuf(ctx, 'ep' + m, 2.4, (d, sr) => {
      const f = hz(m), dec = 1.1 + f / 700, w = 6.2832 * f / sr, tf = 6.2832 * f * 7.02 / sr, ta = f < 600 ? 0.18 : 0.07;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, I = 1.5 * Math.exp(-t * 5) + 0.25;
        d[i] = (Math.sin(w * i + I * Math.sin(w * i)) + ta * Math.sin(tf * i) * Math.exp(-t * 35)) * Math.exp(-t * dec) * Math.min(1, t / 0.002);
      }
      sat(d, 1.4); normalize(d, 0.5); fadeEnds(d, sr, 0.0005, 0.15);
    }, 1, 32000);
  }
  function bassBuf(ctx, m, pop) {   // slap-ish bass: decaying harmonics (a natural filter sweep) + thumb click
    return mkBuf(ctx, 'bs' + m + (pop ? 'p' : ''), 1.0, (d, sr) => {
      const f = hz(m), parts = [];
      for (let k = 1; k <= 14; k++) { const dk = (pop ? 2.5 : 4) + k * k * (pop ? 0.35 : 0.9); parts.push([k, (k === 1 ? 1 : (pop ? 0.9 : 0.55) / k) * (k % 2 ? 1 : 0.7), 6.9 / dk]); }
      modal(d, sr, 0, f, parts, 1, 1);
      const nz = biq(white(Math.floor(sr * 0.012), m + 5), sr, 'bp', pop ? 2600 : 1400, 1.2);
      for (let i = 0; i < nz.length; i++) d[i] += nz[i] * (pop ? 0.5 : 0.25) * (1 - i / nz.length);
      for (let i = 0; i < d.length; i++) d[i] *= Math.exp(-i / sr * 1.8) * Math.min(1, i / sr / 0.003);
      sat(d, 1.6); normalize(d, 0.55); fadeEnds(d, sr, 0.0005, 0.05);
    }, 1, 32000);
  }
  const CHIME = [[1, 1, 1], [2.76, .35, .45], [5.4, .15, .22], [8.93, .06, .12]];
  function chimeBuf(ctx, m) {   // glockenspiel / vibes bar
    return mkBuf(ctx, 'ch' + m, 1.9, (d, sr) => {
      const f0 = hz(m), sc = clamp(Math.sqrt(700 / f0), 0.4, 1.6) * 1.5;
      modal(d, sr, 0, f0, CHIME, sc, 1); modal(d, sr, 0, f0 * 1.0021, CHIME, sc, 0.45);
      normalize(d, 0.5); fadeEnds(d, sr, 0.0015, 0.2);
    }, 1, 32000);
  }
  // Drum kit: k kick, s snare, r rim, h closed hat, o open hat, z shaker, c clap, C crash, t tom, b cowbell, w brush.
  const DLEN = { k: .5, s: .35, r: .15, h: .12, o: .6, z: .12, c: .35, C: 2.6, t: .5, b: .3, w: .35 };
  function drumBuf(ctx, kind) {
    return mkBuf(ctx, 'dr' + kind, DLEN[kind] || 0.4, (d, sr) => {
      const n = d.length, nz = white(n, kind.charCodeAt(0) * 17 + 3);
      if (kind === 'k') {
        let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += 6.2832 * (52 + 95 * Math.exp(-t * 32)) / sr; d[i] = Math.sin(ph) * Math.exp(-t * 9) + nz[i] * 0.3 * Math.exp(-t * 300); }
        sat(d, 1.5);
      } else if (kind === 's') {
        const sn = biq(biq(nz.slice(), sr, 'hp', 1200, 0.7), sr, 'lp', 7000, 0.7); let ph = 0;
        for (let i = 0; i < n; i++) { const t = i / sr; ph += 6.2832 * (185 + 40 * Math.exp(-t * 40)) / sr; d[i] = Math.sin(ph) * 0.7 * Math.exp(-t * 20) + sn[i] * 1.1 * Math.exp(-t * 17); }
      } else if (kind === 'r') {
        modal(d, sr, 0, 1650, [[1, 1, .05], [0.49, .6, .08], [2.3, .3, .03]], 1, 1);
        const cl = biq(nz.slice(), sr, 'hp', 3000, 0.7); for (let i = 0; i < 150 && i < n; i++) d[i] += cl[i] * 0.6 * (1 - i / 150);
      } else if (kind === 'h' || kind === 'o') {
        const hi = biq(biq(nz.slice(), sr, 'hp', 7000, 0.7), sr, 'hp', 7000, 0.7), k = kind === 'h' ? 45 : 6;
        for (let i = 0; i < n; i++) d[i] = hi[i] * Math.exp(-i / sr * k);
      } else if (kind === 'z') {
        const b = biq(nz.slice(), sr, 'bp', 5500, 1);
        for (let i = 0; i < n; i++) { const t = i / sr; d[i] = b[i] * Math.min(1, t / 0.008) * Math.exp(-t * 35); }
      } else if (kind === 'c') {
        const b = biq(nz.slice(), sr, 'bp', 1100, 1.4);
        for (let i = 0; i < n; i++) { const t = i / sr; let e = Math.exp(-t * 14); [0, 0.011, 0.022].forEach(o => { if (t >= o && t < o + 0.01) e += Math.exp(-(t - o) * 200); }); d[i] = b[i] * e; }
      } else if (kind === 'C') {
        const hi = biq(nz.slice(), sr, 'hp', 4000, 0.7), bp = biq(white(n, 77), sr, 'bp', 6000, 0.8);
        for (let i = 0; i < n; i++) { const t = i / sr; d[i] = (hi[i] * 0.7 + bp[i] * 0.6) * Math.exp(-t * 1.6) * Math.min(1, t / 0.002); }
        modal(d, sr, 0, 420, [[1, .08, 1.5], [1.73, .06, 1.2], [2.9, .05, 1], [4.1, .04, .8]], 1, 1);
      } else if (kind === 't') {
        let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += 6.2832 * (135 + 60 * Math.exp(-t * 25)) / sr; d[i] = Math.sin(ph) * Math.exp(-t * 8) + nz[i] * 0.15 * Math.exp(-t * 60); }
      } else if (kind === 'b') {
        let p1 = 0, p2 = 0; for (let i = 0; i < n; i++) { p1 += 540 / sr; p2 += 800 / sr; d[i] = ((p1 % 1 < 0.5 ? 1 : -1) + (p2 % 1 < 0.5 ? 1 : -1)) * Math.exp(-i / sr * 14); }
        biq(d, sr, 'bp', 900, 2);
      } else if (kind === 'w') {
        const b = biq(nz.slice(), sr, 'bp', 3000, 0.7);
        for (let i = 0; i < n; i++) { const t = i / sr; d[i] = b[i] * Math.min(1, t / 0.02) * Math.exp(-t * 12); }
      }
      normalize(d, 0.5); fadeEnds(d, sr, 0.0005, 0.03);
    }, 1, 0);
  }

  // ══ Baked foley (4 variants each) ═══════════════════════════════════════════
  const FLEN = { clang: 1.1, thud: .4, can: .4, paper: .35, pop: .3, bonk: .35, crunch: .12, squish: .22, glug: .25, coin: .7, drawer: .35, bell: 1.4, wire: .5 };
  function folBuf(ctx, kind, v) {
    return mkBuf(ctx, 'f' + kind + v, FLEN[kind], (d, sr) => {
      const n = d.length, seed = hash(kind) + v * 101, r = rng(seed), nz = white(n, seed);
      if (kind === 'clang') {   // shopping cart: chrome wire basket slam
        modal(d, sr, 0, 380 + v * 55, [[1, 1, .5], [1.47, .8, .45], [2.09, .7, .38], [2.56, .55, .3], [3.12, .45, .26], [4.21, .3, .2], [5.4, .25, .15], [6.9, .15, .1]], 1, 1);
        const hi = biq(nz.slice(), sr, 'hp', 2500, 0.7);
        for (let k = 0; k < 40; k++) { const s0 = Math.floor(Math.pow(r(), 1.7) * 0.35 * sr), L = 20 + Math.floor(r() * 90), a = 0.6 * r(); for (let i = 0; i < L && s0 + i < n; i++) d[s0 + i] += hi[s0 + i] * a * Math.exp(-i / (L * 0.3)); }
        for (let i = 0; i < n; i++) d[i] += Math.sin(6.2832 * 95 * i / sr) * 0.6 * Math.exp(-i / sr * 30);
      } else if (kind === 'thud') {   // cardboard box
        const lo = biq(nz.slice(), sr, 'lp', 700 + v * 90, 0.8), bx = biq(white(n, seed + 3), sr, 'bp', 170 + v * 25, 3);
        for (let i = 0; i < n; i++) { const t = i / sr; d[i] = lo[i] * 1.6 * Math.exp(-t * 30) + bx[i] * 2.5 * Math.exp(-t * 18) + Math.sin(6.2832 * (75 + v * 8) * t) * 0.5 * Math.exp(-t * 35); }
      } else if (kind === 'can') {   // tin can clink
        modal(d, sr, 0, 1300 + v * 380, [[1, 1, .14], [2.32, .6, .09], [3.91, .4, .06], [5.2, .2, .04]], 1, 1);
        const cl = biq(nz.slice(), sr, 'hp', 4000, 0.7); for (let i = 0; i < 120 && i < n; i++) d[i] += cl[i] * 0.5 * (1 - i / 120);
      } else if (kind === 'paper') {   // toilet paper tower: soft fwump + crinkle
        const lo = biq(nz.slice(), sr, 'lp', 900, 0.7), hi = biq(white(n, seed + 1), sr, 'hp', 3500, 0.7);
        for (let i = 0; i < n; i++) { const t = i / sr; d[i] = lo[i] * 2 * Math.min(1, t / 0.01) * Math.exp(-t * 22); }
        for (let k = 0; k < 14; k++) { const s0 = Math.floor(r() * 0.2 * sr), L = 15 + Math.floor(r() * 60); for (let i = 0; i < L && s0 + i < n; i++) d[s0 + i] += hi[s0 + i] * 0.4 * r() * Math.exp(-i / (L * 0.3)); }
      } else if (kind === 'pop') {   // balloon pop
        const hi = biq(nz.slice(), sr, 'hp', 1500, 0.7);
        for (let i = 0; i < n; i++) { const t = i / sr; d[i] = hi[i] * 1.5 * Math.exp(-t * 55) + nz[i] * 0.6 * Math.exp(-t * 200) + Math.sin(6.2832 * 110 * t) * 0.5 * Math.exp(-t * 40); }
      } else if (kind === 'bonk') {   // hollow plastic
        const b = biq(nz.slice(), sr, 'bp', 520 + v * 80, 6);
        for (let i = 0; i < n; i++) { const t = i / sr; d[i] = b[i] * 3 * Math.exp(-t * 20) + Math.sin(6.2832 * (360 + v * 40) * t) * 0.6 * Math.exp(-t * 28); }
      } else if (kind === 'crunch') {   // a bite: grainy crunch
        const b = biq(nz.slice(), sr, 'bp', 2600 + v * 400, 1.1);
        for (let k = 0; k < 30; k++) { const s0 = Math.floor(r() * 0.09 * sr), L = 20 + Math.floor(r() * 80), a = r(); for (let i = 0; i < L && s0 + i < n; i++) d[s0 + i] += b[s0 + i] * a * Math.exp(-i / (L * 0.3)); }
      } else if (kind === 'squish') {   // wet chew
        const sq = svf(nz, sr, t => 300 + 1500 * Math.exp(-t * 14) * (1 + 0.3 * Math.sin(6.2832 * (18 + v * 4) * t)), 4);
        for (let i = 0; i < n; i++) { const t = i / sr; d[i] = sq[i] * 2.5 * Math.min(1, t / 0.006) * Math.exp(-t * 12); }
      } else if (kind === 'glug') {
        let ph = 0; const f0 = 240 + v * 40;
        for (let i = 0; i < n; i++) { const t = i / sr; ph += 6.2832 * f0 * (1 + 1.3 * Math.min(1, t / 0.06)) / sr; d[i] = Math.sin(ph) * Math.exp(-t * 22) * Math.min(1, t / 0.01) + nz[i] * 0.08 * Math.exp(-t * 30); }
        biq(d, sr, 'lp', 1400, 0.8);
      } else if (kind === 'coin') {
        for (let k = 0, K = 3 + v % 3; k < K; k++) modal(d, sr, Math.floor((k * 0.06 + r() * 0.03) * sr), 2600 + r() * 1400, [[1, 1, .18], [2.71, .5, .12], [5.1, .2, .08]], 1, 0.8 - k * 0.1);
      } else if (kind === 'drawer') {   // register drawer: clunk + rattle
        const lo = biq(nz.slice(), sr, 'lp', 500, 0.8);
        for (let i = 0; i < n; i++) { const t = i / sr; d[i] = lo[i] * 2 * Math.exp(-t * 25) + Math.sin(6.2832 * 120 * t) * 0.5 * Math.exp(-t * 30); }
        modal(d, sr, Math.floor(0.01 * sr), 900 + v * 60, [[1, .3, .15], [2.4, .2, .1], [3.7, .15, .08]], 1, 1);
      } else if (kind === 'bell') {   // register "ching"
        modal(d, sr, 0, 2900 + v * 90, [[1, 1, 1.2], [2.76, .5, .7], [5.4, .25, .4], [1.003, .6, 1.2]], 1, 1);
      } else if (kind === 'wire') {   // cart basket rattle burst
        const hi = biq(nz.slice(), sr, 'bp', 3500, 1);
        for (let k = 0; k < 50; k++) { const s0 = Math.floor(r() * 0.4 * sr), L = 15 + Math.floor(r() * 70), a = Math.pow(r(), 2) * (1 - s0 / n); for (let i = 0; i < L && s0 + i < n; i++) d[s0 + i] += hi[s0 + i] * a * Math.exp(-i / (L * 0.3)); }
      }
      normalize(d, 0.6); fadeEnds(d, sr, 0.0005, 0.04);
    }, 1, 0);
  }
  // Cart wheels on concrete: rumble + a wonky wheel thump + wire basket rattles (a seamless loop).
  const rattleBuf = ctx => loopBuf(ctx, 'rattle', 2, (d, sr) => {
    const n = d.length, r = rng(77), lo = biq(biq(white(n, 78), sr, 'lp', 180, 0.7), sr, 'lp', 220, 0.7), cl = biq(white(n, 79), sr, 'bp', 3200, 1.2);
    for (let i = 0; i < n; i++) d[i] = lo[i] * 3 * (0.7 + 0.3 * Math.sin(6.2832 * 9 * i / sr));
    for (let t = 0; t < n / sr; t += (1 / 6.2) * (0.9 + 0.2 * r())) { const s0 = Math.floor(t * sr), a = 0.3 + 0.3 * r(); for (let i = 0; i < 0.12 * sr && s0 + i < n; i++) d[s0 + i] += Math.sin(6.2832 * 90 * i / sr) * a * Math.exp(-i / sr * 28); }
    for (let t = 0; t < n / sr; t += -Math.log(1 - r() * 0.999) / 70) { const s0 = Math.floor(t * sr), L = 30 + Math.floor(r() * 150), a = Math.pow(r(), 2) * 1.2; for (let i = 0; i < L && s0 + i < n; i++) d[s0 + i] += cl[s0 + i] * a * Math.exp(-i / (L * 0.3)); }
    normalize(d, 0.5);
  }, 32000);
  // Warehouse reverb: 2.2 s, big concrete slap reflections, a bright tail.
  function impulse(ctx) {
    return mkBuf(ctx, 'ir', 2.2, (d, sr, ch) => {
      const r = rng(ch ? 991 : 373), pre = Math.floor(0.02 * sr); let lp = 0;
      for (let i = pre; i < d.length; i++) { const t = (i - pre) / sr; lp += 0.6 * ((r() * 2 - 1) - lp); d[i] = lp * 0.35 * Math.exp(-t * 2.9); }
      [0.013, 0.031, 0.047, 0.089, 0.141, 0.19].forEach((x, k) => { const i = pre + Math.floor((x + (ch ? 0.005 : 0)) * sr); if (i < d.length) d[i] += (r() > 0.5 ? 1 : -1) * 0.5 * (1 - k * 0.12); });
      fadeEnds(d, sr, 0, 0.3);
    }, 2);
  }

  // ══ Live voices ═════════════════════════════════════════════════════════════
  function curve(ctx, amt) {
    const c = cacheOf(ctx).curve, key = Math.round(amt * 20); if (c[key]) return c[key];
    const k = 1 + key, n = 1024, a = new Float32Array(n), m = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; a[i] = Math.tanh(x * k) / m * 0.9; }
    return (c[key] = a);
  }
  function outTo(g, node, pan) {
    if (pan && g.ctx.createStereoPanner) { const p = g.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); p.connect(g.out); }
    else node.connect(g.out);
  }
  function play(g, t, buf, lv, pan, rate, cut) {
    const c = g.ctx, s = c.createBufferSource(), v = c.createGain();
    s.buffer = buf; if (rate) s.playbackRate.value = rate; v.gain.value = lv;
    s.connect(v); outTo(g, v, pan); s.start(t);
    if (cut) { v.gain.setValueAtTime(lv, t + cut); v.gain.setTargetAtTime(0, t + cut, 0.05); s.stop(t + cut + 0.4); }
    return v;
  }
  const epHit = (g, t, m, lv, dur, pan) => play(g, t, epBuf(g.ctx, m), lv, pan, 0, Math.max(0.08, dur));
  const bassHit = (g, t, m, lv, dur, pop) => play(g, t, bassBuf(g.ctx, m, pop), lv, 0, 0, Math.max(0.06, dur));
  const chimeHit = (g, t, m, lv, pan) => play(g, t, chimeBuf(g.ctx, m), lv, pan);
  const DLV = { k: .55, s: .3, r: .16, h: .1, o: .1, z: .06, c: .22, C: .26, t: .2, b: .1, w: .2 };
  const DPAN = { h: 0.3, o: 0.3, z: -0.35, r: -0.2, b: 0.35, t: -0.15, w: 0.2 };
  const drumHit = (g, t, k, lv, pan, rate) => play(g, t, drumBuf(g.ctx, k), lv, pan, rate);

  // Legato phrase voices: one oscillator pair glides through a whole phrase.
  const LEAD = {
    flute: { w: 'sine', lp: 4000, glide: .03, vib: 10, vr: 5.4, att: .04, dip: .6, rel: .12, chiff: .3, cf: 2600, dual: 3, lv: .3 },
    synth: { w: 'square', lp: 2600, glide: .05, vib: 9, vr: 6, att: .01, dip: .7, rel: .08, dual: 7, lv: .075 },
    brass: { w: 'sawtooth', lp: 1100, glide: .02, vib: 6, vr: 5.5, att: .03, dip: .45, rel: .1, blat: 1, dual: 7, lv: .14 },
  };
  function lead(g, inst, notes, lv, pan) {
    const c = g.ctx, I = LEAD[inst]; if (!I || !notes.length) return;
    const t0 = notes[0].t, last = notes[notes.length - 1], end = last.t + last.d, stop = end + I.rel * 8 + 0.2;
    lv *= I.lv;
    const env = c.createGain(), src = c.createGain(), vo = c.createGain(), lfo = c.createOscillator(), vg = c.createGain();
    lfo.frequency.value = I.vr * (0.95 + Math.random() * 0.1); vg.gain.value = 0; lfo.connect(vg); lfo.start(t0); lfo.stop(stop);
    const dets = [-I.dual, I.dual];
    const oscs = dets.map(dt => { const o = c.createOscillator(); o.type = I.w; KR(o.frequency); KR(o.detune).value = dt; vg.connect(o.detune); o.connect(src); o.start(t0); o.stop(stop); return o; });
    src.gain.value = 0.5;
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; KR(filt.frequency).value = I.lp; filt.Q.value = I.blat ? 2 : 0.9; src.connect(filt); filt.connect(env);
    let cg = null;
    if (I.chiff) {
      const ns = c.createBufferSource(), bp = c.createBiquadFilter(); cg = c.createGain();
      ns.buffer = noiseBuf(c); ns.loop = true; bp.type = 'bandpass'; bp.frequency.value = I.cf; bp.Q.value = 0.9; cg.gain.value = 0;
      ns.connect(bp); bp.connect(cg); cg.connect(vo); ns.start(t0, Math.random()); ns.stop(stop);
    }
    env.gain.setValueAtTime(0, t0);
    notes.forEach((n, i) => {
      const f = hz(n.m), nx = notes[i + 1], a = lv * (i === 0 ? 1 : 0.9);
      oscs.forEach(o => (i === 0 ? o.frequency.setValueAtTime(f, t0) : o.frequency.setTargetAtTime(f, n.t - 0.004, I.glide)));
      env.gain.setTargetAtTime(a, n.t, I.att);
      if (nx) env.gain.setTargetAtTime(a * I.dip, Math.max(n.t + 0.02, n.t + n.d - 0.05), 0.014);
      const depth = I.vib * (n.d > 0.45 ? 1 : 0.35);
      vg.gain.setValueAtTime(depth * 0.2, n.t); vg.gain.linearRampToValueAtTime(depth, n.t + Math.min(0.5, n.d * 0.8));
      if (cg) { cg.gain.setValueAtTime(0, n.t); cg.gain.linearRampToValueAtTime(lv * I.chiff, n.t + 0.01); cg.gain.setTargetAtTime(lv * I.chiff * 0.1, n.t + 0.012, 0.05); }
      if (I.blat) { filt.frequency.setTargetAtTime(I.lp * 2.3, n.t, 0.02); filt.frequency.setTargetAtTime(I.lp, n.t + 0.07, 0.12); }
    });
    env.gain.setTargetAtTime(0, end - 0.03, I.rel);
    if (cg) cg.gain.setTargetAtTime(0, end, I.rel);
    env.connect(vo); outTo(g, vo, pan);
  }
  function stab(g, t, ms, lv, dur) {   // brass stab: a hard attack with a snapping filter
    const c = g.ctx, env = c.createGain(), lp = c.createBiquadFilter(), stop = t + dur + 0.8;
    lp.type = 'lowpass'; lp.Q.value = 2.5; KR(lp.frequency).setValueAtTime(3600, t); lp.frequency.setTargetAtTime(700, t + 0.02, 0.08);
    ms.forEach(m => [-9, 9].forEach(dt => { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = hz(m); x.detune.value = dt; x.connect(lp); x.start(t); x.stop(stop); }));
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(lv / Math.sqrt(ms.length * 2), t + 0.008); env.gain.setTargetAtTime(0, t + dur, 0.06);
    lp.connect(env); outTo(g, env, 0);
  }
  function tone(g, t, type, f0, f1, dur, lv, pan) {
    const c = g.ctx, o = c.createOscillator(), v = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(lv, t + 0.006); v.gain.setTargetAtTime(0, t + 0.01, dur / 3.5);
    o.connect(v); outTo(g, v, pan); o.start(t); o.stop(t + dur + 0.3);
    return o;
  }
  function noiseThrough(g, t, dur, type, q, pan) {
    const c = g.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), v = c.createGain();
    s.buffer = noiseBuf(c); s.loop = true; f.type = type; f.Q.value = q; KR(f.frequency); v.gain.value = 0;
    s.connect(f); f.connect(v); outTo(g, v, pan); s.start(t, Math.random() * 1.5); s.stop(t + dur);
    return { f: f.frequency, v: v.gain };
  }
  function swish(g, t, dur, f0, f1, f2, lv, pan) {
    const n = noiseThrough(g, t, dur + 0.3, 'bandpass', 1.4, pan);
    n.f.setValueAtTime(f0, t); n.f.exponentialRampToValueAtTime(f1, t + dur * 0.35); n.f.exponentialRampToValueAtTime(f2, t + dur);
    n.v.setValueAtTime(0, t); n.v.linearRampToValueAtTime(lv, t + dur * 0.3); n.v.setTargetAtTime(0, t + dur * 0.36, dur * 0.2);
  }
  function riser(g, t, dur, lv) {
    const n = noiseThrough(g, t, dur + 0.05, 'bandpass', 2, 0);
    n.f.setValueAtTime(250, t); n.f.exponentialRampToValueAtTime(4000, t + dur);
    n.v.setValueAtTime(0.0001, t); n.v.exponentialRampToValueAtTime(lv, t + dur - 0.02); n.v.linearRampToValueAtTime(0, t + dur + 0.04);
  }
  function slide(g, t, f0, f1, dur, lv) {   // slide whistle
    const c = g.ctx, o = c.createOscillator(), v = c.createGain(), l = c.createOscillator(), lg = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    l.frequency.value = 6; lg.gain.value = 18; l.connect(lg); lg.connect(o.detune);
    v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(lv, t + 0.03); v.gain.setValueAtTime(lv, t + dur - 0.05); v.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(v); outTo(g, v, 0); o.start(t); o.stop(t + dur + 0.1); l.start(t); l.stop(t + dur + 0.1);
    const n = noiseThrough(g, t, dur + 0.1, 'bandpass', 3); n.f.setValueAtTime(f0 * 2, t); n.f.exponentialRampToValueAtTime(f1 * 2, t + dur); n.v.setValueAtTime(lv * 0.25, t); n.v.linearRampToValueAtTime(0, t + dur);
  }
  // Human voice blips: saw (+FM rough, +sub) with a pitch contour, noise, drive, moving formants, tremolo.
  const VOW = {
    ah: [[700, 1], [1150, .5], [2600, .18]], oh: [[480, 1], [820, .45], [2600, .1]], oo: [[330, 1], [700, .3], [2500, .06]],
    ee: [[300, .8], [2250, .5], [3000, .3]], eh: [[560, 1], [1750, .45], [2550, .2]], uh: [[620, 1], [1050, .45], [2500, .12]], aw: [[600, 1], [900, .5], [2500, .1]],
  };
  const FQ = [6, 8, 12];
  function voice(g, t, o) {
    const c = g.ctx, dur = o.dur, rel = o.rel || 0.12, stop = t + dur + rel * 6 + 0.05, src = c.createGain(), osc = [];
    const add = (type, mul, lv, det) => { const x = c.createOscillator(), k = c.createGain(); x.type = type; KR(x.frequency); KR(x.detune).value = det || 0; k.gain.value = lv; x.connect(k); k.connect(src); x.start(t); x.stop(stop); osc.push([x, mul]); };
    add(o.wave || 'sawtooth', 1, 1, 0);
    if (o.dual) add(o.wave || 'sawtooth', 1, 0.7, o.dual);
    if (o.sub) add('sawtooth', 0.5, o.sub, 0);
    osc.forEach(([x, mul]) => { x.frequency.setValueAtTime(o.f[0][1] * mul, t); for (let i = 1; i < o.f.length; i++) x.frequency.exponentialRampToValueAtTime(o.f[i][1] * mul, t + o.f[i][0]); });
    const lfo = (f, depth, params) => { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = f; lg.gain.value = depth; l.connect(lg); params.forEach(p => lg.connect(p)); l.start(t); l.stop(stop); };
    if (o.fm) lfo(o.fm[0], o.fm[1], osc.map(([x]) => x.frequency));
    if (o.vib) lfo(o.vib[0], o.vib[1], osc.map(([x]) => x.detune));
    src.gain.value = 0.5;
    if (o.noise) { const n = c.createBufferSource(), b = c.createBiquadFilter(), k = c.createGain(); n.buffer = noiseBuf(c); n.loop = true; b.type = 'bandpass'; b.frequency.value = o.nf || 1400; b.Q.value = 0.7; k.gain.value = o.noise; n.connect(b); b.connect(k); k.connect(src); n.start(t, Math.random()); n.stop(stop); }
    let x = src;
    if (o.dist) { const d = c.createWaveShaper(); d.curve = curve(c, o.dist); src.connect(d); x = d; }
    const amp = c.createGain(), fs = o.fs || 1, path = o.v || [[0, 'ah']];
    for (let k = 0; k < 3; k++) {
      const b = c.createBiquadFilter(), kg = c.createGain(); b.type = 'bandpass'; b.Q.value = FQ[k]; KR(b.frequency);
      path.forEach(([pt, vw], i) => { const F = VOW[vw][k][0] * fs; if (i === 0) b.frequency.setValueAtTime(F, t); else b.frequency.linearRampToValueAtTime(F, t + pt); });
      kg.gain.value = VOW[path[0][1]][k][1] * 2.6; x.connect(b); b.connect(kg); kg.connect(amp);
    }
    const body = c.createBiquadFilter(), bg = c.createGain(); body.type = 'lowpass'; body.frequency.value = 480 * fs; bg.gain.value = o.body == null ? 0.4 : o.body; x.connect(body); body.connect(bg); bg.connect(amp);
    let last = amp;
    if (o.am) { const tr = c.createGain(); tr.gain.value = 1 - o.am[1]; amp.connect(tr); lfo(o.am[0], o.am[1], [tr.gain]); last = tr; }
    const env = c.createGain(), lv = o.lv || 0.5;
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(lv, t + (o.att || 0.03)); env.gain.setTargetAtTime(0, t + dur, rel);
    last.connect(env); outTo(g, env, o.pan || 0);
  }
  const shift = (f, k) => f.map(([t, v]) => [t, v * k]);
  const V4 = () => Math.floor(Math.random() * 4);
  const fol = (g, t, k, lv, pan, rate) => play(g, t, folBuf(g.ctx, k, V4()), lv, pan || 0, rate || rr(0.9, 1.1));
  const fem = () => Math.random() < 0.5;

  // ══ SFX: name -> fn(g, t, opts). Unknown names are no-ops ═══════════════════
  function knockCans(g, t, lv) {   // a pyramid of cans: a dense clatter that thins into bounces, then a roll
    let x = t, gap = 0.008;
    for (let i = 0, N = Math.floor(rr(28, 50)); i < N; i++) { fol(g, x, 'can', lv * rr(0.25, 0.8) * Math.max(0.25, 1 - i / N), rr(-0.7, 0.7), rr(0.75, 1.4)); x += gap * rr(0.5, 1.8); gap *= 1.07; }
    for (let k = 0; k < 2; k++) { const s = t + rr(0.5, 1.1), n = noiseThrough(g, s, 1.2, 'bandpass', 5, rr(-0.5, 0.5)); n.f.value = rr(1800, 2600); n.v.setValueAtTime(0, s); n.v.linearRampToValueAtTime(0.12 * lv, s + 0.05); n.v.setTargetAtTime(0, s + 0.3, 0.25); }
    fol(g, t, 'thud', lv * 0.4, 0, 1.3);
  }
  function balloonFly(g, t, lv) {   // a deflating balloon zooming away: pbbbbthhhh
    const c = g.ctx, d = rr(0.7, 1.3), o = c.createOscillator(), bp = c.createBiquadFilter(), v = c.createGain(), l = c.createOscillator(), lg = c.createGain(), am = c.createOscillator(), ag = c.createGain(), tr = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(rr(280, 350), t); o.frequency.exponentialRampToValueAtTime(rr(700, 1000), t + d);
    l.frequency.value = rr(6, 10); lg.gain.value = 120; l.connect(lg); lg.connect(o.detune);
    am.frequency.value = rr(22, 32); ag.gain.value = 0.5; tr.gain.value = 0.5; am.connect(ag); ag.connect(tr.gain);
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 1.2;
    v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(0.28 * lv, t + 0.03); v.gain.setValueAtTime(0.28 * lv, t + d - 0.1); v.gain.linearRampToValueAtTime(0, t + d);
    o.connect(bp); bp.connect(tr); tr.connect(v); outTo(g, v, rr(-0.6, 0.6));
    [o, l, am].forEach(x => { x.start(t); x.stop(t + d + 0.1); });
  }
  function whistle(g, t, lv) {   // security pea whistle: two blasts with the pea trill
    [[0, 0.16], [0.24, 0.5]].forEach(([o0, d]) => {
      const s = t + o0, c = g.ctx, o = c.createOscillator(), l = c.createOscillator(), lg = c.createGain(), v = c.createGain(), tr = c.createGain(), ag = c.createGain();
      o.type = 'sine'; o.frequency.value = rr(2700, 3100); l.type = 'square'; l.frequency.value = rr(28, 38); lg.gain.value = 160; l.connect(lg); lg.connect(o.frequency);
      tr.gain.value = 0.6; ag.gain.value = 0.4; l.connect(ag); ag.connect(tr.gain);
      v.gain.setValueAtTime(0, s); v.gain.linearRampToValueAtTime(0.3 * lv, s + 0.015); v.gain.setValueAtTime(0.3 * lv, s + d - 0.03); v.gain.linearRampToValueAtTime(0, s + d);
      o.connect(tr); tr.connect(v); outTo(g, v, 0); o.start(s); o.stop(s + d + 0.05); l.start(s); l.stop(s + d + 0.05);
      const n = noiseThrough(g, s, d + 0.05, 'bandpass', 2); n.f.value = 3000; n.v.setValueAtTime(0.1 * lv, s); n.v.linearRampToValueAtTime(0, s + d);
    });
  }
  function gasp(g, t, lv, pan) { const f = fem(), b = f ? rr(380, 480) : rr(200, 260); voice(g, t, { dur: rr(0.18, 0.28), f: [[0, b], [0.2, b * 1.3]], noise: 1.6, nf: 1800, v: [[0, 'ah'], [0.2, 'eh']], fs: f ? 1.2 : 1, lv: 0.32 * lv, att: 0.01, rel: 0.04, pan }); }
  function scream(g, t, lv, pan) {
    const f = fem(), b = f ? rr(550, 780) : rr(260, 360), d = rr(0.45, 0.85);
    voice(g, t, { dur: d, f: [[0, b], [0.08, b * 1.5], [d, b * 1.15]], vib: [rr(6, 8), 70], dual: 12, noise: 0.4, nf: 2500, dist: 0.4, v: [[0, 'ah'], [d, f ? 'eh' : 'ah']], fs: f ? 1.3 : 1.05, lv: 0.42 * lv, att: 0.02, rel: 0.08, pan });
  }
  function eww(g, t, lv, pan) {
    const f = fem(), b = f ? rr(300, 420) : rr(150, 210), d = rr(0.45, 0.7);
    voice(g, t, { dur: d, f: [[0, b], [0.15, b * 1.35], [d, b * 0.8]], dual: 6, noise: 0.2, dist: 0.2, v: [[0, 'eh'], [0.12, 'ee'], [d * 0.7, 'ee'], [d, 'oo']], fs: f ? 1.2 : 1.05, lv: 0.45 * lv, att: 0.02, rel: 0.08, pan });
  }
  function crowd(g, t, lv, cheer) {   // a warehouse full of shoppers going "OOOOH"
    for (let i = 0; i < 8; i++) {
      const f = i % 2, b = (f ? rr(260, 380) : rr(120, 180)), d = rr(0.8, 1.4), s = t + rr(0, 0.25);
      voice(g, s, { dur: d, f: cheer ? [[0, b], [0.2, b * 1.4], [d, b * 1.2]] : [[0, b * 1.25], [0.25, b * 1.1], [d, b * 0.8]], vib: [rr(4, 7), 30], noise: 0.5, nf: 1200, v: cheer ? [[0, 'ah'], [d, 'eh']] : [[0, 'oh'], [d, 'oo']], fs: f ? 1.2 : 1, lv: 0.14 * lv, att: 0.12, rel: 0.25, pan: rr(-0.7, 0.7) });
    }
    const n = noiseThrough(g, t, 1.8, 'bandpass', 0.8); n.f.value = 900; n.v.setValueAtTime(0, t); n.v.linearRampToValueAtTime(0.1 * lv, t + 0.15); n.v.setTargetAtTime(0, t + 0.6, 0.3);
  }
  function chomp(g, t, o) {   // 2-4 greedy bites, then a gulp (and sometimes an "mmm!")
    const food = o.food || '', K = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < K; i++) {
      const s = t + i * rr(0.13, 0.18);
      fol(g, s, 'crunch', food === 'broccoli' ? 0.5 : food === 'burrito' ? 0.15 : 0.3, 0, rr(0.85, 1.2));
      fol(g, s + 0.01, 'squish', food === 'burrito' || food === 'beans' ? 0.55 : 0.35, 0, rr(0.8, 1.2));
      tone(g, s, 'sine', 140, 70, 0.08, 0.25);
    }
    fol(g, t + K * 0.16 + 0.05, 'glug', 0.5, 0, rr(0.8, 1));
    if (Math.random() < 0.5) voice(g, t + K * 0.16 + 0.25, { wave: 'triangle', dur: 0.3, f: [[0, rr(110, 130)], [0.3, rr(150, 175)]], noise: 0.05, v: [[0, 'oo'], [0.3, 'oo']], fs: 0.8, body: 1.2, lv: 0.25, att: 0.03, rel: 0.08 });
  }
  function burp(g, t, o) {   // a formant BRAAAP
    const d = rr(0.5, 1.1) * (o.big ? 1.5 : 1), b = rr(80, 105);
    tone(g, t, 'sine', 110, 50, 0.08, 0.4);
    voice(g, t, { dur: d, f: [[0, b], [0.1, b * 1.15], [d, b * 0.62]], fm: [rr(24, 40), rr(25, 45)], am: [rr(20, 34), 0.55], sub: 0.6, noise: 0.5, nf: 700, dist: 0.85, v: [[0, 'uh'], [0.08, 'ah'], [d * 0.75, 'aw'], [d, 'oh']], fs: 0.8, lv: 0.6, att: 0.02, rel: 0.1 });
  }
  const SFX = {
    fart(g, t, o) {
      const E = g.E, type = FT[o.type] != null ? o.type : o.type === 'squeak' ? 'nogas' : 'beans', P = clamp(o.power == null ? 0.8 : +o.power || 0, 0, 1);
      let d = null;
      if (!E.offline && type !== 'nogas') { const pl = E.pool[type]; if (pl && pl.length) d = pl.shift(); E.refill(type); }
      if (!d) d = fartData(type, E.offline ? P : 0.8, (Math.random() * 4294967295) >>> 0);
      const v = play(g, t, dataBuf(g.ctx, d, FSR), FT[type] * (0.6 + 0.4 * P), 0, (E.offline ? 1 : 1.12 - 0.2 * P) * rr(0.96, 1.04));
      if (type === 'beans') E.lastBeans = v;
    },
    nogas(g, t) { SFX.fart(g, t, { type: 'nogas', power: 1 }); },
    clench(g, t, o) {   // burrito wind-up: a strained "nnnngh" over a building rumble
      const d = 0.6 + 0.3 * (o.power || 0.8);
      voice(g, t, { dur: d, f: [[0, 120], [d, 175]], dual: 5, noise: 0.25, dist: 0.5, v: [[0, 'uh'], [d, 'uh']], fs: 0.75, am: [9, 0.3], lv: 0.3, att: 0.05, rel: 0.05 });
      const n = noiseThrough(g, t, d + 0.3, 'lowpass', 2); n.f.setValueAtTime(90, t); n.f.exponentialRampToValueAtTime(260, t + d); n.v.setValueAtTime(0, t); n.v.linearRampToValueAtTime(0.5, t + d); n.v.linearRampToValueAtTime(0, t + d + 0.05);
      slide(g, t + 0.05, 500, 1300, d - 0.05, 0.05);
    },
    burp(g, t, o) { burp(g, t, o); },
    chomp(g, t, o) { chomp(g, t, o); },
    munch(g, t, o) { chomp(g, t, o); },
    gulp(g, t) { fol(g, t, 'glug', 0.6, 0, 0.9); fol(g, t + 0.14, 'glug', 0.45, 0, 1.1); },
    squeal(g, t, o) {   // (one-shot fallback; the live squeal loop handles repeated calls)
      const p = o.power == null ? 0.7 : o.power, f = rr(1250, 1500), d = 0.35;
      tone(g, t, 'sine', f, f * 0.92, d, 0.08 * p); tone(g, t, 'sine', f * 1.53, f * 1.45, d, 0.05 * p);
    },
    squeak(g, t, o) {   // a rusty squeaky wheel
      const p = o.power == null ? 0.3 : o.power, f = rr(1500, 2100);
      for (let i = 0; i < 2; i++) { const s = t + i * rr(0.09, 0.14); voice(g, s, { wave: 'sawtooth', dur: 0.07, f: [[0, f], [0.07, f * rr(1.1, 1.3)]], noise: 0.1, v: [[0, 'ee'], [0.07, 'ee']], fs: 2.4, body: 0, lv: 1.1 * p, att: 0.01, rel: 0.02 }); }
    },
    crash(g, t, o) {   // metal cart clang + cardboard thuds (+ a slide whistle on a wipeout, a boing on a landing)
      const p = clamp(o.power == null ? 0.7 : o.power, 0.1, 1), kind = o.kind || '';
      fol(g, t, 'clang', 0.55 + 0.4 * p, 0, rr(0.9, 1.1)); fol(g, t + 0.01, 'wire', 0.4 + 0.3 * p, 0.1);
      tone(g, t, 'sine', 100, 40, 0.25, 0.5 * p);
      for (let i = 0, N = 1 + Math.floor(p * 4); i < N; i++) fol(g, t + rr(0.02, 0.3), 'thud', rr(0.3, 0.7) * p, rr(-0.5, 0.5), rr(0.8, 1.2));
      if (p > 0.6 && Math.random() < 0.4) knockCans(g, t + 0.05, 0.4);
      if (kind === 'wipeout') { slide(g, t + 0.05, 1400, 300, 0.7, 0.12); voice(g, t, { dur: 0.45, f: [[0, 190], [0.1, 240], [0.45, 130]], dual: 8, noise: 0.3, dist: 0.3, v: [[0, 'oh'], [0.45, 'aw']], lv: 0.4, att: 0.02, rel: 0.08 }); }
      if (kind === 'land') SFX.boing(g, t + 0.03, { power: p });
    },
    boing(g, t, o) {
      const c = g.ctx, x = c.createOscillator(), v = c.createGain(), l = c.createOscillator(), lg = c.createGain(), p = o.power == null ? 0.7 : o.power;
      x.type = 'triangle'; x.frequency.setValueAtTime(rr(150, 190), t); x.frequency.exponentialRampToValueAtTime(rr(260, 320), t + 0.5);
      l.frequency.setValueAtTime(14, t); l.frequency.linearRampToValueAtTime(6, t + 0.5); lg.gain.setValueAtTime(60, t); lg.gain.setTargetAtTime(0, t, 0.25); l.connect(lg); lg.connect(x.frequency);
      v.gain.setValueAtTime(0.35 * p, t); v.gain.setTargetAtTime(0, t + 0.05, 0.15);
      x.connect(v); outTo(g, v, 0); x.start(t); x.stop(t + 0.8); l.start(t); l.stop(t + 0.8);
    },
    land(g, t, o) { tone(g, t, 'sine', 90, 35, 0.2, 0.5); fol(g, t, 'wire', 0.5, 0); fol(g, t + 0.02, 'thud', 0.4, 0, 0.8); SFX.boing(g, t + 0.03, o); },
    launch(g, t) { slide(g, t, 450, 1900, 0.75, 0.13); swish(g, t, 0.9, 200, 1500, 600, 0.5); tone(g, t, 'sine', 70, 30, 0.8, 0.5); },
    wipeout(g, t) { SFX.crash(g, t, { power: 0.9, kind: 'wipeout' }); },
    knock(g, t, o) {
      const k = o.kind || 'boxes', lv = clamp(o.power == null ? 1 : o.power, 0.3, 1);
      if (k === 'cans') knockCans(g, t, lv);
      else if (k === 'tp') { for (let i = 0, N = Math.floor(rr(5, 10)); i < N; i++) fol(g, t + i * rr(0.05, 0.12) + rr(0, 0.03), 'paper', rr(0.4, 0.8) * lv, rr(-0.6, 0.6), rr(0.8, 1.2)); }
      else if (k === 'balloons') { for (let i = 0, N = 1 + Math.floor(rr(0, 3)); i < N; i++) fol(g, t + i * rr(0.07, 0.2), 'pop', rr(0.6, 0.9) * lv, rr(-0.5, 0.5), rr(0.85, 1.2)); balloonFly(g, t + rr(0.05, 0.25), lv); }
      else if (k === 'cones') { for (let i = 0; i < 3; i++) fol(g, t + i * rr(0.08, 0.16), 'bonk', rr(0.4, 0.8) * lv, rr(-0.5, 0.5)); }
      else if (k === 'table') { fol(g, t, 'thud', 0.8 * lv); fol(g, t + 0.03, 'bonk', 0.5 * lv); knockCans(g, t + 0.05, 0.35 * lv); }
      else { let x = t; for (let i = 0, N = Math.floor(rr(4, 8)); i < N; i++) { fol(g, x, 'thud', rr(0.45, 0.9) * lv * (1 - i / (N + 2)), rr(-0.6, 0.6), rr(0.75, 1.25)); x += rr(0.06, 0.16); } swish(g, t + 0.1, 0.5, 400, 900, 300, 0.1 * lv); }
    },
    gasp(g, t, o) { gasp(g, t, 1, o._pan || 0); },
    scream(g, t, o) { scream(g, t, 1, o._pan || 0); },
    eww(g, t, o) { eww(g, t, 1, o._pan || 0); },
    crowd(g, t, o) { crowd(g, t, 1, o.kind === 'cheer'); },
    whistle(g, t) { whistle(g, t, 1); },
    radio(g, t) {   // walkie-talkie: squelch, band-passed garble, roger beep
      const c = g.ctx, bp = c.createBiquadFilter(), hp = c.createBiquadFilter(), sh = c.createWaveShaper(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.1; hp.type = 'highpass'; hp.frequency.value = 450;
      sh.curve = curve(c, 1.2); bp.connect(hp); hp.connect(sh); outTo(g, sh, 0);
      const r2 = { ctx: c, out: bp }, sq = n0 => { const n = noiseThrough(r2, n0, 0.15, 'highpass', 0.7); n.f.value = 1500; n.v.setValueAtTime(0.5, n0); n.v.setTargetAtTime(0, n0 + 0.02, 0.03); };
      sq(t); let x = t + 0.09; const b = rr(120, 170), vs = ['ah', 'eh', 'oh', 'ee', 'uh'];
      for (let i = 0, N = 4 + Math.floor(rr(0, 5)); i < N; i++) { const d = rr(0.05, 0.14); voice(r2, x, { dur: d, f: [[0, b * rr(0.9, 1.25)], [d, b * rr(0.8, 1.1)]], noise: 0.5, dist: 0.6, v: [[0, vs[V4()]], [d, vs[V4()]]], lv: 0.9, att: 0.008, rel: 0.02 }); x += d + rr(0.01, 0.06); }
      sq(x + 0.02); tone(r2, x + 0.1, 'square', 1250, 1250, 0.07, 0.25);
    },
    forklift(g, t) { for (let i = 0; i < 3; i++) { const s = t + i * 0.6; const c = g.ctx, o = c.createOscillator(), v = c.createGain(); o.type = 'square'; o.frequency.value = 1060; v.gain.setValueAtTime(0, s); v.gain.linearRampToValueAtTime(0.08, s + 0.01); v.gain.setValueAtTime(0.08, s + 0.3); v.gain.linearRampToValueAtTime(0, s + 0.32); o.connect(v); outTo(g, v, 0); o.start(s); o.stop(s + 0.35); } },
    honk(g, t) { const c = g.ctx, lp = c.createBiquadFilter(), v = c.createGain(); lp.type = 'lowpass'; lp.frequency.value = 1600; [330, 415].forEach(f => { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + 0.6); }); v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(0.15, t + 0.02); v.gain.setValueAtTime(0.15, t + 0.45); v.gain.linearRampToValueAtTime(0, t + 0.5); lp.connect(v); outTo(g, v, 0); },
    horn(g, t) {   // the cart bell: brrring-brrring
      for (let b = 0; b < 2; b++) for (let i = 0; i < 5; i++) { const s = t + b * 0.32 + i * 0.045; play(g, s, folBuf(g.ctx, 'bell', 3), 0.3 * (1 - i * 0.12), 0, 0.8); }
    },
    scanner(g, t) { tone(g, t, 'sine', 1850, 1850, 0.13, 0.22); tone(g, t, 'square', 1850, 1850, 0.1, 0.03); },
    register(g, t) {   // cha-ching
      for (let i = 0; i < 3; i++) SFX.click(g, t + i * 0.06);
      fol(g, t + 0.2, 'drawer', 0.7); play(g, t + 0.32, folBuf(g.ctx, 'bell', V4()), 0.6, 0.1);
      fol(g, t + 0.36, 'coin', 0.35, -0.2);
    },
    click(g, t) { drumHit(g, t, 'r', 0.25, 0, 1.3); tone(g, t, 'sine', 1400, 900, 0.03, 0.06); },
    pickup(g, t) { fol(g, t, 'pop', 0.2, 0, 1.6); tone(g, t, 'sine', 420, 1300, 0.1, 0.22); tone(g, t + 0.07, 'triangle', 900, 1800, 0.08, 0.1); },
    collect(g, t) { SFX.scanner(g, t); [84, 88, 91, 96].forEach((m, i) => chimeHit(g, t + 0.12 + i * 0.07, m, 0.35 - i * 0.04, i % 2 ? 0.3 : -0.3)); },
    chime(g, t) {   // PA "ding-dong"
      [[81, 0], [77, 0.55]].forEach(([m, o0]) => { tone(g, t + o0, 'sine', hz(m), hz(m), 2.2, 0.3); tone(g, t + o0, 'sine', hz(m) * 2, hz(m) * 2, 0.9, 0.05); tone(g, t + o0, 'triangle', hz(m) / 2, hz(m) / 2, 1.5, 0.08); });
    },
    caught(g, t) { whistle(g, t, 1); tone(g, t + 0.05, 'sine', 90, 35, 0.3, 0.6); fol(g, t + 0.05, 'thud', 0.7, 0, 0.7); crowd(g, t + 0.2, 0.8, false); },
    slip(g, t) { slide(g, t, 900, 1700, 0.25, 0.1); slide(g, t + 0.25, 1700, 500, 0.35, 0.1); },
  };
  const SDUR = { fart: 5, clench: 1.5, burp: 2, chomp: 1.8, munch: 1.8, crash: 2.5, knock: 3, crowd: 2.5, caught: 3, radio: 2.2, register: 2, collect: 2.2, launch: 1.4, land: 1.2, wipeout: 2.5, scream: 1.4, whistle: 1.2, forklift: 2.2, chime: 3, balloon: 2, horn: 1.8 };
  const POSITIONAL = { gasp: 1, scream: 1, eww: 1, whistle: 1, radio: 1, forklift: 1, honk: 1, knock: 1, crash: 1 };

  // ══ Music ═══════════════════════════════════════════════════════════════════
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const QUAL = { '': [0, 4, 7], m: [0, 3, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14], 7: [0, 4, 7, 10], 9: [0, 4, 7, 10, 14], 13: [0, 4, 10, 14, 21], '7b9': [0, 4, 7, 10, 13], m7b5: [0, 3, 6, 10], '7sus': [0, 5, 7, 10], dim7: [0, 3, 6, 9] };
  function chord(s, tp) {
    const mm = /^([A-G])(b|#)?(.*)$/.exec(s); const root = ((PC[mm[1]] + (mm[2] === 'b' ? -1 : mm[2] === '#' ? 1 : 0) + tp) % 12 + 12) % 12;
    return { root, iv: QUAL[mm[3]] || QUAL[''] };
  }
  const noteM = s => { const mm = /^([A-G])(b|#)?(-?\d)$/.exec(s); return 12 * (+mm[3] + 1) + PC[mm[1]] + (mm[2] === 'b' ? -1 : mm[2] === '#' ? 1 : 0); };
  function parseMel(s) {
    const out = []; let b = 0;
    (s || '').split(/[\s|]+/).forEach(tok => { if (!tok) return; const [a, d] = tok.split(','), dur = parseFloat(d); if (a !== 'r') out.push({ b, d: dur, m: noteM(a) }); b += dur; });
    return out;
  }
  const bassRoot = ch => { let m = 36 + ch.root; if (m > 43) m -= 12; return m; };
  function epVoice(ch) {
    const ivs = ch.iv.length >= 4 ? ch.iv.slice(1) : ch.iv, out = [];
    ivs.forEach(iv => { let n = 48 + ch.root + iv; while (n < 52) n += 12; while (n > 72) n -= 12; if (out.indexOf(n) < 0) out.push(n); });
    return out.sort((a, b) => a - b);
  }
  function stabVoice(ch) {
    const out = [bassRoot(ch) + 12];
    [ch.iv[1], ch.iv[3] || 12, ch.iv[2]].forEach(iv => { let n = 48 + ch.root + iv; while (n < 55) n += 12; while (n > 70) n -= 12; out.push(n); });
    return out;
  }
  const VEL = { X: 1, x: 0.72, g: 0.32 };
  const COMP = {
    bossa: [[0, 3, .8], [3, 2, .55], [6, 3, .7], [10, 2, .6], [13, 3, .65]],
    skank: [[2, 1, .6], [6, 1, .7], [10, 1, .6], [14, 1, .7]],
    push: [[0, 2, .8], [6, 2, .6], [10, 2, .7], [14, 2, .6]],
  };
  const BASS = {
    funk: [[0, 'R', 3, 1], [3, '5', 1, .5], [4, 'O', 1, .8, 1], [6, 'A', 2, .65], [8, 'R', 3, .95], [11, '5', 1, .5], [12, 'O', 1, .8, 1], [14, 'A', 2, .65]],
    gallop: [[0, 'R', 1, 1], [2, 'O', 1, .8, 1], [3, 'R', 1, .6], [4, 'R', 1, .9], [6, 'O', 1, .8, 1], [7, 'R', 1, .6], [8, 'R', 1, 1], [10, 'O', 1, .8, 1], [11, 'R', 1, .6], [12, '5', 1, .9], [14, 'O', 1, .8, 1], [15, 'A', 1, .7]],
    bounce: [[0, 'R', 3, 1], [4, '5', 2, .8], [6, 'O', 1, .7, 1], [8, 'R', 3, .9], [12, '5', 2, .8], [14, 'A', 2, .7]],
    walk: [[0, 'R', 7, .8], [8, '5', 5, .7], [14, 'A', 2, .6]],
  };
  // Drum patterns: 16 steps per bar; X accent, x normal, g ghost.
  const DR = {
    shop: { k: ['X-----x---x-----', 'X-----x---x--x--'], s: '----x-------x---', h: 'xgxgXgxgxgxgXgxg', z: 'gxgxgxgxgxgxgxgx', r: '---x-----x----x-' },
    shopFill: { k: 'X-----x---------', s: '----x-----x-xgxx', h: 'xgxgXgxg--------', o: '--------------x-' },
    shopB: { k: ['X-----x---x-----', 'X-----x---x--x--'], c: '----x-------x---', h: 'xgxgXgxgxgxgXgxg', z: 'gxgxgxgxgxgxgxgx', r: '---x-----x----x-' },
    chase: { k: 'X---x-x-X---x-x-', s: '----X-------X---', h: 'XxxxXxxxXxxxXxxx', t: 'x-xxx-xxx-xxx-xx', b: 'x-x-x-x-x-x-x-x-' },
    chaseFill: { k: 'X---x-x-X-------', s: 'X-xxX-xxXxxxXXXX', h: 'XxxxXxxx--------' },
    title: { k: 'X-------X-x-----', s: '----X-------X---', c: '----x-------x---', h: 'g-x-g-x-g-x-g-x-', z: 'xgxgxgxgxgxgxgxg' },
    titleFill: { k: 'X-------X-------', s: '----X-----x-XxXX', h: 'g-x-g-x---------' },
    soft: { k: 'x-------x-------', w: '----x-------x---', z: 'g-g-g-g-g-g-g-g-' },
    fan: { s: ['gxgxgxgxxxxxXXXX', ''], k: ['', 'X---------------'], C: ['', 'X---------------'] },
  };
  const A_CH = ['Fmaj7', 'Dm9', 'Gm9', 'C13', 'Am7 D7b9', 'Gm9 C9', 'Fmaj7 D7', 'Gm7 C7'];
  const A2_CH = ['Fmaj7', 'Dm9', 'Gm9', 'C13', 'Am7 D7b9', 'Gm9 C9', 'Fmaj7', 'Cm7 F7'];
  const B_CH = ['Bbmaj7', 'Bbm6', 'Am7', 'D7b9', 'Gm7', 'C7', 'Am7 D7', 'Gm7 C7'];
  const MEL = {
    A: 'r,.5 A4,.5 C5,.5 E5,.5 G5,1 E5,1 | F5,1.5 E5,.5 D5,1 A4,1 | r,.5 Bb4,.5 D5,.5 F5,.5 A5,1 F5,1 | G5,1.5 F5,.5 E5,1 C5,1 | A4,.5 C5,.5 E5,1 F#5,1 Eb5,1 | D5,.5 F5,.5 A5,1 G5,1 Bb4,1 | A4,2 r,.5 F#4,.5 A4,.5 C5,.5 | Bb4,1 D5,1 E5,1 G5,1',
    A2: 'r,.5 A4,.5 C5,.5 E5,.5 G5,1 E5,1 | F5,1.5 E5,.5 D5,1 A4,1 | r,.5 Bb4,.5 D5,.5 F5,.5 A5,1 F5,1 | G5,1.5 F5,.5 E5,1 C5,1 | A4,.5 C5,.5 E5,1 F#5,1 Eb5,1 | D5,.5 F5,.5 A5,1 G5,1 Bb4,1 | A4,1 C5,1 F5,2 | Eb5,1 C5,1 A4,1 C5,1',
    B: 'D5,1.5 C5,.5 D5,1 F5,1 | Db5,1.5 C5,.5 Bb4,1 G4,1 | C5,1.5 A4,.5 E5,2 | r,.5 D5,.5 F#5,.5 A5,.5 C6,1 A5,1 | Bb5,1.5 A5,.5 G5,1 F5,1 | E5,1 G5,1 Bb5,1 G5,1 | E5,1 C5,1 F#5,1 D5,1 | G5,2 F5,1 E5,1',
    T: 'E5,.5 G5,.5 C6,1 G5,.5 E5,.5 C5,1 | A5,.5 G5,.5 E5,1 C5,1 r,1 | F5,.5 E5,.5 D5,1 A5,1 F5,1 | G5,1.5 F5,.5 D5,1 B4,1 | E5,.5 G5,.5 C6,1 E6,1 D6,1 | C#6,1.5 A5,.5 E5,1 G5,1 | F5,1 A5,1 G5,1 B5,1 | C6,2 r,1 G5,1',
    F: 'C5,.333 C5,.333 C5,.334 F5,1.5 C5,.5 F5,.5 A5,.5 | C6,3 r,1',
    R: 'A4,2 C5,1 E5,1 | D5,3 r,1 | C5,2 A4,1 G4,1 | Bb4,2 G4,2 | A4,3 C5,1 | F5,2 E5,1 D5,1 | D5,2 C5,1 Bb4,1 | Bb4,2 E5,2',
  };
  const T_CH = ['C6', 'Am7', 'Dm7', 'G7', 'C6', 'A7', 'Dm7 G7', 'C6 G7'];
  const R_CH = ['Fmaj7', 'Bbmaj7', 'Am7', 'Gm7 C9', 'Fmaj7', 'Dm9', 'Gm9', 'Gm7 C7'];
  const TRACKS = {
    // Muzak: F major bossa-funk, 104 bpm, light swing, ~74 s loop (AABA).
    shop: {
      bpm: 104, swing: 0.12, lv: 0.9, intro: ['I'], form: ['A1', 'A2', 'B1', 'A3'],
      sec: {
        I: { ch: ['Fmaj7', 'Gm7 C7'], comp: 'bossa', bass: 'funk', dr: { h: 'xgxgXgxgxgxgXgxg', z: 'gxgxgxgxgxgxgxgx', r: '---x-----x----x-' }, fill: DR.shopFill },
        A1: { ch: A_CH, m: 'A', lead: [['flute', 0, 1]], comp: 'bossa', bass: 'funk', dr: DR.shop, fill: DR.shopFill },
        A2: { ch: A2_CH, m: 'A2', lead: [['synth', 0, 1], ['flute', 12, 0.3]], comp: 'bossa', bass: 'funk', dr: DR.shop, fill: DR.shopFill, crash: 1 },
        B1: { ch: B_CH, m: 'B', lead: [['vibes', 0, 0.8], ['flute', -12, 0.4]], comp: 'push', bass: 'funk', dr: DR.shopB, fill: DR.shopFill, crash: 1 },
        A3: { ch: A_CH, m: 'A', lead: [['flute', 0, 1], ['synth', -12, 0.45], ['glock', 12, 0.25]], comp: 'bossa', bass: 'funk', dr: DR.shop, fill: DR.shopFill, crash: 1 },
      },
    },
    // The same theme as a frantic cartoon chase: tempo, stabs, cowbell and a key change rise with the wanted level.
    chase: {
      bpm: p => 150 + 8 * clamp(p.wanted - 1, 0, 4), tp: p => (p.wanted >= 4 ? 1 : 0), swing: 0, lv: 0.85, intro: ['CI'], form: ['CA', 'CA2', 'CB', 'CA3'],
      sec: {
        CI: { ch: ['C7'], dr: { k: 'X---X---X---X---', s: '--------X-X-XXXX', t: 'x-xxx-xxx-xxx-xx' }, stab: 'X-----X---------', riser: 1 },
        CA: { ch: A_CH, m: 'A', lead: [['brass', 0, 1], ['synth', 12, 0.35]], bass: 'gallop', comp: 'skank', dr: DR.chase, fill: DR.chaseFill, stab: 'X-----X---X-----', crash: 1 },
        CA2: { ch: A2_CH, m: 'A2', lead: [['synth', 0, 1], ['brass', -12, 0.6]], bass: 'gallop', comp: 'skank', dr: DR.chase, fill: DR.chaseFill, stab: 'X-----X---X-----', crash: 1 },
        CB: { ch: B_CH, m: 'B', lead: [['brass', 0, 1], ['flute', 12, 0.35]], bass: 'gallop', comp: 'skank', dr: DR.chase, fill: DR.chaseFill, stab: 'X---X---X---X---', crash: 1, riserEnd: 1 },
        CA3: { ch: A_CH, m: 'A', lead: [['brass', 0, 1], ['brass', 12, 0.4], ['synth', -12, 0.4]], bass: 'gallop', comp: 'skank', dr: DR.chase, fill: DR.chaseFill, stab: 'X-----X---X-----', crash: 1 },
      },
    },
    // Title: a jingly glockenspiel hook in C, 126 bpm, ~31 s loop.
    title: {
      bpm: 126, swing: 0.08, lv: 0.85, intro: ['TI'], form: ['T1', 'T2'],
      sec: {
        TI: { ch: ['G7'], dr: { k: 'X-------X-------', s: '----X-----x-XxXX' }, stab: 'X---------------' },
        T1: { ch: T_CH, m: 'T', lead: [['glock', 0, 0.9], ['vibes', -12, 0.35]], comp: 'skank', bass: 'bounce', dr: DR.title, fill: DR.titleFill, crash: 1 },
        T2: { ch: T_CH, m: 'T', lead: [['glock', 0, 0.8], ['synth', -12, 0.7]], comp: 'skank', bass: 'bounce', dr: DR.title, fill: DR.titleFill, crash: 1 },
      },
    },
    // Results: a brass fanfare (a win) or a sad trombone (a loss), then a soft muzak loop (~23 s).
    results: {
      bpm: 84, swing: 0.1, lv: 0.85, intro: E => (E.win === false ? ['L0'] : ['F0']), form: ['R1'],
      sec: {
        F0: { bpm: 116, ch: ['F', 'Fmaj9'], m: 'F', lead: [['brass', 0, 1], ['brass', -12, 0.6], ['glock', 12, 0.3]], dr: DR.fan, stab: ['', 'X---------------'] },
        L0: { bpm: 90, ch: ['C7', 'C7'], fx: 'trombone' },
        R1: { ch: R_CH, m: 'R', lead: [['flute', 0, 0.55]], comp: 'bossa', compLv: 0.8, bass: 'walk', dr: DR.soft, lv: 0.7 },
      },
    },
  };
  function trombone(g, t) {   // wah wah wah waaaah
    const c = g.ctx, o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), v = c.createGain(), vib = c.createOscillator(), vg = c.createGain();
    o.type = o2.type = 'sawtooth'; o2.detune.value = 9; lp.type = 'lowpass'; lp.Q.value = 5; KR(lp.frequency);
    vib.frequency.value = 5.5; vg.gain.value = 0; vib.connect(vg); vg.connect(o.detune); vg.connect(o2.detune);
    let x = t; v.gain.setValueAtTime(0, t);
    [[50, 0.55], [49, 0.55], [48, 0.55], [47, 2.0]].forEach(([m, d], i) => {
      const f = hz(m); o.frequency.setValueAtTime(f, x); o2.frequency.setValueAtTime(f, x);
      v.gain.setValueAtTime(0, x); v.gain.linearRampToValueAtTime(0.3, x + 0.05); v.gain.setTargetAtTime(0, x + d - 0.08, 0.04);
      if (i < 3) { lp.frequency.setValueAtTime(250, x); lp.frequency.linearRampToValueAtTime(1400, x + 0.15); lp.frequency.linearRampToValueAtTime(400, x + d * 0.9); }
      else { for (let k = 0; k * 0.32 < d - 0.2; k++) { lp.frequency.setValueAtTime(300, x + k * 0.32); lp.frequency.linearRampToValueAtTime(1300, x + k * 0.32 + 0.14); lp.frequency.linearRampToValueAtTime(350, x + k * 0.32 + 0.3); } vg.gain.setValueAtTime(0, x + 0.2); vg.gain.linearRampToValueAtTime(40, x + 0.7); }
      x += d;
    });
    o.connect(lp); o2.connect(lp); lp.connect(v); outTo(g, v, 0);
    [o, o2, vib].forEach(n => { n.start(t); n.stop(x + 0.3); });
  }
  const PL = {   // plucked / struck lead voices
    glock: (g, T, m, lv, pan) => chimeHit(g, T, m + 12, lv * 0.5, pan),
    vibes: (g, T, m, lv, pan) => chimeHit(g, T, m, lv * 0.55, pan),
    ep: (g, T, m, lv, pan, d) => epHit(g, T, m, lv * 0.4, d, pan),
  };
  // Build every event of one section (times in seconds from the section start).
  function buildSection(tr, key, rep, prm) {
    const S = tr.sec[key], bpm = S.bpm || (typeof tr.bpm === 'function' ? tr.bpm(prm) : tr.bpm), tp = tr.tp ? tr.tp(prm) : 0;
    const sb = 60 / bpm, st = sb / 4, sw = S.swing != null ? S.swing : (tr.swing || 0), bars = S.ch.length, barS = 4 * sb, SL = S.lv || 1;
    const r = rng(hash(key) + rep * 977), ev = [], needs = [];
    const add = (t, d, fn, prio) => ev.push({ t: Math.max(0, t), d, fn, prio: prio || 1 });
    const at = s => { const i = Math.floor(s + 1e-6), f = s - i; return (i + f) * st + (i % 2 === 1 && f < 1e-6 ? sw * st : 0); };
    const chords = S.ch.map(b => b.split(/\s+/).map(x => chord(x, tp)));
    const chordAt = s => { if (s >= bars * 16) return chords[0][0]; const b = Math.floor(s / 16), cs = chords[b]; return cs[Math.min(cs.length - 1, Math.floor((s - b * 16) * cs.length / 16))]; };
    if (S.dr) for (let b = 0; b < bars; b++) {
      const pat = S.fill && b === bars - 1 ? S.fill : S.dr;
      Object.keys(pat).forEach(k => {
        if (k === 'b' && !(prm.wanted >= 3)) return;
        const p = Array.isArray(pat[k]) ? pat[k][b % pat[k].length] : pat[k]; if (!p) return;
        needs.push(['drum', k]);
        [...p].forEach((ch, i) => {
          const v = VEL[ch]; if (!v) return;
          const lv = DLV[k] * v * SL * (0.9 + 0.2 * r()), rate = k === 't' ? [1, 0.8, 0.68, 0.9][i % 4] : 1;
          add(at(b * 16 + i), k === 'C' ? 2.6 : 0.6, (g, T) => drumHit(g, T, k, lv, DPAN[k] || 0, rate), k === 'k' || k === 's' ? 2 : 1);
        });
      });
    }
    if (S.crash) { needs.push(['drum', 'C']); add(0, 2.6, (g, T) => drumHit(g, T, 'C', DLV.C * SL, 0.2), 2); }
    if (S.bass) for (let b = 0; b < bars; b++) BASS[S.bass].forEach(([s0, tok, len, v, pop]) => {
      const s = b * 16 + s0, ch = chordAt(s), R0 = bassRoot(ch);
      let m = tok === 'R' ? R0 : tok === 'O' ? R0 + 12 : tok === '5' ? R0 + 7 : tok === '3' ? R0 + ch.iv[1] : R0;
      if (tok === 'A') { const nt = bassRoot(chordAt(s + len)); m = nt + (r() < 0.3 ? 1 : -1); }
      const lv = 0.5 * v * SL, dur = len * st * 0.9, pp = !!pop;
      needs.push(['bass', m, pp]); add(at(s), dur, (g, T) => bassHit(g, T, m, lv, dur, pp), 2);
    });
    if (S.comp) for (let b = 0; b < bars; b++) COMP[S.comp].forEach(([s0, len, v]) => {
      const s = b * 16 + s0, vo = epVoice(chordAt(s)), lv = 0.24 * v * SL * (S.compLv || 1) / Math.sqrt(vo.length), dur = len * st;
      vo.forEach(m => needs.push(['ep', m]));
      add(at(s), dur, (g, T) => vo.forEach((m, k) => epHit(g, T + k * 0.006, m, lv, dur, k % 2 ? 0.25 : -0.25)), 2);
    });
    if (S.stab && !(tr === TRACKS.chase && key !== 'CI' && !(prm.wanted >= 2))) for (let b = 0; b < bars; b++) {
      const p = Array.isArray(S.stab) ? S.stab[b % S.stab.length] : S.stab; if (!p) continue;
      [...p].forEach((ch, i) => { if (ch !== 'X') return; const ms = stabVoice(chordAt(b * 16 + i)); add(at(b * 16 + i), 0.4, (g, T) => stab(g, T, ms, 0.4 * SL, Math.min(0.2, st * 2)), 2); });
    }
    (S.lead || []).forEach(([inst, oct, lv0], li) => {
      const pan = li ? (li % 2 ? -0.3 : 0.3) : 0.05, lv = lv0 * SL;
      const ns = parseMel(MEL[S.m]).map(n => ({ t: at(n.b * 4), d: at((n.b + n.d) * 4) - at(n.b * 4), m: n.m + oct + tp, b: n.b }));
      if (PL[inst]) { ns.forEach(n => { needs.push([inst === 'ep' ? 'ep' : 'chime', inst === 'glock' ? n.m + 12 : n.m]); const v = lv * (0.9 + r() * 0.2); add(n.t, 2, (g, T) => PL[inst](g, T, n.m, v, pan, n.d), 3); }); return; }
      let ph = [];
      const flush = () => { if (!ph.length) return; const p = ph; ph = []; const d = p[p.length - 1].t + p[p.length - 1].d - p[0].t; add(p[0].t, d, (g, T) => lead(g, inst, p.map(n => ({ t: T + n.t - p[0].t, d: n.d, m: n.m })), lv, pan), 3); };
      ns.forEach(n => {
        const pv = ph[ph.length - 1];
        if (pv && (n.t > pv.t + pv.d + 0.001 || n.b % 16 === 0)) { if (n.t <= pv.t + pv.d + 0.001) pv.d -= Math.min(0.12, pv.d * 0.25); flush(); }
        ph.push({ t: n.t, d: n.d, m: n.m });
      });
      flush();
    });
    if (S.riser || S.riserEnd) add((bars - 1) * barS, barS, (g, T) => riser(g, T, barS, 0.07), 2);
    if (S.fx === 'trombone') add(0.05, 4, (g, T) => trombone(g, T), 3);
    ev.sort((a, b) => a.t - b.t);
    return { len: bars * barS, chunk: barS * 2, ev, needs };
  }
  function bakeNeed(c, n) { if (n[0] === 'drum') drumBuf(c, n[1]); else if (n[0] === 'bass') bassBuf(c, n[1], n[2]); else if (n[0] === 'ep') epBuf(c, n[1]); else chimeBuf(c, n[1]); }
  // One track's look-ahead player: sections chain back to back; each 2-bar chunk plays into its own bus.
  function player(E, name, fadeIn) {
    const tr = TRACKS[name], c = E.ctx, P = { name, dead: false, done: false, buses: [] };
    const t0 = c.currentTime + 0.05, intro = typeof tr.intro === 'function' ? tr.intro(E) : (tr.intro || []), order = intro.concat(tr.form), loop0 = intro.length;
    P.gain = c.createGain(); P.gain.gain.setValueAtTime(0, t0); P.gain.gain.linearRampToValueAtTime(tr.lv || 1, t0 + fadeIn); P.gain.connect(E.musicIn);
    let si = 0, rep = 0, next = t0, cur = null;
    if (!E.offline) {   // bake this track's buffers in small idle slices, first use first
      const seen = {}, list = [];
      order.forEach(k => buildSection(tr, k, 0, E.params()).needs.forEach(n => { const id = n.join(); if (!seen[id]) { seen[id] = 1; list.push(n); } }));
      const step = () => { if (P.dead || !list.length) return; bakeNeed(c, list.shift()); setTimeout(step, 20); };
      setTimeout(step, 20);
    }
    const close = (s, j) => {
      const b = s.open[j]; delete s.open[j];
      E.later(() => { try { b.bus.disconnect(); } catch (e) { } P.buses = P.buses.filter(x => x !== b.bus); }, (b.end + TAIL - c.currentTime) * 1000);
    };
    P.pump = h => {
      if (P.dead || P.done) return;
      for (let guard = 0; guard < 8; guard++) {
        if (!cur) {
          if (next > h) return;
          const key = order[si]; if (++si >= order.length) { si = loop0; rep++; }
          const st = E.offline ? next : Math.max(next, c.currentTime + 0.05);
          const sec = buildSection(tr, key, rep, E.params());
          cur = { t0: st, len: sec.len, ev: sec.ev, i: 0, chunk: sec.chunk, open: {} };
          E.stats.sections.push(name + ':' + key); if (E.stats.sections.length > 16) E.stats.sections.shift();
        }
        const now = c.currentTime;
        while (cur.i < cur.ev.length && cur.t0 + cur.ev[cur.i].t < h) {
          const e = cur.ev[cur.i++], T = cur.t0 + e.t, k = Math.floor(e.t / cur.chunk);
          Object.keys(cur.open).forEach(j => { if (+j < k) close(cur, j); });
          if (!E.offline && T < now - 0.02) { E.stats.skipped++; continue; }
          if (!E.allow(E.mv, CAP_M, T, T + e.d + 1, e.prio)) continue;
          let b = cur.open[k];
          if (!b) { b = cur.open[k] = { bus: c.createGain(), end: 0 }; b.bus.connect(P.gain); P.buses.push(b.bus); }
          b.end = Math.max(b.end, T + e.d);
          e.fn({ ctx: c, out: b.bus }, T);
        }
        if (cur.i < cur.ev.length) return;
        next = cur.t0 + cur.len;
        Object.keys(cur.open).forEach(j => close(cur, j)); cur = null;
      }
    };
    P.stop = fade => {
      if (P.dead) return; P.dead = true;
      const now = c.currentTime, gg = P.gain.gain;
      gg.cancelScheduledValues(now); gg.setValueAtTime(gg.value, now); gg.linearRampToValueAtTime(0, now + fade);
      E.later(() => { P.buses.forEach(b => { try { b.disconnect(); } catch (e) { } }); P.buses = []; try { P.gain.disconnect(); } catch (e) { } }, (fade + 0.5) * 1000);
    };
    return P;
  }
  function fades(prev, name) {
    if (name === 'results') return [0.05, 0.4];
    if ((prev === 'shop' && name === 'chase') || (prev === 'chase' && name === 'shop')) return [0.4, 0.8];
    return [1.2, 1.2];
  }

  // ══ Engine: master chain + reverb + music/sfx buses (works on any context) ══
  function makeEngine(ctx, dest, offline) {
    const E = { ctx, offline, mv: [], sv: [], cur: null, pool: {}, stats: { notes: 0, skipped: 0, capped: 0, sfx: 0, sections: [] } };
    const G = () => ctx.createGain();
    E.master = G(); E.master.connect(dest);
    const clip = ctx.createWaveShaper(); clip.curve = (() => { const n = 2048, a = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 4 - 2; a[i] = Math.tanh(x * 1.05) * 0.965; } return a; })();
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 10; glue.ratio.value = 2.5; glue.attack.value = 0.01; glue.release.value = 0.25;
    const pre = G(), pg = G(); pg.gain.value = 0.5;
    pre.connect(glue); glue.connect(lim); lim.connect(pg); pg.connect(clip); clip.connect(E.master);
    const conv = ctx.createConvolver(); conv.buffer = impulse(ctx);
    const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), rg = G();
    hp.type = 'highpass'; hp.frequency.value = 180; lp.type = 'lowpass'; lp.frequency.value = 5000; rg.gain.value = 0.8;
    conv.connect(hp); hp.connect(lp); lp.connect(rg); rg.connect(pre);
    // music: musicIn -> vol -> fart duck -> speech duck -> master chain (+ a light reverb send)
    E.musicIn = G(); E.musicVol = G(); E.musicVol.gain.value = 0.34; E.fduck = G(); E.sduck = G();
    E.musicIn.connect(E.musicVol); E.musicVol.connect(E.fduck); E.fduck.connect(E.sduck); E.sduck.connect(pre);
    const ms = G(); ms.gain.value = 0.18; E.sduck.connect(ms); ms.connect(conv);
    E.sfxIn = G(); E.sfxVol = G(); E.sfxIn.connect(E.sfxVol); E.sfxVol.connect(pre);
    const ss = G(); ss.gain.value = 0.3; E.sfxVol.connect(ss); ss.connect(conv);   // the warehouse echo on every fart

    E.q = [];
    E.later = (fn, ms2) => { if (!offline) setTimeout(fn, Math.max(0, ms2)); else E.q.push([ctx.currentTime + ms2 / 1000, fn]); };
    E.allow = (list, cap, T, end, prio) => {
      if (list.length >= cap * 0.75) { const keep = list.filter(x => x > T); list.length = 0; keep.forEach(x => list.push(x)); }
      if (list.length >= cap && prio < 3) { E.stats.capped++; return false; }
      list.push(end); E.stats.notes++; return true;
    };
    E.params = () => ({ wanted: E.testWanted != null ? E.testWanted : clamp(+(BR.rules && BR.rules.wanted) || 0, 0, 5) });
    E.music = name => {
      name = TRACKS[name] ? name : null;
      const prev = E.cur ? E.cur.name : null;
      if (prev === name) return;
      const [fin, fout] = fades(prev, name);
      if (E.cur) E.cur.stop(name ? fout : 1.5);
      E.cur = name ? player(E, name, fin) : null;
      if (E.cur) E.cur.pump(ctx.currentTime + LOOK);
    };
    E.tick = () => {
      if (E.cur) E.cur.pump(ctx.currentTime + LOOK);
      if (offline && E.q.length) { const now = ctx.currentTime, due = E.q.filter(x => x[0] <= now); E.q = E.q.filter(x => x[0] > now); due.forEach(x => x[1]()); }
    };
    E.sfx = (name, o, at, lv, pan) => {
      const fn = SFX[name]; if (!fn) return;
      const t = at == null ? ctx.currentTime + 0.01 : at, dur = SDUR[name] || 1.2;
      if (!E.allow(E.sv, CAP_S, t, t + dur, name === 'click' || name === 'squeak' ? 1 : 3)) return;
      const bus = G(); bus.gain.value = lv;
      if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; bus.connect(p); p.connect(E.sfxIn); } else bus.connect(E.sfxIn);
      E.stats.sfx++;
      fn({ ctx, out: bus, E }, t, o || {});
      E.later(() => { try { bus.disconnect(); } catch (e) { } }, (dur + 1.5) * 1000);
    };
    E.duck = (amt, secs) => {   // farts punch a hole in the music
      const g = E.fduck.gain, now = ctx.currentTime;
      g.cancelScheduledValues(now); g.setTargetAtTime(amt, now, 0.02); g.setTargetAtTime(1, now + secs, 0.35);
    };
    E.refill = type => { if (offline) return; setTimeout(() => { try { const a = E.pool[type] || (E.pool[type] = []); if (a.length < 2) a.push(fartData(type, 0.8, (Math.random() * 4294967295) >>> 0)); } catch (e) { } }, 90 + Math.random() * 120); };
    // The held beans stream: a live loop whose rate, filter and level follow the thrust.
    E.hold = (P, at, manual) => {
      const t = at == null ? ctx.currentTime + 0.01 : at, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), v = G();
      s.buffer = dataBuf(ctx, holdData((Math.random() * 4294967295) >>> 0), FSR); s.loop = true;
      f.type = 'lowpass'; f.Q.value = 1.2; KR(f.frequency);
      const apply = (p, tt, tc) => { p = clamp(p, 0, 1); s.playbackRate.setTargetAtTime(0.82 + 0.4 * p, tt, tc); f.frequency.setTargetAtTime(700 + 2600 * p, tt, tc); v.gain.setTargetAtTime(FT.beans * (0.45 + 0.55 * p), tt, tc); };
      s.playbackRate.value = 0.82 + 0.4 * P; f.frequency.value = 700 + 2600 * P; v.gain.setValueAtTime(0, t); apply(P, t, 0.015);
      s.connect(f); f.connect(v); v.connect(E.sfxIn); s.start(t, Math.random() * 2);
      if (E.lastBeans) { try { const g = E.lastBeans.gain; g.cancelScheduledValues(t); g.setTargetAtTime(0, t, 0.05); } catch (e) { } E.lastBeans = null; }
      const H = { type: 'beans', manual: !!manual, t0: nowS(), seen: nowS(), dead: false };
      H.set = (p, tt) => { if (H.dead) return; H.seen = nowS(); apply(+p || 0, tt == null ? ctx.currentTime : tt, 0.06); };
      H.stop = tt => {
        if (H.dead) return; H.dead = true; const t2 = tt == null ? ctx.currentTime : tt;
        v.gain.cancelScheduledValues(t2); v.gain.setTargetAtTime(0, t2, 0.04); s.stop(t2 + 0.4);
        E.sfx('fart', { type: 'tail', power: 0.8 }, t2, 1, 0);
        E.later(() => { try { s.disconnect(); f.disconnect(); v.disconnect(); } catch (e) { } }, (t2 - ctx.currentTime + 0.6) * 1000);
      };
      H.handle = { set(p) { try { H.set(p); } catch (e) { } }, stop() { try { H.stop(); } catch (e) { } }, get active() { return !H.dead; } };
      return H;
    };
    E.volume = (m, mu, s) => {
      const now = ctx.currentTime, set = (p, v) => { p.cancelScheduledValues(now); p.setTargetAtTime(v, now, 0.05); };
      set(E.master.gain, clamp(m, 0, 1)); set(E.musicVol.gain, 0.34 * clamp(mu, 0, 1)); set(E.sfxVol.gain, clamp(s, 0, 1));
    };
    return E;
  }

  // ── Distance attenuation + pan from the camera (silent by ~80 m) ───────────
  function spatial(pos) {
    const cam = BR.core && BR.core.camera;
    if (!pos || !cam) return { lv: 1, pan: 0 };
    const dx = pos.x - cam.position.x, dy = (pos.y || 0) - cam.position.y, dz = pos.z - cam.position.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d >= 80) return null;
    const m = cam.matrixWorld && cam.matrixWorld.elements, lv = Math.pow(1 - d / 80, 1.3) / (1 + d / 30);
    let pan = 0;
    if (m && d > 0.01) pan = clamp((dx * m[0] + dy * m[1] + dz * m[2]) / d * Math.min(1, d / 2), -0.8, 0.8);
    return { lv, pan };
  }

  // ── Continuous loops: the cart rattle and the wheel squeal. Every call keeps them alive for 0.3 s ─
  const L = {};
  function loopCall(name, o) {
    if (!E) return;
    const c = E.ctx, now = c.currentTime;
    let lvl, rate = 1;
    if (name === 'rattle') {
      const sp = o.level != null ? +o.level : clamp((+o.speed || 0) / ((BR.config && BR.config.CART && BR.config.CART.maxSpeed) || 22), 0, 1);
      if (o.on === false) lvl = 0; else lvl = sp < 0.02 ? 0 : 0.08 + 0.32 * Math.pow(sp, 0.7); rate = 0.65 + 0.85 * sp;
    } else lvl = o.on === false ? 0 : 0.1 * clamp(o.power == null ? (o.amount == null ? 0.7 : +o.amount) : +o.power, 0, 1);
    let l = L[name];
    if (!l) {
      if (!lvl) return;
      const v = c.createGain(), nodes = []; v.gain.value = 0; v.connect(E.sfxIn);
      if (name === 'rattle') { const s = c.createBufferSource(); s.buffer = rattleBuf(c); s.loop = true; s.connect(v); s.start(now, Math.random() * 2); nodes.push(s); l = { v, nodes, rate: s.playbackRate }; }
      else {
        const f = rr(1250, 1450), lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 23; lg.gain.value = 55; lfo.connect(lg); lfo.start(now); nodes.push(lfo);
        [[f, 1], [f * 1.53, 0.5]].forEach(([fr, a]) => { const x = c.createOscillator(), k = c.createGain(); x.frequency.value = fr; lg.connect(x.frequency); k.gain.value = a; x.connect(k); k.connect(v); x.start(now); nodes.push(x); });
        const n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain(); n.buffer = noiseBuf(c); n.loop = true; bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 3; ng.gain.value = 0.4; n.connect(bp); bp.connect(ng); ng.connect(v); n.start(now); nodes.push(n);
        l = { v, nodes };
      }
      L[name] = l;
    }
    l.last = nowS();
    const g = l.v.gain; g.cancelScheduledValues(now); g.setTargetAtTime(lvl, now, 0.04); g.setTargetAtTime(0, now + (name === 'squeal' ? 0.32 : 0.3), 0.08);
    if (l.rate) l.rate.setTargetAtTime(rate, now, 0.1);
  }
  function reapLoops() {   // free a loop after 3 s of silence
    Object.keys(L).forEach(k => {
      const l = L[k]; if (nowS() - l.last < 3) return; delete L[k];
      const now = E.ctx.currentTime; l.nodes.forEach(n => { try { n.stop(now + 0.05); } catch (e) { } });
      E.later(() => { try { l.v.disconnect(); } catch (e) { } }, 300);
    });
  }

  // ── Farts: one-shots, the held stream, dedupe of repeated calls ────────────
  let H = null;
  const lastReq = {}, NOOP = { set() { }, stop() { }, active: false };
  function stopHold() { if (H) { const h = H; H = null; try { h.stop(); } catch (e) { } } }
  function watch() {
    if (!H) return;
    const age = nowS() - H.seen;
    if ((!H.manual && age > 0.45) || nowS() - H.t0 > 30 || H.dead) { stopHold(); return; }
    setTimeout(watch, 80);
  }
  function startHold(P, manual) {
    if (H) { H.manual = H.manual || manual; H.set(P); return H.handle; }
    H = E.hold(P, null, manual); E.duck(0.7, 0.6); setTimeout(watch, 80);
    return H.handle;
  }
  function fartReq(o) {
    if (o.stop) { stopHold(); return NOOP; }
    let type = FT[o.type] != null ? o.type : o.type === 'squeak' || o.type === 'nogas' ? 'nogas' : 'beans';
    const P = clamp(o.power == null ? 0.8 : +o.power || 0, 0, 1), now = nowS();
    if (P <= 0.02 && type !== 'cheese') type = 'nogas';
    if (o.hold && type === 'beans') return startHold(P, true);
    if (H && type === 'beans') { H.set(P); return H.handle; }
    const last = lastReq[type] || -9; lastReq[type] = now;
    if (now - last < 0.06) return NOOP;
    if (type === 'beans' && now - last < 0.45) return startHold(P, false);
    if (now - last < 0.2) return NOOP;
    E.sfx('fart', { type, power: P }, null, o.volume == null ? 1 : +o.volume, 0);
    E.duck(type === 'burrito' ? 0.35 : type === 'cheese' || type === 'nogas' ? 0.85 : 0.6, type === 'burrito' ? 2.5 : 0.8);
    return NOOP;
  }

  // ── PA voice ───────────────────────────────────────────────────────────────
  let spQ = 0, voiceSel = null;
  function pickVoice() {
    const ss = window.speechSynthesis; if (!ss) return null;
    if (voiceSel) return voiceSel;
    const vs = ss.getVoices() || []; if (!vs.length) return null;
    const pref = ['Google US English', 'Microsoft David', 'Microsoft Mark', 'Microsoft Guy', 'Alex', 'Fred', 'Aaron', 'Samantha'];
    for (const p of pref) { const v = vs.find(x => x.name.indexOf(p) >= 0 && /^en[-_]US/i.test(x.lang)); if (v) return (voiceSel = v); }
    return (voiceSel = vs.find(x => /^en[-_]US/i.test(x.lang)) || vs.find(x => /^en/i.test(x.lang)) || null);
  }
  try { if (window.speechSynthesis && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', () => { voiceSel = null; }); } catch (e) { }
  function sduck(on) { if (!E) return; const g = E.sduck.gain, now = E.ctx.currentTime; g.cancelScheduledValues(now); g.setTargetAtTime(on ? 0.3 : 1, now, on ? 0.08 : 0.4); }
  function speak(text) {
    if (!E) return;
    text = String(text || '').slice(0, 220); if (!text || spQ >= 2) return;
    E.sfx('chime', {}, null, 0.9, 0); sduck(true); spQ++;
    let done = false;
    const fin = () => { if (done) return; done = true; spQ = Math.max(0, spQ - 1); if (!spQ) sduck(false); };
    const ss = window.speechSynthesis;
    if (!ss || !window.SpeechSynthesisUtterance) { setTimeout(fin, 1800); return; }
    setTimeout(() => {
      try {
        const u = new SpeechSynthesisUtterance(text); u.rate = 1.0; u.pitch = 0.85; u.volume = 1; u.lang = 'en-US';
        const v = pickVoice(); if (v) u.voice = v;
        u.onend = fin; u.onerror = fin; ss.speak(u);
      } catch (e) { fin(); }
    }, 1100);
    setTimeout(fin, 4000 + text.length * 90);   // safety: the voice never reports back
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  let E = null, pending = null, timer = 0, vol = [1, 1, 1];
  const dedupe = {};
  function init() {
    if (!AC) return;
    if (!E) {
      let ctx; try { ctx = new AC(); } catch (e) { return; }
      E = makeEngine(ctx, ctx.destination, false);
      try { const v = parseFloat(localStorage.getItem('bumRush.vol')); if (v >= 0 && v <= 1) vol[0] = v; } catch (e) { }
      E.volume(vol[0], vol[1], vol[2]);
      const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);   // iOS unlock
      timer = setInterval(() => { try { E.tick(); reapLoops(); } catch (e) { console.error('[BR.audio.tick]', e); clearInterval(timer); } }, TICK);
      document.addEventListener('visibilitychange', () => { if (E) E.tick(); });
      if (pending) E.music(pending);
      // Pre-bake a pool of farts and the foley in idle slices so the first ones never hitch.
      const list = [];
      ['beans', 'hotdog', 'burrito', 'broccoli', 'cheese', 'tail'].forEach(k => list.push(() => E.refill(k)));
      ['clang', 'thud', 'can', 'wire', 'crunch', 'squish', 'glug'].forEach(k => { for (let v = 0; v < 4; v++) list.push(() => folBuf(ctx, k, v)); });
      list.push(() => rattleBuf(ctx));
      const step = () => { const f = list.shift(); if (!f) return; try { f(); } catch (e) { } setTimeout(step, 40); };
      setTimeout(step, 300);
    }
    if (E.ctx.state !== 'running' && E.ctx.resume) { try { E.ctx.resume().catch(() => { }); } catch (e) { } }
  }
  const api = {
    init,
    setMusic(name) {
      pending = name || null;
      if (pending === 'results' || pending === 'title' || !pending) stopHold();
      if (E) E.music(pending);
    },
    sfx(name, opts) {
      opts = opts || {};
      if (!E || E.ctx.state === 'closed') return NOOP;
      if (name === 'fart') return fartReq(opts);
      if (name === 'fartStop') { stopHold(); return NOOP; }
      if (name === 'nogas') return fartReq({ type: 'nogas', power: 1 });
      if (name === 'rattle' || name === 'squeal') { loopCall(name, opts); return NOOP; }
      if (!SFX[name]) return NOOP;
      const key = name + (opts.kind || ''), now = nowS();
      if (now - (dedupe[key] || -9) < 0.05) return NOOP;
      dedupe[key] = now;
      let lv = opts.volume == null ? 1 : +opts.volume, pan = 0;
      if (POSITIONAL[name] && opts.pos) { const sp = spatial(opts.pos); if (!sp) return NOOP; lv *= sp.lv; pan = sp.pan; }
      if (lv < 0.004) return NOOP;
      const o = Object.assign({}, opts, { _pan: 0 });
      E.sfx(name, o, null, lv, pan);
      if (name === 'crash' || name === 'knock') E.duck(0.7, 0.5);
      return NOOP;
    },
    speak,
    setVolume(master, music, sfx) {
      vol[0] = master == null ? vol[0] : +master; vol[1] = music == null ? vol[1] : +music; vol[2] = sfx == null ? vol[2] : +sfx;
      try { localStorage.setItem('bumRush.vol', String(vol[0])); } catch (e) { }
      if (E) E.volume(vol[0], vol[1], vol[2]);
    },
    // Test hooks: render a track or an sfx into any (Offline)AudioContext.
    _render(ctx, name, seconds, opts) {
      opts = opts || {};
      const X = api._last = makeEngine(ctx, ctx.destination, true);
      if (opts.wanted != null) X.testWanted = opts.wanted;
      if (opts.win != null) X.win = opts.win;
      if (TRACKS[name] && !opts.sfx) { X.music(name); for (let i = 0; i < 400 && X.cur; i++) X.cur.pump(Math.min(seconds, 0.5 + i * 2)); }
      else if (opts.hold) { const h = X.hold(opts.power == null ? 0.6 : opts.power, 0.05, true); (opts.ramp || []).forEach(([t, p]) => h.set(p, t)); h.stop(opts.holdFor || 2); }
      else X.sfx(name, opts, 0.05, 1, 0);
      return X;
    },
    _tracks: Object.keys(TRACKS), _sfx: Object.keys(SFX), _fartData: fartData, _build: buildSection, _T: TRACKS,
    _state() { return E ? { ctx: E.ctx.state, music: E.cur && E.cur.name, hold: !!H, loops: Object.keys(L), mv: E.mv.length, sv: E.sv.length, stats: E.stats, pool: Object.keys(E.pool).map(k => k + ':' + E.pool[k].length).join(' ') } : { pending }; },
  };
  // Browsers need a gesture to start audio: the first gesture inits.
  const wake = () => { ['pointerdown', 'keydown', 'touchend'].forEach(ev => window.removeEventListener(ev, wake)); try { init(); } catch (e) { } };
  ['pointerdown', 'keydown', 'touchend'].forEach(ev => window.addEventListener(ev, wake));
  try { if (BR.bus) BR.bus.on('runEnd', d => { if (E) E.win = !!(d && d.win); }); } catch (e) { }
  BR.audio = api;
})();
