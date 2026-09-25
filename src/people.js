// ─── PEOPLE: shoppers, staff, forklifts, security guards, PA announcements ────
// All bodies are instanced primitives (one InstancedMesh per primitive + an
// inverted-hull outline twin), so every person in the store costs ~12 draw calls.
(function () {
  'use strict';
  const P = BR.people = { list: [] };
  const bus = BR.bus;
  let core = null, T = null, C = null, ready = false;
  let shoppers = [], staff = [], guards = [], lifts = [], tosses = [], clouds = [];
  let stealthT = 0, caughtLatch = false, flowT = 0, lastW = 0, lastAnn = -99, idleAnnT = 40, spawnT = 0, frameN = 0, uid = 0;
  const stats = P.stats = { ms: 0, inst: 0, people: 0 };

  const rand = Math.random;
  const R = (a, b) => a + (b - a) * rand();
  const pick = a => a[(rand() * a.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const now = () => (core ? core.time : 0);

  const SKIN = [0xffd3ad, 0xf2b98f, 0xdca070, 0xb07748, 0x7d4d2d, 0xffe2c8];
  const SHIRT = [0xff5a5f, 0x3fa7ff, 0x7bd84b, 0xffc93c, 0xb36bff, 0xff8fc8, 0x2ec4b6, 0xff9f1c, 0xf25f9a, 0x5ad1ff];
  const PANTS = [0x2d3a8c, 0x3b3b46, 0x7a5530, 0x1f6f5f, 0x8a8f99, 0x4a2f6b];
  const HAIR = [0x2b1a10, 0x5a3a1e, 0xe0c060, 0xa8421a, 0xe8e8e8, 0x141414, 0x8a6a4a];
  const SHOE = [0x222222, 0xffffff, 0x8b4a2b, 0xd03030];
  const FOOD_COL = { beans: 0xb5541c, hotdog: 0xe0a030, burrito: 0xd8b070, broccoli: 0x3aa040, cheese: 0xf0d040 };

  // ── safe access to the other modules ───────────────────────────────────────
  const ok = m => BR[m] && !(BR._broken && BR._broken[m]);
  function sfx(name, opts) { try { if (ok('audio') && BR.audio.sfx) BR.audio.sfx(name, opts); } catch (e) { /* audio is optional */ } }
  const sfxAt = {};
  function sfxL(name, gap, opts) { const t = now(); if (sfxAt[name] != null && t - sfxAt[name] < gap) return; sfxAt[name] = t; sfx(name, opts); }
  const bounds = () => (BR.store && BR.store.bounds) || C.STORE;
  let cv = null;
  function collide(pos, r) {
    let res = null;
    if (ok('store') && BR.store.collide) { try { res = BR.store.collide(pos, r); } catch (e) { res = null; } }
    const b = bounds(); let hit = false;
    if (pos.x < b.minX + r) { pos.x = b.minX + r; hit = true; } else if (pos.x > b.maxX - r) { pos.x = b.maxX - r; hit = true; }
    if (pos.z < b.minZ + r) { pos.z = b.minZ + r; hit = true; } else if (pos.z > b.maxZ - r) { pos.z = b.maxZ - r; hit = true; }
    return (res && res.hit) || hit;
  }
  function floorAt(x, z) {
    if (ok('store') && BR.store.floorAt) { try { const y = BR.store.floorAt(x, z); return isFinite(y) ? y : 0; } catch (e) { return 0; } }
    return 0;
  }
  function player() {
    const c = BR.cart; if (!c || !c.pos) return null;
    const vx = c.vel ? c.vel.x : 0, vz = c.vel ? c.vel.z : 0;
    return { x: c.pos.x, y: c.pos.y || 0, z: c.pos.z, vx, vz, speed: Math.hypot(vx, vz), air: !!c.airborne && (c.pos.y || 0) > 1.0 };
  }
  function spots() {
    const out = [], s = BR.store && BR.store.spots;
    const walk = (o, key, d) => {
      if (!o || d > 4) return;
      if (Array.isArray(o)) { o.forEach(v => walk(v, key, d + 1)); return; }
      if (typeof o !== 'object') return;
      if (typeof o.x === 'number' && typeof o.z === 'number') { out.push({ name: String(o.name || o.label || key || ''), x: o.x, z: o.z }); return; }
      for (const k in o) walk(o[k], k, d + 1);
    };
    walk(s, '', 0); return out;
  }

  // ── walk grid + flow field (guards path around the shelves) ────────────────
  const G = { cs: 1.5, nx: 0, nz: 0, x0: 0, z0: 0, walk: null, dist: null, q: null, built: false };
  function buildGrid() {
    const b = bounds(), v = new T.Vector3();
    G.x0 = b.minX; G.z0 = b.minZ; G.nx = Math.ceil((b.maxX - b.minX) / G.cs); G.nz = Math.ceil((b.maxZ - b.minZ) / G.cs);
    const n = G.nx * G.nz; G.walk = new Uint8Array(n); G.dist = new Float32Array(n); G.q = new Int32Array(n);
    for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) {
      const x = G.x0 + (i + 0.5) * G.cs, z = G.z0 + (j + 0.5) * G.cs;
      if (x < b.minX + 1.2 || x > b.maxX - 1.2 || z < b.minZ + 1.2 || z > b.maxZ - 1.2) continue;
      v.set(x, 0, z); const hit = collide(v, 0.45);
      G.walk[j * G.nx + i] = !hit && Math.abs(v.x - x) + Math.abs(v.z - z) < 0.01 ? 1 : 0;
    }
    G.built = true;
  }
  const cellOf = (x, z) => { const i = Math.floor((x - G.x0) / G.cs), j = Math.floor((z - G.z0) / G.cs); return i < 0 || j < 0 || i >= G.nx || j >= G.nz ? -1 : j * G.nx + i; };
  const cX = c => G.x0 + ((c % G.nx) + 0.5) * G.cs;
  const cZ = c => G.z0 + (((c / G.nx) | 0) + 0.5) * G.cs;
  const W = (i, j) => i >= 0 && j >= 0 && i < G.nx && j < G.nz && G.walk[j * G.nx + i] === 1;
  function nearestWalk(x, z, maxR, reach) {
    const okc = n => G.walk[n] && (!reach || G.dist[n] < 1e9);
    const c = cellOf(x, z); if (c >= 0 && okc(c)) return c;
    const i0 = Math.floor((x - G.x0) / G.cs), j0 = Math.floor((z - G.z0) / G.cs);
    for (let r = 1; r <= (maxR || 12); r++) {
      let best = -1, bd = 1e9;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !W(i0 + di, j0 + dj) || (reach && G.dist[(j0 + dj) * G.nx + i0 + di] >= 1e9)) continue;
        const d = di * di + dj * dj; if (d < bd) { bd = d; best = (j0 + dj) * G.nx + i0 + di; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  function buildFlow(px, pz) {
    const src = nearestWalk(px, pz, 12); G.dist.fill(1e9); if (src < 0) return;
    const q = G.q; let h = 0, t = 0; q[t++] = src; G.dist[src] = 0;
    while (h < t) {
      const c = q[h++], i = c % G.nx, j = (c / G.nx) | 0, d = G.dist[c] + 1;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj; if (!W(ni, nj)) continue;
        if (di && dj && (!W(i + di, j) || !W(i, j + dj))) continue;
        const n = nj * G.nx + ni; if (G.dist[n] <= d) continue;
        G.dist[n] = d; q[t++] = n;
      }
    }
  }
  // Direction along the flow field, looking two cells ahead for smooth turns.
  function flowDir(x, z, out) {
    let c = cellOf(x, z); if (c < 0 || G.dist[c] >= 1e9) c = nearestWalk(x, z, 3);
    if (c < 0 || G.dist[c] >= 1e9) return false;
    let cur = c;
    for (let step = 0; step < 2; step++) {
      const i = cur % G.nx, j = (cur / G.nx) | 0; let best = cur, bd = G.dist[cur];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj; if (!W(ni, nj)) continue;
        if (di && dj && (!W(i + di, j) || !W(i, j + dj))) continue;
        const n = nj * G.nx + ni; if (G.dist[n] < bd) { bd = G.dist[n]; best = n; }
      }
      if (best === cur) break; cur = best;
    }
    if (cur === c && G.dist[c] > 0) return false;
    const dx = cX(cur) - x, dz = cZ(cur) - z, l = Math.hypot(dx, dz) || 1;
    out.x = dx / l; out.z = dz / l; return true;
  }
  // A random point down an aisle: walk the grid in a cardinal direction.
  function aisleTarget(p) {
    const c = nearestWalk(p.pos.x, p.pos.z, 6); if (c < 0) return false;
    const i0 = c % G.nx, j0 = (c / G.nx) | 0;
    for (let tries = 0; tries < 6; tries++) {
      const d = rand() < 0.65 ? (rand() < 0.5 ? [0, 1] : [0, -1]) : (rand() < 0.5 ? [1, 0] : [-1, 0]);
      const maxN = 4 + ((rand() * 16) | 0); let n = 0;
      while (n < maxN && W(i0 + d[0] * (n + 1), j0 + d[1] * (n + 1)) && W(i0 + d[0] * (n + 1) + d[1], j0 + d[1] * (n + 1) + d[0]) && W(i0 + d[0] * (n + 1) - d[1], j0 + d[1] * (n + 1) - d[0])) n++;
      if (n >= 3) { p.tx = cX(c) + d[0] * n * G.cs + R(-0.3, 0.3); p.tz = cZ(c) + d[1] * n * G.cs + R(-0.3, 0.3); return true; }
    }
    return false;
  }
  function randomWalkPoint(avoidX, avoidZ, avoidR) {
    for (let k = 0; k < 400; k++) {
      const c = (rand() * G.walk.length) | 0; if (!G.walk[c]) continue;
      const x = cX(c), z = cZ(c);
      if (avoidX != null && Math.hypot(x - avoidX, z - avoidZ) < avoidR) continue;
      return { x, z, c };
    }
    return { x: R(-40, 40), z: R(-40, 30), c: -1 };
  }

  // ── rendering: instanced primitives ────────────────────────────────────────
  const MS = {};
  function mkInst(key, geo, mat, cap, outline, cast) {
    const m = new T.InstancedMesh(geo, mat, cap);
    m.frustumCulled = false; m.count = 0; m.castShadow = !!cast && core.quality === 'high';
    m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    m.setColorAt(0, new T.Color(1, 1, 1)); m.instanceColor.setUsage(T.DynamicDrawUsage);
    core.scene.add(m);
    const o = { mesh: m, n: 0, cap, ol: null };
    if (outline) {
      const om = new T.MeshBasicMaterial({ color: 0x1d1622, side: T.BackSide });
      om.onBeforeCompile = s => { s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + outline); };
      om.customProgramCacheKey = () => 'brol_' + key;
      const ol = new T.InstancedMesh(geo, om, cap);
      ol.instanceMatrix = m.instanceMatrix; ol.frustumCulled = false; ol.count = 0;
      core.scene.add(ol); o.ol = ol;
    }
    MS[key] = o; return o;
  }
  function billboardTex(ch, fill) {
    const cvs = document.createElement('canvas'); cvs.width = cvs.height = 64;
    const g = cvs.getContext('2d');
    g.font = '900 56px Arial Black, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 9; g.strokeStyle = '#1d1622'; g.strokeText(ch, 32, 35); g.fillStyle = fill; g.fillText(ch, 32, 35);
    const t = new T.CanvasTexture(cvs); t.colorSpace = T.SRGBColorSpace; return t;
  }
  function buildMeshes() {
    const grad = new T.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, T.RedFormat);
    grad.minFilter = grad.magFilter = T.NearestFilter; grad.needsUpdate = true;
    const toon = new T.MeshToonMaterial({ color: 0xffffff, gradientMap: grad });
    const q = core.quality === 'high';
    mkInst('sph', new T.SphereGeometry(1, q ? 14 : 10, q ? 10 : 7), toon, 1800, 'transformed += normal * 0.075;', true);
    mkInst('cyl', new T.CylinderGeometry(0.5, 0.5, 1, q ? 10 : 7), toon, 1400, 'transformed.xz += normalize(position.xz + vec2(1e-5)) * 0.06; transformed.y += sign(position.y) * 0.03;', true);
    mkInst('box', new T.BoxGeometry(1, 1, 1), toon, 1600, 'transformed += sign(position) * 0.04;', true);
    mkInst('glow', new T.SphereGeometry(1, 10, 7), new T.MeshBasicMaterial({ color: 0xffffff }), 200);
    const sh = new T.Shape();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.45 : 1, a = Math.PI / 2 + i * Math.PI / 5; sh[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
    const sg = new T.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false }); sg.center();
    mkInst('star', sg, new T.MeshBasicMaterial({ color: 0xffffff }), 260);
    const pg = new T.PlaneGeometry(1, 1);
    mkInst('qm', pg, new T.MeshBasicMaterial({ map: billboardTex('?', '#ffe14a'), alphaTest: 0.4 }), 40);
    mkInst('ex', pg, new T.MeshBasicMaterial({ map: billboardTex('!', '#ff4040'), alphaTest: 0.4 }), 40);
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const g = sc.getContext('2d'), rg = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    rg.addColorStop(0, 'rgba(0,0,0,0.55)'); rg.addColorStop(0.6, 'rgba(0,0,0,0.3)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    const shGeo = new T.PlaneGeometry(1, 1); shGeo.rotateX(-Math.PI / 2);
    const shMat = new T.MeshBasicMaterial({ map: new T.CanvasTexture(sc), transparent: true, depthWrite: false, color: 0xffffff });
    mkInst('shadow', shGeo, shMat, 160).mesh.renderOrder = 1;
  }

  let M = null; // temp matrices, built in init
  const col = { c: null };
  function put(kind, m, hex) {
    const o = MS[kind]; if (o.n >= o.cap) return;
    o.mesh.setMatrixAt(o.n, m); col.c.setHex(hex); o.mesh.setColorAt(o.n, col.c); o.n++;
  }
  function frameM(out, parent, px, py, pz, rx, ry, rz, s) {
    M.e.set(rx, ry, rz, 'YXZ'); M.q.setFromEuler(M.e);
    M.l.compose(M.p.set(px, py, pz), M.q, M.s.set(s || 1, s || 1, s || 1));
    if (parent) out.multiplyMatrices(parent, M.l); else out.copy(M.l);
    return out;
  }
  function part(parent, kind, hex, px, py, pz, rx, ry, rz, sx, sy, sz) {
    M.e.set(rx, ry, rz, 'XYZ'); M.q.setFromEuler(M.e);
    M.l.compose(M.p.set(px, py, pz), M.q, M.s.set(sx, sy, sz));
    M.w.multiplyMatrices(parent, M.l); put(kind, M.w, hex);
  }
  // A limb hanging from a pivot; rx swings forward (negative), rz swings out. Leaves the end point in M.end.
  function limb(parent, hex, px, py, pz, rx, rz, len, r) {
    M.e.set(rx, 0, rz, 'XYZ'); M.q.setFromEuler(M.e);
    M.d.set(0, -len / 2, 0).applyQuaternion(M.q);
    M.l.compose(M.p.set(px + M.d.x, py + M.d.y, pz + M.d.z), M.q, M.s.set(r * 2, len, r * 2));
    M.w.multiplyMatrices(parent, M.l); put('cyl', M.w, hex);
    M.end.set(px + M.d.x * 2, py + M.d.y * 2, pz + M.d.z * 2);
  }
  function endBlob(parent, hex, ox, oy, oz, sx, sy, sz) {
    M.d.set(ox, oy, oz).applyQuaternion(M.q);
    M.l.compose(M.p.copy(M.end).add(M.d), M.q, M.s.set(sx, sy, sz));
    M.w.multiplyMatrices(parent, M.l); put('sph', M.w, hex);
  }
  function mix(a, b, k) {
    const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255, br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k);
  }
  function shadow(x, y, z, sx, sz, yaw) {
    M.e.set(0, yaw || 0, 0); M.q.setFromEuler(M.e);
    M.w.compose(M.p.set(x, y + 0.03, z), M.q, M.s.set(sx, 1, sz)); put('shadow', M.w, 0xffffff);
  }
  function billboard(kind, x, y, z, s) {
    M.w.compose(M.p.set(x, y, z), core.camera.quaternion, M.s.set(s, s, s)); put(kind, M.w, 0xffffff);
  }
  function starRing(x, y, z, r, t, n) {
    for (let i = 0; i < n; i++) {
      const a = t * 4 + i * TAU / n;
      M.e.set(0, t * 6 + i, 0); M.q.setFromEuler(M.e);
      M.w.compose(M.p.set(x + Math.cos(a) * r, y + Math.sin(a * 2 + t) * 0.06, z + Math.sin(a) * r), M.q, M.s.set(0.19, 0.19, 0.19));
      put('star', M.w, i % 2 ? 0xffe14a : 0xfff4a0);
    }
  }

  // ── the characters ─────────────────────────────────────────────────────────
  function person(kind, role, x, z, o) {
    o = o || {};
    return {
      id: uid++, kind, role, pos: new T.Vector3(x, 0, z), yaw: o.yaw != null ? o.yaw : R(-Math.PI, Math.PI),
      vx: 0, vz: 0, px: 0, pz: 0, speed: 0, radius: o.radius || 0.42, state: o.state || 'walk', st: 0, dur: R(2, 5), prev: null,
      phase: R(0, 6.28), jy: 0, jv: 0, spinV: 0, tiltSpin: 0, acc: 0,
      scale: o.scale || R(0.9, 1.06), fat: o.fat || R(0.9, 1.25), legLen: 0.72, headR: o.headR || R(0.33, 0.39), nose: R(0.8, 1.35),
      skin: o.skin != null ? o.skin : pick(SKIN), shirt: o.shirt != null ? o.shirt : pick(SHIRT), pants: o.pants != null ? o.pants : pick(PANTS),
      hairC: pick(HAIR), hair: o.hair != null ? o.hair : (rand() * 5) | 0, shoe: pick(SHOE), hat: o.hat || null, stache: rand() < 0.5,
      tx: x, tz: z, stuckT: 0, lx: x, lz: z, react: R(0.12, 0.42), alarm: 0, stinkCD: 0, blinkT: R(1, 4), dodgeX: 0, dodgeZ: 0,
      radT: 0, whT: 0, radCD: R(4, 9), whCD: R(1.5, 4), mark: null, markT: 0, seated: false, seatH: 0.68, down: false, fallen: false,
      veh: null, side: 1, gag: false, partner: null, cool: 0, dead: false,
      a: { aLx: 0, aLo: 0.1, aRx: 0, aRo: 0.1, legAmp: 0, legF: 0, hip: 0.72, tilt: 0, roll: 0, hy: 0, hp: 0, hr: 0, mw: 0.1, mh: 0.025, brow: 0, bang: 0, pup: 1, lx: 0, ly: 0, green: 0, bob: 0 },
    };
  }
  const VOFF = { cart: 0.95, scooter: 0 };
  function vehicle(kind, p) {
    const v = { kind, x: p.pos.x, y: 0, z: p.pos.z, yaw: p.yaw, tip: 0, roll: 0, vx: 0, vz: 0, spin: 0, att: true, items: [pick(SHIRT), pick(SHIRT), pick(SHIRT), (rand() * 4) | 0] };
    p.veh = v; syncVeh(p); return v;
  }
  function syncVeh(p) {
    const v = p.veh; if (!v || !v.att) return;
    const o = VOFF[v.kind]; v.x = p.pos.x + Math.sin(p.yaw) * o; v.z = p.pos.z + Math.cos(p.yaw) * o; v.y = p.pos.y; v.yaw = p.yaw; v.tip = 0; v.roll = 0;
  }
  function looseVeh(v, dt) {
    if (!v || v.att) return;
    v.x += v.vx * dt; v.z += v.vz * dt; const f = Math.exp(-dt * 1.8); v.vx *= f; v.vz *= f;
    v.yaw += v.spin * dt; v.spin *= Math.exp(-dt * 1.5);
    cv.set(v.x, 0, v.z); if (collide(cv, 0.5)) { v.vx *= -0.4; v.vz *= -0.4; v.spin += R(-3, 3); }
    v.x = cv.x; v.z = cv.z; v.y = floorAt(v.x, v.z);
  }
  function detach(p, vx, vz) {
    const v = p.veh; if (!v || !v.att) return;
    v.att = false; v.vx = vx; v.vz = vz; v.spin = R(-6, 6); p.seated = false;
    if (v.kind === 'scooter') v.roll = R(0.9, 1.3) * (rand() < 0.5 ? -1 : 1);
  }

  function makeShopper(x, z) {
    const p = person('shopper', 'shopper', x, z);
    if (rand() < 0.85) vehicle('cart', p);
    p.state = 'walk'; aisleTarget(p);
    return p;
  }

  function populate() {
    shoppers = []; staff = []; lifts = []; tosses = []; clouds = []; guards = [];
    const hi = core.quality === 'high';
    const st = C.START, nShop = hi ? 26 : 12;
    for (let i = 0; i < nShop; i++) { const w = randomWalkPoint(st.x, st.z, 10); shoppers.push(makeShopper(w.x, w.z)); }
    const sp = spots();
    // sample ladies
    let sample = sp.filter(s => /sample/i.test(s.name));
    if (!sample.length) sample = [0, 1, 2].map(() => randomWalkPoint(st.x, st.z, 15));
    sample.slice(0, hi ? 4 : 2).forEach(s => {
      const c = nearestWalk(s.x + R(-1, 1), s.z + 1.2, 6); if (c < 0) return;
      const p = person('staff', 'sample', cX(c), cZ(c), { shirt: 0xff6f91, pants: 0x303040, hat: 'net', fat: R(1.0, 1.3), hair: 3 });
      p.state = 'serve'; p.home = { x: cX(c), z: cZ(c) }; p.food = pick(C.GAS_TYPES); p.yaw = R(-Math.PI, Math.PI);
      staff.push(p);
    });
    // hot-dog vendor
    const hd = sp.find(s => /hot ?dog|food ?court/i.test(s.name)) || randomWalkPoint(st.x, st.z, 15);
    { const c = nearestWalk(hd.x + 1.5, hd.z + 1.5, 6);
      if (c >= 0) { const p = person('staff', 'vendor', cX(c), cZ(c), { shirt: 0xffffff, pants: 0xd03030, hat: 'paper', fat: 1.3 }); p.state = 'serve'; p.home = { x: cX(c), z: cZ(c) }; p.food = 'hotdog'; staff.push(p); } }
    // restockers on ladders (a walkable cell with a shelf beside it)
    const nR = hi ? 4 : 2, used = [];
    for (let k = 0; k < 600 && used.length < nR; k++) {
      const c = (rand() * G.walk.length) | 0; if (!G.walk[c]) continue;
      const i = c % G.nx, j = (c / G.nx) | 0, x = cX(c), z = cZ(c);
      if (Math.hypot(x - st.x, z - st.z) < 20 || used.some(u => Math.hypot(u.x - x, u.z - z) < 25)) continue;
      let sx = 0; if (!W(i + 1, j) && W(i - 1, j)) sx = 1; else if (!W(i - 1, j) && W(i + 1, j)) sx = -1;
      if (!sx || !W(i, j + 1) || !W(i, j - 1)) continue;
      const lx = x + sx * 0.25, yaw = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      const p = person('staff', 'restock', lx - sx * 0.4, z, { shirt: 0xff7f11, pants: 0x2d3a8c, hat: 'hard', yaw });
      p.state = 'climb'; p.ladder = { x: lx, z, yaw, h: 0, wob: 0, wobV: 0 }; p.st = R(0, 6);
      used.push({ x, z }); staff.push(p);
    }
    // forklifts: the store's loops through the forklift lanes, else long open grid lanes (ping-pong)
    const routes = [], nL = hi ? 4 : 2, fr = BR.store && BR.store.spots && BR.store.spots.forkliftRoutes;
    if (Array.isArray(fr) && fr.length) {
      for (let i = 0; i < nL; i++) {
        const r = fr[i % fr.length], pts = r.map(q => Array.isArray(q) ? { x: q[0], z: q[1] } : { x: q.x, z: q.z });
        const per = Math.ceil(nL / fr.length); if (pts.length >= 2) routes.push({ pts, loop: pts.length > 2, k: 0.12 + Math.floor(i / fr.length) / per + (i % fr.length) * 0.2 });
      }
    } else findLanes(nL).forEach(l => routes.push({ pts: [{ x: l.ax, z: l.az }, { x: l.bx, z: l.bz }], loop: false, k: rand() }));
    routes.forEach(rt => {
      const pts = rt.pts, n = pts.length, segs = rt.loop ? n : n - 1;
      const u = (rt.k % 1) * segs, si = Math.floor(u), fk = u - si, a = pts[si], b = pts[(si + 1) % n];
      const f = { kind: 'forklift', role: 'forklift', pos: new T.Vector3(a.x + (b.x - a.x) * fk, 0, a.z + (b.z - a.z) * fk), yaw: Math.atan2(b.x - a.x, b.z - a.z),
        pts, loop: rt.loop, wi: (si + 1) % n, state: 'drive', st: 0, speed: 0, radius: 1.6, lift: 0.25, beepT: 0, honkT: 0, bumpT: 0, waitT: 0, flash: R(0, 3),
        load: [pick(SHIRT), pick(SHIRT), 0xc49a6c, (rand() * 3) | 0] };
      f.driver = person('staff', 'driver', f.pos.x, f.pos.z, { shirt: 0xff7f11, pants: 0x3b3b46, hat: 'hard', fat: 1.2 });
      f.driver.seated = true; f.driver.seatH = 1.12; f.driver.state = 'drive';
      lifts.push(f);
    });
    relist();
  }
  function relist() { P.list.length = 0; shoppers.concat(staff, guards, lifts).forEach(p => P.list.push(p)); }

  function findLanes(n) {
    const c = [];
    const good = (i, j) => W(i, j) && W(i, j - 1) && W(i, j + 1) && W(i - 1, j) && W(i + 1, j);
    const minLen = 12, zMax = C.START.z - 10;
    for (let j = 1; j < G.nz - 1; j++) {
      let s = -1;
      for (let i = 0; i <= G.nx; i++) {
        const g = i < G.nx && good(i, j) && G.z0 + (j + 0.5) * G.cs < zMax;
        if (g && s < 0) s = i;
        if (!g && s >= 0) { if (i - s >= minLen) c.push({ h: 1, a: s, b: i - 1, k: j, len: i - s }); s = -1; }
      }
    }
    for (let i = 1; i < G.nx - 1; i++) {
      let s = -1;
      for (let j = 0; j <= G.nz; j++) {
        const g = j < G.nz && W(i, j) && W(i - 1, j) && W(i + 1, j) && G.z0 + (j + 0.5) * G.cs < zMax;
        if (g && s < 0) s = j;
        if (!g && s >= 0) { if (j - s >= minLen) c.push({ h: 0, a: s, b: j - 1, k: i, len: j - s }); s = -1; }
      }
    }
    c.sort((p, q) => q.len - p.len + R(-4, 4));
    const out = [];
    for (const l of c) {
      if (out.length >= n) break;
      if (out.some(o => o.h === l.h && Math.abs(o.k - l.k) < 8 && !(l.b < o.a || l.a > o.b))) continue;
      if (out.filter(o => o.h === l.h).length >= Math.ceil(n / 2)) continue;
      const span = Math.min(l.len - 2, 26), a0 = l.a + 1 + ((rand() * (l.len - 2 - span + 1)) | 0), a1 = a0 + span - 1;
      const w = l.h ? { ax: G.x0 + (a0 + 0.5) * G.cs, az: G.z0 + (l.k + 0.5) * G.cs, bx: G.x0 + (a1 + 0.5) * G.cs, bz: G.z0 + (l.k + 0.5) * G.cs }
        : { ax: G.x0 + (l.k + 0.5) * G.cs, az: G.z0 + (a0 + 0.5) * G.cs, bx: G.x0 + (l.k + 0.5) * G.cs, bz: G.z0 + (a1 + 0.5) * G.cs };
      w.h = l.h; w.a = l.a; w.b = l.b; w.k = l.k; out.push(w);
    }
    return out;
  }

  // ── guards ─────────────────────────────────────────────────────────────────
  function doorPoints() {
    const sp = spots().filter(s => /staff|door|employee|dock|security|office|entrance/i.test(s.name));
    if (sp.length) return sp;
    const b = bounds();
    return [{ x: C.START.x, z: C.START.z }, { x: b.minX + 20, z: b.minZ + 3 }, { x: 0, z: b.minZ + 3 }, { x: b.maxX - 20, z: b.minZ + 3 }, { x: b.minX + 3, z: 0 }, { x: b.maxX - 3, z: 0 }];
  }
  function spawnGuard(scooter, pl) {
    const pts = doorPoints(); let best = null, bd = 1e9;
    pts.forEach(s => { const d = pl ? Math.hypot(s.x - pl.x, s.z - pl.z) : 30; const score = d < 18 ? 1e5 - d : d; if (score < bd) { bd = score; best = s; } });
    if (pl) buildFlow(pl.x, pl.z);
    const c = nearestWalk(best.x, best.z, 30, !!pl); if (c < 0) return;
    const g = person('guard', scooter ? 'scooter' : 'foot', cX(c) + R(-0.4, 0.4), cZ(c) + R(-0.4, 0.4),
      { shirt: 0x8fb8e8, pants: 0x1c2a55, hat: 'cap', fat: R(1.3, 1.55), scale: R(0.98, 1.08), headR: R(0.34, 0.38), hair: 0 });
    g.state = 'enter'; g.st = 0; g.radius = 0.5; g.mark = 'ex'; g.markT = 1.2; g.radT = 1.4;
    if (pl) g.yaw = Math.atan2(pl.x - g.pos.x, pl.z - g.pos.z);
    if (scooter) { vehicle('scooter', g); g.seated = true; g.seatH = 0.7; }
    guards.push(g); relist();
    sfxL('radio', 0.8);
  }
  function updGuardCount(dt, pl) {
    const w = BR.rules ? +BR.rules.wanted || 0 : 0, stars = Math.floor(w + 1e-6);
    if (stars > lastW) { announce(stars >= 4 ? 'wantedHigh' : 'wanted'); }
    lastW = stars;
    const WN = C.WANTED, target = Math.min(WN.maxGuards, stars * WN.guardsPerStar);
    const active = guards.filter(g => g.state !== 'leave');
    spawnT -= dt;
    if (active.length < target && spawnT <= 0) {
      const scoots = active.filter(g => g.role === 'scooter').length;
      spawnGuard(stars >= 4 && scoots < stars - 2, pl); spawnT = 1.1;
    } else if (active.length > target && (P._overT = (P._overT || 0) + dt) > 3) {
      P._overT = 0;
      let far = null, fd = -1;
      active.forEach(g => { const d = pl ? Math.hypot(g.pos.x - pl.x, g.pos.z - pl.z) : 0; if (d > fd) { fd = d; far = g; } });
      if (far) { far.state = 'leave'; far.st = 0; far.mark = 'qm'; far.markT = 1.5; }
    } else if (active.length <= target) P._overT = 0;
  }

  // ── PA announcements ───────────────────────────────────────────────────────
  const LINES = {
    wanted: [
      'Security to aisle {aisle}. Security to aisle {aisle}. Bring the net.',
      'Code Brown in {dept}. Repeat, we have a Code Brown.',
      'Attention staff: we have a runner. He is on a cart. He is... gassy.',
      'All available security, please report to {dept}. Wear a mask.',
      'Attention shoppers: the gentleman on the cart is NOT a free sample.',
      'Security, the suspect is near {dept}. You will smell him before you see him.',
    ],
    wantedHigh: [
      'All units, all units. Deploy the scooters.',
      'Security has requested backup. Backup has requested a gas mask.',
      'Attention shoppers: please clear the aisles. Security is on scooters now. God help us.',
      'This is not a drill. This is a man, a cart, and a lot of beans.',
    ],
    knock: [
      'Cleanup on aisle {aisle}. Bring a mop. And a priest.',
      'Cleanup on aisle {aisle}. Actually, cleanup on every aisle.',
      'Attention shoppers: the display in {dept} is now a pile. Please step around the pile.',
      'Reminder: our displays are for looking, not for bowling.',
      'Would the owner of that pyramid please accept our condolences.',
    ],
    burrito: [
      'Attention shoppers: a man just launched himself with a burrito. Please do not try this at home. Or here.',
      'We have a burrito launch. I repeat, a burrito launch. Duck.',
      'Air traffic control, we have an unidentified flying shopper over {dept}.',
    ],
    fart: [
      'Attention shoppers: a man is FARTING in {dept}.',
      'Please do not light any candles in {dept} at this time.',
      'Attention shoppers: the smell in {dept} is not the cheese. We checked.',
      'Would the gentleman on the cart please stop. Just... stop.',
    ],
    hit: [
      'Customer down in {dept}. She is fine. She is just sitting there now.',
      'Reminder: carts are to be pushed, not ridden like a rocket.',
      'Would the shopper who got hit by the cart please come to customer service for a free sticker.',
    ],
    guard: [
      'Security, why are you on the floor. Get up.',
      'Security has been bowled over in {dept}. Security is embarrassed.',
    ],
    dizzy: [
      'Security is dizzy. Security is very dizzy. Someone open a window.',
      'Attention staff: do not breathe near the broccoli man.',
    ],
    stealth: [
      'Security has lost the suspect. Security is also lost.',
      'Guards, the suspect has vanished. How. How does that work.',
    ],
    forklift: [
      'Forklift drivers, please do not race the customers.',
      'Attention shoppers: the forklift always has the right of way. The man on the cart disagrees.',
    ],
    idle: [
      'Attention shoppers: free samples at the Sample Stations. One per customer. One. Sir.',
      'Today\'s special: bulk baked beans. What could possibly go wrong.',
      'Attention Bulkzilla shoppers: our restrooms are closed for... reasons.',
      'Please keep your hands, feet and gas inside your cart at all times.',
    ],
  };
  const bags = {};
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function deptName(x, z) {
    let best = null, bd = 1e9;
    spots().forEach(s => { if (!s.name || /entrance|checkout|lane|door|spawn|start|staff|dock|sample \d|^\d+$/i.test(s.name)) return; const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s.name; } });
    return best && bd < 45 ? best.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) : 'aisle ' + aisleNum(x);
  }
  const aisleNum = x => Math.max(1, Math.round((x - bounds().minX) / 6));
  function announce(cat, force) {
    if (!core || core.state !== 'PLAY') return false;
    const t = now();
    if (!force && t - lastAnn < 12) { if (/wanted|burrito|knock|dizzy|stealth/.test(cat) && (!P._pend || P._pend.cat !== cat)) P._pend = { cat, t }; return false; }
    if (P._pend && P._pend.cat === cat) P._pend = null;
    if (!LINES[cat]) return false;
    let bag = bags[cat]; if (!bag || !bag.length) bag = bags[cat] = shuffle(LINES[cat].slice());
    const pl = player(), x = pl ? pl.x : 0, z = pl ? pl.z : 0;
    const text = bag.pop().replace(/\{aisle\}/g, aisleNum(x)).replace(/\{dept\}/g, deptName(x, z));
    lastAnn = t; bus.emit('announce', { text }); return true;
  }

  // ── bus listeners ──────────────────────────────────────────────────────────
  function hook() {
    bus.on('fart', d => {
      if (!ready || !d) return;
      const p = d.pos || (BR.cart && BR.cart.pos); if (!p) return;
      const life = { beans: 3, hotdog: 3, burrito: 5, broccoli: 8, cheese: 6 }[d.type] || 3;
      const cl = clouds.find(c => Math.hypot(c.x - p.x, c.z - p.z) < 2.5);
      if (cl) cl.t = Math.max(cl.t, life); else if (clouds.length < 24) clouds.push({ x: p.x, z: p.z, t: life, type: d.type });
      if (d.type === 'burrito') announce('burrito');
      else if (d.type !== 'cheese' && rand() < 0.2) announce('fart');
    });
    bus.on('stun', d => {
      if (!ready || !d || !d.pos) return;
      const r = (d.radius || 5) + 0.6; let n = 0;
      guards.forEach(g => {
        if (Math.hypot(g.pos.x - d.pos.x, g.pos.z - d.pos.z) > r || /flung|down|tackle|pile|leave/.test(g.state)) return;
        if (g.state !== 'dizzy') n++;
        setState(g, 'dizzy', 4); g.wobA = R(0, TAU);
      });
      shoppers.concat(staff).forEach(p => { if (Math.hypot(p.pos.x - d.pos.x, p.pos.z - d.pos.z) < r) stink(p, d.pos, true); });
      if (n) { sfxL('gasp', 0.5); announce('dizzy'); }
    });
    bus.on('stealth', d => {
      if (!ready) return;
      stealthT = Math.max(stealthT, (d && d.seconds) || 6);
      guards.forEach(g => { if (g.state === 'chase' || g.state === 'enter') { setState(g, 'lost', 0); g.mark = 'qm'; } });
      if (guards.length) announce('stealth');
    });
    bus.on('knock', d => {
      if (!ready || !d || !d.pos || /^(shopper|guard|staff|ladder|person)$/.test(d.kind || '')) return;
      shoppers.concat(staff).forEach(p => {
        if (Math.hypot(p.pos.x - d.pos.x, p.pos.z - d.pos.z) < 12 && calm(p) && rand() < 0.7) { p.look = { x: d.pos.x, z: d.pos.z }; setState(p, 'gasp', R(0.9, 1.4)); p.jv = 2.5; }
      });
      if ((+d.value || 1) >= 2 || /pyramid|tower|stack|display|shelf|wall/i.test(d.kind || '')) announce('knock');
      sfxL('gasp', 0.6);
    });
  }

  // ── state helpers ──────────────────────────────────────────────────────────
  function setState(p, s, dur) { if (p.state !== s) { p.prev = p.state; p.st = 0; } p.state = s; p.dur = dur; }
  const calm = p => /^(walk|browse|chat|serve|idle|fetch|climb)$/.test(p.state) && !(p.role === 'restock' && p.ladder && p.ladder.h > 0.2);
  function stink(p, from, strong) {
    if (p.stinkCD > 0 || !calm(p) && p.state !== 'gasp') return;
    p.stinkFrom = { x: from.x, z: from.z }; p.gag = strong || Math.hypot(p.pos.x - from.x, p.pos.z - from.z) < 3;
    if (p.partner) { p.partner = null; }
    setState(p, 'stink', R(2.2, 3.2)); p.stinkCD = R(7, 10);
    sfxL('gasp', 0.35);
  }
  function knockDown(p, pl, fling) {
    const sp = Math.max(pl.speed, 3), k = fling ? 1.0 : 0.55;
    const dx = p.pos.x - pl.x, dz = p.pos.z - pl.z, l = Math.hypot(dx, dz) || 1;
    p.vx = pl.vx * k + dx / l * 2.5; p.vz = pl.vz * k + dz / l * 2.5;
    p.jv = fling ? 5 + sp * 0.35 : 3.5; p.spinV = (rand() < 0.5 ? -1 : 1) * R(10, 16); p.tiltSpin = 0;
    detach(p, pl.vx * 0.8 + R(-1, 1), pl.vz * 0.8 + R(-1, 1));
    if (p.partner) { p.partner.partner = null; p.partner = null; }
    setState(p, fling ? 'flung' : 'hit', 0); p.down = true; p.fallen = true;
    sfxL('scream', 0.25);
    if (fling && rand() < 0.6) sfxL('whistle', 1.2);
    bus.emit('knock', { pos: { x: p.pos.x, y: 0, z: p.pos.z }, value: p.kind === 'guard' ? 2 : 1, kind: p.kind === 'guard' ? 'guard' : 'shopper' });
    if (ok('cart') && BR.cart.bump) BR.cart.bump({ x: -dx / l, z: -dz / l }, fling ? 2.5 : 1.5);
    if (core.shake) core.shake(fling ? 0.3 : 0.15, 0.2);
    announce(p.kind === 'guard' ? 'guard' : 'hit');
  }

  // ── movement ───────────────────────────────────────────────────────────────
  function steerTo(p, tx, tz, spd, dt, acc) {
    const dx = tx - p.pos.x, dz = tz - p.pos.z, d = Math.hypot(dx, dz);
    let vx = 0, vz = 0; if (d > 0.08) { const s = Math.min(spd, d * 3); vx = dx / d * s; vz = dz / d * s; }
    const k = 1 - Math.exp(-dt * (acc || 5)); p.vx += (vx - p.vx) * k; p.vz += (vz - p.vz) * k;
    return d;
  }
  function steerDir(p, dx, dz, spd, dt, acc) { const k = 1 - Math.exp(-dt * (acc || 5)); p.vx += (dx * spd - p.vx) * k; p.vz += (dz * spd - p.vz) * k; }
  function integrate(p, dt, face, turn) {
    const ox = p.pos.x, oz = p.pos.z;
    p.pos.x += (p.vx + p.px) * dt; p.pos.z += (p.vz + p.pz) * dt; p.px = p.pz = 0;
    const r = p.radius;
    if (collide(p.pos, r)) { const mx = (p.pos.x - ox) / Math.max(dt, 1e-3), mz = (p.pos.z - oz) / Math.max(dt, 1e-3); p.vx = mx; p.vz = mz; }
    const v = p.veh;
    if (v && v.att && v.kind === 'cart') {
      cv.set(p.pos.x + Math.sin(p.yaw) * 0.95, 0, p.pos.z + Math.cos(p.yaw) * 0.95); const cx0 = cv.x, cz0 = cv.z;
      if (collide(cv, 0.45)) { p.pos.x += cv.x - cx0; p.pos.z += cv.z - cz0; collide(p.pos, r); }
    }
    p.speed = Math.hypot(p.vx, p.vz);
    if (face && p.speed > 0.25) p.yaw += angDiff(p.yaw, Math.atan2(p.vx, p.vz)) * Math.min(1, dt * (turn || 5));
    p.pos.y = floorAt(p.pos.x, p.pos.z);
  }
  function hop(p, dt) { if (p.jy > 0 || p.jv > 0) { p.jv -= 18 * dt; p.jy += p.jv * dt; if (p.jy <= 0) { p.jy = 0; p.jv = 0; } } }

  // ── shoppers ───────────────────────────────────────────────────────────────
  function threat(p, dt, pl, big) {
    if (!pl || pl.air || p.down) return;
    const dx = p.pos.x - pl.x, dz = p.pos.z - pl.z, d = Math.hypot(dx, dz);
    let cd = d;
    if (p.veh && p.veh.att && p.veh.kind === 'cart') cd = Math.min(d, Math.hypot(p.veh.x - pl.x, p.veh.z - pl.z) + 0.1);
    const reach = (big ? p.radius : p.radius) + 0.72;
    if (cd < reach) {
      if (pl.speed > 3) { knockDown(p, pl, false); return; }
      const l = d || 1; p.px += dx / l * 2.5; p.pz += dz / l * 2.5;
      if (calm(p) && p.state !== 'gasp' && rand() < 0.02) { p.look = { x: pl.x, z: pl.z }; setState(p, 'gasp', 0.8); }
      return;
    }
    // a late comic dodge
    if (pl.speed > 5.5 && d < 9 && p.state !== 'dodge') {
      const vv = pl.vx * pl.vx + pl.vz * pl.vz, tc = (dx * pl.vx + dz * pl.vz) / vv;
      if (tc > 0 && tc < 0.75) {
        const mx = dx - pl.vx * tc, mz = dz - pl.vz * tc;
        if (Math.hypot(mx, mz) < 1.7) {
          if (p.alarm === 0) sfxL('gasp', 0.3);
          p.alarm += dt;
          if (p.alarm > p.react) {
            const sp = Math.sqrt(vv), side = (pl.vx * dz - pl.vz * dx) > 0 ? 1 : -1;
            p.dodgeX = -pl.vz / sp * side; p.dodgeZ = pl.vx / sp * side;
            detach(p, 0, 0); setState(p, 'dodge', 0.6); p.jv = 5.5; p.alarm = 0;
            if (rand() < 0.5) sfxL('scream', 0.4);
          }
          return;
        }
      }
    }
    p.alarm = 0;
  }
  function nearCloud(p) {
    for (const c of clouds) if (Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < 6) return c;
    return null;
  }
  function updShopper(p, dt, pl) {
    p.st += dt; p.stinkCD -= dt; hop(p, dt);
    looseVeh(p.veh, dt);
    switch (p.state) {
      case 'walk': {
        const d = steerTo(p, p.tx, p.tz, p.veh ? 1.25 : 1.4, dt, 4);
        integrate(p, dt, true, 3.5);
        if (Math.hypot(p.pos.x - p.lx, p.pos.z - p.lz) > 0.5) { p.lx = p.pos.x; p.lz = p.pos.z; p.stuckT = 0; } else p.stuckT += dt;
        if (d < 0.6 || p.stuckT > 2.5) {
          p.stuckT = 0; const r = rand();
          if (r < 0.35) { setState(p, 'browse', R(2.5, 5)); p.side = rand() < 0.5 ? 1 : -1; }
          else if (r < 0.55) {
            const q = shoppers.find(o => o !== p && o.state === 'walk' && !o.partner && Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) < 6);
            if (q) { const dur = R(3, 6); p.partner = q; q.partner = p; setState(p, 'chat', dur); setState(q, 'chat', dur); }
            else aisleTarget(p);
          } else aisleTarget(p);
        }
        break;
      }
      case 'browse': case 'chat': {
        steerTo(p, p.pos.x, p.pos.z, 0, dt, 6); integrate(p, dt, false);
        if (p.state === 'chat' && p.partner) p.yaw += angDiff(p.yaw, Math.atan2(p.partner.pos.x - p.pos.x, p.partner.pos.z - p.pos.z)) * Math.min(1, dt * 3);
        if (p.state === 'chat' && p.partner && p.partner.state !== 'chat') p.partner = null;
        if (p.st > p.dur) { p.partner = null; setState(p, 'walk', 0); aisleTarget(p); }
        break;
      }
      case 'gasp': {
        steerTo(p, p.pos.x, p.pos.z, 0, dt, 6); integrate(p, dt, false);
        if (p.look) p.yaw += angDiff(p.yaw, Math.atan2(p.look.x - p.pos.x, p.look.z - p.pos.z)) * Math.min(1, dt * 6);
        if (p.st > p.dur) resume(p);
        break;
      }
      case 'dodge': {
        steerDir(p, p.dodgeX, p.dodgeZ, 6.5, dt, 14); integrate(p, dt, false);
        if (p.st > p.dur && p.jy <= 0) { setState(p, 'gasp', 0.7); p.look = pl ? { x: pl.x, z: pl.z } : null; }
        break;
      }
      case 'hit': case 'flung': {
        p.yaw += p.spinV * dt; p.spinV *= Math.exp(-dt * 1.5);
        const f = Math.exp(-dt * (p.jy > 0 ? 0.3 : 4)); p.vx *= f; p.vz *= f; integrate(p, dt, false);
        if (p.state === 'flung') p.tiltSpin += dt * 11;
        if (p.st > 0.3 && p.jy <= 0) { setState(p, 'down', R(2.8, 3.3)); sfxL('gasp', 0.3); }
        break;
      }
      case 'down': {
        p.vx *= Math.exp(-dt * 5); p.vz *= Math.exp(-dt * 5); integrate(p, dt, false); p.yaw += p.spinV * dt * 0.1;
        if (p.st > p.dur) setState(p, 'getup', 0.6);
        break;
      }
      case 'getup': {
        if (p.st > p.dur) { p.down = false; p.fallen = false; resume(p); }
        break;
      }
      case 'stink': {
        steerTo(p, p.pos.x, p.pos.z, 0, dt, 6); integrate(p, dt, false);
        if (p.stinkFrom) p.yaw += angDiff(p.yaw, Math.atan2(p.pos.x - p.stinkFrom.x, p.pos.z - p.stinkFrom.z) + Math.PI) * Math.min(1, dt * 4);
        if (p.st > p.dur) {
          if (p.kind === 'staff' && p.role !== 'shopper') { resume(p); break; }
          detach(p, 0, 0); setState(p, 'flee', R(1.8, 2.8)); sfxL('scream', 0.5);
        }
        break;
      }
      case 'flee': {
        const f = p.stinkFrom || p.pos, dx = p.pos.x - f.x, dz = p.pos.z - f.z, l = Math.hypot(dx, dz) || 1;
        steerDir(p, dx / l, dz / l, 3.8, dt, 6); integrate(p, dt, true, 8);
        if (p.st > p.dur) resume(p);
        break;
      }
      case 'fetch': {
        const v = p.veh; if (!v || v.att) { setState(p, 'walk', 0); aisleTarget(p); break; }
        const o = VOFF[v.kind], tx = v.x - Math.sin(v.yaw) * o, tz = v.z - Math.cos(v.yaw) * o;
        const d = steerTo(p, tx, tz, 1.6, dt, 5); integrate(p, dt, true, 6);
        if (d < 0.45 || p.st > 8) { p.pos.x = tx; p.pos.z = tz; p.yaw = v.yaw; v.att = true; v.roll = 0; v.tip = 0; if (v.kind === 'scooter') p.seated = true; resume(p); }
        break;
      }
      default: setState(p, 'walk', 0); aisleTarget(p);
    }
    if (p.state !== 'hit' && p.state !== 'down' && p.state !== 'getup' && p.state !== 'flung') {
      threat(p, dt, pl);
      if (calm(p) && p.stinkCD <= 0) { const c = nearCloud(p); if (c) stink(p, c, false); }
    }
    syncVeh(p);
  }
  function resume(p) {
    if (p.veh && !p.veh.att) { setState(p, 'fetch', 0); return; }
    if (p.kind === 'guard') { setState(p, stealthT > 0 ? 'lost' : 'chase', 0); if (p.state === 'chase') { p.mark = 'ex'; p.markT = 0.8; } return; }
    if (p.role === 'sample' || p.role === 'vendor') { setState(p, 'serve', 0); return; }
    if (p.role === 'restock') { setState(p, 'climb', 0); return; }
    setState(p, 'walk', 0); aisleTarget(p);
  }

  // ── staff ──────────────────────────────────────────────────────────────────
  function updStaff(p, dt, pl) {
    if (p.role === 'restock') return updRestock(p, dt, pl);
    if (!/serve|toss/.test(p.state)) { updShopper(p, dt, pl); return; }
    p.st += dt; p.stinkCD -= dt; p.cool -= dt; hop(p, dt);
    // drift back home
    steerTo(p, p.home.x, p.home.z, 1.2, dt, 4); integrate(p, dt, false);
    if (pl) {
      const dx = pl.x - p.pos.x, dz = pl.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d < 10) p.yaw += angDiff(p.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 4);
      if (p.state === 'serve' && d < 4.5 && pl.speed < 3.2 && p.cool <= 0 && !pl.air) {
        setState(p, 'toss', 0.55); p.cool = p.role === 'vendor' ? 12 : 8; p.tossed = false;
      }
      if (p.state === 'toss' && !p.tossed && p.st > 0.25) {
        p.tossed = true;
        const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
        const tx = pl.x + (pl.vx || 0) * 0.6 + R(-0.6, 0.6), tz = pl.z + (pl.vz || 0) * 0.6 + R(-0.6, 0.6);
        const food = p.role === 'vendor' ? 'hotdog' : (rand() < 0.6 ? p.food : pick(C.GAS_TYPES)), ft = 0.65;
        const sx = p.pos.x + fx * 0.5, sz = p.pos.z + fz * 0.5, sy = 1.3;
        tosses.push({ x: sx, y: sy, z: sz, vx: (tx - sx) / ft, vz: (tz - sz) / ft, vy: (0.3 - sy + 9 * ft * ft) / ft, t: 0, food });
      }
      if (p.state === 'toss' && p.st > p.dur) setState(p, 'serve', 0);
    }
    threat(p, dt, pl);
    if (p.state === 'serve' && p.stinkCD <= 0) { const c = nearCloud(p); if (c) stink(p, c, false); }
  }
  function updRestock(p, dt, pl) {
    const L = p.ladder; p.st += dt; p.stinkCD -= dt; hop(p, dt);
    // the ladder wobbles back to rest
    L.wobV += (-L.wob * 40 - L.wobV * 4) * dt; L.wob += L.wobV * dt;
    if (p.state === 'climb') {
      const cyc = p.st % 11; // up 2 s, work 4 s, down 2 s, rest 3 s
      L.h = cyc < 2 ? cyc / 2 * 1.5 : cyc < 6 ? 1.5 : cyc < 8 ? (8 - cyc) / 2 * 1.5 : 0;
      p.climbing = cyc < 2 || (cyc >= 6 && cyc < 8); p.working = cyc >= 2 && cyc < 6;
      p.pos.set(L.x - Math.sin(L.yaw) * 0.42, floorAt(L.x, L.z) + L.h, L.z - Math.cos(L.yaw) * 0.42); p.yaw = L.yaw;
      if (pl && !pl.air && pl.speed > 4 && Math.hypot(pl.x - L.x, pl.z - L.z) < 1.3) {
        L.wobV += 6 * (rand() < 0.5 ? -1 : 1);
        if (L.h > 0.2) {
          const d = Math.hypot(pl.vx, pl.vz) || 1;
          p.vx = pl.vx / d * 2.5 - Math.sin(L.yaw) * 2; p.vz = pl.vz / d * 2.5 - Math.cos(L.yaw) * 2;
          p.jy = L.h; p.pos.y = floorAt(p.pos.x, p.pos.z); p.jv = 3; p.spinV = R(-8, 8);
          setState(p, 'fall', 0); p.down = p.fallen = true; sfxL('scream', 0.3);
          bus.emit('knock', { pos: { x: L.x, y: 0, z: L.z }, value: 1, kind: 'ladder' });
          announce('knock');
        } else { knockDown(p, pl, false); }
      } else if (L.h < 0.1 && p.stinkCD <= 0) { const c = nearCloud(p); if (c) { stink(p, c, false); } }
      return;
    }
    if (p.state === 'fall') {
      p.yaw += p.spinV * dt; p.tiltSpin += dt * 6; integrate(p, dt, false);
      if (p.jy <= 0) { setState(p, 'down', 3); p.tiltSpin = 0; }
      return;
    }
    if (p.state === 'getup' && p.st > p.dur) {
      p.down = p.fallen = false; L.h = 0; setState(p, 'walkback', 0); return;
    }
    if (p.state === 'walkback') {
      const tx = L.x - Math.sin(L.yaw) * 0.42, tz = L.z - Math.cos(L.yaw) * 0.42;
      if (steerTo(p, tx, tz, 1.4, dt, 5) < 0.2 || p.st > 6) { setState(p, 'climb', 0); p.st = 8; }
      integrate(p, dt, true, 6); return;
    }
    updShopper(p, dt, pl);
  }

  // ── guards ─────────────────────────────────────────────────────────────────
  const fd = { x: 0, z: 0 };
  function updGuard(g, dt, pl) {
    g.st += dt; g.markT -= dt; g.radT -= dt; g.whT -= dt; g.radCD -= dt; g.whCD -= dt; hop(g, dt);
    looseVeh(g.veh, dt);
    const scoot = g.veh && g.veh.att && g.veh.kind === 'scooter';
    const d = pl ? Math.hypot(pl.x - g.pos.x, pl.z - g.pos.z) : 99;
    switch (g.state) {
      case 'enter': {
        if (pl) steerTo(g, pl.x, pl.z, 3, dt, 4);
        integrate(g, dt, true, 6);
        if (g.st > 0.9) setState(g, stealthT > 0 ? 'lost' : 'chase', 0);
        break;
      }
      case 'chase': {
        if (stealthT > 0) { setState(g, 'lost', 0); g.mark = 'qm'; break; }
        if (!pl) { steerTo(g, g.pos.x, g.pos.z, 0, dt, 5); integrate(g, dt, false); break; }
        const spd = scoot ? 8.6 : 6.2;
        if (d < 5 || !flowDir(g.pos.x, g.pos.z, fd)) { fd.x = (pl.x - g.pos.x) / (d || 1); fd.z = (pl.z - g.pos.z) / (d || 1); }
        steerDir(g, fd.x, fd.z, spd, dt, scoot ? 2.5 : 4);
        integrate(g, dt, true, scoot ? 4 : 8);
        if (g.radCD <= 0) { g.radCD = R(8, 14); g.radT = 1.5; sfxL('radio', 2); }
        if (g.whCD <= 0 && d < 14) { g.whCD = R(4, 7); g.whT = 0.9; sfxL('whistle', 1.5); }
        if (!pl.air && !caughtLatch) {
          if (d < 1.55 && pl.speed < 4 && !P.noCatch) {
            setState(g, 'tackle', 0.4); g.jv = 3.2; g.dvx = (pl.x - g.pos.x) / (d || 1) * 5; g.dvz = (pl.z - g.pos.z) / (d || 1) * 5;
            g.yaw = Math.atan2(g.dvx, g.dvz); sfxL('whistle', 0.5);
          }
        }
        break;
      }
      case 'tackle': {
        g.vx = g.dvx; g.vz = g.dvz; integrate(g, dt, false);
        if (g.st > g.dur && g.jy <= 0) {
          if (pl && d < 2.2 && pl.speed < 5.5 && !caughtLatch) {
            caughtLatch = true; setState(g, 'pile', 0); g.pos.x = pl.x - Math.sin(g.yaw) * 0.2; g.pos.z = pl.z - Math.cos(g.yaw) * 0.2; g.jy = 0.55;
            if (core.shake) core.shake(0.5, 0.4);
            bus.emit('caught', { by: g.role === 'scooter' ? 'a security guard on a mobility scooter' : 'a security guard' });
          } else { setState(g, 'down', 1.6); g.down = true; g.fallen = true; sfxL('gasp', 0.4); }
        }
        break;
      }
      case 'pile': { g.vx = g.vz = 0; if (pl) { g.pos.x = pl.x - Math.sin(g.yaw) * 0.2; g.pos.z = pl.z - Math.cos(g.yaw) * 0.2; g.jy = 0.55; } break; }
      case 'flung': case 'hit': {
        g.yaw += g.spinV * dt; g.tiltSpin += dt * 11;
        const f = Math.exp(-dt * (g.jy > 0 ? 0.25 : 5)); g.vx *= f; g.vz *= f; integrate(g, dt, false);
        if (g.st > 0.3 && g.jy <= 0) { setState(g, 'down', R(2.6, 3.2)); g.tiltSpin = 0; }
        break;
      }
      case 'down': {
        g.vx *= Math.exp(-dt * 5); g.vz *= Math.exp(-dt * 5); integrate(g, dt, false);
        if (g.st > g.dur) setState(g, 'getup', 0.6);
        break;
      }
      case 'getup': { if (g.st > g.dur) { g.down = g.fallen = false; resume(g); } break; }
      case 'fetch': updShopper(g, dt, null); return;
      case 'dizzy': {
        g.wobA = (g.wobA || 0) + dt * 2.2;
        steerDir(g, Math.sin(g.wobA), Math.cos(g.wobA), 1.1, dt, 3); integrate(g, dt, true, 3);
        if (g.st > g.dur) { setState(g, stealthT > 0 ? 'lost' : 'chase', 0); g.mark = 'ex'; g.markT = 0.9; }
        break;
      }
      case 'lost': {
        g.mark = 'qm'; g.markT = 0.5;
        if (g.st > (g.wanderT || 0)) { g.wanderT = g.st + R(1.2, 2.4); const a = R(0, TAU); g.wx = Math.sin(a); g.wz = Math.cos(a); }
        steerDir(g, g.wx || 0, g.wz || 0, scoot ? 1.8 : 1.2, dt, 3); integrate(g, dt, true, 4);
        if (stealthT <= 0) { setState(g, 'chase', 0); g.mark = 'ex'; g.markT = 1; sfxL('whistle', 1); }
        break;
      }
      case 'leave': {
        if (pl) { const l = d || 1; steerDir(g, (g.pos.x - pl.x) / l, (g.pos.z - pl.z) / l, 3, dt, 3); }
        integrate(g, dt, true, 5);
        if (g.st > 5) g.dead = true;
        break;
      }
      default: setState(g, 'chase', 0);
    }
    // a fast cart bowls guards over; a slow one just shoves them aside
    if (pl && !pl.air && /chase|enter|dizzy|lost|leave/.test(g.state)) {
      if (d < 1.25 && pl.speed >= 4) knockDown(g, pl, true);
      else if (d < 1.15 && d > 1e-3) { const k = (1.15 - d) / d; g.pos.x -= (pl.x - g.pos.x) * k; g.pos.z -= (pl.z - g.pos.z) * k; }
    }
    // fart clouds make the chase unpleasant (pinch the nose, keep running)
    g.pinch = !!nearCloud(g) && /chase|lost|enter/.test(g.state);
    syncVeh(g);
  }

  // ── forklifts ──────────────────────────────────────────────────────────────
  function updLift(f, dt, pl, others) {
    f.st += dt; f.honkT -= dt; f.beepT -= dt; f.bumpT -= dt; f.flash += dt;
    const wp = f.pts[f.wi], tx = wp.x, tz = wp.z;
    const sn = Math.sin(f.yaw), cs = Math.cos(f.yaw);
    const local = (x, z) => { const dx = x - f.pos.x, dz = z - f.pos.z; return [dx * cs - dz * sn, dx * sn + dz * cs]; };
    const pd = pl ? Math.hypot(pl.x - f.pos.x, pl.z - f.pos.z) : 99;
    if (f.state === 'drive') {
      let blocked = false, byPlayer = false;
      if (pl && !pl.air) { const [lx, lz] = local(pl.x, pl.z); if (lz > 1.5 && lz < 7 && Math.abs(lx) < 1.6) { blocked = byPlayer = true; } }
      for (const o of others) { if (o.dead) continue; const [lx, lz] = local(o.pos.x, o.pos.z); if (lz > 1.5 && lz < 4.5 && Math.abs(lx) < 1.3) { blocked = true; break; } }
      if (blocked && !byPlayer) { f.waitT += dt; if (f.waitT > 3) blocked = false; } else f.waitT = 0;
      if (byPlayer && f.honkT <= 0) { f.honkT = 2.5; sfx('forklift', { kind: 'honk' }); if (rand() < 0.3) announce('forklift'); }
      const want = blocked ? 0 : 3.4;
      f.speed += (want - f.speed) * Math.min(1, dt * (blocked ? 5 : 1.2));
      const dAng = angDiff(f.yaw, Math.atan2(tx - f.pos.x, tz - f.pos.z));
      f.yaw += clamp(dAng, -1.3 * dt, 1.3 * dt);
      if (Math.abs(dAng) > 0.6) f.speed = Math.min(f.speed, 1.6);
      f.pos.x += Math.sin(f.yaw) * f.speed * dt; f.pos.z += Math.cos(f.yaw) * f.speed * dt;
      const dw = Math.hypot(tx - f.pos.x, tz - f.pos.z);
      if (f.loop && dw < 2.2) { f.wi = (f.wi + 1) % f.pts.length; if (f.beepT <= 0 && pd < 28) { f.beepT = 0.6; sfx('forklift', { kind: 'beep' }); } }
      else if (!f.loop && dw < 0.5) { f.state = 'turn'; f.st = 0; f.from = f.yaw; f.wi = 1 - f.wi; f.speed = 0; }
    } else {
      const k = Math.min(1, f.st / 2.6), e = k * k * (3 - 2 * k);
      f.yaw = f.from + Math.PI * e;
      f.lift = 0.25 + Math.sin(k * Math.PI) * 0.5;
      if (f.beepT <= 0 && pd < 28) { f.beepT = 0.55; sfx('forklift', { kind: 'beep' }); }
      if (k >= 1) { f.state = 'drive'; f.st = 0; }
    }
    f.pos.y = floorAt(f.pos.x, f.pos.z);
    // the player bounces off the forklift (an oriented box)
    const hw = 0.72, z0 = -1.25, z1 = 2.25;
    if (pl && (!pl.air || pl.y < 2.3) && ok('cart')) {
      const r = 0.7, [lx, lz] = local(pl.x, pl.z);
      if (lx > -hw - r && lx < hw + r && lz > z0 - r && lz < z1 + r) {
        const pen = [hw + r - lx, lx + hw + r, z1 + r - lz, lz - z0 + r], m = Math.min(...pen), i = pen.indexOf(m);
        const nlx = i === 0 ? 1 : i === 1 ? -1 : 0, nlz = i === 2 ? 1 : i === 3 ? -1 : 0;
        const nx = nlx * cs + nlz * sn, nz = -nlx * sn + nlz * cs;
        BR.cart.pos.x += nx * m; BR.cart.pos.z += nz * m;
        const vn = pl.vx * nx + pl.vz * nz;
        if (f.bumpT <= 0) {
          f.bumpT = 0.4;
          if (BR.cart.bump) BR.cart.bump({ x: nx, z: nz }, Math.min(12, 3 + Math.max(0, -vn) * 1.4));
          sfx('forklift', { kind: 'honk' }); f.honkT = 2;
        }
      }
    }
    // walkers get nudged out of it
    for (const o of others) {
      const [lx, lz] = local(o.pos.x, o.pos.z), r = o.radius || 0.4;
      if (lx > -hw - r && lx < hw + r && lz > z0 - r && lz < z1 + r) {
        const px = lx > 0 ? hw + r - lx : -(lx + hw + r);
        o.pos.x += px * cs; o.pos.z += -px * sn;
      }
    }
    const dr = f.driver; dr.pos.set(f.pos.x - sn * 0.28, f.pos.y, f.pos.z - cs * 0.28); dr.yaw = f.yaw;
  }

  // ── pose (animation targets) ───────────────────────────────────────────────
  const tg = {};
  function pose(p, dt, t, pl) {
    const moveK = clamp(p.speed / 1.5, 0, 1.4);
    p.phase += dt * (2 + p.speed * 2.7);
    const sw = Math.sin(p.phase);
    tg.aLx = sw * 0.55 * Math.min(1, moveK); tg.aRx = -tg.aLx; tg.aLo = 0.14; tg.aRo = 0.14;
    tg.legAmp = 0.55 * Math.min(1.2, moveK); tg.legF = 0; tg.hip = p.legLen; tg.tilt = moveK * 0.07; tg.roll = 0;
    tg.hy = 0; tg.hp = 0; tg.hr = 0; tg.mw = 0.1; tg.mh = 0.028; tg.brow = 0; tg.bang = p.kind === 'guard' ? 0.38 : 0; tg.pup = 1; tg.lx = 0; tg.ly = 0; tg.green = 0;
    let bob = Math.abs(Math.cos(p.phase)) * 0.06 * Math.min(1, moveK);
    const cartOn = p.veh && p.veh.att && p.veh.kind === 'cart';
    if (cartOn) { tg.aLx = tg.aRx = -1.3; tg.aLo = tg.aRo = -0.06; }
    if (p.seated) { tg.hip = p.seatH; tg.legF = -1.35; tg.legAmp = 0; tg.aLx = tg.aRx = -1.15; tg.aLo = tg.aRo = 0.02; tg.tilt = 0; bob = 0; }
    if (pl && /walk|browse|serve|chase|enter|drive|climb/.test(p.state)) {
      const dx = pl.x - p.pos.x, dz = pl.z - p.pos.z;
      if (dx * dx + dz * dz < 100) { tg.hy = clamp(angDiff(p.yaw, Math.atan2(dx, dz)), -1, 1); tg.lx = clamp(tg.hy, -1, 1) * 0.8; }
    }
    switch (p.state) {
      case 'browse': tg.aRx = -2.45; tg.aRo = -0.15; tg.hy = p.side * 0.9; tg.hp = -0.15; tg.mw = 0.05; tg.mh = 0.045; tg.lx = p.side; tg.ly = 0.5; break;
      case 'chat': {
        const talk = Math.sin(t * 0.9 + p.id * 1.7) > 0;
        tg.mh = talk ? 0.02 + 0.07 * Math.max(0, Math.sin(t * 15 + p.id)) : 0.03;
        tg.aLx = -0.9 + (talk ? Math.sin(t * 4 + p.id) * 0.5 : 0); tg.aLo = 0.3; tg.hp = Math.sin(t * 5 + p.id) * 0.07; tg.brow = talk ? 0.03 : 0; break;
      }
      case 'gasp': tg.aLx = tg.aRx = -2.65; tg.aLo = tg.aRo = -0.32; tg.mw = 0.09; tg.mh = 0.12; tg.brow = 0.07; tg.pup = 0.6; tg.tilt = -0.12; break;
      case 'dodge': tg.aLx = tg.aRx = -0.3; tg.aLo = tg.aRo = 2.6; tg.mw = 0.1; tg.mh = 0.14; tg.brow = 0.08; tg.pup = 0.5; tg.tilt = -0.3; tg.legAmp = 1.1; tg.roll = p.dodgeX * 0.2; break;
      case 'hit': case 'flung': case 'fall':
        tg.aLx = -1.5 + Math.sin(t * 24) * 1.4; tg.aRx = -1.5 + Math.cos(t * 22) * 1.4; tg.aLo = tg.aRo = 2.0;
        tg.legAmp = 1.2; tg.tilt = -0.9; tg.mw = 0.11; tg.mh = 0.15; tg.brow = 0.08; tg.pup = 0.45; p.phase += dt * 20; break;
      case 'down':
        tg.hip = 0.24; tg.tilt = -0.42; tg.legF = -1.45; tg.legAmp = 0.12; p.phase += dt * 6; tg.aLx = tg.aRx = 0.55; tg.aLo = tg.aRo = 0.45;
        tg.lx = Math.cos(t * 7); tg.ly = Math.sin(t * 7); tg.mw = 0.1 + Math.sin(t * 9) * 0.03; tg.mh = 0.035; tg.brow = 0.05; tg.hr = Math.sin(t * 3) * 0.15; bob = 0; break;
      case 'getup': tg.aLx = tg.aRx = -1.2; tg.aLo = tg.aRo = 0.5; tg.tilt = 0.35; break;
      case 'stink': {
        tg.aRx = -2.46; tg.aRo = -0.55; tg.aLx = -1.9 + Math.sin(t * 22) * 0.35; tg.aLo = 0.9 + Math.sin(t * 22) * 0.35;
        tg.green = p.gag ? 0.85 : 0.45; tg.mw = 0.13; tg.mh = 0.03; tg.brow = -0.02; tg.bang = -0.3; tg.pup = 0.8;
        if (p.gag && p.st > 0.7) { tg.tilt = 0.6; tg.hp = 0.25; tg.mh = 0.11; tg.aRx = -1.2; tg.aRo = 0; }
        break;
      }
      case 'flee': tg.aLx = -0.4 + Math.sin(t * 20) * 0.5; tg.aRx = -0.4 + Math.cos(t * 20) * 0.5; tg.aLo = tg.aRo = 2.5; tg.mw = 0.1; tg.mh = 0.14; tg.brow = 0.08; tg.pup = 0.5; tg.tilt = 0.2; tg.green = 0.3; break;
      case 'serve':
        if (p.role === 'vendor') { tg.aRx = -2.5 + Math.sin(t * 6) * 0.35; tg.aRo = 0.35; tg.aLx = -0.4; tg.aLo = 0.2; }
        else { tg.aLx = tg.aRx = -1.45; tg.aLo = tg.aRo = -0.12; }
        tg.mw = 0.13; tg.mh = 0.04; bob = Math.abs(Math.sin(t * 2.5 + p.id)) * 0.03; break;
      case 'toss': { const k = Math.sin(Math.PI * Math.min(1, p.st / 0.4)); tg.aRx = -1.45 - 1.4 * k; tg.aRo = 0; tg.aLx = -1.45; tg.aLo = -0.12; tg.mw = 0.12; tg.mh = 0.09; tg.brow = 0.05; break; }
      case 'climb':
        tg.legAmp = 0;
        if (p.climbing) { tg.aLx = -2.6 + Math.sin(t * 7) * 0.3; tg.aRx = -2.6 - Math.sin(t * 7) * 0.3; tg.aLo = tg.aRo = 0; tg.legF = -0.3; tg.legAmp = 0.35; p.phase += dt * 5; }
        else if (p.working) { tg.aLx = tg.aRx = -2.1 + Math.sin(t * 3) * 0.3; tg.aLo = tg.aRo = -0.1; tg.hp = -0.2; tg.mw = 0.06; tg.mh = 0.04; }
        else { tg.aLx = tg.aRx = -1.45; tg.aLo = tg.aRo = -0.15; }
        break;
      case 'chase': case 'enter':
        if (!p.seated) { tg.tilt = 0.28; tg.aLx = sw * 1.1; tg.aRx = -sw * 1.1; tg.legAmp = 0.85; }
        tg.mw = 0.13; tg.mh = 0.03; break;
      case 'tackle': tg.tilt = 1.45; tg.hip = 0.55; tg.aLx = tg.aRx = -2.95; tg.aLo = tg.aRo = 0.12; tg.legF = 0.3; tg.legAmp = 0.1; tg.mw = 0.09; tg.mh = 0.13; tg.brow = -0.02; break;
      case 'pile': tg.tilt = 1.5; tg.hip = 0.5; tg.aLx = tg.aRx = -2.9; tg.aLo = tg.aRo = 0.6; tg.legF = 0.2; tg.mw = 0.14; tg.mh = 0.05; tg.bang = 0.2; break;
      case 'dizzy': tg.roll = Math.sin(t * 3.2) * 0.28; tg.hr = Math.sin(t * 3.2 + 1) * 0.25; tg.aLo = tg.aRo = 0.7 + Math.sin(t * 4) * 0.3; tg.aLx = tg.aRx = -0.3;
        tg.lx = Math.cos(t * 8); tg.ly = Math.sin(t * 8); tg.mw = 0.11 + Math.sin(t * 10) * 0.03; tg.mh = 0.04; tg.bang = -0.2; tg.brow = 0.04; tg.green = 0.4; break;
      case 'lost': tg.hy = Math.sin(t * 1.6 + p.id) * 0.9; tg.aRx = -2.85; tg.aRo = -0.35; tg.bang = 0; tg.brow = 0.05; tg.mw = 0.05; tg.mh = 0.05; tg.lx = Math.sin(t * 1.6 + p.id); break;
      case 'leave': tg.mw = 0.12; tg.mh = 0.02; tg.bang = -0.2; break;
    }
    if (p.kind === 'guard') {
      if (p.radT > 0 && /chase|enter|lost/.test(p.state)) { tg.aLx = -2.3; tg.aLo = -0.75; tg.mh = 0.02 + 0.06 * Math.max(0, Math.sin(t * 16)); }
      if (p.whT > 0 && /chase|enter|lost/.test(p.state)) { tg.mw = 0.05; tg.mh = 0.05; }
      if (p.pinch && p.radT <= 0) { tg.aRx = -2.46; tg.aRo = -0.55; tg.green = 0.4; }
    }
    // smoothing
    const a = p.a, k = 1 - Math.exp(-dt * 12), kf = 1 - Math.exp(-dt * 20);
    for (const key of ['aLx', 'aLo', 'aRx', 'aRo', 'legAmp', 'legF', 'hip', 'tilt', 'roll', 'hy', 'hp', 'hr', 'green', 'brow', 'bang', 'pup']) a[key] += (tg[key] - a[key]) * k;
    for (const key of ['mw', 'mh', 'lx', 'ly']) a[key] += (tg[key] - a[key]) * kf;
    a.bob = bob;
    p.blinkT -= dt; if (p.blinkT < -0.12) p.blinkT = R(1.5, 4.5);
  }

  // ── drawing ────────────────────────────────────────────────────────────────
  function drawPerson(p, near, t) {
    const a = p.a, s = p.scale, fat = p.fat, hr = p.headR;
    const tilt = a.tilt + (p.state === 'flung' || p.state === 'fall' ? p.tiltSpin : 0);
    frameM(M.root, null, p.pos.x, p.pos.y + p.jy, p.pos.z, 0, p.yaw, 0, s);
    frameM(M.hip, M.root, 0, a.hip + a.bob, 0, tilt, 0, a.roll);
    const pants = p.pants, shirt = p.shirt, skin = a.green > 0.02 ? mix(p.skin, 0x8fd14f, a.green) : p.skin;
    // hips + torso
    part(M.hip, 'sph', pants, 0, 0.06, 0, 0, 0, 0, 0.26 * fat, 0.21, 0.22 * fat);
    const sq = p.kind === 'guard' ? 0.05 : 0;
    part(M.hip, 'sph', shirt, 0, 0.42, 0.01, 0, 0, 0, 0.31 * fat, 0.43 + sq, 0.27 * fat);
    // legs + shoes
    const sw = Math.sin(p.phase) * (near ? a.legAmp : a.legAmp * 0.5);
    limb(M.hip, pants, 0.13, 0.02, 0, a.legF + sw, 0.03, p.legLen, 0.09);
    if (near) endBlob(M.hip, p.shoe, 0, 0.02, 0.07, 0.1, 0.075, 0.17);
    limb(M.hip, pants, -0.13, 0.02, 0, a.legF - sw, -0.03, p.legLen, 0.09);
    if (near) endBlob(M.hip, p.shoe, 0, 0.02, 0.07, 0.1, 0.075, 0.17);
    // arms + hands
    const sx = 0.33 * fat;
    limb(M.hip, shirt, sx, 0.66, 0, a.aLx, a.aLo, 0.6, 0.075); M.hL.copy(M.end);
    if (near) endBlob(M.hip, skin, 0, 0, 0, 0.095, 0.095, 0.095);
    limb(M.hip, shirt, -sx, 0.66, 0, a.aRx, -a.aRo, 0.6, 0.075); M.hR.copy(M.end);
    if (near) endBlob(M.hip, skin, 0, 0, 0, 0.095, 0.095, 0.095);
    // role props on the body
    const fz = 0.27 * fat;
    if (p.kind === 'guard') {
      part(M.hip, 'cyl', 0x222228, 0, 0.14, 0, 0, 0, 0, 0.56 * fat, 0.09, 0.47 * fat);
      if (near) {
        M.e.set(0, 0, 0); M.q.setFromEuler(M.e); M.l.compose(M.p.set(0.13 * fat, 0.58, fz * 0.93), M.q, M.s.set(0.085, 0.085, 0.085)); M.w.multiplyMatrices(M.hip, M.l); put('star', M.w, 0xffd23a);
        part(M.hip, 'box', 0x1a1a1a, -0.2 * fat, 0.62, fz * 0.85, 0, 0, 0.2, 0.085, 0.16, 0.07);
        part(M.hip, 'cyl', 0x1a1a1a, -0.22 * fat, 0.78, fz * 0.85, 0, 0, 0.2, 0.02, 0.18, 0.02);
      }
    } else if (p.role === 'sample' || p.role === 'vendor') {
      part(M.hip, 'box', p.role === 'vendor' ? 0xe63946 : 0xffffff, 0, 0.3, fz * 0.9, 0.08, 0, 0, 0.44 * fat, 0.62, 0.05);
    } else if (p.role === 'restock' || p.role === 'driver') {
      part(M.hip, 'cyl', 0xf4f4f4, 0, 0.36, 0.01, 0, 0, 0, 0.64 * fat, 0.06, 0.56 * fat);
    }
    // held things
    if (p.role === 'sample' && /serve|toss/.test(p.state)) {
      const mx = (M.hL.x + M.hR.x) / 2, my = (M.hL.y + M.hR.y) / 2 + 0.05, mz = (M.hL.z + M.hR.z) / 2 + 0.05;
      part(M.hip, 'box', 0xd8dde3, mx, my, mz, 0, 0, 0, 0.6, 0.03, 0.36);
      if (near) for (let i = 0; i < 3; i++) part(M.hip, 'sph', FOOD_COL[C.GAS_TYPES[(p.id + i) % 5]], mx - 0.18 + i * 0.18, my + 0.05, mz, 0, 0, 0, 0.06, 0.05, 0.06);
    }
    if (p.role === 'vendor' && near) {
      const h = M.hR; part(M.hip, 'cyl', 0xe8b86a, h.x, h.y + 0.1, h.z, 0, 0, 0.2, 0.13, 0.45, 0.13); part(M.hip, 'cyl', 0xc0392b, h.x, h.y + 0.14, h.z + 0.03, 0, 0, 0.2, 0.08, 0.55, 0.08);
    }
    if (p.role === 'restock' && p.state === 'climb' && !p.climbing) {
      const mx = (M.hL.x + M.hR.x) / 2, my = (M.hL.y + M.hR.y) / 2, mz = (M.hL.z + M.hR.z) / 2;
      part(M.hip, 'box', 0xc49a6c, mx, my + 0.12, mz + 0.1, 0, 0, 0, 0.42, 0.3, 0.32);
    }
    // head
    frameM(M.head, M.hip, 0, 1.1, 0.02, a.hp, a.hy, a.hr);
    part(M.head, 'sph', skin, 0, 0, 0, 0, 0, 0, hr, hr * 0.96, hr * 0.94);
    if (near) {
      part(M.head, 'sph', skin, hr * 0.96, -0.02, -0.02, 0, 0, 0, 0.06, 0.1, 0.07);
      part(M.head, 'sph', skin, -hr * 0.96, -0.02, -0.02, 0, 0, 0, 0.06, 0.1, 0.07);
      part(M.head, 'sph', mix(skin, 0xd05050, 0.25), 0, -0.03, hr * 0.95, 0, 0, 0, 0.08 * p.nose, 0.075 * p.nose, 0.09 * p.nose);
      const blink = p.blinkT < 0 ? 0.12 : 1, ez = hr * 0.82;
      for (let sd = -1; sd <= 1; sd += 2) {
        const ex = sd * 0.13;
        part(M.head, 'sph', 0xffffff, ex, 0.08, ez, 0, 0, 0, 0.095, 0.12 * blink, 0.07);
        if (blink > 0.5) part(M.head, 'sph', 0x141414, ex + a.lx * 0.03, 0.08 + a.ly * 0.035, ez + 0.058, 0, 0, 0, 0.045 * a.pup, 0.052 * a.pup, 0.02);
        part(M.head, 'box', p.kind === 'guard' ? 0x2a1a10 : p.hairC, ex, 0.235 + a.brow + (p.state === 'lost' && sd > 0 ? 0.05 : 0), hr * 0.86, 0, 0, sd * a.bang, 0.14, 0.035, 0.04);
      }
      part(M.head, 'sph', 0x5a1818, 0, -0.165, hr * 0.84, 0, 0, 0, a.mw, a.mh, 0.05);
      if (a.green > 0.6 && a.mh > 0.07) part(M.head, 'sph', 0xff7a8a, 0, -0.22, hr * 0.86, 0.4, 0, 0, 0.05, 0.03, 0.07);
      if (p.kind === 'guard' && p.stache) part(M.head, 'sph', 0x3a2414, 0, -0.1, hr * 0.9, 0, 0, 0, 0.15, 0.04, 0.05);
      if (p.kind === 'guard' && p.whT > 0 && /chase|enter|lost/.test(p.state)) {
        part(M.head, 'box', 0xffd23a, 0, -0.17, hr + 0.04, 0, 0, 0, 0.05, 0.05, 0.14);
        part(M.head, 'sph', skin, 0.16, -0.12, hr * 0.72, 0, 0, 0, 0.1, 0.09, 0.09); part(M.head, 'sph', skin, -0.16, -0.12, hr * 0.72, 0, 0, 0, 0.1, 0.09, 0.09);
      }
    }
    // hair and hats
    const hc = p.hairC;
    if (p.hat === 'cap') {
      part(M.head, 'cyl', 0x1c2a55, 0, hr * 0.62, -0.02, -0.1, 0, 0, hr * 2.02, 0.22, hr * 2.02);
      part(M.head, 'box', 0x1c2a55, 0, hr * 0.5, hr * 0.85, 0.15, 0, 0, 0.44, 0.04, 0.3);
      if (near) part(M.head, 'glow', 0xffd23a, 0, hr * 0.68, hr * 0.98, 0, 0, 0, 0.05, 0.05, 0.02);
    } else if (p.hat === 'hard') {
      part(M.head, 'sph', 0xffc400, 0, hr * 0.42, 0, 0, 0, 0, hr * 1.04, hr * 0.7, hr * 1.04);
      part(M.head, 'cyl', 0xffc400, 0, hr * 0.38, 0.04, 0, 0, 0, hr * 2.4, 0.03, hr * 2.4);
    } else if (p.hat === 'paper') {
      part(M.head, 'box', 0xffffff, 0, hr * 0.95, 0, 0, 0, 0, 0.5, 0.2, 0.32);
      part(M.head, 'sph', hc, 0, 0.05, -0.12, 0, 0, 0, hr * 0.98, hr * 0.8, hr * 0.85);
    } else if (p.hat === 'net') {
      part(M.head, 'sph', 0xdce8f5, 0, 0.14, -0.05, 0, 0, 0, hr * 1.06, hr * 0.85, hr * 1.02);
    } else {
      switch (p.hair) {
        case 0: part(M.head, 'sph', hc, hr * 0.8, 0.02, -0.1, 0, 0, 0, 0.1, 0.15, 0.17); part(M.head, 'sph', hc, -hr * 0.8, 0.02, -0.1, 0, 0, 0, 0.1, 0.15, 0.17); break;
        case 1: part(M.head, 'sph', hc, 0, hr * 0.55, -0.04, 0, 0, 0, hr * 1.0, hr * 0.62, hr * 0.95); break;
        case 2: part(M.head, 'sph', hc, 0, 0.1, -0.08, 0, 0, 0, hr * 1.06, hr * 1.0, hr); part(M.head, 'sph', hc, 0, -0.2, -0.16, 0, 0, 0, hr * 0.95, hr * 0.8, hr * 0.6); break;
        case 3: part(M.head, 'sph', hc, 0, hr * 0.45, -0.06, 0, 0, 0, hr * 1.0, hr * 0.6, hr * 0.95); part(M.head, 'sph', hc, 0, hr * 0.95, -0.2, 0, 0, 0, 0.15, 0.15, 0.15); break;
        default: for (let i = 0; i < 4; i++) part(M.head, 'sph', hc, Math.cos(i * 1.2 - 1.8) * hr * 0.6, hr * 0.62, Math.sin(i * 1.2 - 1.8) * hr * 0.5, 0, 0, 0, hr * 0.42, hr * 0.42, hr * 0.42);
      }
    }
    // status marks
    const showStars = p.state === 'down' || p.state === 'dizzy';
    if (showStars || (p.mark && p.markT > 0)) {
      M.p.setFromMatrixPosition(M.head); const hx = M.p.x, hy = M.p.y, hz = M.p.z;
      if (showStars) starRing(hx, hy + hr * s * 1.1, hz, 0.55 * s, t + p.id, 5);
      else billboard(p.mark, hx, hy + 0.85 * s + Math.sin(t * 8) * 0.06, hz, 0.55);
    }
    shadow(p.pos.x, p.pos.y, p.pos.z, 1.0 * s * fat * Math.max(0.4, 1 - p.jy * 0.25), 1.0 * s * fat * Math.max(0.4, 1 - p.jy * 0.25), 0);
  }
  function drawCart(v, p, near) {
    frameM(M.veh, null, v.x, v.y, v.z, v.tip, v.yaw, v.roll);
    const W = 0xc9d4de, H = Math.PI / 2;
    part(M.veh, 'box', 0xaab6c2, 0, 0.5, 0, 0, 0, 0, 0.6, 0.03, 0.84);
    part(M.veh, 'cyl', 0xe63946, 0, 1.04, -0.52, 0, 0, H, 0.07, 0.68, 0.07);
    if (!near) { part(M.veh, 'box', W, 0, 0.75, 0, 0, 0, 0, 0.6, 0.46, 0.84); return; }
    for (const y of [0.98, 0.76]) {
      part(M.veh, 'cyl', W, 0.3, y, 0, H, 0, 0, 0.03, 0.86, 0.03); part(M.veh, 'cyl', W, -0.3, y, 0, H, 0, 0, 0.03, 0.86, 0.03);
      part(M.veh, 'cyl', W, 0, y, 0.43, 0, 0, H, 0.03, 0.6, 0.03); part(M.veh, 'cyl', W, 0, y, -0.43, 0, 0, H, 0.03, 0.6, 0.03);
    }
    for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) part(M.veh, 'cyl', W, sx * 0.3, 0.74, sz * 0.43, 0, 0, 0, 0.03, 0.5, 0.03);
    part(M.veh, 'cyl', 0x8a96a3, 0.3, 0.92, -0.48, 0, 0, 0, 0.04, 0.26, 0.04); part(M.veh, 'cyl', 0x8a96a3, -0.3, 0.92, -0.48, 0, 0, 0, 0.04, 0.26, 0.04);
    for (let sx = -1; sx <= 1; sx += 2) {
      part(M.veh, 'cyl', 0x8a96a3, sx * 0.26, 0.27, -0.3, 0, 0, 0, 0.035, 0.46, 0.035);
      part(M.veh, 'cyl', 0x8a96a3, sx * 0.26, 0.27, 0.34, 0, 0, 0, 0.035, 0.46, 0.035);
      part(M.veh, 'sph', 0x202020, sx * 0.26, 0.075, -0.32, 0, 0, 0, 0.05, 0.075, 0.075);
      part(M.veh, 'sph', 0x202020, sx * 0.26, 0.075, 0.36, 0, 0, 0, 0.05, 0.075, 0.075);
    }
    const it = v.items;
    part(M.veh, 'box', it[0], 0.1, 0.68, 0.12, 0, 0.3, 0, 0.3, 0.3, 0.25);
    part(M.veh, 'box', it[1], -0.12, 0.64, -0.18, 0, -0.2, 0, 0.28, 0.24, 0.3);
    if (it[3] > 1) part(M.veh, 'cyl', it[2], -0.1, 0.8, 0.2, 0.2, 0, 0.3, 0.16, 0.42, 0.16);
    else part(M.veh, 'sph', it[2], 0.08, 0.85, -0.12, 0, 0, 0, 0.13, 0.13, 0.13);
    if (!v.att) shadow(v.x, v.y, v.z, 0.9, 1.2, v.yaw);
  }
  function drawScooter(v, near, t) {
    frameM(M.veh, null, v.x, v.y, v.z, v.tip, v.yaw, v.roll);
    part(M.veh, 'box', 0xd62828, 0, 0.28, 0.08, 0, 0, 0, 0.62, 0.2, 1.35);
    part(M.veh, 'box', 0x1d1d1d, 0, 0.55, -0.2, 0, 0, 0, 0.52, 0.12, 0.48);
    part(M.veh, 'box', 0x1d1d1d, 0, 0.82, -0.42, -0.1, 0, 0, 0.52, 0.42, 0.1);
    part(M.veh, 'cyl', 0x9aa3ad, 0, 0.45, -0.2, 0, 0, 0, 0.08, 0.25, 0.08);
    part(M.veh, 'cyl', 0x9aa3ad, 0, 0.78, 0.62, -0.35, 0, 0, 0.08, 0.8, 0.08);
    part(M.veh, 'cyl', 0x1d1d1d, 0, 1.14, 0.5, 0, 0, Math.PI / 2, 0.06, 0.55, 0.06);
    part(M.veh, 'sph', 0x202020, 0, 0.13, 0.66, 0, 0, 0, 0.07, 0.13, 0.13);
    part(M.veh, 'sph', 0x202020, 0.3, 0.13, -0.42, 0, 0, 0, 0.07, 0.13, 0.13);
    part(M.veh, 'sph', 0x202020, -0.3, 0.13, -0.42, 0, 0, 0, 0.07, 0.13, 0.13);
    if (!near) return;
    part(M.veh, 'box', 0xb0b8c0, 0, 0.98, 0.78, 0, 0, 0, 0.42, 0.24, 0.3);
    part(M.veh, 'cyl', 0xdddddd, 0.24, 1.25, -0.46, 0, 0, 0, 0.04, 1.5, 0.04);
    part(M.veh, 'box', 0xff7a00, 0.44, 1.88, -0.46, 0, Math.sin(t * 9 + v.x) * 0.4, 0, 0.4, 0.26, 0.03);
    part(M.veh, 'glow', 0xfff3b0, 0, 0.38, 0.77, 0, 0, 0, 0.08, 0.06, 0.03);
  }
  function drawLadder(p) {
    const L = p.ladder;
    frameM(M.veh, null, L.x, floorAt(L.x, L.z), L.z, -0.12 + L.wob * 0.08, L.yaw, L.wob * 0.1);
    part(M.veh, 'box', 0xd8a031, 0.27, 1.3, 0, 0, 0, 0, 0.07, 2.6, 0.07);
    part(M.veh, 'box', 0xd8a031, -0.27, 1.3, 0, 0, 0, 0, 0.07, 2.6, 0.07);
    for (let i = 0; i < 6; i++) part(M.veh, 'box', 0xb07a20, 0, 0.35 + i * 0.42, 0, 0, 0, 0, 0.54, 0.05, 0.06);
  }
  function drawLift(f, near, t) {
    frameM(M.veh, null, f.pos.x, f.pos.y, f.pos.z, 0, f.yaw, 0);
    const Y = 0xf2b705, D = 0x2e2e33;
    part(M.veh, 'box', Y, 0, 0.62, 0, 0, 0, 0, 1.2, 0.62, 1.7);
    part(M.veh, 'box', 0x3a3a40, 0, 0.72, -1.0, 0, 0, 0, 1.26, 0.82, 0.5);
    part(M.veh, 'box', 0x1d1d1d, 0, 1.0, -0.3, 0, 0, 0, 0.55, 0.12, 0.5);
    for (let sx = -1; sx <= 1; sx += 2) {
      part(M.veh, 'box', D, sx * 0.34, 1.45, 0.95, 0, 0, 0, 0.1, 2.5, 0.12);
      part(M.veh, 'cyl', D, sx * 0.52, 1.62, -0.72, 0, 0, 0, 0.07, 1.25, 0.07);
      part(M.veh, 'cyl', D, sx * 0.52, 1.62, 0.55, 0, 0, 0, 0.07, 1.25, 0.07);
      part(M.veh, 'cyl', 0x161616, sx * 0.64, 0.3, 0.55, 0, 0, Math.PI / 2, 0.58, 0.24, 0.58);
      part(M.veh, 'cyl', 0x161616, sx * 0.64, 0.26, -0.7, 0, 0, Math.PI / 2, 0.5, 0.22, 0.5);
      part(M.veh, 'box', 0xa0a4aa, sx * 0.25, f.lift, 1.62, 0, 0, 0, 0.12, 0.05, 1.15);
    }
    part(M.veh, 'box', D, 0, 2.26, -0.08, 0, 0, 0, 1.18, 0.07, 1.4);
    part(M.veh, 'box', D, 0, f.lift + 0.32, 1.05, 0, 0, 0, 0.92, 0.55, 0.06);
    part(M.veh, 'box', 0xb08850, 0, f.lift + 0.1, 1.65, 0, 0, 0, 1.1, 0.15, 1.1);
    const ld = f.load;
    part(M.veh, 'box', ld[2], 0, f.lift + 0.48, 1.65, 0, 0.05, 0, 1.0, 0.6, 1.0);
    if (near) {
      part(M.veh, 'box', ld[0], -0.2, f.lift + 1.0, 1.6, 0, 0.2, 0, 0.5, 0.45, 0.55);
      if (ld[3] > 0) part(M.veh, 'box', ld[1], 0.25, f.lift + 0.95, 1.75, 0, -0.1, 0, 0.42, 0.35, 0.42);
    }
    const on = Math.sin(f.flash * 9) > 0;
    part(M.veh, 'glow', on ? 0xff8a00 : 0x803800, 0, 2.4, -0.4, 0, 0, 0, 0.14, 0.14, 0.14);
    if (on && near) part(M.veh, 'glow', 0xffd080, 0, 2.4, -0.4, 0, 0, 0, 0.22, 0.05, 0.22);
    shadow(f.pos.x + Math.sin(f.yaw) * 0.45, f.pos.y, f.pos.z + Math.cos(f.yaw) * 0.45, 1.9, 4.2, f.yaw);
    drawPerson(f.driver, near, t);
  }
  function drawToss(o) {
    M.e.set(o.t * 9, o.t * 7, 0); M.q.setFromEuler(M.e);
    M.w.compose(M.p.set(o.x, o.y, o.z), M.q, M.s.set(0.18, 0.14, 0.22)); put('sph', M.w, FOOD_COL[o.food] || 0xffcc66);
  }

  function render() {
    const t = now();
    for (const k in MS) MS[k].n = 0;
    const cam = core.camera.position;
    const vis = (x, z) => { const d = Math.hypot(x - cam.x, z - cam.z); return d > 115 ? -1 : d < 40 ? 1 : 0; };
    let np = 0;
    const each = p => {
      if (p.dead) return;
      const v = vis(p.pos.x, p.pos.z); if (v < 0) return; np++;
      if (p.role === 'restock') drawLadder(p);
      if (p.veh) { if (p.veh.kind === 'cart') drawCart(p.veh, p, v > 0); else drawScooter(p.veh, v > 0, t); }
      drawPerson(p, v > 0, t);
    };
    shoppers.forEach(each); staff.forEach(each); guards.forEach(each);
    lifts.forEach(f => { const v = vis(f.pos.x, f.pos.z); if (v >= 0) { np++; drawLift(f, v > 0, t); } });
    tosses.forEach(drawToss);
    let inst = 0, calls = 0;
    for (const k in MS) {
      const o = MS[k], m = o.mesh; m.count = o.n; m.visible = o.n > 0; inst += o.n; if (o.n) calls += (o.ol ? 2 : 1) + (m.castShadow ? 1 : 0);
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      if (o.ol) { o.ol.count = o.n; o.ol.visible = o.n > 0; }
    }
    stats.inst = inst; stats.people = np; stats.calls = calls;
  }

  // ── public API ─────────────────────────────────────────────────────────────
  P.init = function (c) {
    core = c; T = c.THREE; C = BR.config;
    cv = new T.Vector3();
    M = { e: new T.Euler(), q: new T.Quaternion(), p: new T.Vector3(), s: new T.Vector3(), d: new T.Vector3(), end: new T.Vector3(), hL: new T.Vector3(), hR: new T.Vector3(),
      l: new T.Matrix4(), w: new T.Matrix4(), root: new T.Matrix4(), hip: new T.Matrix4(), head: new T.Matrix4(), veh: new T.Matrix4() };
    col.c = new T.Color();
    buildMeshes(); buildGrid(); populate(); hook(); ready = true;
    for (let i = 0; i < 3; i++) animateAll(0.05, player());
    render();
  };
  function animateAll(dt, pl) {
    const t = now();
    shoppers.forEach(p => pose(p, dt, t, pl)); staff.forEach(p => pose(p, dt, t, pl)); guards.forEach(p => pose(p, dt, t, pl));
    lifts.forEach(f => pose(f.driver, dt, t, pl));
  }
  P.reset = function () {
    if (!ready) return;
    if (!G.built) buildGrid();
    populate();
    stealthT = 0; caughtLatch = false; flowT = 0; P._pend = null; P._overT = 0; lastW = 0; spawnT = 0.5; lastAnn = now() - 8; idleAnnT = R(35, 50);
    for (let i = 0; i < 3; i++) animateAll(0.05, player());
    render();
  };
  P.update = function (dt, c) {
    if (!ready) return;
    core = c; const t0 = performance.now(); frameN++;
    const pl = player();
    stealthT = Math.max(0, stealthT - dt);
    for (let i = clouds.length - 1; i >= 0; i--) { clouds[i].t -= dt; if (clouds[i].t <= 0) clouds.splice(i, 1); }
    updGuardCount(dt, pl);
    flowT -= dt;
    if (guards.length && pl && flowT <= 0) { flowT = 0.5; buildFlow(pl.x, pl.z); }
    // shoppers far from the player think at a third of the rate (LOD)
    shoppers.forEach(p => {
      p.acc += dt;
      const far = pl && Math.abs(p.pos.x - pl.x) + Math.abs(p.pos.z - pl.z) > 60;
      if (far && (frameN + p.id) % 3) return;
      updShopper(p, Math.min(p.acc, 0.1), pl); p.acc = 0;
    });
    staff.forEach(p => updStaff(p, dt, pl));
    guards.forEach(g => updGuard(g, dt, pl));
    if (guards.some(g => g.dead)) { guards = guards.filter(g => !g.dead); relist(); }
    // separation between walkers
    const walkers = shoppers.concat(guards, staff.filter(p => p.role !== 'restock' || p.state !== 'climb'));
    for (let i = 0; i < walkers.length; i++) {
      const a = walkers[i]; if (a.state === 'pile') continue;
      for (let j = i + 1; j < walkers.length; j++) {
        const b = walkers[j]; if (b.state === 'pile') continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, rr = a.radius + b.radius;
        if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
        const d = Math.hypot(dx, dz); if (d >= rr || d < 1e-4) continue;
        const push = (rr - d) * 0.5 / d; a.pos.x -= dx * push; a.pos.z -= dz * push; b.pos.x += dx * push; b.pos.z += dz * push;
      }
    }
    lifts.forEach(f => updLift(f, dt, pl, walkers));
    // free samples in flight
    for (let i = tosses.length - 1; i >= 0; i--) {
      const o = tosses[i]; o.t += dt; o.x += o.vx * dt; o.z += o.vz * dt; o.vy -= 18 * dt; o.y += o.vy * dt;
      if (o.y <= 0.3 && o.vy < 0) {
        tosses.splice(i, 1);
        if (ok('store') && BR.store.spawnFood) { try { BR.store.spawnFood(o.food, o.x, o.z); } catch (e) { /* store optional */ } }
      }
    }
    const pend = P._pend;
    if (pend && now() - pend.t > 9) P._pend = null;
    else if (pend && now() - lastAnn >= 12) announce(pend.cat);
    idleAnnT -= dt; if (idleAnnT <= 0) { idleAnnT = R(35, 55); announce('idle'); }
    animateAll(dt, pl);
    render();
    stats.ms = stats.ms * 0.9 + (performance.now() - t0) * 0.1;
  };
})();
