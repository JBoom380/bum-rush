// ─── STORE: BULKZILLA WAREHOUSE (world, collision, props, pickups, list items) ─
(function () {
  const C = BR.config, bus = BR.bus;
  const SB = C.STORE;
  let T = window.THREE, core, scene, LOW = false;

  const store = BR.store = {
    bounds: { minX: SB.minX, maxX: SB.maxX, minZ: SB.minZ, maxZ: SB.maxZ },
    spots: {}, listItems: [], props: [], pickups: null, ramps: [], spills: [],
  };

  // ── shared scratch ─────────────────────────────────────────────────────────
  let M4, Q, E, V, S3, COL, G, MAT;
  function mtx(x, y, z, sx, sy, sz, rx, ry, rz) {
    E.set(rx || 0, ry || 0, rz || 0); Q.setFromEuler(E); V.set(x, y, z); S3.set(sx, sy, sz);
    return M4.compose(V, Q, S3);
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ── geometry merger (position, normal, color, uv) ──────────────────────────
  function Merger() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; this.v = 0; }
  Merger.prototype.add = function (geo, m, hex) {
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, CA = geo.attributes.color;
    const nm = new T.Matrix3().getNormalMatrix(m), base = this.v, v = new T.Vector3();
    COL.setHex(hex == null ? 0xffffff : hex);
    for (let k = 0; k < P.count; k++) {
      v.fromBufferAttribute(P, k).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
      if (CA) this.c.push(CA.getX(k) * COL.r, CA.getY(k) * COL.g, CA.getZ(k) * COL.b); else this.c.push(COL.r, COL.g, COL.b);
      if (U) this.u.push(U.getX(k), U.getY(k)); else this.u.push(0, 0);
    }
    if (geo.index) { const I = geo.index.array; for (let k = 0; k < I.length; k++) this.i.push(base + I[k]); }
    else for (let k = 0; k < P.count; k++) this.i.push(base + k);
    this.v += P.count;
    return this;
  };
  // a flat textured/coloured quad; (nx,nz) is the facing, or 'up'
  Merger.prototype.quad = function (cx, cy, cz, w, h, nx, ny, nz, hex, u0, v0, u1, v1) {
    let rx, ry, rz, ux, uy, uz;
    if (ny) { rx = 1; ry = 0; rz = 0; ux = 0; uy = 0; uz = ny > 0 ? -1 : 1; } // lying flat, facing up; "up" of the quad = -z
    else { rx = nz; ry = 0; rz = -nx; ux = 0; uy = 1; uz = 0; }
    const hw = w / 2, hh = h / 2, b = this.v;
    COL.setHex(hex == null ? 0xffffff : hex);
    const pts = [[-1, -1, u0 || 0, v0 || 0], [1, -1, u1 == null ? 1 : u1, v0 || 0], [1, 1, u1 == null ? 1 : u1, v1 == null ? 1 : v1], [-1, 1, u0 || 0, v1 == null ? 1 : v1]];
    for (const q of pts) {
      this.p.push(cx + rx * hw * q[0] + ux * hh * q[1], cy + ry * hw * q[0] + uy * hh * q[1], cz + rz * hw * q[0] + uz * hh * q[1]);
      this.n.push(nx, ny, nz); this.c.push(COL.r, COL.g, COL.b); this.u.push(q[2], q[3]);
    }
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3); this.v += 4;
    return this;
  };
  Merger.prototype.build = function () {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.v > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  };
  // box by centre / by bottom
  function bx(m, x, y, z, sx, sy, sz, c, ry) { m.add(G.box, mtx(x, y, z, sx, sy, sz, 0, ry || 0, 0), c); }
  function bb(m, x, y0, z, sx, sy, sz, c, ry) { bx(m, x, y0 + sy / 2, z, sx, sy, sz, c, ry); }
  function cyl(m, x, y, z, r, h, c, rx, rz) { m.add(G.cyl, mtx(x, y, z, r * 2, h, r * 2, rx || 0, 0, rz || 0), c); }
  function sph(m, x, y, z, sx, sy, sz, c) { m.add(G.sph, mtx(x, y, z, sx, sy, sz), c); }

  // ── collision: AABB grid ───────────────────────────────────────────────────
  const boxes = []; // {x0,z0,x1,z1,h}
  const CELL = 4, GW = Math.ceil((SB.maxX - SB.minX) / CELL), GH = Math.ceil((SB.maxZ - SB.minZ) / CELL);
  let grid = null, stamp = 0, stamps = null;
  function solid(x0, z0, x1, z1, h) { boxes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h: h == null ? 30 : h }); }
  const cx = x => clamp(Math.floor((x - SB.minX) / CELL), 0, GW - 1), cz = z => clamp(Math.floor((z - SB.minZ) / CELL), 0, GH - 1);
  function buildGrid() {
    grid = []; for (let k = 0; k < GW * GH; k++) grid.push([]);
    boxes.forEach((b, i) => {
      for (let gx = cx(b.x0); gx <= cx(b.x1); gx++) for (let gz = cz(b.z0); gz <= cz(b.z1); gz++) grid[gz * GW + gx].push(i);
    });
    stamps = new Uint32Array(boxes.length);
  }
  const NOHIT = { hit: false, normal: null };
  store.collide = function (pos, radius) {
    if (!pos || !grid) return NOHIT;
    const r = radius || 0.5, y = pos.y || 0, B = store.bounds;
    let hit = false, nx = 0, nz = 0;
    if (pos.x < B.minX + r) { pos.x = B.minX + r; nx += 1; hit = true; }
    if (pos.x > B.maxX - r) { pos.x = B.maxX - r; nx -= 1; hit = true; }
    if (pos.z < B.minZ + r) { pos.z = B.minZ + r; nz += 1; hit = true; }
    if (pos.z > B.maxZ - r) { pos.z = B.maxZ - r; nz -= 1; hit = true; }
    stamp++;
    const gx0 = cx(pos.x - r), gx1 = cx(pos.x + r), gz0 = cz(pos.z - r), gz1 = cz(pos.z + r);
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const cell = grid[gz * GW + gx];
      for (let k = 0; k < cell.length; k++) {
        const i = cell[k]; if (stamps[i] === stamp) continue; stamps[i] = stamp;
        const b = boxes[i]; if (y > b.h) continue;
        const qx = clamp(pos.x, b.x0, b.x1), qz = clamp(pos.z, b.z0, b.z1);
        let dx = pos.x - qx, dz = pos.z - qz; const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), push = r - d; dx /= d; dz /= d; pos.x += dx * push; pos.z += dz * push; }
        else {
          const l = pos.x - b.x0, rr = b.x1 - pos.x, f = pos.z - b.z0, kk = b.z1 - pos.z, m = Math.min(l, rr, f, kk);
          if (m === l) { dx = -1; dz = 0; pos.x = b.x0 - r; } else if (m === rr) { dx = 1; dz = 0; pos.x = b.x1 + r; }
          else if (m === f) { dx = 0; dz = -1; pos.z = b.z0 - r; } else { dx = 0; dz = 1; pos.z = b.z1 + r; }
        }
        nx += dx; nz += dz; hit = true;
      }
    }
    if (!hit) return NOHIT;
    const len = Math.hypot(nx, nz) || 1;
    return { hit: true, normal: new T.Vector3(nx / len, 0, nz / len) };
  };
  // true when a circle at (x,z) overlaps a solid (no push)
  store.blocked = function (x, z, r, y) {
    const p = { x, y: y || 0, z }; const h = store.collide(p, r || 0.5); return h.hit;
  };

  // ── ramps, spills ──────────────────────────────────────────────────────────
  // ramp: rises from 0 at the 'low' edge to h at the 'high' edge along axis; beyond the high edge the floor drops (a jump).
  function ramp(x0, z0, x1, z1, h, dir) { store.ramps.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h, dir }); }
  store.floorAt = function (x, z) {
    let y = 0;
    const R = store.ramps;
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      let t;
      if (r.dir === 'n') t = (r.z1 - z) / (r.z1 - r.z0); else if (r.dir === 's') t = (z - r.z0) / (r.z1 - r.z0);
      else if (r.dir === 'w') t = (r.x1 - x) / (r.x1 - r.x0); else if (r.dir === 'e') t = (x - r.x0) / (r.x1 - r.x0); else t = 1;
      const hh = r.h * clamp(t, 0, 1); if (hh > y) y = hh;
    }
    return y;
  };
  store.frictionAt = function (x, z) {
    const S = store.spills;
    for (let i = 0; i < S.length; i++) { const s = S[i], dx = x - s.x, dz = z - s.z; if (dx * dx + dz * dz < s.r * s.r) return 0.15; }
    return 1;
  };
  store.inCheckout = function (p) {
    const z = store.spots.checkoutZone; if (!p || !z) return false;
    return Math.abs(p.x - z.x) <= z.w / 2 && Math.abs(p.z - z.z) <= z.d / 2;
  };

  // ── textures ───────────────────────────────────────────────────────────────
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function texOf(c, repeat) {
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = LOW ? 1 : 4;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    return t;
  }
  function concreteTex() {
    const c = canvas(256, 256), x = c.getContext('2d'), r = BR.rng(7);
    x.fillStyle = '#a7aaae'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) { const g = 150 + (r() * 40) | 0; x.fillStyle = `rgba(${g},${g},${g + 4},0.35)`; x.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3); }
    for (let i = 0; i < 6; i++) { const gr = x.createRadialGradient(r() * 256, r() * 256, 2, r() * 256, r() * 256, 90); gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); }
    x.fillStyle = 'rgba(70,70,76,0.55)'; x.fillRect(0, 0, 256, 2); x.fillRect(0, 0, 2, 256);
    return texOf(c, true);
  }
  function boxTex() {
    const c = canvas(128, 128), x = c.getContext('2d');
    x.fillStyle = '#e9e9e9'; x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#d0d0d0'; x.fillRect(0, 0, 128, 12); x.fillRect(0, 116, 128, 12);
    x.fillStyle = '#ffffff'; x.beginPath(); x.roundRect ? x.roundRect(18, 28, 92, 60, 10) : x.rect(18, 28, 92, 60); x.fill();
    x.fillStyle = '#8a8a8a'; x.fillRect(28, 40, 56, 9); x.fillRect(28, 56, 72, 5); x.fillRect(28, 66, 40, 5);
    x.fillStyle = '#bdbdbd'; x.beginPath(); x.arc(96, 44, 9, 0, 7); x.fill();
    x.fillStyle = '#c9c9c9'; x.fillRect(58, 0, 12, 12);
    return texOf(c);
  }
  function softTex() {
    const c = canvas(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return texOf(c);
  }

  // ── sign atlas ─────────────────────────────────────────────────────────────
  const SIGNS = [
    ['BULKZILLA WAREHOUSE', '#e8352b', '#ffd23f', '#7a120c'],
    ['CHECKOUT', '#ffd23f', '#d6211a', '#7a4a00'],
    ['🥦 PRODUCE', '#3aa84a', '#ffffff', '#16541e'],
    ['🥖 BAKERY', '#e7a95a', '#5a2d0c', '#7a4a1c'],
    ['🍗 MEAT & DELI', '#c8242c', '#ffffff', '#5e0a0e'],
    ['❄ FROZEN', '#8fd8ff', '#0b4f8c', '#2a6fa8'],
    ['📺 ELECTRONICS', '#6a3fd0', '#ffffff', '#2c1470'],
    ['🌻 HOME & GARDEN', '#2fae8f', '#ffffff', '#0e5444'],
    ['🧸 TOYS', '#ff4fa3', '#ffffff', '#8a1455'],
    ['🍿 BULK SNACKS', '#ff8a1c', '#ffffff', '#8a3a00'],
    ['✚ PHARMACY', '#ffffff', '#1c9a4a', '#1c9a4a'],
    ['TIRES & AUTO', '#222222', '#ffd23f', '#ffd23f'],
    ['🌭 HOT DOGS • FOOD COURT', '#d6211a', '#ffffff', '#ffd23f'],
    ['FREE SAMPLES!', '#ff6fb5', '#ffffff', '#ffd23f'],
    ['LOADING DOCK', '#ffd23f', '#111111', '#111111'],
    ['🥫 CANNED GOODS', '#c0392b', '#fff4d6', '#5e140c'],
    ['🧻 PAPER GOODS', '#3b82f6', '#ffffff', '#123a8a'],
    ['🧽 HOUSEHOLD', '#14b8a6', '#ffffff', '#085a52'],
    null, // lane numbers
    null, // ENTRANCE | EXIT
  ];
  const ROWS = SIGNS.length, ROWH = 128;
  let atlasTex;
  function drawAtlas() {
    const s = LOW ? 0.5 : 1, c = canvas(1024 * s, ROWS * ROWH * s), x = c.getContext('2d');
    x.scale(s, s); x.textAlign = 'center'; x.textBaseline = 'middle';
    const font = n => `900 ${n}px "Arial Black", "Segoe UI Black", Impact, "Segoe UI Emoji", sans-serif`;
    function fitText(t, w, n) { x.font = font(n); while (x.measureText(t).width > w && n > 20) { n -= 4; x.font = font(n); } }
    SIGNS.forEach((s0, k) => {
      const y = k * ROWH;
      if (s0) {
        const [t, bg, fg, edge] = s0;
        x.fillStyle = edge; x.fillRect(0, y, 1024, ROWH);
        x.fillStyle = bg; x.fillRect(8, y + 8, 1008, ROWH - 16);
        if (k === 14) { x.fillStyle = '#111'; for (let i = -2; i < 34; i++) { x.beginPath(); x.moveTo(i * 34, y + 8); x.lineTo(i * 34 + 16, y + 8); x.lineTo(i * 34 + 16 - 20, y + 28); x.lineTo(i * 34 - 20, y + 28); x.fill(); } x.fillStyle = bg; x.fillRect(8, y + 30, 1008, ROWH - 60); }
        fitText(t, 960, 84);
        x.lineWidth = 10; x.strokeStyle = edge; x.lineJoin = 'round'; x.strokeText(t, 512, y + ROWH / 2 + 4);
        x.fillStyle = fg; x.fillText(t, 512, y + ROWH / 2 + 4);
      } else if (k === 18) {
        for (let i = 0; i < 12; i++) {
          const w = 1024 / 12; x.fillStyle = '#1b1b1b'; x.fillRect(i * w, y, w, ROWH);
          x.fillStyle = i % 2 ? '#ffd23f' : '#6fe36a'; x.beginPath(); x.arc(i * w + w / 2, y + 64, 38, 0, 7); x.fill();
          x.fillStyle = '#111'; x.font = font(56); x.fillText(String(i + 1), i * w + w / 2, y + 68);
        }
      } else {
        [['ENTRANCE', '#1c9a4a'], ['EXIT', '#d6211a']].forEach((e, i) => {
          x.fillStyle = '#111'; x.fillRect(i * 512, y, 512, ROWH); x.fillStyle = e[1]; x.fillRect(i * 512 + 6, y + 6, 500, ROWH - 12);
          x.fillStyle = '#fff'; x.font = font(80); x.fillText(e[0], i * 512 + 256, y + 68);
        });
      }
    });
    atlasTex = texOf(c); atlasTex.generateMipmaps = true;
  }
  function rowUV(k, a, b) { return [a == null ? 0 : a, 1 - (k + 1) / ROWS, b == null ? 1 : b, 1 - k / ROWS]; }
  // two-sided hanging sign along z (faces +z and -z) or a one-sided wall sign
  function sign(sm, k, x, y, z, w, twoSided, nx, nz, uvr) {
    const uv = uvr || rowUV(k), h = w * ROWH / ((uv[2] - uv[0]) * 1024);
    if (nx == null) { nx = 0; nz = 1; }
    sm.quad(x + nx * 0.09, y, z + nz * 0.09, w, h, nx, 0, nz, 0xffffff, uv[0], uv[1], uv[2], uv[3]);
    if (twoSided) sm.quad(x - nx * 0.09, y, z - nz * 0.09, w, h, -nx, 0, -nz, 0xffffff, uv[0], uv[1], uv[2], uv[3]);
    return h;
  }

  // ── TV screens (one animated canvas, 4x2 tiles) ────────────────────────────
  let tvCanvas, tvCtx, tvTex, tvT = 0;
  function drawTV(t) {
    const x = tvCtx, S = 128;
    for (let k = 0; k < 8; k++) {
      const ox = (k % 4) * S, oy = Math.floor(k / 4) * S;
      x.save(); x.beginPath(); x.rect(ox, oy, S, S); x.clip(); x.translate(ox, oy);
      switch (k) {
        case 0: for (let i = 0; i < 8; i++) { x.fillStyle = `hsl(${(i * 45 + t * 120) % 360},90%,55%)`; x.beginPath(); x.moveTo(64, 64); x.arc(64, 64, 120, t * 1.5 + i * 0.785, t * 1.5 + (i + 1) * 0.785); x.fill(); } break;
        case 1: { x.fillStyle = '#6ec8ff'; x.fillRect(0, 0, S, S); x.fillStyle = '#5bd05b'; x.fillRect(0, 100, S, 28); const by = 90 - Math.abs(Math.sin(t * 3)) * 60, bx0 = 64 + Math.sin(t * 1.3) * 40; x.fillStyle = '#ffd23f'; x.beginPath(); x.arc(bx0, by, 18, 0, 7); x.fill(); x.fillStyle = '#111'; x.fillRect(bx0 - 7, by - 6, 4, 5); x.fillRect(bx0 + 3, by - 6, 4, 5); x.beginPath(); x.arc(bx0, by + 2, 8, 0.2, 2.9); x.stroke(); break; }
        case 2: for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = ((i + j + Math.floor(t * 3)) % 2) ? `hsl(${(t * 90) % 360},90%,60%)` : `hsl(${(t * 90 + 180) % 360},90%,50%)`; x.fillRect(i * 32, j * 32, 32, 32); } break;
        case 3: { x.fillStyle = '#ffe9a8'; x.fillRect(0, 0, S, S); const s = 1 + Math.sin(t * 5) * 0.1; x.fillStyle = '#7bbf3a'; for (let i = 0; i < 5; i++) { x.beginPath(); x.arc(64 + Math.cos(i * 1.26) * 28 * s, 70 + Math.sin(i * 1.26) * 22 * s, 24 * s, 0, 7); x.fill(); } x.fillStyle = '#fff'; x.beginPath(); x.arc(54, 64, 9, 0, 7); x.arc(76, 64, 9, 0, 7); x.fill(); x.fillStyle = '#111'; x.beginPath(); x.arc(56 + Math.sin(t * 4) * 3, 65, 4, 0, 7); x.arc(78 + Math.sin(t * 4) * 3, 65, 4, 0, 7); x.fill(); break; }
        case 4: for (let i = 6; i > 0; i--) { x.fillStyle = `hsl(${(i * 50 - t * 200) % 360},95%,58%)`; x.beginPath(); x.arc(64, 64, i * 14 + (t * 30) % 14, 0, 7); x.fill(); } break;
        case 5: for (let i = 0; i < 10; i++) { x.fillStyle = `hsl(${(i * 36 + t * 60) % 360},85%,55%)`; x.beginPath(); x.moveTo(0, i * 16 - 16); for (let u = 0; u <= S; u += 8) x.lineTo(u, i * 16 - 16 + Math.sin(u * 0.08 + t * 4 + i) * 8); x.lineTo(S, S + 20); x.lineTo(0, S + 20); x.fill(); } break;
        case 6: { x.fillStyle = Math.floor(t * 4) % 2 ? '#d6211a' : '#ffd23f'; x.fillRect(0, 0, S, S); x.fillStyle = Math.floor(t * 4) % 2 ? '#ffd23f' : '#d6211a'; x.font = '900 40px Arial Black, Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('SALE!', 64, 64); break; }
        case 7: { x.fillStyle = '#2b2b60'; x.fillRect(0, 0, S, S); for (let i = 0; i < 20; i++) { x.fillStyle = '#fff'; x.fillRect((i * 37 + t * 50) % S, (i * 53) % S, 2, 2); } const px = ((t * 80) % 200) - 40; x.fillStyle = '#c9ced6'; x.fillRect(px, 60, 34, 20); x.fillStyle = '#e8352b'; x.fillRect(px + 30, 52, 6, 10); x.fillStyle = '#8b5a2b'; for (let i = 0; i < 4; i++) { x.globalAlpha = 0.7 - i * 0.15; x.beginPath(); x.arc(px - 10 - i * 14, 70 + Math.sin(t * 9 + i) * 3, 7 + i * 3, 0, 7); x.fill(); } x.globalAlpha = 1; break; }
      }
      x.restore();
    }
    tvTex.needsUpdate = true;
  }
  function tvUV(k) { const u = (k % 4) / 4, v = 1 - (Math.floor(k / 4) + 1) / 2; return [u + 0.004, v + 0.004, u + 0.246, v + 0.496]; }

  // ── layout constants ───────────────────────────────────────────────────────
  const RACK_X = [-52, -44, -36, -28, -20, 20, 28, 36, 44, 52];
  const BLOCKS = [{ z0: -40, z1: -10 }, { z0: 2, z1: 28 }];
  const PALETTE = {
    snacks: [0xff7a1a, 0xffd23f, 0xe8352b, 0xff4fa3, 0x8bd14a, 0xffb347],
    canned: [0xc0392b, 0x27ae60, 0xf1c40f, 0xe67e22, 0x2e86de, 0xffffff],
    paper: [0xffffff, 0x9fd3ff, 0xffc4e1, 0xd7f5c0, 0x3b82f6, 0xfff3a8],
    house: [0x8e44ad, 0x14b8a6, 0x2e86de, 0xff6fb5, 0x55efc4, 0xfdcb6e],
  };
  function blockPal(rx, bi) { return rx < 0 ? (bi ? PALETTE.canned : PALETTE.paper) : (bi ? PALETTE.snacks : PALETTE.house); }

  // ── statics ────────────────────────────────────────────────────────────────
  function buildStatics() {
    const st = new Merger(), gl = new Merger(), rf = new Merger(), rg = new Merger(), mk = new Merger(), sg = new Merger(), tv = new Merger();
    const rng = BR.rng(1234);
    const W = 180, D = 120, H = SB.ceiling;

    // walls: lower red band, yellow stripe, pale upper with ribs
    const wall = (x, z, w, d) => { bb(st, x, 0, z, w, H, d, 0xd5dbe3); };
    wall(0, -60.5, 182, 1); wall(0, 60.5, 182, 1); wall(-90.5, 0, 1, 122); wall(90.5, 0, 1, 122);
    bb(st, 0, 0, -59.9, 180, 3, 0.2, 0xe8352b); bb(st, 0, 3, -59.9, 180, 0.4, 0.22, 0xffd23f);
    bb(st, -90 + 0.1, 0, 0, 0.2, 3, 120, 0xe8352b); bb(st, -89.9, 3, 0, 0.22, 0.4, 120, 0xffd23f);
    bb(st, 89.9, 0, 0, 0.2, 3, 120, 0xe8352b); bb(st, 89.9, 3, 0, 0.22, 0.4, 120, 0xffd23f);
    bb(st, -48, 0, 59.9, 84, 3, 0.2, 0xe8352b); bb(st, 48, 0, 59.9, 84, 3, 0.2, 0xe8352b); bb(st, 0, 3, 59.9, 180, 0.4, 0.22, 0xffd23f);
    for (let x = -88; x <= 88; x += 4) { bb(st, x, 3.4, -59.85, 0.3, 10.6, 0.3, 0xbfc6cf); if (Math.abs(x) > 8) bb(st, x, 3.4, 59.85, 0.3, 10.6, 0.3, 0xbfc6cf); }
    for (let z = -56; z <= 56; z += 4) { bb(st, -89.85, 3.4, z, 0.3, 10.6, 0.3, 0xbfc6cf); bb(st, 89.85, 3.4, z, 0.3, 10.6, 0.3, 0xbfc6cf); }
    // entrance: glowing glass doors (daylight) and frames
    for (let i = -3; i <= 2; i++) { gl.quad(i * 2.4 + 1.2, 2, 59.85, 2.2, 4, 0, 0, -1, 0xcff0ff); bb(st, i * 2.4, 0, 59.8, 0.2, 4.2, 0.3, 0x5a6470); }
    bb(st, 0, 4.1, 59.8, 15, 0.4, 0.4, 0x5a6470);
    sign(sg, 19, 0, 5.3, 59.7, 5, false, 0, -1, [0, 1 - 20 / ROWS, 0.5, 1 - 19 / ROWS]);
    // brand banners
    sign(sg, 0, 0, 10, -59.75, 48, false, 0, 1); sign(sg, 0, 0, 10, 59.75, 30, false, 0, -1);
    sign(sg, 0, -89.75, 10, 0, 40, false, 1, 0); sign(sg, 0, 89.75, 10, 0, 40, false, -1, 0);

    // ceiling, trusses, ducts, light banks, skylights
    bb(rf, 0, H, 0, W + 2, 0.3, D + 2, 0x7c8591);
    for (let z = -54; z <= 54; z += 12) bb(rf, 0, H - 1.2, z, W, 0.5, 0.25, 0x5f6975);
    for (let x = -84; x <= 84; x += 12) bb(rf, x, H - 0.6, 0, 0.25, 0.5, D, 0x5f6975);
    [-60, -30, 30, 60].forEach(x => cyl(rf, x, H - 2.2, 0, 0.7, D, 0xb9c1c9, Math.PI / 2));
    for (let x = -84; x <= 84; x += 8) for (let z = -54; z <= 54; z += 7) {
      bb(rf, x, H - 1.75, z, 0.9, 0.12, 4.6, 0x9aa3ad); rg.add(G.box, mtx(x, H - 1.85, z, 0.6, 0.1, 4.2), 0xfdfcf2);
    }
    for (let x = -72; x <= 72; x += 24) for (let z = -48; z <= 48; z += 24) { rg.quad(x, H - 0.1, z, 6, 6, 0, -1, 0, 0xcfefff); bb(rf, x, H - 0.4, z, 6.6, 0.3, 0.3, 0x5f6975); }

    // pillars (yellow/black striped bases)
    const pillars = [[-20, -11], [20, -11], [-52, -11], [52, -11], [-20, 30], [20, 30], [-52, 30], [52, 30], [-72, -11], [72, -11], [-72, 30], [72, 30], [-72, -26], [72, -26], [-86, 15], [86, 15], [-36, -44], [36, -44]];
    pillars.forEach(([x, z]) => {
      bb(st, x, 0, z, 0.8, H, 0.8, 0x8f9aa6);
      for (let k = 0; k < 4; k++) bb(st, x, k * 0.4, z, 0.9, 0.4, 0.9, k % 2 ? 0x111111 : 0xffd23f);
      solid(x - 0.45, z - 0.45, x + 0.45, z + 0.45);
    });

    // floor markings
    const Y1 = 0.012;
    const rect = (x0, z0, x1, z1, c, y) => mk.quad((x0 + x1) / 2, y || Y1, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(z1 - z0), 0, 1, 0, c);
    function hatch(x0, z0, x1, z1, alongX) {
      rect(x0, z0, x1, z1, 0x111111, 0.008);
      if (alongX) for (let x = x0; x < x1 - 0.4; x += 1.2) rect(x, z0, x + 0.6, z1, 0xffd23f, 0.011);
      else for (let z = z0; z < z1 - 0.4; z += 1.2) rect(x0, z, x1, z + 0.6, 0xffd23f, 0.011);
    }
    // department floor patches
    for (let x = -88; x < -56; x += 2) for (let z = -40; z < -10; z += 2) rect(x, z, x + 2, z + 2, ((x + z) / 2) % 2 ? 0x9fd89a : 0x86c97f, 0.006);
    rect(-88, 2, -56, 28, 0xe9cf9f, 0.006);
    rect(56, -40, 88, -10, 0x4b56b8, 0.006);
    rect(56, 2, 88, 28, 0x7fcf5c, 0.006);
    for (let x = -16; x < 16; x += 4) for (let z = -40; z < -12; z += 4) rect(x, z, x + 4, z + 4, [0xff9ec9, 0x9ed8ff, 0xfff09e, 0xb9f59e][((x + z) / 4 + 40) % 4], 0.006);
    for (let x = -88; x < -52; x += 2) for (let z = 36; z < 58; z += 2) rect(x, z, x + 2, z + 2, ((x + z) / 2) % 2 ? 0xffffff : 0xe8554b, 0.006);
    rect(-44, -58, 24, -48, 0xc8ecff, 0.006);
    rect(54, 36, 88, 58, 0x6d737a, 0.006);
    rect(-7, 55, 7, 60, 0x33383f, 0.009);
    // aisle lines along every rack face
    RACK_X.forEach(rx => BLOCKS.forEach(b => { rect(rx - 1.75, b.z0 - 0.5, rx - 1.6, b.z1 + 0.5, 0xffd23f); rect(rx + 1.6, b.z0 - 0.5, rx + 1.75, b.z1 + 0.5, 0xffd23f); }));
    // forklift lanes: cross aisle + back aisle + power aisle (hatched edges, dashed centre)
    [[-10, 2], [-48, -40.5], [29, 40]].forEach(([z0, z1]) => {
      hatch(-88, z0, 88, z0 + 0.5, true); hatch(-88, z1 - 0.5, 88, z1, true);
      for (let x = -86; x < 86; x += 4) rect(x, (z0 + z1) / 2 - 0.08, x + 2, (z0 + z1) / 2 + 0.08, 0xffffff);
    });
    // runway: big arrows pointing north
    for (let z = 26; z > 4; z -= 7) { rect(-0.6, z - 2, 0.6, z, 0xffffff); mk.add(G.tri, mtx(0, Y1, z - 2.4, 3.2, 0.01, 2.4, 0, Math.PI / 2, 0), 0xffffff); }
    // queue lines at the checkouts
    for (let x = -42; x <= 42; x += 6) if (Math.abs(x) > 8) rect(x - 0.08, 40.5, x + 0.08, 43.5, 0xffffff);

    // ── racks
    const prodM = [], prodC = [];
    function product(x, y0, z, sx, sy, sz, c) { prodM.push(mtx(x, y0 + sy / 2, z, sx, sy, sz, 0, 0, 0).clone()); prodC.push(c); }
    const levels = [0.16, 2.3, 4.5, 6.7, 8.9];
    RACK_X.forEach(rx => BLOCKS.forEach((b, bi) => {
      const L = b.z1 - b.z0, zc = (b.z0 + b.z1) / 2, bays = Math.round(L / 3), bay = L / bays, pal = blockPal(rx, bi);
      for (let k = 0; k <= bays; k++) { const z = b.z0 + k * bay; bb(st, rx - 1.1, 0, z, 0.18, 10.2, 0.18, 0x2f6fd6); bb(st, rx + 1.1, 0, z, 0.18, 10.2, 0.18, 0x2f6fd6); bx(st, rx, 5, z, 2.2, 0.1, 0.1, 0x2f6fd6); }
      levels.slice(1).forEach(y => { bx(st, rx - 1.1, y - 0.1, zc, 0.16, 0.26, L, 0xff7a1a); bx(st, rx + 1.1, y - 0.1, zc, 0.16, 0.26, L, 0xff7a1a); bx(st, rx, y - 0.2, zc, 2.1, 0.05, L, 0x8d949c); });
      solid(rx - 1.3, b.z0 - 0.15, rx + 1.3, b.z1 + 0.15);
      levels.forEach((y, li) => {
        if (LOW && li > 3) return;
        for (let k = 0; k < bays; k++) for (const side of [-1, 1]) {
          const z0 = b.z0 + k * bay + 0.12, x = rx + side * 0.52;
          if (li === 4) { product(x, y, z0 + bay / 2 - 0.06, 1.0, 1.1 + rng() * 0.5, bay * 0.8, 0xc89b62); continue; }
          if (li === 0) product(x, y - 0.14, z0 + bay / 2 - 0.06, 1.05, 0.14, bay - 0.3, 0x9b6a3c);
          const n = LOW ? 1 : 1 + (rng() * 2.4 | 0), w = (bay - 0.3) / n, c = pal[rng() * pal.length | 0];
          if (rng() < 0.08) continue;
          for (let j = 0; j < n; j++) {
            const hgt = 0.7 + rng() * (li === 0 ? 1.2 : 1.1);
            product(x, y, z0 + w * (j + 0.5), 0.95, hgt, w * 0.92, rng() < 0.7 ? c : pal[rng() * pal.length | 0]);
          }
        }
      });
    }));

    // ── end caps (static displays where no knockable props go)
    RACK_X.forEach(rx => BLOCKS.forEach((b, bi) => {
      [b.z0 - 1.3, b.z1 + 1.3].forEach((z, ei) => {
        if (endcapProps.some(e => e.x === rx && Math.abs(e.z - z) < 0.1)) return;
        const pal = blockPal(rx, bi), c = pal[(Math.abs(rx) + ei * 3 + bi) % pal.length];
        bb(st, rx, 0, z, 2.2, 0.15, 2, 0x9b6a3c);
        for (let i = 0; i < 3; i++) bb(st, rx + (i - 1) * 0.72, 0.15, z, 0.66, 1.3 + (i % 2) * 0.4, 1.6, pal[(i + ei) % pal.length]);
        bb(st, rx, 2, z + (ei ? 0.9 : -0.9), 2.2, 0.8, 0.08, c);
        solid(rx - 1.15, z - 1.05, rx + 1.15, z + 1.05, 1.9);
      });
    }));

    // ── department dressing
    // Produce bins with piles of fruit
    const fruitM = [], fruitC = [];
    const fruit = (x, y, z, s, c, sy) => { fruitM.push(mtx(x, y, z, s, s * (sy || 1), s).clone()); fruitC.push(c); };
    const FR = [0xe8352b, 0xff9f1c, 0xffe14d, 0x7ac943, 0x3f9b3a, 0x8e44ad];
    [-80, -66].forEach((x, i) => [-34, -25, -16].forEach((z, j) => {
      bb(st, x, 0, z, 4, 0.9, 2.4, 0x9b6a3c); bb(st, x, 0.9, z, 4.1, 0.12, 2.5, 0x6f4a26);
      const c = FR[(i * 3 + j) % FR.length], big = c === 0x3f9b3a;
      for (let k = 0; k < (LOW ? 14 : 30); k++) fruit(x + (rng() - 0.5) * 3.4, 1.05 + rng() * 0.35, z + (rng() - 0.5) * 1.9, big ? 0.55 : 0.32, c, big ? 0.8 : 1);
      solid(x - 2.05, z - 1.25, x + 2.05, z + 1.25, 1.2);
    }));
    // misting bar over produce
    bb(st, -73, 3.2, -25, 0.2, 0.2, 22, 0x9aa3ad);
    // Bakery: tables with loaves and cakes, a counter on the west wall
    [[-78, 8], [-66, 8], [-78, 20], [-66, 20]].forEach(([x, z], i) => {
      bb(st, x, 0, z, 4, 0.85, 2.2, 0xf3e3c3); bb(st, x, 0.85, z, 4.2, 0.08, 2.4, 0x8b5a2b);
      for (let k = 0; k < (LOW ? 6 : 12); k++) fruit(x + (rng() - 0.5) * 3.4, 1.1, z + (rng() - 0.5) * 1.6, 0.5, [0xc98a3c, 0xa8652a, 0xe0b060][k % 3], 0.6);
      if (i % 2) { cyl(st, x + 1.2, 1.1, z, 0.45, 0.35, 0xff9ec9); cyl(st, x + 1.2, 1.3, z, 0.47, 0.06, 0xffffff); }
      solid(x - 2.1, z - 1.2, x + 2.1, z + 1.2, 1.2);
    });
    bb(st, -87.5, 0, 15, 2.5, 1.2, 20, 0xe9d7b0); bb(st, -88.5, 1.2, 15, 1, 2.4, 20, 0xc98a3c); solid(-89, 5, -86.2, 25, 3);
    // Meat & Deli: glass counter along the north wall + rotisserie warmer
    bb(st, -66, 0, -52, 36, 1.0, 2, 0xf4f4f4); bb(st, -66, 0, -51.05, 36, 1.0, 0.1, 0xc8242c);
    gl.add(G.box, mtx(-66, 1.3, -52.3, 35.6, 0.6, 1.3), 0xdff6ff);
    for (let x = -83; x <= -49; x += 1.4) fruit(x, 1.1, -52.2, 0.5, [0xd9534f, 0xf08080, 0xb03a2e, 0xffb6a0][Math.abs(x | 0) % 4], 0.5);
    bb(st, -66, 0, -58.8, 36, 2.6, 2.2, 0xdfe4ea); bb(st, -66, 2.6, -58.8, 36, 0.2, 2.4, 0x8f9aa6);
    gl.add(G.box, mtx(-48.5, 1.8, -56.5, 3, 1.6, 1.4), 0xffa040);
    for (let i = 0; i < 6; i++) sph(st, -49.8 + (i % 3) * 1.1, 1.4 + (i / 3 | 0) * 0.7, -55.7, 0.55, 0.45, 0.5, 0x9c5a1e);
    solid(-84.2, -53.2, -47.8, -50.9, 1.35); solid(-84.2, -60, -47.8, -57.6, 3); solid(-50.2, -57.4, -46.8, -55.6, 3);
    // Frozen: glowing freezer-door wall + chest freezer islands
    for (let x = -42; x <= 22; x += 1.6) {
      bb(st, x, 0, -59.3, 0.18, 3.2, 0.5, 0x9aa3ad);
      gl.quad(x + 0.8, 1.7, -59.05, 1.4, 2.8, 0, 0, 1, 0xbfe6ff);
      for (let s = 0; s < 4; s++) gl.quad(x + 0.8, 0.7 + s * 0.7, -59.03, 1.1, 0.4, 0, 0, 1, [0xff8fb1, 0xfff3a8, 0x9ed8ff, 0xb9f59e, 0xffc48a][(s + Math.abs(x | 0)) % 5]);
      bb(st, x + 0.6, 1.4, -58.95, 0.06, 0.8, 0.1, 0xeeeeee);
    }
    bb(st, -10, 3.2, -59.3, 65, 0.6, 0.6, 0x2a6fa8); solid(-43, -60, 23, -58.8, 3.8);
    [-30, -10, 10].forEach(x => {
      bb(st, x, 0, -52, 12, 0.95, 2.4, 0xffffff); bb(st, x, 0.1, -50.78, 12, 0.3, 0.05, 0x2a6fa8);
      gl.add(G.box, mtx(x, 0.97, -52, 11.6, 0.04, 2.0), 0xd8f2ff);
      for (let k = 0; k < 14; k++) bb(st, x - 5.2 + k * 0.8, 0.95, -52 + ((k % 3) - 1) * 0.55, 0.6, 0.18, 0.45, [0xff8fb1, 0xfff3a8, 0x9ed8ff, 0xb9f59e, 0xffc48a, 0xd6a8ff][k % 6]);
      solid(x - 6.1, -53.3, x + 6.1, -50.7, 1.1);
    });
    // Pharmacy: counter, shelves, a glowing green cross
    bb(st, 38, 0, -52, 20, 1.1, 1.6, 0xffffff); bb(st, 38, 1.1, -52, 20.2, 0.08, 1.8, 0x1c9a4a);
    bb(st, 38, 0, -59, 20, 3, 1.4, 0xe9eef2);
    for (let k = 0; k < 3; k++) for (let x = 29; x < 47; x += 0.7) bb(st, x, 0.3 + k * 0.9, -58.4, 0.5, 0.5, 0.4, [0xff6fb5, 0x3b82f6, 0xffffff, 0xffd23f, 0x14b8a6][(k + Math.round(x * 3)) % 5]);
    gl.add(G.box, mtx(38, 5.5, -59.7, 3, 1, 0.2), 0x2bd66a); gl.add(G.box, mtx(38, 5.5, -59.7, 1, 3, 0.21), 0x2bd66a);
    solid(27.8, -52.9, 48.2, -51.1, 1.3); solid(27.8, -60, 48.2, -58.2, 3.2);
    // Loading dock: raised platform with a ramp, roll-up doors, pallets
    bb(st, 72, 0, -55, 30, 1.3, 10, 0x9ea4aa); bb(st, 72, 1.29, -50.2, 30, 0.02, 0.4, 0xffd23f);
    for (let i = 0; i < 3; i++) {
      const x = 62 + i * 10; bb(st, x, 1.3, -59.75, 7, 6, 0.3, 0x39424d);
      for (let k = 0; k < 12; k++) bb(st, x, 1.3 + k * 0.5, -59.55, 6.6, 0.08, 0.1, 0x6b7784);
      for (let k = 0; k < 8; k++) bb(st, x - 3.5 + k * 1, 7.3, -59.5, 0.5, 0.35, 0.1, k % 2 ? 0x111111 : 0xffd23f);
    }
    [[60, -57], [66, -56], [80, -57.5], [84, -55]].forEach(([x, z], i) => {
      bb(st, x, 1.3, z, 2.2, 0.18, 2.2, 0x9b6a3c);
      bb(st, x, 1.48, z, 2, 1.4 + (i % 2) * 0.8, 2, i % 2 ? 0xc89b62 : 0x3b82f6);
      solid(x - 1.1, z - 1.1, x + 1.1, z + 1.1, 3.5 + 1.3);
    });
    // ramp face up to the dock
    rampVisual(st, 57, -50, 87, -44, 1.3, 'n', 0x8d949c);
    ramp(57, -50, 87, -44, 1.3, 'n'); ramp(57, -60, 87, -50, 1.3, null);
    solid(56.6, -60, 57, -50, 1.2); solid(87, -60, 87.4, -50, 1.2);
    // Electronics: TV wall on the east wall + display tables
    let tvk = 0;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
      const z = -37 + col * 6.2, y = 2.2 + row * 3.4;
      bb(st, 89.55, y - 0.2, z, 0.3, 3.1, 5.6, 0x111111);
      tv.quad(89.35, y + 1.35, z, 5.2, 2.7, -1, 0, 0, 0xffffff, ...tvUV(tvk++ % 8));
    }
    [[70, -30], [70, -20], [78, -25]].forEach(([x, z], i) => {
      bb(st, x, 0, z, 5, 0.8, 1.6, 0x2c1470); bb(st, x, 0.8, z, 0.3, 0.6, 0.3, 0x222222);
      bb(st, x, 1.4, z, 4.2, 2.4, 0.18, 0x111111);
      tv.quad(x, 2.6, z + 0.1, 3.9, 2.1, 0, 0, 1, 0xffffff, ...tvUV((i * 3 + 1) % 8));
      tv.quad(x, 2.6, z - 0.1, 3.9, 2.1, 0, 0, -1, 0xffffff, ...tvUV((i * 3 + 2) % 8));
      solid(x - 2.55, z - 0.85, x + 2.55, z + 0.85, 3.8);
    });
    // Home & Garden: patio sets with umbrellas, grills, gnomes, a shed
    [[64, 8], [80, 8], [72, 18]].forEach(([x, z], i) => {
      cyl(st, x, 0.72, z, 1.1, 0.08, 0xffffff); cyl(st, x, 0.36, z, 0.08, 0.72, 0x555555);
      cyl(st, x, 1.5, z, 0.05, 3, 0xdddddd);
      st.add(G.cone, mtx(x, 3.2, z, 4, 0.9, 4), [0xff6f61, 0x2fae8f, 0xffd23f][i]);
      for (let k = 0; k < 4; k++) bb(st, x + Math.cos(k * 1.57) * 1.6, 0, z + Math.sin(k * 1.57) * 1.6, 0.6, 0.9, 0.6, 0x3b82f6);
      solid(x - 2, z - 2, x + 2, z + 2, 1.0);
    });
    for (let k = 0; k < 6; k++) { const x = 60 + k * 1.2, z = 25; cyl(st, x, 0.25, z, 0.22, 0.5, 0x3b82f6); sph(st, x, 0.62, z, 0.3, 0.3, 0.3, 0xffd9b3); sph(st, x, 0.66, z + 0.14, 0.24, 0.12, 0.1, 0xffffff); st.add(G.cone, mtx(x, 0.95, z, 0.34, 0.5, 0.34), 0xe8352b); }
    solid(59.3, 24.6, 66.7, 25.4, 1);
    bb(st, 85, 0, 22, 5, 3.2, 6, 0xb07a44); st.add(G.cone, mtx(85, 4.1, 22, 7.5, 1.8, 7.5, 0, Math.PI / 4, 0), 0x8c3a2e);
    bb(st, 82.45, 0, 22, 0.1, 2.2, 1.4, 0x6b3f1c); solid(82.4, 18.9, 87.6, 25.1);
    // Toys: the giant inflatable mascot sits on a pad; ball pit; toy box towers
    cyl(st, 0, 0.1, -27, 5, 0.2, 0x5b2bc9); solid(-3.2, -30.2, 3.2, -23.8);
    bb(st, 10, 0, -34, 5, 0.6, 5, 0xffd23f); solid(7.4, -36.6, 12.6, -31.4, 0.7);
    for (let k = 0; k < (LOW ? 30 : 80); k++) fruit(10 + (rng() - 0.5) * 4.4, 0.55 + rng() * 0.2, -34 + (rng() - 0.5) * 4.4, 0.36, FR[k % 6]);
    [[-10, -36], [-12, -18], [12, -17]].forEach(([x, z], i) => {
      for (let k = 0; k < 4; k++) bb(st, x + (k % 2) * 0.1, k * 1.1, z, 1.8, 1.1, 1.4, [0xff4fa3, 0x3b82f6, 0xffd23f, 0x7ac943][(k + i) % 4]);
      solid(x - 1, z - 0.8, x + 1.1, z + 0.8);
    });
    // Tires: tire racks along the east and south walls, a service counter
    for (let k = 0; k < 7; k++) for (let lvl = 0; lvl < (LOW ? 3 : 5); lvl++) {
      const x = 58 + k * 4, z = 57.5;
      cyl(st, x, 0.45 + lvl * 0.95, z, 0.45, 0.28, 0x2a2a2a, Math.PI / 2); cyl(st, x + 1.3, 0.45 + lvl * 0.95, z, 0.45, 0.28, 0x2a2a2a, Math.PI / 2);
    }
    bb(st, 72, 0, 58.2, 30, 0.2, 2.4, 0x555555); solid(56, 56.2, 88, 60);
    bb(st, 86, 0, 44, 2.6, 1.2, 10, 0x222222); bb(st, 86, 1.2, 44, 2.8, 0.1, 10.2, 0xffd23f); solid(84.6, 38.8, 87.4, 49.2, 1.4);
    // Food court + hot dog stand
    bb(st, -72, 0, 43, 12, 1.2, 3.5, 0xffffff); bb(st, -72, 0, 41.2, 12, 1.2, 0.1, 0xd6211a);
    for (let i = 0; i < 2; i++) bb(st, -77.8 + i * 11.6, 1.2, 43, 0.3, 2.6, 0.3, 0xdddddd);
    for (let k = 0; k < 8; k++) bb(st, -77.25 + k * 1.5, 3.8, 42.6, 1.5, 0.35, 4.4, k % 2 ? 0xffffff : 0xd6211a);
    bb(st, -72, 1.2, 44.4, 12, 2.6, 0.2, 0xfff4d6);
    // giant hot dog on the roof
    st.add(G.caps, mtx(-72, 5.1, 43, 1.25, 3.2, 0.9, 0, 0, Math.PI / 2), 0xe0a050);
    st.add(G.caps, mtx(-72, 5.65, 43, 0.75, 4.2, 0.75, 0, 0, Math.PI / 2), 0xc0442a);
    for (let k = 0; k < 7; k++) bx(st, -75.6 + k * 1.2, 6.35, 43 + (k % 2 ? 0.2 : -0.2), 1.3, 0.12, 0.18, 0xffd21a, k % 2 ? 0.5 : -0.5);
    gl.add(G.box, mtx(-72, 3.0, 44.25, 8, 1.1, 0.1), 0xffe28a);
    solid(-78.1, 41.1, -65.9, 44.9, 3.8);
    [[-82, 50], [-74, 50], [-66, 50], [-82, 56], [-74, 56], [-66, 56], [-58, 53]].forEach(([x, z]) => {
      bb(st, x, 0.7, z, 3.6, 0.12, 1.6, 0xd6211a); bb(st, x, 0, z, 0.2, 0.7, 1.2, 0x555555);
      bb(st, x, 0.4, z - 1.2, 3.6, 0.1, 0.5, 0xffd23f); bb(st, x, 0.4, z + 1.2, 3.6, 0.1, 0.5, 0xffd23f);
      solid(x - 1.8, z - 1.45, x + 1.8, z + 1.45, 0.85);
    });
    // Checkout lanes: counters, belts, registers, numbered lane lights
    let lane = 0;
    for (let x = -42; x <= 42; x += 6) {
      if (Math.abs(x) < 8) continue;
      bb(st, x, 0, 46.5, 1.1, 1.0, 5, 0xd0d4da); bb(st, x, 0.05, 46.5, 1.12, 0.35, 5.02, 0x2e86de);
      bb(st, x, 1.0, 45.6, 0.8, 0.06, 3.2, 0x222222);
      bb(st, x, 1.0, 48.4, 0.7, 0.5, 0.6, 0x3a3f46); gl.add(G.box, mtx(x, 1.52, 48.3, 0.5, 0.04, 0.4), 0xff3030);
      bb(st, x + 0.5, 1.0, 49.2, 0.12, 2.6, 0.12, 0x9aa3ad);
      bb(st, x - 0.9, 0, 44.2, 0.5, 1.4, 1.2, 0x8e44ad);
      for (let k = 0; k < 3; k++) bb(st, x - 0.9, 0.2 + k * 0.4, 44.2, 0.52, 0.2, 1.1, [0xff4fa3, 0xffd23f, 0x7ac943][k]);
      const u = 1 / 12;
      sg.quad(x + 0.5, 3.9, 49.2, 0.9, 0.9 * (ROWH / (1024 / 12)) * 1, 0, 0, -1, 0xffffff, lane * u, 1 - 19 / ROWS, (lane + 1) * u, 1 - 18 / ROWS);
      sg.quad(x + 0.5, 3.9, 49.2, 0.9, 0.9 * (ROWH / (1024 / 12)) * 1, 0, 0, 1, 0xffffff, lane * u, 1 - 19 / ROWS, (lane + 1) * u, 1 - 18 / ROWS);
      store.spots.checkouts.push({ name: 'Lane ' + (lane + 1), x: x + 3, z: 46.5 });
      lane = (lane + 1) % 12;
      solid(x - 0.6, 43.95, x + 0.6, 49.1, 1.1); solid(x - 1.2, 43.55, x - 0.6, 44.85, 1.5);
    }
    // the big CHECKOUT sign: yellow frame with chaser bulbs
    for (let s of [-1, 1]) { bb(st, s * 10, 9.6, 43, 0.1, H - 9.6, 0.1, 0x333333); }
    bx(st, 0, 8, 43, 22.6, 3.3, 0.14, 0xd6211a);
    sign(sg, 1, 0, 8, 43, 22, true);
    for (let k = 0; k < 24; k++) {
      const x = -11.1 + k * (22.2 / 23);
      gl.add(G.sph, mtx(x, 9.62, 43, 0.28, 0.28, 0.28), 0xffec80); gl.add(G.sph, mtx(x, 6.38, 43, 0.28, 0.28, 0.28), 0xffec80);
    }

    // ── hanging department signs
    const DSIGNS = [[2, -72, -25], [3, -72, 15], [4, -66, -46.5], [5, -10, -46.5], [10, 38, -46.5], [14, 72, -43], [6, 72, -25], [7, 72, 15], [8, 0, -12], [9, 36, 15], [15, -36, 15], [16, -36, -25], [17, 36, -25], [11, 71, 34], [12, -71, 34], [13, 0, 34]];
    DSIGNS.forEach(([k, x, z]) => {
      const w = 12, y = 11.2;
      bx(st, x, y, z, w + 0.3, w / 8 + 0.3, 0.14, 0x222222);
      bb(st, x - w * 0.4, y + w / 16, z, 0.06, H - y - w / 16, 0.06, 0x444444); bb(st, x + w * 0.4, y + w / 16, z, 0.06, H - y - w / 16, 0.06, 0x444444);
      sign(sg, k, x, y, z, w, true);
    });

    // ── pallet ramps (for jumps)
    rampVisual(st, -2.5, 16, 2.5, 23.5, 1.9, 'n', 0xc89b62); ramp(-2.5, 16, 2.5, 23.5, 1.9, 'n');
    rampVisual(st, -40, -6.5, -31, -1.5, 1.8, 'w', 0xc89b62); ramp(-40, -6.5, -31, -1.5, 1.8, 'w');
    rampVisual(st, 31, -6.5, 40, -1.5, 1.8, 'e', 0xc89b62); ramp(31, -6.5, 40, -1.5, 1.8, 'e');
    rampVisual(st, -64, 30, -58, 38, 1.5, 's', 0xc89b62); ramp(-64, 30, -58, 38, 1.5, 's');

    // ── spills (low friction)
    const SPILLS = [[-4, 31, 2.2], [26, -4, 2.4], [-62, -20, 2.2], [0, -46, 2.6], [-68, 47, 2], [66, 20, 2], [-24, 20, 1.8], [44, 34, 2.2]];
    SPILLS.forEach(([x, z, r], i) => {
      store.spills.push({ x, z, r });
      mk.add(G.disc, mtx(x, 0.018, z, r, 1, r * 0.85, 0, i, 0), 0x7fd4ff);
      mk.add(G.disc, mtx(x + r * 0.45, 0.02, z - r * 0.15, r * 0.55, 1, r * 0.4, 0, i * 2, 0), 0x9fe0ff);
      mk.add(G.disc, mtx(x - r * 0.2, 0.022, z - r * 0.2, r * 0.3, 1, r * 0.12, 0, 0.4, 0), 0xffffff);
    });

    // assemble
    const add = (m, mat, shadow) => { const mesh = new T.Mesh(m.build(), mat); mesh.matrixAutoUpdate = false; mesh.castShadow = !!shadow; mesh.receiveShadow = true; scene.add(mesh); return mesh; };
    add(st, MAT.toonVC, true);
    add(gl, MAT.glow);
    roof = [add(rf, MAT.toonVC), add(rg, MAT.glow)]; roof[0].receiveShadow = false;
    const mkMesh = add(mk, MAT.marks); mkMesh.castShadow = false;
    add(sg, MAT.sign).receiveShadow = false;
    add(tv, MAT.tv).receiveShadow = false;
    // rack products + fruit (instanced)
    const pim = new T.InstancedMesh(G.box, MAT.prod, prodM.length);
    prodM.forEach((m, i) => { pim.setMatrixAt(i, m); pim.setColorAt(i, COL.setHex(prodC[i])); });
    pim.castShadow = !LOW; pim.receiveShadow = true; pim.frustumCulled = false; scene.add(pim);
    const fim = new T.InstancedMesh(G.sph, MAT.toon, fruitM.length);
    fruitM.forEach((m, i) => { fim.setMatrixAt(i, m); fim.setColorAt(i, COL.setHex(fruitC[i])); });
    fim.frustumCulled = false; scene.add(fim);
    store._counts = { products: prodM.length, fruit: fruitM.length, staticVerts: st.v, boxes: boxes.length };
  }
  function rampVisual(m, x0, z0, x1, z1, h, dir, c) {
    const along = dir === 'n' || dir === 's', L = along ? z1 - z0 : x1 - x0, Wd = along ? x1 - x0 : z1 - z0;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, n = Math.max(3, Math.round(h / 0.33)), hh = h / n;
    // stacked pallets (steps) under an inclined plywood deck
    for (let k = 0; k < n - 1; k++) {
      const len = L * (1 - (k + 1) / n) + 0.05, y0 = k * hh;
      let px = mx, pz = mz;
      if (dir === 'n') pz = z0 + len / 2; else if (dir === 's') pz = z1 - len / 2; else if (dir === 'w') px = x0 + len / 2; else px = x1 - len / 2;
      const sx = along ? Wd : len, sz = along ? len : Wd;
      bb(m, px, y0, pz, sx, hh * 0.3, sz, 0x9b6a3c); bb(m, px, y0 + hh * 0.3, pz, sx * 0.9, hh * 0.4, sz * 0.9, 0x5a3a1c); bb(m, px, y0 + hh * 0.7, pz, sx, hh * 0.3, sz, c);
    }
    const ang = Math.atan2(h, L), len = Math.hypot(h, L);
    m.add(G.box, mtx(mx, h / 2 + 0.05, mz, along ? Wd : len, 0.1, along ? len : Wd, dir === 'n' ? ang : dir === 's' ? -ang : 0, 0, dir === 'e' ? ang : dir === 'w' ? -ang : 0), 0xd9b07a);
    // painted chevrons on the deck
    const qd = new T.Quaternion().setFromEuler(new T.Euler(dir === 'n' ? ang : dir === 's' ? -ang : 0, 0, dir === 'e' ? ang : dir === 'w' ? -ang : 0));
    for (let k = 1; k < 4; k++) {
      const f = k / 4 - 0.5, ddir = (dir === 'n' || dir === 'w') ? -1 : 1;
      for (const sd of [-1, 1]) {
        const loc = along ? new T.Vector3(sd * Math.min(Wd * 0.2, 0.95), 0.06, -ddir * f * len * -1) : new T.Vector3(-ddir * f * len * -1, 0.06, sd * Math.min(Wd * 0.2, 0.95));
        loc.applyQuaternion(qd).add(new T.Vector3(mx, h / 2 + 0.05, mz));
        const e2 = new T.Euler().setFromQuaternion(qd); const yaw = -(along ? (sd * (ddir > 0 ? -0.6 : 0.6)) : (sd * (ddir > 0 ? 0.6 : -0.6)) + Math.PI / 2);
        m.add(G.box, mtx(loc.x, loc.y, loc.z, Math.min(Wd * 0.42, 2.2), 0.02, 0.35, e2.x, yaw, e2.z), 0xffd23f);
      }
    }
    // yellow/black lip at the high end
    const lx = dir === 'w' ? x0 : dir === 'e' ? x1 : mx, lz = dir === 'n' ? z0 : dir === 's' ? z1 : mz;
    for (let k = 0; k < 6; k++) { const o = (k - 2.5) * Wd / 6; bb(m, along ? lx + o : lx, h, along ? lz : lz + o, along ? Wd / 6 : 0.3, 0.12, along ? 0.3 : Wd / 6, k % 2 ? 0x111111 : 0xffd23f); }
  }

  let roof = [];
  store.debugRoof = function (v) { roof.forEach(m => { m.visible = !!v; }); scene.fog = v ? store._fog || scene.fog : (store._fog = scene.fog, null); };

  // ── mascot (giant inflatable) ──────────────────────────────────────────────
  let mascot;
  function buildMascot() {
    const m = new Merger(), g = 0x3fcf5a, dg = 0x2a9a40, bel = 0xd8f7a0;
    sph(m, 0, 4.2, 0, 5.2, 6.4, 4.4, g); sph(m, 0, 3.9, 1.3, 3.6, 4.6, 2.4, bel);
    sph(m, 0, 8.4, 0.3, 3.8, 3.4, 3.6, g); sph(m, 0, 7.9, 1.9, 2.6, 1.7, 1.8, g);
    sph(m, -0.9, 9.5, 1.5, 1.2, 1.3, 1.1, 0xffffff); sph(m, 0.9, 9.5, 1.5, 1.2, 1.3, 1.1, 0xffffff);
    sph(m, -0.8, 9.45, 2.02, 0.5, 0.6, 0.3, 0x111111); sph(m, 0.8, 9.45, 2.02, 0.5, 0.6, 0.3, 0x111111);
    bx(m, 0, 7.55, 2.75, 1.8, 0.3, 0.2, 0x7a1d1d);
    for (let k = 0; k < 5; k++) m.add(G.cone, mtx(-0.7 + k * 0.35, 7.72, 2.8, 0.22, 0.3, 0.1, Math.PI, 0, 0), 0xffffff);
    for (let k = 0; k < 6; k++) m.add(G.cone, mtx(0, 10 - k * 1.3, -1.6 - Math.sin(k * 0.5) * 0.6, 0.9, 1.2, 0.5, -0.6 - k * 0.1, 0, 0), 0xa84fff);
    sph(m, -2.8, 5.2, 1, 1.1, 2.6, 1.1, g); sph(m, 2.8, 5.2, 1, 1.1, 2.6, 1.1, g);
    sph(m, -2.9, 6.4, 1.8, 1, 1, 1, g); sph(m, 2.9, 6.4, 1.8, 1, 1, 1, g);
    sph(m, -1.5, 0.8, 0.9, 1.8, 1.6, 2.6, dg); sph(m, 1.5, 0.8, 0.9, 1.8, 1.6, 2.6, dg);
    for (let k = 0; k < 5; k++) sph(m, 0, 1.4 + k * 0.1, -2.6 - k * 1.1, 1.8 - k * 0.3, 1.6 - k * 0.25, 1.6, g);
    // shopping cart hat + sash colours
    bx(m, 0, 10.35, 0.2, 2.6, 0.6, 2.2, 0xe8352b); bx(m, 0, 10.8, 0.2, 1.8, 0.4, 1.6, 0xffd23f);
    mascot = new T.Mesh(m.build(), MAT.toonVC); mascot.position.set(0, 0.2, -27); mascot.castShadow = true; scene.add(mascot);
  }

  // ── freezer mist ───────────────────────────────────────────────────────────
  let mist, mistData = [];
  function buildMist() {
    const n = LOW ? 24 : 60, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) mistData.push({ x: -42 + Math.random() * 64, z: -57 + Math.random() * 9, y: Math.random() * 1.2, s: 0.2 + Math.random() * 0.4 });
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    mist = new T.Points(g, new T.PointsMaterial({ map: softTex(), size: 3.2, color: 0xeaf7ff, transparent: true, opacity: 0.45, depthWrite: false, sizeAttenuation: true }));
    mist.frustumCulled = false; scene.add(mist);
  }
  function updateMist(dt) {
    if (!mist) return;
    const a = mist.geometry.attributes.position;
    mistData.forEach((p, i) => {
      p.y += p.s * dt * 0.4; p.x += Math.sin(p.y * 3 + i) * dt * 0.3; p.z += p.s * dt * 0.8;
      if (p.y > 1.8 || p.z > -44) { p.y = 0; p.z = -57 + Math.random() * 4; p.x = -42 + Math.random() * 64; }
      a.setXYZ(i, p.x, p.y + 0.2, p.z);
    });
    a.needsUpdate = true;
  }

  // ── physics props ──────────────────────────────────────────────────────────
  const bodies = [], groups = [], awake = [];
  const KINDS = {
    can: { geo: 'cyl', mat: 'prod' }, box: { geo: 'box', mat: 'prod' }, cone: { geo: 'cone', mat: 'toonVC' }, ball: { geo: 'sph', mat: 'toon' },
  };
  const PIM = {};
  let endcapProps = [];
  const MAX_AWAKE = 150;
  function body(g, shape, x, y, z, hx, hy, hz, color, ry) {
    const b = { g, shape, hx, hy, hz, r: shape === 'ball' ? hx : (hx + hy + hz) / 3, color,
      home: { x, y, z, q: new T.Quaternion().setFromEuler(new T.Euler(0, ry || 0, 0)) },
      p: new T.Vector3(x, y, z), v: new T.Vector3(), q: new T.Quaternion(), w: new T.Vector3(), awake: false, idle: 0, idx: -1 };
    b.q.copy(b.home.q); g.bodies.push(b); bodies.push(b); return b;
  }
  function group(kind, x, z, value, extra) {
    const g = Object.assign({ kind, x, z, r: 2, value, knocked: false, bodies: [] }, extra || {}); groups.push(g); return g;
  }
  function finishGroup(g) {
    let r = 0; g.bodies.forEach(b => { r = Math.max(r, Math.hypot(b.home.x - g.x, b.home.z - g.z) + b.r); }); g.r = r;
  }
  const CANC = [0xc0392b, 0x27ae60, 0xf1c40f, 0xe67e22, 0x2e86de, 0xb5541c];
  function canPyramid(x, z, rows, deep, kind, value, face) {
    const g = group(kind, x, z, value), rr = 0.24, hh = 0.56, c1 = CANC[(Math.abs(x * 7 + z * 3) | 0) % 6], c2 = CANC[(Math.abs(x * 3 + z * 11) + 2 | 0) % 6];
    for (let d = 0; d < deep; d++) for (let r = 0; r < rows; r++) {
      const n = rows - r;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * rr * 2.05, dd = (d - (deep - 1) / 2) * rr * 2.1;
        const px = face === 'x' ? x + dd : x + off, pz = face === 'x' ? z + off : z + dd;
        body(g, 'can', px, r * hh + hh / 2, pz, rr, hh / 2, rr, (r + i) % 3 === 0 ? c2 : c1);
      }
    }
    finishGroup(g); return g;
  }
  function boxTower(x, z, cols, rows, sx, sy, sz, colors, kind, value, face) {
    const g = group(kind, x, z, value);
    for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) {
      const off = (i - (cols - 1) / 2) * sx * 1.02;
      body(g, 'box', face === 'x' ? x : x + off, r * sy + sy / 2, face === 'x' ? z + off : z, sx / 2, sy / 2, sz / 2, colors[(r + i) % colors.length], face === 'x' ? Math.PI / 2 : 0);
    }
    finishGroup(g); return g;
  }
  function single(kind, shape, x, y, z, hx, hy, hz, color, value, ry) { const g = group(kind, x, z, value); body(g, shape, x, y, z, hx, hy, hz, color, ry); finishGroup(g); return g; }
  function balloons(x, z) {
    const g = group('balloons', x, z, 1, { floaty: true });
    const BC = [0xff4fa3, 0xffd23f, 0x3b82f6, 0x7ac943, 0xe8352b, 0xa84fff];
    for (let i = 0; i < (LOW ? 4 : 7); i++) body(g, 'ball', x + Math.cos(i * 2.4) * 0.5, 2.9 + (i % 3) * 0.5, z + Math.sin(i * 2.4) * 0.5, 0.38, 0.46, 0.38, BC[i % 6]);
    finishGroup(g); return g;
  }
  function buildProps() {
    // end caps: can pyramids, cereal towers, TP / paper-towel walls
    const plan = endcapProps;
    const CER = [0xffd23f, 0xe8352b, 0x3b82f6, 0xff7a1a, 0x8e44ad];
    const TPC = [0xffffff, 0xd8ecff, 0xffe0ef];
    plan.forEach(p => {
      if (p.x < 0 && p.bi === 0) boxTower(p.x, p.z, 3, LOW ? 3 : 4, 0.7, 0.62, 1.4, TPC, 'paper towels', 2);
      else if (p.x < 0) canPyramid(p.x, p.z, LOW ? 4 : 5, 1, 'can pyramid', 3);
      else if (p.bi === 0) boxTower(p.x, p.z, 3, LOW ? 3 : 5, 0.66, 0.9, 0.3, CER, 'cereal tower', 2);
      else canPyramid(p.x, p.z, LOW ? 4 : 5, 1, 'can pyramid', 3);
    });
    // the mega pyramid in the cross aisle (the jump landing)
    canPyramid(0, -4, LOW ? 6 : 8, LOW ? 1 : 2, 'mega pyramid', 6);
    canPyramid(-9, 12, 5, 1, 'can pyramid', 3); canPyramid(9, 12, 5, 1, 'can pyramid', 3);
    // TP walls in Home & Garden
    boxTower(62, 14, 4, 3, 0.8, 0.8, 0.8, TPC, 'tp wall', 2); if (!LOW) boxTower(82, 14, 4, 3, 0.8, 0.8, 0.8, TPC, 'tp wall', 2);
    // cereal towers in the runway
    boxTower(-12, 22, 2, 4, 0.66, 0.9, 0.3, CER, 'cereal tower', 2, 'x'); boxTower(12, 22, 2, 4, 0.66, 0.9, 0.3, CER, 'cereal tower', 2, 'x');
    // tire stacks
    [[64, 44], [72, 44], [80, 50]].forEach(([x, z]) => {
      const g = group('tire stack', x, z, 2);
      for (let k = 0; k < 5; k++) body(g, 'can', x, 0.14 + k * 0.28, z, 0.45, 0.14, 0.45, 0x2a2a2a);
      finishGroup(g);
    });
    // sample tables (red cloth) and cones / wet-floor signs at every spill
    (store.spots.samples || []).forEach(s => single('sample table', 'box', s.x, 0.45, s.z, 0.9, 0.45, 0.45, 0xe8352b, 2));
    store.spills.forEach((s, i) => {
      single('wet floor sign', 'box', s.x + s.r + 0.3, 0.45, s.z, 0.3, 0.45, 0.06, 0xffd23f, 1, i);
      for (let k = 0; k < (LOW ? 1 : 2); k++) { const a = i + k * 2.1; single('cone', 'cone', s.x + Math.cos(a) * (s.r + 0.6), 0.4, s.z + Math.sin(a) * (s.r + 0.6), 0.3, 0.4, 0.3, 0xffffff, 1); }
    });
    // a line of cones across the forklift lane + at the dock ramp
    for (let k = 0; k < 5; k++) single('cone', 'cone', -70 + k * 1.6, 0.4, -4, 0.3, 0.4, 0.3, 0xffffff, 1);
    for (let k = 0; k < 4; k++) single('cone', 'cone', 59 + k * 8, 0.4, -43, 0.3, 0.4, 0.3, 0xffffff, 1);
    // balloon bunches
    [[-6, 54], [6, 54], [-10, -20], [10, -22], [-60, 44], [66, 30]].forEach(([x, z], i) => { if (!LOW || i % 2 === 0) balloons(x, z); });

    // instanced meshes per shape
    Object.keys(KINDS).forEach(k => {
      const list = bodies.filter(b => b.shape === k); if (!list.length) return;
      const mesh = new T.InstancedMesh(G[KINDS[k].geo], MAT[KINDS[k].mat], list.length);
      list.forEach((b, i) => { b.idx = i; b.mesh = mesh; mesh.setColorAt(i, COL.setHex(b.color)); });
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh); PIM[k] = mesh;
    });
    store.props = groups;
    resetProps();
  }
  function writeBody(b) { b.mesh.setMatrixAt(b.idx, M4.compose(b.p, b.q, S3.set(b.hx * 2, b.hy * 2, b.hz * 2))); b.mesh.instanceMatrix.needsUpdate = true; }
  function resetProps() {
    awake.length = 0;
    bodies.forEach(b => { b.p.set(b.home.x, b.home.y, b.home.z); b.q.copy(b.home.q); b.v.set(0, 0, 0); b.w.set(0, 0, 0); b.awake = false; b.idle = 0; b.moved = false; if (b.mesh) writeBody(b); });
    groups.forEach(g => { g.knocked = false; });
  }
  function wake(b) { if (!b.awake) { b.awake = true; b.idle = 0; b.moved = true; awake.push(b); } }
  function knockGroup(g, px, pz, vx, vz, power, cause) {
    const first = !g.knocked; g.knocked = true;
    const sp = Math.hypot(vx, vz);
    g.bodies.forEach(b => {
      const dx = b.p.x - px, dz = b.p.z - pz, d = Math.hypot(dx, dz) || 0.01, k = Math.max(0, 1 - d / 3.5) * power;
      wake(b);
      b.v.x += vx * 0.7 * k + dx / d * (1 + 3 * k) + (Math.random() - 0.5) * 1.2;
      b.v.z += vz * 0.7 * k + dz / d * (1 + 3 * k) + (Math.random() - 0.5) * 1.2;
      b.v.y += (g.floaty ? 1 : 1.2 + 3.5 * k + sp * 0.12 * k) + Math.random() * 0.8;
      b.w.set((Math.random() - 0.5) * 12 * (0.3 + k), (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12 * (0.3 + k));
    });
    if (first) bus.emit('knock', { pos: new T.Vector3(g.x, 1, g.z), value: g.value, kind: g.kind, cause: cause || 'cart', count: g.bodies.length });
  }
  // external API: knock props near a point (a burrito blast, a forklift)
  store.blast = function (pos, radius, power) {
    if (!pos) return 0; let n = 0; const r = radius || 3, pw = power == null ? 1 : power;
    groups.forEach(g => {
      if (Math.hypot(g.x - pos.x, g.z - pos.z) > r + g.r) return;
      if (!g.knocked) { knockGroup(g, pos.x, pos.z, 0, 0, 1.2 * pw, 'blast'); n++; return; }
      g.bodies.forEach(b => { const dx = b.p.x - pos.x, dz = b.p.z - pos.z, d = Math.hypot(dx, dz); if (d < r) { wake(b); const k = (1 - d / r) * 6 * pw; b.v.x += dx / (d || 1) * k; b.v.z += dz / (d || 1) * k; b.v.y += k * 0.6; } });
    });
    return n;
  };
  const QA = new T.Quaternion(), VA = new T.Vector3(), UP = new T.Vector3(0, 1, 0), QB = new T.Quaternion(), VB = new T.Vector3(), MR = new T.Matrix4();
  function restHalf(b) {
    if (b.shape === 'ball') return b.hy;
    MR.makeRotationFromQuaternion(b.q); const e = MR.elements;
    return Math.abs(e[1]) * b.hx + Math.abs(e[5]) * b.hy + Math.abs(e[9]) * b.hz;
  }
  function snapFlat(b, k) {
    MR.makeRotationFromQuaternion(b.q); const e = MR.elements;
    const ay = [Math.abs(e[1]), Math.abs(e[5]), Math.abs(e[9])];
    let i = ay[0] > ay[1] ? 0 : 1; if (ay[2] > ay[i]) i = 2;
    const s = e[i * 4 + 1] > 0 ? 1 : -1;
    VA.set(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]).normalize();
    QA.setFromUnitVectors(VA, VB.set(0, s, 0));
    b.q.premultiply(QB.identity().slerp(QA, k)); b.q.normalize();
  }
  const HASH = new Map();
  function simProps(dt) {
    const c = cartInfo();
    // cart hits
    if (c) {
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const dxg = g.x - c.x, dzg = g.z - c.z, rg = g.r + c.r + 2;
        if (dxg * dxg + dzg * dzg > rg * rg && g.knocked === false) continue;
        for (let k = 0; k < g.bodies.length; k++) {
          const b = g.bodies[k], dx = b.p.x - c.x, dz = b.p.z - c.z, rr = b.r + c.r;
          if (dx * dx + dz * dz > rr * rr) continue;
          if (b.p.y - restHalf(b) > c.y + 1.4 || b.p.y + b.hy < c.y - 0.2) continue;
          if (!g.knocked) { if (c.speed > 0.6) { knockGroup(g, c.x, c.z, c.vx, c.vz, 1, 'cart'); } break; }
          if (c.speed > 0.8) {
            const d = Math.hypot(dx, dz) || 0.01; wake(b);
            b.v.x = c.vx * 1.1 + dx / d * 2; b.v.z = c.vz * 1.1 + dz / d * 2; b.v.y = 1.5 + c.speed * 0.25;
            b.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14);
          }
        }
      }
    }
    if (!awake.length) return;
    // cap the awake set: settle the oldest instantly
    while (awake.length > MAX_AWAKE) { const b = awake.shift(); settleNow(b); }
    // integrate
    const g = 18;
    for (let i = 0; i < awake.length; i++) {
      const b = awake[i], G0 = b.g.floaty ? -2.2 : g;
      b.v.y -= G0 * dt;
      if (b.g.floaty) { b.v.x *= 1 - dt * 0.8; b.v.z *= 1 - dt * 0.8; if (b.v.y > 3) b.v.y = 3; }
      b.p.addScaledVector(b.v, dt);
      const wl = b.w.length();
      if (wl > 1e-4) { QA.setFromAxisAngle(VA.copy(b.w).divideScalar(wl), wl * dt); b.q.premultiply(QA); }
    }
    // body-body separation (spatial hash, 1 m cells)
    HASH.clear();
    for (let i = 0; i < awake.length; i++) { const b = awake[i], key = ((b.p.x + 100) | 0) * 1000 + ((b.p.z + 100) | 0); let a = HASH.get(key); if (!a) HASH.set(key, a = []); a.push(b); }
    for (let i = 0; i < awake.length; i++) {
      const b = awake[i], bxk = (b.p.x + 100) | 0, bzk = (b.p.z + 100) | 0;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const a = HASH.get((bxk + ox) * 1000 + bzk + oz); if (!a) continue;
        for (let j = 0; j < a.length; j++) {
          const o = a[j]; if (o === b || o.idx < b.idx && o.shape === b.shape) continue;
          const dx = o.p.x - b.p.x, dy = o.p.y - b.p.y, dz = o.p.z - b.p.z, rr = (b.r + o.r) * 0.9, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2), pen = (rr - d) * 0.5, nx = dx / d, ny = dy / d, nz = dz / d;
          b.p.x -= nx * pen; b.p.y -= ny * pen; b.p.z -= nz * pen; o.p.x += nx * pen; o.p.y += ny * pen; o.p.z += nz * pen;
          const rv = (o.v.x - b.v.x) * nx + (o.v.y - b.v.y) * ny + (o.v.z - b.v.z) * nz;
          if (rv < 0) { const imp = -rv * 0.6; b.v.x -= nx * imp; b.v.y -= ny * imp; b.v.z -= nz * imp; o.v.x += nx * imp; o.v.y += ny * imp; o.v.z += nz * imp; }
        }
      }
    }
    // floor, walls, sleep
    const tmpP = { x: 0, y: 0, z: 0 };
    for (let i = awake.length - 1; i >= 0; i--) {
      const b = awake[i], hh = restHalf(b), fl = store.floorAt(b.p.x, b.p.z);
      if (b.g.floaty) {
        const top = SB.ceiling - 0.9;
        if (b.p.y > top) { b.p.y = top; b.v.y = 0; b.w.multiplyScalar(0.9); }
        if (b.p.y - hh < fl) { b.p.y = fl + hh; if (b.v.y < 0) b.v.y = 0; }
      } else if (b.p.y - hh < fl) {
        b.p.y = fl + hh;
        if (b.v.y < 0) b.v.y = b.v.y < -2 ? -b.v.y * 0.3 : 0;
        const fr = Math.max(0, 1 - dt * 5 * store.frictionAt(b.p.x, b.p.z));
        b.v.x *= fr; b.v.z *= fr; b.w.multiplyScalar(Math.max(0, 1 - dt * 4));
        if (b.v.lengthSq() < 1.5) snapFlat(b, Math.min(1, dt * 8));
      }
      tmpP.x = b.p.x; tmpP.z = b.p.z; tmpP.y = b.p.y - hh;
      const h = store.collide(tmpP, b.r * 0.8);
      if (h.hit) {
        b.p.x = tmpP.x; b.p.z = tmpP.z;
        const vn = b.v.x * h.normal.x + b.v.z * h.normal.z;
        if (vn < 0) { b.v.x -= 1.5 * vn * h.normal.x; b.v.z -= 1.5 * vn * h.normal.z; }
      }
      writeBody(b);
      const still = b.v.lengthSq() < 0.05 && b.w.lengthSq() < 0.2 && (b.g.floaty ? b.p.y >= SB.ceiling - 1 : b.p.y - hh <= fl + 0.02);
      b.idle = still ? b.idle + dt : 0;
      if (b.idle > 0.6 || b.p.y < -5) { if (b.p.y < -5) b.p.set(b.home.x, b.home.y, b.home.z); b.awake = false; b.v.set(0, 0, 0); b.w.set(0, 0, 0); awake.splice(i, 1); writeBody(b); }
    }
  }
  function settleNow(b) {
    b.awake = false; b.v.set(0, 0, 0); b.w.set(0, 0, 0);
    if (!b.g.floaty) { snapFlat(b, 1); b.p.y = store.floorAt(b.p.x, b.p.z) + restHalf(b); }
    writeBody(b);
  }
  function cartInfo() {
    const c = BR.cart; if (!c || !c.pos || core.state !== 'PLAY') return null;
    let vx = 0, vz = 0;
    if (c.vel && c.vel.x != null) { vx = c.vel.x; vz = c.vel.z || 0; }
    else { const s = c.speed || 0, y = c.yaw || 0; vx = -Math.sin(y) * s; vz = -Math.cos(y) * s; }
    const speed = Math.hypot(vx, vz);
    return { x: c.pos.x, y: c.pos.y || 0, z: c.pos.z, vx, vz, speed, r: (C.CART && C.CART.radius) || 0.7 };
  }

  // ── food pickups ───────────────────────────────────────────────────────────
  const food = [], FIM = {}, FCAP = 70;
  let ringIM;
  function foodGeo(type) {
    const m = new Merger();
    if (type === 'beans') {
      cyl(m, 0, 0, 0, 0.3, 0.72, 0xc8541e); cyl(m, 0, 0, 0, 0.305, 0.3, 0xfff1c8);
      cyl(m, 0, 0.38, 0, 0.31, 0.06, 0xd8dde3); cyl(m, 0, -0.38, 0, 0.31, 0.06, 0xd8dde3);
      sph(m, 0.12, 0.02, 0.27, 0.12, 0.08, 0.06, 0x8b3a12); sph(m, -0.06, -0.04, 0.29, 0.12, 0.08, 0.06, 0x8b3a12);
    } else if (type === 'hotdog') {
      m.add(G.caps, mtx(0, -0.05, 0.12, 0.34, 0.55, 0.3, 0, 0, Math.PI / 2), 0xe8b060); m.add(G.caps, mtx(0, -0.05, -0.12, 0.34, 0.55, 0.3, 0, 0, Math.PI / 2), 0xe8b060);
      m.add(G.caps, mtx(0, 0.1, 0, 0.24, 0.75, 0.24, 0, 0, Math.PI / 2), 0xc0442a);
      for (let k = 0; k < 6; k++) bx(m, -0.45 + k * 0.18, 0.24, k % 2 ? 0.05 : -0.05, 0.2, 0.05, 0.06, 0xffd21a, k % 2 ? 0.6 : -0.6);
    } else if (type === 'burrito') {
      m.add(G.caps, mtx(0, 0, 0, 0.5, 0.75, 0.5, 0, 0, Math.PI / 2 + 0.15), 0xf0d09a);
      cyl(m, 0.35, 0.05, 0, 0.27, 0.5, 0xd8dde3, 0, Math.PI / 2 + 0.15);
      sph(m, -0.72, -0.1, 0, 0.1, 0.36, 0.36, 0x8b4a1e); sph(m, -0.74, -0.05, 0.1, 0.08, 0.12, 0.12, 0x3aa040); sph(m, -0.74, -0.2, -0.08, 0.08, 0.12, 0.12, 0xe8352b);
    } else if (type === 'broccoli') {
      cyl(m, 0, -0.2, 0, 0.14, 0.55, 0x9ed36a);
      sph(m, 0, 0.22, 0, 0.62, 0.5, 0.62, 0x2f8f3a); sph(m, 0.25, 0.12, 0.1, 0.4, 0.36, 0.4, 0x3aa84a); sph(m, -0.24, 0.13, -0.08, 0.42, 0.36, 0.42, 0x3aa84a); sph(m, 0.02, 0.1, 0.27, 0.38, 0.34, 0.38, 0x2f8f3a); sph(m, -0.05, 0.1, -0.28, 0.38, 0.34, 0.38, 0x2f8f3a);
    } else {
      m.add(G.tri, mtx(0, 0, 0, 0.9, 0.42, 0.9, 0, 0.3, 0), 0xffd23a);
      [[0.1, 0.05, 0.2], [-0.15, -0.08, 0.12], [0.22, -0.1, -0.1], [-0.05, 0.1, -0.2]].forEach(p => sph(m, p[0], p[1] + 0.05, p[2], 0.14, 0.14, 0.14, 0xe0a800));
      // stink lines
      for (let k = 0; k < 3; k++) bx(m, -0.2 + k * 0.2, 0.45 + (k % 2) * 0.08, 0, 0.05, 0.28, 0.05, 0x9ed36a, 0);
    }
    return m.build();
  }
  function buildFood() {
    C.GAS_TYPES.forEach(t => {
      const mesh = new T.InstancedMesh(foodGeo(t), MAT.toonVC, FCAP); mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = !LOW; scene.add(mesh); FIM[t] = mesh;
    });
    ringIM = new T.InstancedMesh(new T.RingGeometry(0.55, 0.85, 24).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }), FCAP * 5);
    ringIM.count = 0; ringIM.frustumCulled = false; scene.add(ringIM);
  }
  function addFood(type, x, z, opt) {
    if (!FIM[type]) return null;
    const mesh = FIM[type]; let slot = -1;
    // reuse a dead temporary slot of this type
    for (let i = 0; i < food.length; i++) { const f = food[i]; if (f.type === type && f.dead) { slot = i; break; } }
    const f = { id: 'f' + (food.length + 1), type, gas: C.FOODS[type].gas, amount: C.FOODS[type].amount, name: C.FOODS[type].name,
      x, z, y0: (opt && opt.y) || (store.floorAt(x, z) + 0.8), y: 0, active: true, temp: !!(opt && opt.temp), respawnAt: 0, phase: Math.random() * 6.28, pop: 0, dead: false };
    f.y = f.y0 - 0.8;
    if (slot >= 0) { f.idx = food[slot].idx; f.ring = food[slot].ring; food[slot] = f; return f; }
    if (mesh.count >= FCAP) return null;
    f.idx = mesh.count++; f.ring = ringIM.count++; food.push(f);
    ringIM.setColorAt(f.ring, COL.set(C.FOODS[type].color).multiplyScalar(0.9));
    ringIM.instanceColor.needsUpdate = true;
    return f;
  }
  store.spawnFood = function (type, x, z, opt) {
    const t = C.FOODS[type] ? type : (C.FOODS[type && type.id] ? type.id : 'beans');
    return addFood(t, x, z, Object.assign({ temp: true }, opt || {}));
  };
  function take(f) {
    if (!f || !f.active) return false;
    f.active = false;
    if (f.temp) f.dead = true; else f.respawnAt = (core ? core.time : 0) + 25;
    return true;
  }
  store.pickups = {
    list: food,
    nearest(pos, r) {
      let best = null, bd = (r == null ? 1.5 : r); bd *= bd;
      for (let i = 0; i < food.length; i++) {
        const f = food[i]; if (!f.active) continue;
        const dx = f.x - pos.x, dz = f.z - pos.z, d = dx * dx + dz * dz;
        if (d < bd && (pos.y == null || Math.abs((pos.y || 0) + 0.8 - f.y0) < 2)) { bd = d; best = f; }
      }
      return best;
    },
    inRange(pos, r) { const out = []; for (const f of food) if (f.active && Math.hypot(f.x - pos.x, f.z - pos.z) < r) out.push(f); return out; },
    take,
    radius: 1.4,
    autoEat: true, // the store feeds BR.cart.eat(food) when the cart drives over food, unless the cart took it first
  };
  function placeInitialFood() {
    const r = BR.rng(99);
    const put = (t, x, z, y) => { const f = addFood(t, x, z, y ? { y } : null); if (f) f.home = true; };
    for (let k = 0; k < 6; k++) put('hotdog', -77 + k * 2, 38.5);
    put('burrito', -60, 50); put('burrito', -86, 58); put('hotdog', -70, 53); put('hotdog', -78, 53);
    const mix = ['beans', 'hotdog', 'broccoli', 'cheese', 'burrito', 'beans'];
    (store.spots.samples || []).forEach((s, i) => { for (let k = 0; k < 3; k++) put(mix[(i + k) % 5 === 4 && k !== 1 ? 0 : (i + k) % 5], s.x - 1.6 + k * 1.6, s.z + 1.6); });
    [[-73, -30], [-73, -20], [-59, -34], [-59, -16], [-86, -25]].forEach(p => put('broccoli', p[0], p[1]));
    [[-80, -45], [-68, -45], [-56, -45], [-44, -45]].forEach(p => put('cheese', p[0], p[1]));
    [[-48, 8], [-40, 20], [-32, 12], [-24, 6], [-48, -30], [-32, -18]].forEach(p => put('beans', p[0], p[1]));
    [[32, 20], [48, 10], [24, 14]].forEach(p => put('beans', p[0], p[1]));
    put('cheese', -20, -45); put('cheese', 8, -45); put('burrito', -2, -56 + 9);
    put('burrito', 66, -54, 2.2); put('burrito', 80, -52, 2.2);
    put('beans', -6, -32); put('broccoli', 6, -40); put('hotdog', 14, -24);
    put('hotdog', 64, -34); put('hotdog', 80, -16);
    put('broccoli', 76, 4); put('broccoli', 60, 20);
    put('beans', 66, 50); put('beans', 78, 40);
    for (let k = 0; k < 4; k++) put(C.GAS_TYPES[(r() * 4) | 0], -80 + r() * 160, -8 + r() * 8);
    put('burrito', 0, 12, 3.4);
    put('hotdog', -35, -4, 2.6); put('hotdog', 35, -4, 2.6);
  }
  function resetFood() {
    food.forEach(f => { if (f.temp) { f.active = false; f.dead = true; } else { f.active = true; f.pop = 0; } });
  }
  const FQ = new T.Quaternion(), FE = new T.Euler(), FS = new T.Vector3(), FP = new T.Vector3();
  function updateFood(dt, t) {
    const c = cartInfo();
    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      if (!f.active && !f.dead && f.respawnAt && t >= f.respawnAt) { f.active = true; f.pop = 0; f.respawnAt = 0; }
      // auto-eat when the cart drives over it
      if (c && f.active && store.pickups.autoEat) {
        const dx = f.x - c.x, dz = f.z - c.z;
        if (dx * dx + dz * dz < 1.96 && Math.abs(c.y + 0.9 - f.y0) < 1.6) {
          take(f);
          if (BR.cart && typeof BR.cart.eat === 'function') BR.cart.eat(f);
          else bus.emit('eat', { food: f.type, gas: f.gas, amount: f.amount, pos: { x: f.x, y: f.y0, z: f.z } });
        }
      }
      const mesh = FIM[f.type];
      if (!f.active) { mesh.setMatrixAt(f.idx, M4.makeScale(0, 0, 0)); ringIM.setMatrixAt(f.ring, M4); continue; }
      f.pop = Math.min(1, f.pop + dt * 3);
      const popS = f.pop < 1 ? 1 + Math.sin(f.pop * Math.PI) * 0.5 : 1;
      const bounce = Math.abs(Math.sin(t * 3 + f.phase)), sq = 1 + (bounce < 0.15 ? (0.15 - bounce) * 1.6 : 0);
      FE.set(0.25 * Math.sin(t * 2 + f.phase), t * 2 + f.phase, 0); FQ.setFromEuler(FE);
      const s = 1.15 * popS * f.pop;
      FP.set(f.x, f.y0 - 0.1 + bounce * 0.45, f.z); FS.set(s * sq, s / sq, s * sq);
      mesh.setMatrixAt(f.idx, M4.compose(FP, FQ, FS));
      const rs = (1 + Math.sin(t * 5 + f.phase) * 0.15) * f.pop;
      FP.set(f.x, f.y0 - 0.77, f.z); FQ.identity(); FS.set(rs, 1, rs);
      ringIM.setMatrixAt(f.ring, M4.compose(FP, FQ, FS));
    }
    C.GAS_TYPES.forEach(t0 => { FIM[t0].instanceMatrix.needsUpdate = true; });
    ringIM.instanceMatrix.needsUpdate = true;
  }

  // ── shopping-list items ────────────────────────────────────────────────────
  const SLOTS = {
    'Electronics': [[66, -25], [64, -14], [80, -36]],
    'Home & Garden': [[72, 12], [64, 26], [78, 26]],
    'Meat & Deli': [[-66, -45], [-54, -45], [-78, -45]],
    'Bulk Snacks': [[24, 9], [32, 20], [40, 12], [48, 22], [24, 23], [40, 5]],
    'Tires': [[70, 50], [80, 42], [62, 51]],
    'Toys': [[-7, -21], [7, -38], [11, -26], [-8, -30]],
    'Bakery': [[-72, 14], [-60, 25], [-84, 4]],
    'Frozen': [[-20, -46], [0, -44], [18, -46]],
    'Produce': [[-73, -29], [-60, -25], [-86, -12]],
    'Pharmacy': [[38, -46], [30, -46], [46, -46]],
  };
  const itemGeoCache = {};
  function itemGeo(id) {
    if (itemGeoCache[id]) return itemGeoCache[id];
    const m = new Merger();
    switch (id) {
      case 'tv': bx(m, 0, 0.4, 0, 2.6, 1.5, 0.16, 0x111111); bx(m, 0, 0.4, 0.09, 2.4, 1.3, 0.02, 0x3fa9ff); bx(m, -0.6, 0.6, 0.1, 0.8, 0.5, 0.02, 0xff4fa3); bx(m, 0.5, 0.2, 0.1, 0.9, 0.4, 0.02, 0xffd23f); bx(m, 0, -0.45, 0, 0.2, 0.3, 0.2, 0x333333); bx(m, 0, -0.6, 0, 1, 0.06, 0.4, 0x333333); break;
      case 'tp': for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) cyl(m, (i - 1) * 0.42, -0.2 + j * 0.44, (k - 0.5) * 0.42, 0.2, 0.42, 0xffffff); bx(m, 0, 0, 0, 1.3, 0.3, 0.86, 0x3b82f6); break;
      case 'chicken': bx(m, 0, -0.35, 0, 1.2, 0.1, 0.9, 0x222222); sph(m, 0, 0, 0, 0.95, 0.65, 0.75, 0xb8651e); sph(m, 0.45, 0.05, 0.25, 0.5, 0.3, 0.3, 0xa0561a); sph(m, 0.45, 0.05, -0.25, 0.5, 0.3, 0.3, 0xa0561a); sph(m, 0.72, 0.1, 0.25, 0.14, 0.14, 0.14, 0xfff4e0); sph(m, 0.72, 0.1, -0.25, 0.14, 0.14, 0.14, 0xfff4e0); break;
      case 'mayo': cyl(m, 0, 0, 0, 0.45, 1.1, 0xfffbe8); cyl(m, 0, 0.62, 0, 0.36, 0.2, 0x2e86de); cyl(m, 0, 0, 0, 0.46, 0.5, 0xffd23f); sph(m, 0, 0.02, 0.44, 0.34, 0.24, 0.05, 0xe8352b); break;
      case 'tires': for (let k = 0; k < 4; k++) { m.add(G.torus, mtx(0, -0.45 + k * 0.3, 0, 1, 1, 1, Math.PI / 2, 0, 0), 0x222222); cyl(m, 0, -0.45 + k * 0.3, 0, 0.24, 0.2, 0xb9c1c9); } break;
      case 'teddy': sph(m, 0, -0.1, 0, 0.9, 1, 0.8, 0xa86a36); sph(m, 0, 0.1, 0.3, 0.55, 0.6, 0.3, 0xe8c08a); sph(m, 0, 0.7, 0, 0.75, 0.7, 0.7, 0xa86a36); sph(m, -0.3, 1.05, 0, 0.28, 0.28, 0.2, 0xa86a36); sph(m, 0.3, 1.05, 0, 0.28, 0.28, 0.2, 0xa86a36); sph(m, 0, 0.62, 0.32, 0.3, 0.22, 0.2, 0xe8c08a); sph(m, 0, 0.68, 0.42, 0.1, 0.08, 0.08, 0x111111); sph(m, -0.15, 0.82, 0.3, 0.08, 0.1, 0.06, 0x111111); sph(m, 0.15, 0.82, 0.3, 0.08, 0.1, 0.06, 0x111111); sph(m, -0.5, -0.05, 0.1, 0.35, 0.55, 0.35, 0xa86a36); sph(m, 0.5, -0.05, 0.1, 0.35, 0.55, 0.35, 0xa86a36); bx(m, 0, 0.35, 0.33, 0.4, 0.12, 0.08, 0xe8352b); break;
      case 'cake': bx(m, 0, -0.1, 0, 1.6, 0.45, 1.1, 0xff9ec9); bx(m, 0, 0.14, 0, 1.62, 0.06, 1.12, 0xffffff); for (let k = 0; k < 5; k++) { cyl(m, -0.6 + k * 0.3, 0.3, 0, 0.03, 0.3, 0x3b82f6); sph(m, -0.6 + k * 0.3, 0.5, 0, 0.08, 0.14, 0.08, 0xffc44a); } break;
      case 'icecream': cyl(m, 0, 0, 0, 0.55, 0.8, 0xffe0ef); cyl(m, 0, 0.44, 0, 0.57, 0.1, 0x8a4a2a); sph(m, 0, 0.55, 0, 0.7, 0.4, 0.7, 0xfff4d6); sph(m, 0.2, 0.7, 0.1, 0.3, 0.3, 0.3, 0xff6fb5); sph(m, 0, 0.9, 0, 0.14, 0.14, 0.14, 0xe8352b); break;
      case 'bananas': for (let k = 0; k < 5; k++) m.add(G.caps, mtx(-0.3 + k * 0.15, 0, 0, 0.16, 0.5, 0.16, 0, k * 0.15 - 0.3, -0.5 + k * 0.05 + (k - 2) * 0.15), 0xffd83a); sph(m, -0.05, 0.42, 0, 0.12, 0.12, 0.12, 0x6b4a1c); break;
      case 'pills': cyl(m, 0, 0, 0, 0.42, 1.0, 0xff6fb5); cyl(m, 0, 0.6, 0, 0.36, 0.22, 0xffffff); cyl(m, 0, 0, 0, 0.43, 0.45, 0xffffff); bx(m, 0, 0, 0.43, 0.3, 0.1, 0.02, 0x1c9a4a); bx(m, 0, 0, 0.43, 0.1, 0.3, 0.02, 0x1c9a4a); break;
      case 'chips': sph(m, 0, 0, 0, 1.2, 1.5, 0.45, 0xe8352b); bx(m, 0, 0.72, 0, 1.0, 0.1, 0.2, 0xe8352b); bx(m, 0, -0.72, 0, 1.0, 0.1, 0.2, 0xe8352b); sph(m, 0, 0.05, 0.2, 0.6, 0.45, 0.1, 0xffd23f); break;
      case 'grill': sph(m, 0, 0.2, 0, 1.1, 0.8, 0.8, 0x222222); bx(m, 0, 0.18, 0, 1.12, 0.06, 0.82, 0x555555); for (const s of [-1, 1]) cyl(m, s * 0.4, -0.45, 0, 0.05, 0.9, 0x555555); cyl(m, 0.75, -0.3, 0, 0.2, 0.55, 0xe8352b); cyl(m, 0, 0.62, 0, 0.05, 0.1, 0xb9c1c9); break;
      case 'soda': bx(m, 0, -0.15, 0, 1.4, 0.6, 1.0, 0xd6211a); bx(m, 0, -0.15, 0.51, 0.9, 0.25, 0.02, 0xffffff); for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) cyl(m, -0.5 + i * 0.33, 0.28, -0.3 + j * 0.3, 0.12, 0.28, 0xb9c1c9); break;
      case 'kayak': sph(m, 0, 0, 0, 0.8, 0.45, 3.2, 0xffd23f); sph(m, 0, 0.18, 0, 0.5, 0.2, 0.9, 0x222222); cyl(m, 0, 0.25, 0.6, 0.04, 2.2, 0x555555, 0, Math.PI / 2 - 0.2); break;
      default: bx(m, 0, 0, 0, 1, 1, 1, 0xffd23f);
    }
    return (itemGeoCache[id] = m.build());
  }
  const iconCache = {};
  function iconTex(icon, color) {
    if (iconCache[icon]) return iconCache[icon];
    const c = canvas(128, 128), x = c.getContext('2d');
    x.fillStyle = '#ffd23f'; x.beginPath(); x.arc(64, 64, 60, 0, 7); x.fill();
    x.fillStyle = '#ffffff'; x.beginPath(); x.arc(64, 64, 50, 0, 7); x.fill();
    x.font = '70px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    if (icon === '🛞') { x.strokeStyle = '#222'; x.lineWidth = 16; x.beginPath(); x.arc(64, 64, 28, 0, 7); x.stroke(); x.fillStyle = '#b9c1c9'; x.beginPath(); x.arc(64, 64, 14, 0, 7); x.fill(); }
    else if (icon === '🫙') { x.fillStyle = '#fffbe8'; x.strokeStyle = '#333'; x.lineWidth = 4; x.fillRect(40, 44, 48, 52); x.strokeRect(40, 44, 48, 52); x.fillStyle = '#2e86de'; x.fillRect(38, 32, 52, 14); x.fillStyle = '#ffd23f'; x.fillRect(40, 60, 48, 18); }
    else x.fillText(icon || '★', 64, 70);
    return (iconCache[icon] = texOf(c));
  }
  let beamMat, ringMat;
  function makeItemVisual(it) {
    const grp = new T.Group(); grp.position.set(it.x, 0, it.z);
    const mesh = new T.Mesh(itemGeo(it.id), MAT.toonVC); mesh.position.y = 1.5; mesh.castShadow = true; grp.add(mesh);
    const beam = new T.Mesh(G.beam, beamMat); beam.position.y = 7; grp.add(beam);
    const ring = new T.Mesh(G.ring, ringMat); ring.position.y = 0.04; grp.add(ring);
    const spr = new T.Sprite(new T.SpriteMaterial({ map: iconTex(it.icon), depthWrite: false })); spr.scale.set(1.5, 1.5, 1); spr.position.y = 3.4; grp.add(spr);
    it._vis = { grp, mesh, beam, ring, spr, t: 0, gone: 0 };
    scene.add(grp);
  }
  function clearItems() {
    store.listItems.forEach(it => { if (it._vis) { scene.remove(it._vis.grp); it._vis.spr.material.dispose(); } });
    store.listItems.length = 0;
  }
  store.setupRun = function (seed, list) {
    const rng = BR.rng((seed >>> 0) || 1);
    clearItems();
    const used = {};
    (list || []).forEach(entry => {
      const id = typeof entry === 'string' ? entry : entry && entry.id;
      const def = C.LIST_ITEMS.find(i => i.id === id) || (typeof entry === 'object' ? entry : null); if (!def) return;
      const slots = (SLOTS[def.dept] || SLOTS['Toys']).map((s, i) => ({ s, k: rng() + (used[def.dept + i] ? 10 : 0), i }));
      slots.sort((a, b) => a.k - b.k); const pick = slots[0]; used[def.dept + pick.i] = true;
      const it = { id: def.id, name: def.name, icon: def.icon, dept: def.dept, x: pick.s[0], z: pick.s[1], taken: false };
      makeItemVisual(it); store.listItems.push(it);
    });
    resetProps(); resetFood();
    return store.listItems;
  };
  store.takeItem = function (id) {
    const it = store.listItems.find(i => i.id === id && !i.taken); if (!it) return false;
    it.taken = true; if (it._vis) it._vis.gone = 0.0001;
    const out = { id: it.id, name: it.name, icon: it.icon, dept: it.dept, x: it.x, z: it.z, taken: true };
    bus.emit('collect', { item: out });
    return true;
  };
  function updateItems(dt, t) {
    const c = cartInfo();
    store.listItems.forEach((it, i) => {
      const v = it._vis; if (!v) return;
      if (!it.taken && c) {
        const dx = it.x - c.x, dz = it.z - c.z;
        if (dx * dx + dz * dz < 2.4 * 2.4 && c.y < 4) store.takeItem(it.id);
      }
      if (it.taken) {
        if (!v.grp.visible) return;
        v.gone += dt; const k = v.gone / 0.6;
        const cc = BR.cart && BR.cart.pos;
        if (cc) { v.grp.position.x += (cc.x - v.grp.position.x) * Math.min(1, dt * 8); v.grp.position.z += (cc.z - v.grp.position.z) * Math.min(1, dt * 8); }
        v.mesh.position.y = 1.5 + k * 2; v.mesh.scale.setScalar(Math.max(0.01, 1 + k * 0.6 - k * k * 1.6)); v.mesh.rotation.y += dt * 20;
        v.beam.visible = v.ring.visible = v.spr.visible = false;
        if (k >= 1) v.grp.visible = false;
        return;
      }
      v.mesh.rotation.y = t * 1.4 + i; v.mesh.position.y = 1.5 + Math.sin(t * 2.4 + i) * 0.25;
      v.spr.position.y = 3.5 + Math.sin(t * 3 + i) * 0.15;
      const p = 1 + Math.sin(t * 4 + i) * 0.12; v.ring.scale.set(p, 1, p);
      v.beam.material.opacity = 0.28 + Math.sin(t * 3) * 0.06;
    });
  }

  // ── init ───────────────────────────────────────────────────────────────────
  store.init = function (c) {
    core = c; T = c.THREE; scene = c.scene; LOW = c.quality === 'low';
    M4 = new T.Matrix4(); Q = new T.Quaternion(); E = new T.Euler(); V = new T.Vector3(); S3 = new T.Vector3(); COL = new T.Color();
    G = {
      box: new T.BoxGeometry(1, 1, 1), cyl: new T.CylinderGeometry(0.5, 0.5, 1, LOW ? 10 : 14), sph: new T.SphereGeometry(0.5, LOW ? 10 : 14, LOW ? 7 : 10),
      caps: new T.CapsuleGeometry(0.5, 1, 4, 10), tri: new T.CylinderGeometry(0.5, 0.5, 1, 3), disc: new T.CircleGeometry(1, 18).rotateX(-Math.PI / 2),
      torus: new T.TorusGeometry(0.42, 0.18, 8, 16), beam: new T.CylinderGeometry(0.8, 0.8, 14, 16, 1, true), ring: new T.RingGeometry(1.2, 1.7, 32).rotateX(-Math.PI / 2),
    };
    // cone with an orange/white band (vertex colours)
    G.cone = new T.ConeGeometry(0.5, 1, 14, 4);
    { const p = G.cone.attributes.position, cols = []; for (let i = 0; i < p.count; i++) { const y = p.getY(i); const w = y > -0.01 && y < 0.26; COL.setHex(w ? 0xffffff : 0xff6a10); cols.push(COL.r, COL.g, COL.b); } G.cone.setAttribute('color', new T.Float32BufferAttribute(cols, 3)); }
    const grad = new T.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, T.RedFormat); grad.minFilter = grad.magFilter = T.NearestFilter; grad.needsUpdate = true;
    drawAtlas();
    tvCanvas = canvas(512, 256); tvCtx = tvCanvas.getContext('2d'); tvTex = texOf(tvCanvas); drawTV(0);
    const floorMap = concreteTex(); floorMap.repeat.set(30, 20);
    MAT = {
      toonVC: new T.MeshToonMaterial({ vertexColors: true, gradientMap: grad }),
      toon: new T.MeshToonMaterial({ color: 0xffffff, gradientMap: grad }),
      prod: new T.MeshToonMaterial({ map: boxTex(), gradientMap: grad }),
      glow: new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      marks: new T.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      sign: new T.MeshBasicMaterial({ map: atlasTex, toneMapped: false }),
      tv: new T.MeshBasicMaterial({ map: tvTex, toneMapped: false }),
      floor: new T.MeshLambertMaterial({ map: floorMap, color: 0xffffff }),
    };
    beamMat = new T.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.3, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false });
    ringMat = new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false });

    const floor = new T.Mesh(new T.PlaneGeometry(180, 120), MAT.floor); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

    // spots
    const DEPTS = [['Produce', -72, -25], ['Bakery', -72, 15], ['Meat & Deli', -66, -46], ['Frozen', -10, -46], ['Pharmacy', 38, -46], ['Loading Dock', 72, -46],
      ['Electronics', 72, -25], ['Home & Garden', 72, 15], ['Toys', 0, -22], ['Bulk Snacks', 36, 15], ['Canned Goods', -36, 15], ['Paper Goods', -36, -25],
      ['Household', 36, -25], ['Tires', 71, 46], ['Hot Dog Stand', -72, 38], ['Food Court', -72, 52], ['Sample Stations', 0, 34]];
    Object.assign(store.spots, {
      entrance: { name: 'Entrance', x: 0, z: 56 }, start: { x: C.START.x, z: C.START.z, yaw: C.START.yaw },
      checkoutZone: { x: 0, z: 46.5, w: 88, d: 7 }, checkouts: [],
      departments: DEPTS.map(d => ({ name: d[0], x: d[1], z: d[2] })),
      samples: [{ name: 'Sample 1', x: -8, z: 34 }, { name: 'Sample 2', x: 8, z: 34 }, { name: 'Sample 3', x: -40, z: 35 }, { name: 'Sample 4', x: 40, z: 35 }, { name: 'Sample 5', x: -12, z: 6 }, { name: 'Sample 6', x: 12, z: 6 }],
      hotdog: { name: 'Hot Dog Stand', x: -72, z: 38 }, dock: { name: 'Loading Dock', x: 72, z: -52 },
      // walkable aisle centre lines (x fixed, z range) and forklift loops for people.js
      aisles: [-48, -40, -32, -24, 24, 32, 40, 48].flatMap(x => BLOCKS.map(b => ({ x, z0: b.z0, z1: b.z1 }))),
      forkliftRoutes: [
        [[-84, -4], [84, -4], [84, -44], [-84, -44]],
        [[-80, 34], [80, 34], [80, -4], [-80, -4]],
      ],
    });
    store.spots.departments.forEach(d => { store.spots[d.name] = d; });
    store.spills.length = 0; store.ramps.length = 0;
    // props first (end-cap plan decides which end caps stay static), statics use it
    planProps();
    buildStatics();
    buildGrid();
    buildMascot(); buildMist();
    buildProps();
    buildFood(); placeInitialFood();
    bus.on('fart', d => { if (d && d.pos && (d.type === 'burrito' || (d.power || 0) > 0.9)) store.blast(d.pos, 3.5, 1); });
  };
  function planProps() {
    const plan = [];
    RACK_X.forEach((rx, ri) => BLOCKS.forEach((b, bi) => [b.z0 - 1.3, b.z1 + 1.3].forEach((z, ei) => {
      if (LOW ? (ri + bi + ei) % 3 !== 0 : (ri + ei + bi) % 3 === 2) return;
      plan.push({ x: rx, z, bi, ei });
    })));
    endcapProps = plan;
  }

  store.update = function (dt, c) {
    const t = c.time;
    tvT += dt; if (tvT > (LOW ? 0.16 : 0.08)) { tvT = 0; drawTV(t); }
    if (mascot) { mascot.rotation.z = Math.sin(t * 1.1) * 0.05; mascot.rotation.y = Math.sin(t * 0.7) * 0.15; const s = 1 + Math.sin(t * 2.2) * 0.02; mascot.scale.set(1 / s, s, 1 / s); }
    updateMist(dt);
    updateFood(dt, t);
    updateItems(dt, t);
    simProps(Math.min(dt, 0.033));
  };

  store.debugInfo = function () {
    const r = core.renderer.info;
    return { calls: r.render.calls, tris: r.render.triangles, awake: awake.length, bodies: bodies.length, groups: groups.length, food: food.length, counts: store._counts };
  };
})();
