// ─── CONTROLS: keyboard + mouse, gamepad, touch -> BR.controls.state ─────────
(function () {
  const W = 1280, H = 720, TAU = Math.PI * 2, DEAD = 0.15;
  const GAS = ['beans', 'hotdog', 'burrito', 'broccoli', 'cheese'];
  const GAS_ICON = { beans: '\u{1F96B}', hotdog: '\u{1F32D}', burrito: '\u{1F32F}', broccoli: '\u{1F966}', cheese: '\u{1F9C0}' };
  const GAS_COL = { beans: '#b5541c', hotdog: '#e0a030', burrito: '#e07a30', broccoli: '#3aa040', cheese: '#f0d040' };
  const PRESSED = ['boostPressed', 'gasNext', 'gasPrev', 'gas1', 'gas2', 'gas3', 'gas4', 'gas5', 'horn', 'pause'];
  const GAME_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
    'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ', 'KeyR', 'KeyH', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
    'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5']);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const state = { steer: 0, throttle: 0, brake: 0, drift: false, boost: false, boostPressed: false, gasNext: false, gasPrev: false,
    gas1: false, gas2: false, gas3: false, gas4: false, gas5: false, horn: false, pause: false, look: 0 };
  const pend = {}; PRESSED.forEach(k => (pend[k] = false));
  let core = null, uiCanvas = null, prevBoost = false, kSteer = 0, mouseLook = 0, rmb = false, localSel = null, selT = -9;
  const keys = new Set();
  const inPlay = () => !!core && core.state === 'PLAY';
  const kd = (a, b) => keys.has(a) || keys.has(b);

  // ── Keyboard ──
  function onKeyDown(e) {
    if (!inPlay()) return;
    const c = e.code;
    if (GAME_CODES.has(c)) e.preventDefault();
    if (e.repeat) return;
    keys.add(c);
    switch (c) {
      case 'ShiftLeft': case 'ShiftRight': case 'KeyE': pend.boostPressed = true; break;
      case 'KeyQ': pend.gasPrev = true; break;
      case 'KeyR': pend.gasNext = true; break;
      case 'KeyH': pend.horn = true; break;
      case 'Escape': pend.pause = true; break;
      default: {
        const m = /^(?:Digit|Numpad)([1-5])$/.exec(c);
        if (m) selectGas(+m[1]);
      }
    }
  }
  function onKeyUp(e) { keys.delete(e.code); if (inPlay() && GAME_CODES.has(e.code)) e.preventDefault(); }
  function selectGas(n) { pend['gas' + n] = true; localSel = GAS[n - 1]; selT = core ? core.time : 0; }

  // ── Mouse: wheel cycles gas, right-drag = look ──
  function onWheel(e) {
    if (!inPlay()) return;
    e.preventDefault();
    if (e.deltaY > 0) pend.gasNext = true; else if (e.deltaY < 0) pend.gasPrev = true;
  }
  function onMouseDown(e) { if (inPlay() && e.button === 2) rmb = true; }
  function onMouseUp(e) { if (e.button === 2) rmb = false; }
  function onMouseMove(e) { if (inPlay() && rmb) mouseLook = clamp(mouseLook + (e.movementX || 0) * 0.004, -1, 1); }

  // ── Touch layout (1280x720 UI space) ──
  const BTN = [
    { id: 'fart', r: 78, x: 1080, y: 580, kind: 'hold' },
    { id: 'drift', r: 54, x: 900, y: 632, kind: 'hold' },
    { id: 'pause', r: 30, x: 50, y: 50, kind: 'press' },
  ];
  GAS.forEach((g, i) => BTN.push({ id: 'gas' + (i + 1), gas: g, r: 33, x: 1232, y: 118 + i * 76, kind: 'gas', n: i + 1 }));
  BTN.forEach(b => { b.down = 0; b.flash = 0; });
  const B = {}; BTN.forEach(b => (B[b.id] = b));
  const STICK_R = 110, HOME = { x: 200, y: 560 };
  const stick = { id: null, bx: HOME.x, by: HOME.y, x: HOME.x, y: HOME.y, mx: 0, my: 0 };
  const lookT = { id: null, x0: 0, v: 0 };
  const touches = new Map();

  function toUI(cx, cy) {
    const r = uiCanvas ? uiCanvas.getBoundingClientRect() : { left: 0, top: 0, width: W, height: H };
    return { x: (cx - r.left) / (r.width || W) * W, y: (cy - r.top) / (r.height || H) * H };
  }
  function buttonAt(x, y) {
    let best = null, bd = 1e9;
    BTN.forEach(b => { const d = Math.hypot(x - b.x, y - b.y); if (d < b.r * 1.15 + 6 && d < bd) { best = b; bd = d; } });
    return best;
  }
  function buttonDown(b) {
    b.down++; b.flash = 0.2;
    if (b.id === 'fart') pend.boostPressed = true;
    else if (b.id === 'pause') pend.pause = true;
    else if (b.kind === 'gas') selectGas(b.n);
  }
  function stickCalc() {  // floating stick: the base follows the thumb when it overshoots
    let dx = stick.x - stick.bx, dy = stick.y - stick.by, len = Math.hypot(dx, dy);
    if (len > STICK_R * 1.35) { const f = (len - STICK_R * 1.35) / len; stick.bx += dx * f; stick.by += dy * f; dx = stick.x - stick.bx; dy = stick.y - stick.by; len = Math.hypot(dx, dy); }
    const raw = Math.min(1, len / STICK_R), m = raw < DEAD ? 0 : (raw - DEAD) / (1 - DEAD);
    stick.mx = len > 0 ? dx / len * m : 0; stick.my = len > 0 ? -dy / len * m : 0;
  }
  function stickReset() { stick.id = null; stick.mx = stick.my = 0; stick.bx = stick.x = HOME.x; stick.by = stick.y = HOME.y; }
  function onTouchStart(e) {
    if (e.cancelable) e.preventDefault();
    if (!inPlay()) return;
    for (const t of e.changedTouches) {
      const p = toUI(t.clientX, t.clientY), b = buttonAt(p.x, p.y);
      if (b) { touches.set(t.identifier, b.id); buttonDown(b); }
      else if (p.x < W * 0.4 && p.y > 100) {
        if (stick.id !== null) continue;
        stick.id = t.identifier; stick.bx = clamp(p.x, STICK_R * 0.6, W * 0.4); stick.by = clamp(p.y, STICK_R * 0.6 + 120, H - STICK_R * 0.6);
        stick.x = p.x; stick.y = p.y; touches.set(t.identifier, 'stick'); stickCalc();
      } else if (p.x > W * 0.5) {
        if (lookT.id !== null) continue;
        lookT.id = t.identifier; lookT.x0 = p.x; lookT.v = 0; touches.set(t.identifier, 'look');
      }
    }
  }
  function onTouchMove(e) {
    if (e.cancelable) e.preventDefault();
    if (!inPlay()) return;
    for (const t of e.changedTouches) {
      const k = touches.get(t.identifier), p = toUI(t.clientX, t.clientY);
      if (k === 'stick') {
        stick.x = p.x; stick.y = p.y; stickCalc();
      } else if (k === 'look') lookT.v = clamp((p.x - lookT.x0) / 220, -1, 1);
    }
  }
  function onTouchEnd(e) {
    if (e.cancelable) e.preventDefault();
    for (const t of e.changedTouches) {
      const k = touches.get(t.identifier); touches.delete(t.identifier);
      if (k === 'stick') stickReset();
      else if (k === 'look') { lookT.id = null; lookT.v = 0; }
      else if (k && B[k]) B[k].down = Math.max(0, B[k].down - 1);
    }
  }
  function releaseTouches() {
    touches.clear(); stickReset(); lookT.id = null; lookT.v = 0;
    BTN.forEach(b => (b.down = 0));
  }

  // ── Gamepad (standard mapping) ──
  const padPrev = [];
  const pad = { steer: 0, thr: 0, brk: 0, drift: false, boost: false, look: 0 };
  const dz = v => { const a = Math.abs(v); return a < DEAD ? 0 : Math.sign(v) * (a - DEAD) / (1 - DEAD); };
  function pollPad(play) {
    pad.steer = pad.thr = pad.brk = pad.look = 0; pad.drift = pad.boost = false;
    let gp = null;
    try { const l = navigator.getGamepads ? navigator.getGamepads() : []; for (const g of l) if (g && g.connected) { gp = g; break; } } catch (e) {}
    if (!gp) return;
    const bv = i => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);
    const bt = i => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    const edge = i => bt(i) && !padPrev[i];
    if (play) {
      const ax = gp.axes;
      pad.steer = dz(ax[0] || 0); pad.look = dz(ax[2] || 0);
      pad.thr = bv(7) > 0.05 ? bv(7) : 0; pad.brk = bv(6) > 0.05 ? bv(6) : 0;
      pad.boost = bt(0); pad.drift = bt(1);
      if (edge(0)) pend.boostPressed = true;
      if (edge(4)) pend.gasPrev = true;
      if (edge(5)) pend.gasNext = true;
      if (edge(3)) pend.horn = true;
      if (edge(9)) pend.pause = true;
    }
    for (let i = 0; i < gp.buttons.length; i++) padPrev[i] = bt(i);
  }

  // ── Frame update: pending events -> state (pressed flags last exactly one frame) ──
  function neutral() {
    for (const k in state) state[k] = typeof state[k] === 'boolean' ? false : 0;
    PRESSED.forEach(k => (pend[k] = false));
    keys.clear(); rmb = false; kSteer = 0; mouseLook = 0; prevBoost = false;
    releaseTouches();
  }
  function update(dt, c) {
    if (c) core = c;
    dt = dt || 0.016;
    const play = inPlay();
    pollPad(play);
    BTN.forEach(b => (b.flash = Math.max(0, b.flash - dt)));
    if (!play) { neutral(); return; }

    const target = (kd('KeyD', 'ArrowRight') ? 1 : 0) - (kd('KeyA', 'ArrowLeft') ? 1 : 0);
    const rate = target === 0 || Math.sign(target) !== Math.sign(kSteer) ? 9 : 5;
    kSteer += clamp(target - kSteer, -rate * dt, rate * dt);
    if (Math.abs(kSteer) < 1e-3 && target === 0) kSteer = 0;
    const fwd = Math.max(0, stick.my), back = Math.max(0, -stick.my);
    state.steer = clamp(kSteer + stick.mx + pad.steer, -1, 1);
    state.throttle = clamp(Math.max(kd('KeyW', 'ArrowUp') ? 1 : 0, fwd > 0.9 ? 1 : fwd, pad.thr), 0, 1);
    state.brake = clamp(Math.max(kd('KeyS', 'ArrowDown') ? 1 : 0, back, pad.brk), 0, 1);
    state.drift = keys.has('Space') || B.drift.down > 0 || pad.drift;
    const boost = kd('ShiftLeft', 'ShiftRight') || keys.has('KeyE') || B.fart.down > 0 || pad.boost;
    if (boost && !prevBoost) pend.boostPressed = true;
    state.boost = boost; prevBoost = boost;
    if (!rmb) mouseLook *= Math.exp(-dt * 6);
    if (Math.abs(mouseLook) < 1e-3) mouseLook = 0;
    state.look = clamp(mouseLook + lookT.v + pad.look, -1, 1);
    PRESSED.forEach(k => { state[k] = pend[k]; pend[k] = false; });
  }

  // ── Drawing (cartoon: thick ink outline, bright fill, glossy highlight, drop shadow) ──
  const INK = '#2a1606';
  function blob(ctx, b, t, fill, on) {
    const { x, y, r } = b;
    ctx.save();
    ctx.translate(x, y);
    const sq = on ? 1 : 0;
    ctx.scale(1 + 0.1 * sq, 1 - 0.12 * sq);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.arc(4, 7, r, 0, TAU); ctx.fill();
    if (on) { ctx.shadowColor = 'rgba(255,230,90,0.95)'; ctx.shadowBlur = 30; }
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, fill); g.addColorStop(1, shade(fill, 0.62));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(4, r * 0.09); ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.5, r * 0.38, r * 0.17, -0.4, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${((n >> 16) & 255) * k | 0},${((n >> 8) & 255) * k | 0},${(n & 255) * k | 0})`;
  }
  function label(ctx, text, x, y, size) {
    ctx.save();
    ctx.font = `900 ${size}px "Arial Black", "Trebuchet MS", Impact, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.32; ctx.strokeStyle = INK; ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fff6d8'; ctx.fillText(text, x, y);
    ctx.restore();
  }
  function ink(ctx, w) { ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = w; ctx.strokeStyle = INK; ctx.stroke(); }

  const ICON = {
    fart(ctx, t, on) {  // a brown stink cloud with wavy lines
      const wob = Math.sin(t * 6) * 1.5 + (on ? Math.sin(t * 30) * 2 : 0);
      ctx.beginPath();
      [[-18, 8, 16], [0, -4, 20 + wob * 0.3], [18, 6, 16], [-4, 14, 15], [10, 16, 13]].forEach(([x, y, r]) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); });
      ink(ctx, 8); ctx.fillStyle = '#8a5a2b'; ctx.fill();
      ctx.beginPath(); [[-18, 8, 13], [0, -4, 17], [18, 6, 13], [-4, 14, 12], [10, 16, 10]].forEach(([x, y, r]) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); });
      ctx.fillStyle = '#a56d36'; ctx.fill();
      ctx.fillStyle = 'rgba(255,240,200,0.5)'; ctx.beginPath(); ctx.ellipse(-6, -12, 8, 4, -0.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#6aa832'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const x = -16 + i * 16, y0 = -26, ph = t * 5 + i;
        ctx.beginPath(); ctx.moveTo(x, y0);
        ctx.bezierCurveTo(x + 7 * Math.sin(ph), y0 - 6, x - 7 * Math.sin(ph), y0 - 12, x, y0 - 18); ctx.stroke();
      }
    },
    drift(ctx) {  // a curved skid arrow
      ctx.beginPath(); ctx.arc(0, 8, 22, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineWidth = 11; ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.stroke();
      ctx.lineWidth = 6; ctx.strokeStyle = '#fff6d8'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(26, -12); ctx.lineTo(28, 10); ctx.lineTo(10, 0); ctx.closePath();
      ctx.fillStyle = '#fff6d8'; ctx.fill(); ink(ctx, 3);
      ctx.strokeStyle = 'rgba(40,20,6,0.8)'; ctx.lineWidth = 3; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(-24, 20); ctx.lineTo(-6, 24); ctx.moveTo(-22, 28); ctx.lineTo(-4, 32); ctx.stroke(); ctx.setLineDash([]);
    },
    pause(ctx) {
      ctx.fillStyle = '#fff6d8';
      [-8, 8].forEach(x => { ctx.beginPath(); ctx.rect(x - 5, -13, 10, 26); ctx.fill(); ink(ctx, 3); });
    },
  };
  const BTN_COL = { fart: '#f2b233', drift: '#e0457b', pause: '#6b6b6b' };
  const BTN_TXT = { fart: 'FART!', drift: 'DRIFT' };

  function currentSel() {
    if (localSel && core && core.time - selT < 0.4) return localSel;
    return (BR.rules && BR.rules.gasSel) || (BR.cart && BR.cart.gasSel) || localSel || 'beans';
  }
  function drawStick(ctx, t) {
    const R = STICK_R, active = stick.id !== null, bx = stick.bx, by = stick.by;
    const full = stick.my > 0.9, back = stick.my < -0.05;
    ctx.save();
    ctx.globalAlpha = active ? 0.97 : 0.6;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(bx + 4, by + 7, R, 0, TAU); ctx.fill();
    let g = ctx.createRadialGradient(bx, by, R * 0.2, bx, by, R);
    g.addColorStop(0, 'rgba(255,240,190,0.35)'); g.addColorStop(1, full ? 'rgba(255,150,40,0.7)' : 'rgba(255,224,138,0.62)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, R, 0, TAU); ctx.fill();
    ctx.lineWidth = 12; ctx.strokeStyle = full ? '#ff7a1a' : '#ffd24a'; ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.arc(bx, by, R + 6, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(bx, by, R - 6, 0, TAU); ctx.stroke();
    ctx.setLineDash([6, 8]); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(42,22,6,0.4)';
    ctx.beginPath(); ctx.arc(bx, by, R * DEAD + 8, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    // arrows: up = GO (green), down = STOP (red), left/right = steer
    const hot = [stick.my > 0.05, stick.mx > 0.05, back, stick.mx < -0.05];
    const col = ['#4cc23a', '#ffb02e', '#e8412e', '#ffb02e'];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 - Math.PI / 2, cx = bx + Math.cos(a) * (R - 28), cy = by + Math.sin(a) * (R - 28);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(12, 6); ctx.lineTo(-12, 6); ctx.closePath();
      ctx.fillStyle = hot[i] ? col[i] : 'rgba(138,90,43,0.8)'; ctx.fill(); ink(ctx, 3); ctx.restore();
    }
    let kx = bx, ky = by;
    if (active) { const dx = stick.x - bx, dy = stick.y - by, l = Math.hypot(dx, dy), m = Math.min(l, R); if (l > 0) { kx = bx + dx / l * m; ky = by + dy / l * m; } }
    const kr = 48, sq = active ? 1 : 0;
    ctx.save(); ctx.translate(kx, ky); ctx.scale(1 + 0.06 * sq, 1 - 0.06 * sq); ctx.rotate(stick.mx * 0.6);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(3, 6, kr, 0, TAU); ctx.fill();
    if (active) { ctx.shadowColor = full ? 'rgba(255,110,20,0.95)' : 'rgba(255,200,60,0.95)'; ctx.shadowBlur = full ? 30 + 8 * Math.sin(t * 12) : 22; }
    g = ctx.createRadialGradient(-12, -14, 4, 0, 0, kr); g.addColorStop(0, '#fff'); g.addColorStop(0.2, '#e94b3c'); g.addColorStop(1, '#8e1c12');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, kr, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; ink(ctx, 5);
    ctx.beginPath(); ctx.arc(0, 0, kr * 0.62, 0, TAU); ctx.lineWidth = 6; ctx.strokeStyle = '#fff6d8'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-kr * 0.62, 0); ctx.lineTo(kr * 0.62, 0); ctx.moveTo(0, 0); ctx.lineTo(0, kr * 0.62); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fillStyle = '#fff6d8'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(-kr * 0.3, -kr * 0.5, kr * 0.34, kr * 0.15, -0.4, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
    if (!active) label(ctx, 'DRIVE', bx, by - R - 22, 20);
    else if (full) label(ctx, 'FULL SPEED!', bx, by - R - 22, 20);
    else if (back) label(ctx, 'BRAKE', bx, by - R - 22, 20);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawGas(ctx, b, t, sel) {
    const on = b.down > 0 || b.flash > 0.02, isSel = sel === b.gas;
    const lvl = BR.cart && BR.cart.gas ? clamp(+BR.cart.gas[b.gas] || 0, 0, 1) : 0;
    ctx.save();
    ctx.globalAlpha = isSel || on ? 1 : 0.78;
    if (isSel) {
      ctx.save(); ctx.shadowColor = GAS_COL[b.gas]; ctx.shadowBlur = 18 + 6 * Math.sin(t * 6);
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 8, 0, TAU); ctx.lineWidth = 6; ctx.strokeStyle = '#ffe24a'; ctx.stroke(); ctx.restore();
    }
    blob(ctx, b, t, isSel ? '#fff1b8' : '#e8dcc0', on);
    if (lvl > 0) {  // the gas level as a ring
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 4, -Math.PI / 2, -Math.PI / 2 + lvl * TAU);
      ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.strokeStyle = GAS_COL[b.gas]; ctx.stroke();
    }
    const s = on ? 1.15 : isSel ? 1.08 + 0.04 * Math.sin(t * 6) : 1;
    ctx.font = `${Math.round(b.r * 1.05 * s)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(GAS_ICON[b.gas], b.x, b.y + 2);
    ctx.restore();
    label(ctx, String(b.n), b.x - b.r * 0.78, b.y - b.r * 0.72, 15);
  }
  function drawButton(ctx, b, t) {
    const on = b.down > 0 || b.flash > 0.02;
    ctx.save();
    ctx.globalAlpha = on ? 1 : 0.85;
    blob(ctx, b, t, BTN_COL[b.id], on);
    ctx.translate(b.x, b.y);
    const s = b.r / 44; ctx.scale(s * (on ? 1.08 : 1), s * (on ? 0.9 : 1));
    ICON[b.id](ctx, t, on);
    ctx.restore();
    if (BTN_TXT[b.id]) label(ctx, BTN_TXT[b.id], b.x, b.y + b.r + (b.id === 'fart' ? -2 : 4), b.id === 'fart' ? 26 : 18);
    if (b.id === 'fart' && on) {  // puffs while held
      ctx.save(); ctx.globalAlpha = 0.55;
      for (let i = 0; i < 4; i++) {
        const a = t * 2 + i * 1.6, rr = b.r + 14 + ((t * 60 + i * 20) % 40);
        ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr * 0.8, 10 + (i % 2) * 5, 0, TAU);
        ctx.fillStyle = '#9a6a38'; ctx.fill();
      }
      ctx.restore();
    }
  }
  function drawTouch(ctx, t) {
    if (!ctx) return;
    t = t || 0;
    ctx.save();
    drawStick(ctx, t);
    if (lookT.id !== null) {
      ctx.globalAlpha = 0.4; ctx.lineWidth = 4; ctx.strokeStyle = '#fff6d8';
      ctx.beginPath(); ctx.arc(lookT.x0 + lookT.v * 220, 360, 30, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
    const sel = currentSel();
    BTN.forEach(b => { if (b.kind === 'gas') drawGas(ctx, b, t, sel); else drawButton(ctx, b, t); });
    ctx.restore();
  }

  function init(c) {
    core = c || BR.core || null;
    uiCanvas = document.getElementById('ui');
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    const clear = () => { keys.clear(); rmb = false; mouseLook = 0; releaseTouches(); };
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    const o = { passive: false };
    window.addEventListener('touchstart', onTouchStart, o);
    window.addEventListener('touchmove', onTouchMove, o);
    window.addEventListener('touchend', onTouchEnd, o);
    window.addEventListener('touchcancel', onTouchEnd, o);
    window.addEventListener('gesturestart', e => e.preventDefault());
  }

  BR.controls = { init, update, state, drawTouch };
})();
