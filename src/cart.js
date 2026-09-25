// ─── CART: the man, the cart, arcade physics, gas and the fart VFX ──────────
(function () {
  const C = BR.config, bus = BR.bus, T = THREE;
  const TYPES = C.GAS_TYPES;
  const KICK = C.CART.kickSpeed, VMAX = C.CART.maxSpeed, RAD = C.CART.radius;

  // Handling and gas tuning (one place).
  const TN = {
    kickAccel: 7.5, brake: 15, revMax: 2.5, drag: 0.15, dragQ: 0.008,
    turn: 2.5, yawResp: 9, grip: 10, driftGrip: 2.2, driftTurn: 1.3, driftKeep: 0.6, driftSlip: 0.75, carveKeep: 0.85,
    tipG: 18, tipFill: 0.35, tipDrain: 1.6, crashWipe: 13,
    gAir: 11, restitution: 0.35, crashLoss: 0.82,
    beansAcc: 15, beansMax: 16, beansBurn: 0.3, beansMin: 0.8,
    hotdogDv: 10, hotdogCost: 0.5,
    burritoCost: 1, burritoDv: 13, burritoVy: 10.5, windup: 0.4, flame: 0.9,
    brocCost: 0.5, brocDv: 3, brocLife: 6.5,
    cheeseCost: 0.5, cheeseDv: 2,
  };
  const FART_COL = {
    beans: [0x7a6a2c, 0x5c4a22], hotdog: [0xe0b030, 0xc88a1c], burrito: [0xff6a1a, 0xc8321a],
    broccoli: [0x6bd13a, 0x2f9a2a], cheese: [0xfff3a0, 0xf2e070], squeak: [0xbfb58a, 0x9a9070],
  };

  const cart = BR.cart = {
    pos: new T.Vector3(C.START.x, 0, C.START.z), vel: new T.Vector3(), yaw: C.START.yaw, speed: 0,
    airborne: false, boosting: false, drifting: false, wipeout: false, stealth: 0,
    gas: { beans: 0, hotdog: 0, burrito: 0, broccoli: 0, cheese: 0 }, gasTotal: 0, gasSel: 'beans',
    group: null, tune: TN,
    init, update, reset, fart, eat, bump,
  };

  let core = null, scene = null, GRAD = null;
  const tmpV = new T.Vector3(), tmpV2 = new T.Vector3(), tmpQ = new T.Quaternion(), tmpM = new T.Matrix4(), tmpS = new T.Vector3(), tmpE = new T.Euler(), tmpC = new T.Color();
  const has = (m, fn) => BR[m] && typeof BR[m][fn] === 'function' && !(BR._broken && BR._broken[m]);
  const sfx = (n, o) => { if (has('audio', 'sfx')) BR.audio.sfx(n, o); };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Physics and animation state.
  const S = {
    yawRate: 0, vy: 0, tip: 0, tipSide: 1, wipeT: 0, wipeSide: 1, wipeImmune: 0, crashCd: 0,
    beansT: 0, beansHold: 0, beansEmit: 0, beansPuff: 0, burstT: 0, windT: 0, flameT: 0, fartCd: 0,
    kickPhase: 0, kicking: 0, chompT: 0, reliefT: 0, puffT: 0, bugT: 0, sadT: 0, hitT: 0,
    airT: 0, groundVy: 0, pitch: 0, lean: 0, roll: 0, squeakCd: 0, squealCd: 0, sparkT: 0, landT: 0,
    flap: 0, flapV: 0, wheelSpin: 0, swF: 0, swR: 0, clouds: [], shimmerT: 0, eatCd: 0, lastFood: null,
  };

  // ── Materials ──────────────────────────────────────────────────────────────
  function gradient() {
    const d = new Uint8Array([130, 200, 255]);
    const t = new T.DataTexture(d, 3, 1, T.RedFormat);
    t.minFilter = t.magFilter = T.NearestFilter; t.needsUpdate = true;
    return t;
  }
  const toon = (color, o) => new T.MeshToonMaterial(Object.assign({ color, gradientMap: GRAD }, o || {}));
  const OUTLINE = new T.MeshBasicMaterial({ color: 0x1a120c, side: T.BackSide });
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    t.anisotropy = 4;
    return t;
  }
  function blotch(g, x, y, r, col) {
    g.fillStyle = col; g.beginPath();
    for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI * 2, rr = r * (0.7 + Math.random() * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
  }
  function hairTex(base, hair, n) {
    return canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      g.strokeStyle = hair; g.lineWidth = 1.6; g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const x = Math.random() * w, y = Math.random() * h, a = rnd(-0.6, 0.6) + Math.PI / 2;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 3, y + 3, x + Math.cos(a) * 6, y + Math.sin(a) * 6); g.stroke();
      }
    }, true);
  }

  // ── Build helpers ──────────────────────────────────────────────────────────
  function mesh(parent, geo, mat, x, y, z, outline) {
    const m = new T.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; parent.add(m);
    if (outline) { const o = new T.Mesh(geo, OUTLINE); o.scale.setScalar(outline); o.castShadow = false; m.add(o); }
    return m;
  }
  const grp = (parent, x, y, z) => { const g = new T.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; };
  const sph = (r, w, h) => new T.SphereGeometry(r, w || 16, h || 12);
  const cyl = (rt, rb, hgt, s) => new T.CylinderGeometry(rt, rb, hgt, s || 12);

  // ── The man ────────────────────────────────────────────────────────────────
  const M = {};
  function buildMan(parent) {
    const skin = toon(0xf0b890), skinHair = toon(0xffffff, { map: hairTex('#f0b890', '#5a3a22', 220) });
    const shinHair = toon(0xffffff, { map: hairTex('#eab088', '#4a3020', 160) });
    const beardM = toon(0x5a3a22), dark = toon(0x2a1a10);
    const khaki = toon(0xa8986a), khakiD = toon(0x8a7a50);
    const tank = toon(0xffffff, { map: canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#f4f0e2'; g.fillRect(0, 0, w, h);
      blotch(g, 150, 70, 16, 'rgba(210,160,40,0.85)'); blotch(g, 170, 90, 9, 'rgba(170,110,40,0.8)');
      blotch(g, 95, 95, 13, 'rgba(150,90,40,0.7)'); blotch(g, 115, 40, 7, 'rgba(190,60,30,0.75)');
      blotch(g, 40, 80, 10, 'rgba(160,140,80,0.5)'); blotch(g, 220, 60, 11, 'rgba(120,90,50,0.55)');
    }) });
    const flop = toon(0x2a7ad8), strap = toon(0xffd23a);
    M.skin = skin; M.skinBase = new T.Color(0xf0b890);

    const root = M.root = grp(parent, 0, 0.2, 0.92);
    const hips = M.hips = grp(root, 0, 0.86, 0);
    mesh(hips, cyl(0.22, 0.24, 0.24), khaki, 0, 0, 0, 1.06);
    M.legs = [];
    [-1, 1].forEach(s => {
      const th = grp(hips, s * 0.12, -0.05, 0);
      mesh(th, cyl(0.105, 0.1, 0.32), khaki, 0, -0.14, 0, 1.08);
      mesh(th, new T.BoxGeometry(0.06, 0.1, 0.12), khakiD, s * 0.1, -0.2, 0);
      const kn = grp(th, 0, -0.34, 0);
      mesh(kn, cyl(0.062, 0.05, 0.42), shinHair, 0, -0.2, 0, 1.1);
      const ft = grp(kn, 0, -0.43, 0);
      mesh(ft, new T.BoxGeometry(0.1, 0.06, 0.22), skin, 0, 0.0, -0.05, 1.08);
      mesh(ft, new T.BoxGeometry(0.13, 0.025, 0.28), flop, 0, -0.04, -0.05);
      mesh(ft, new T.TorusGeometry(0.045, 0.012, 6, 10, Math.PI), strap, 0, 0.0, -0.1).rotation.y = Math.PI / 2;
      M.legs.push({ th, kn, ft, s });
    });
    const torso = M.torso = grp(hips, 0, 0.08, 0);
    M.belly = mesh(torso, sph(0.31, 20, 16), skinHair, 0, 0.1, -0.1, 1.05);
    M.belly.scale.set(1.02, 0.92, 1);
    mesh(torso, sph(0.05), skin, 0, 0.03, -0.395); // belly button bump
    const tk = mesh(torso, cyl(0.25, 0.28, 0.46, 16), tank, 0, 0.33, 0, 1.05);
    tk.rotation.y = Math.PI;
    [-1, 1].forEach(s => mesh(torso, new T.BoxGeometry(0.06, 0.03, 0.34), toon(0xf4f0e2), s * 0.16, 0.57, 0));
    mesh(torso, sph(0.07), dark, 0, 0.5, -0.2).scale.set(1.2, 0.8, 0.5); // chest hair tuft
    M.butt = grp(hips, 0, -0.05, 0.3); // the business end
    M.arms = [];
    [-1, 1].forEach(s => {
      const sh = grp(torso, s * 0.3, 0.5, 0);
      mesh(sh, sph(0.085), skinHair, 0, 0, 0, 1.08);
      mesh(sh, cyl(0.068, 0.062, 0.3), skinHair, 0, -0.15, 0, 1.08);
      const el = grp(sh, 0, -0.3, 0);
      mesh(el, cyl(0.062, 0.055, 0.28), skinHair, 0, -0.14, 0, 1.08);
      const hand = mesh(el, sph(0.075), skin, 0, -0.31, 0, 1.1); hand.scale.set(1, 1.1, 0.9);
      M.arms.push({ sh, el, s });
    });
    const head = M.head = grp(torso, 0, 0.6, -0.02);
    mesh(head, sph(0.22, 20, 16), skin, 0, 0.18, 0, 1.05);
    [-1, 1].forEach(s => mesh(head, sph(0.055), skin, s * 0.21, 0.18, 0.01, 1.1).scale.set(0.6, 1, 1));
    // beard: a big scruffy jaw + chin tuft + sideburns + moustache
    const bj = mesh(head, sph(0.2, 16, 12), beardM, 0, 0.04, -0.07, 1.05); bj.scale.set(1.08, 0.95, 0.95);
    mesh(head, sph(0.12), beardM, 0, -0.1, -0.13, 1.06).scale.set(1, 1.2, 0.9);
    for (let i = 0; i < 7; i++) { const a = -1.3 + i * 0.43; mesh(head, sph(0.05, 8, 6), beardM, Math.sin(a) * 0.19, -0.02 - Math.cos(a) * 0.07 - (i % 2) * 0.03, -0.07 - Math.cos(a) * 0.12); }
    [-1, 1].forEach(s => mesh(head, sph(0.06), beardM, s * 0.19, 0.13, -0.02).scale.set(0.6, 1.4, 1));
    const mo = mesh(head, sph(0.07), beardM, 0, 0.115, -0.215, 1.08); mo.scale.set(1.7, 0.55, 0.8);
    // mouth
    M.mouth = mesh(head, sph(0.055, 14, 10), toon(0x5a1418), 0, 0.065, -0.235);
    M.mouth.scale.set(1.3, 0.35, 0.5);
    M.tongue = mesh(M.mouth, sph(0.035), toon(0xe0606a), 0, -0.02, -0.01);
    // nose, cheeks
    mesh(head, sph(0.07), toon(0xe8887a), 0, 0.17, -0.225, 1.08).scale.set(1, 0.9, 1.1);
    M.cheeks = [-1, 1].map(s => mesh(head, sph(0.062), toon(0xf0a090), s * 0.12, 0.12, -0.17));
    // eyes with lids
    M.eyes = [-1, 1].map(s => {
      const g = grp(head, s * 0.085, 0.26, -0.17);
      mesh(g, sph(0.07), new T.MeshBasicMaterial({ color: 0xfbfbf6 }), 0, 0, 0, 1.1).scale.set(1, 1.1, 0.75);
      const pupil = mesh(g, sph(0.032, 10, 8), toon(0x101010), 0, 0, -0.05);
      const lid = mesh(g, new T.SphereGeometry(0.074, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin, 0, 0, 0);
      lid.castShadow = false; lid.rotation.x = 1.4;
      const brow = mesh(head, new T.BoxGeometry(0.1, 0.028, 0.03), dark, s * 0.09, 0.355, -0.18);
      return { g, pupil, lid, brow, s };
    });
    // beanie
    const bean = toon(0xd23a2a);
    const cap = mesh(head, new T.SphereGeometry(0.228, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), bean, 0, 0.3, 0.02, 1.05);
    cap.scale.set(1, 1.2, 1);
    mesh(head, cyl(0.232, 0.232, 0.08, 18), toon(0xa82a20), 0, 0.33, 0.02, 1.04);
    mesh(head, sph(0.065), toon(0xffe8c0), 0, 0.6, 0.03, 1.08);
    [-1, 1].forEach(s => mesh(head, sph(0.04, 8, 6), beardM, s * 0.17, 0.26, 0.14)); // hair tufts
    // dizzy stars (wipeout)
    M.stars = [];
    const starG = new T.OctahedronGeometry(0.06, 0), starM = new T.MeshBasicMaterial({ color: 0xffe040 });
    for (let i = 0; i < 3; i++) { const st = new T.Mesh(starG, starM); st.visible = false; head.add(st); M.stars.push(st); }
    // cheese stealth shimmer aura
    M.aura = new T.Mesh(sph(0.9, 16, 12), new T.MeshBasicMaterial({ color: 0xfff6a0, transparent: true, opacity: 0, depthWrite: false }));
    M.aura.position.set(0, 1.1, 0); M.aura.scale.set(0.8, 1.35, 0.8); root.add(M.aura);
    // burrito flame jet out of the rear
    const fj = M.flame = grp(M.butt, 0, 0, 0.02);
    const cone = (r, h, col) => { const g = new T.ConeGeometry(r, h, 12, 1, true); g.translate(0, h / 2, 0); g.rotateX(Math.PI / 2); return new T.Mesh(g, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false, toneMapped: false })); };
    M.flameO = cone(0.22, 1.6, 0xff5a10); M.flameI = cone(0.12, 1.0, 0xfff27a);
    fj.add(M.flameO); fj.add(M.flameI); fj.visible = false;
  }

  // ── The cart ───────────────────────────────────────────────────────────────
  const K = {};
  function latticeTex() {
    return canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.fillStyle = '#ffffff';
      for (let i = 0; i < 4; i++) { g.fillRect(i * 16, 0, 4, h); g.fillRect(0, i * 16, w, 4); }
    }, true);
  }
  function plane(parent, w, h, mat, x, y, z, rx, ry) {
    const g = new T.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 0.07, uv.getY(i) * h / 0.07);
    const m = new T.Mesh(g, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); parent.add(m); return m;
  }
  function rod(parent, a, b, r, mat) {
    const d = tmpV.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
    const m = new T.Mesh(cyl(r, r, len, 8), mat);
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    m.quaternion.setFromUnitVectors(tmpV2.set(0, 1, 0), d.normalize());
    m.castShadow = true; parent.add(m); return m;
  }
  function buildCart(parent) {
    const chrome = new T.MeshPhongMaterial({ color: 0xc4ccd6, specular: 0xffffff, shininess: 90, emissive: 0x1c2228 });
    const wire = new T.MeshPhongMaterial({ color: 0xd0d8e2, specular: 0xffffff, shininess: 70, emissive: 0x20262c, map: latticeTex(), alphaTest: 0.35, side: T.DoubleSide, transparent: false });
    const red = toon(0xe02828), black = toon(0x222222), grey = toon(0x8a8f96);
    const body = K.body = grp(parent, 0, 0, 0);
    // basket (y .5..1, z -.52..0.42)
    const y0 = 0.5, y1 = 1.0, zf = -0.55, zb = 0.42, hw = 0.29, L = zb - zf, H = y1 - y0;
    plane(body, hw * 2, L, wire, 0, y0, (zf + zb) / 2, -Math.PI / 2);
    plane(body, L, H, wire, -hw, (y0 + y1) / 2, (zf + zb) / 2, 0, Math.PI / 2);
    plane(body, L, H, wire, hw, (y0 + y1) / 2, (zf + zb) / 2, 0, Math.PI / 2);
    plane(body, hw * 2, H, wire, 0, (y0 + y1) / 2, zf);
    // back gate + child seat flap (hinged at the top back)
    K.flap = grp(body, 0, y1, zb);
    plane(K.flap, hw * 2, H, wire, 0, -H / 2, 0);
    mesh(K.flap, new T.BoxGeometry(hw * 2 - 0.04, 0.05, 0.025), red, 0, -0.06, 0.005);
    const R = 0.016;
    [[[-hw, y1, zf], [hw, y1, zf]], [[-hw, y1, zb], [hw, y1, zb]], [[-hw, y1, zf], [-hw, y1, zb]], [[hw, y1, zf], [hw, y1, zb]],
     [[-hw, y0, zf], [hw, y0, zf]], [[-hw, y0, zf], [-hw, y0, zb]], [[hw, y0, zf], [hw, y0, zb]], [[-hw, y0, zb], [hw, y0, zb]],
     [[-hw, y0, zf], [-hw, y1, zf]], [[hw, y0, zf], [hw, y1, zf]]].forEach(p => rod(body, p[0], p[1], R, chrome));
    // lower frame + standing rail + uprights to the handle
    const fy = 0.2;
    [-1, 1].forEach(s => {
      rod(body, [s * 0.24, fy, -0.48], [s * 0.27, fy, 1.02], 0.02, chrome);
      rod(body, [s * 0.27, fy, 0.44], [s * 0.3, 1.08, 0.56], 0.02, chrome);
      rod(body, [s * 0.24, fy, -0.46], [s * 0.26, y0, -0.46], 0.016, chrome);
    });
    rod(body, [-0.27, fy, 1.02], [0.27, fy, 1.02], 0.022, chrome);
    rod(body, [-0.26, fy, 0.66], [0.26, fy, 0.66], 0.018, chrome);
    plane(body, 0.46, 0.9, wire, 0, fy + 0.01, -0.02, -Math.PI / 2); // bottom tray
    plane(body, 0.52, 0.4, wire, 0, fy + 0.012, 0.84, -Math.PI / 2); // step plate
    // red plastic handle
    const hd = mesh(body, cyl(0.034, 0.034, 0.66, 12), red, 0, 1.08, 0.56, 1.12); hd.rotation.z = Math.PI / 2;
    [-1, 1].forEach(s => mesh(body, sph(0.04), red, s * 0.33, 1.08, 0.56));
    // BULKZILLA plate on the front of the basket
    const plate = mesh(body, new T.BoxGeometry(0.3, 0.1, 0.02), red, 0, 0.9, zf - 0.015);
    plate.castShadow = false;
    // casters
    K.wheels = [];
    [[-0.25, -0.44, 1], [0.25, -0.44, 1], [-0.27, 0.62, 0], [0.27, 0.62, 0]].forEach((p, i) => {
      const sw = grp(body, p[0], 0.2, p[1]);
      mesh(sw, new T.BoxGeometry(0.04, 0.06, 0.04), grey, 0, -0.03, 0);
      [-1, 1].forEach(s => mesh(sw, new T.BoxGeometry(0.012, 0.1, 0.05), grey, s * 0.032, -0.08, 0.03));
      const ax = grp(sw, 0, -0.11, 0.03);
      const wg = cyl(0.09, 0.09, 0.05, 16); wg.rotateZ(Math.PI / 2);
      const wh = mesh(ax, wg, black, 0, 0, 0, 1.06);
      mesh(wh, (() => { const g = cyl(0.045, 0.045, 0.055, 10); g.rotateZ(Math.PI / 2); return g; })(), grey, 0, 0, 0);
      K.wheels.push({ sw, ax, wh, front: !!p[2], squeaky: i === 2, seed: Math.random() * 10 });
    });
  }

  // ── VFX pools ──────────────────────────────────────────────────────────────
  const FX = {};
  function inst(geo, mat, n, color) {
    const m = new T.InstancedMesh(geo, mat, n);
    m.frustumCulled = false; m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    if (color) { for (let i = 0; i < n; i++) m.setColorAt(i, tmpC.set(0xffffff)); m.instanceColor.setUsage(T.DynamicDrawUsage); }
    const z = new T.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) m.setMatrixAt(i, z);
    scene.add(m); return m;
  }
  function pool(n) { const a = []; for (let i = 0; i < n; i++) a.push({ alive: false }); a.next = 0; return a; }
  function take(p) { for (let k = 0; k < p.length; k++) { const i = (p.next + k) % p.length; if (!p[i].alive) { p.next = (i + 1) % p.length; return p[i]; } } const o = p[p.next]; p.next = (p.next + 1) % p.length; return o; }
  function buildFX() {
    const sg = new T.IcosahedronGeometry(1, 2);
    FX.NP = 240;
    FX.puff = inst(sg, toon(0xffffff), FX.NP, true);
    FX.puffO = inst(sg, new T.MeshBasicMaterial({ color: 0xffffff, side: T.BackSide }), FX.NP, true);
    FX.puffs = pool(FX.NP);
    FX.NF = 80;
    FX.fire = inst(new T.IcosahedronGeometry(1, 1), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), FX.NF, true);
    FX.fires = pool(FX.NF);
    FX.NS = 70;
    FX.spark = inst(new T.BoxGeometry(0.06, 0.06, 0.34), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), FX.NS, true);
    FX.sparks = pool(FX.NS);
    FX.NL = 30;
    FX.line = inst(new T.BoxGeometry(0.025, 0.025, 1), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }), FX.NL, false);
    FX.lines = pool(FX.NL);
    FX.NH = 16;
    FX.shim = inst(new T.IcosahedronGeometry(1, 2), new T.MeshBasicMaterial({ color: 0xfff4a0, transparent: true, opacity: 0.22, depthWrite: false }), FX.NH, false);
    FX.shims = pool(FX.NH);
    // stink squiggle: a wavy vertical tube
    const pts = []; for (let i = 0; i <= 16; i++) { const u = i / 16; pts.push(new T.Vector3(Math.sin(u * Math.PI * 3) * 0.12, u * 0.9, 0)); }
    FX.NK = 36;
    FX.stink = inst(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, 0.025, 5), new T.MeshBasicMaterial({ color: 0x4caf2a }), FX.NK, true);
    FX.stinks = pool(FX.NK);
    FX.rings = [0, 1].map(() => {
      const m = new T.Mesh(new T.TorusGeometry(1, 0.1, 6, 48), new T.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      m.rotation.x = Math.PI / 2; m.visible = false; m.frustumCulled = false; scene.add(m); return { m, t: 0, life: 0.6, r: 7 };
    });
    FX.blob = new T.Mesh(new T.CircleGeometry(0.7, 24), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    FX.blob.rotation.x = -Math.PI / 2; FX.blob.renderOrder = 1; scene.add(FX.blob);
  }
  function spawnPuff(type, x, y, z, vx, vy, vz, size, life, kind) {
    const p = take(FX.puffs), c = FART_COL[type] || FART_COL.beans;
    Object.assign(p, { alive: true, x, y, z, vx, vy, vz, size, life, age: 0, kind: kind || 0, seed: Math.random() * 6.28, type });
    p.col = (p.col || new T.Color()).set(c[0]).lerp(tmpC.set(c[1]), Math.random());
    p.colO = (p.colO || new T.Color()).copy(p.col).multiplyScalar(0.45);
    if (type === 'burrito') p.colO.set(0x5a1408);
    FX.puff.setColorAt(FX.puffs.indexOf(p), p.col); FX.puffO.setColorAt(FX.puffs.indexOf(p), p.colO);
    FX.puff.instanceColor.needsUpdate = FX.puffO.instanceColor.needsUpdate = true;
    return p;
  }
  function spawnFire(x, y, z, vx, vy, vz, size, life) {
    const p = take(FX.fires);
    Object.assign(p, { alive: true, x, y, z, vx, vy, vz, size, life, age: 0 });
    return p;
  }
  function spawnSpark(x, y, z, vx, vy, vz) { Object.assign(take(FX.sparks), { alive: true, x, y, z, vx, vy, vz, life: rnd(0.25, 0.5), age: 0 }); }
  function spawnStink(x, y, z, life) { Object.assign(take(FX.stinks), { alive: true, x, y, z, life: life || rnd(1.2, 2), age: 0, seed: Math.random() * 6.28 }); }
  function spawnShim(x, y, z, size) { Object.assign(take(FX.shims), { alive: true, x, y, z, size, life: rnd(1.5, 2.5), age: 0, seed: Math.random() * 6.28 }); }
  function ring(x, y, z, r, col, upright) {
    const R = FX.rings.find(q => q.t <= 0) || FX.rings[0];
    R.t = R.life; R.r = r; R.m.position.set(x, y, z); R.m.material.color.set(col); R.m.visible = true;
    R.m.rotation.set(upright ? 0 : Math.PI / 2, upright ? cart.yaw : 0, 0);
  }
  function puffEnv(u) {
    if (u < 0.14) { const k = u / 0.14; return 1 + 1.7 * Math.pow(k - 1, 3) + 0.7 * Math.pow(k - 1, 2); } // ease-out-back
    if (u < 0.6) return 1;
    const k = (u - 0.6) / 0.4; return Math.max(0, 1 - k * k);
  }
  function updateFX(dt, t) {
    let i, p;
    for (i = 0; i < FX.NP; i++) {
      p = FX.puffs[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; tmpM.makeScale(0, 0, 0); FX.puff.setMatrixAt(i, tmpM); FX.puffO.setMatrixAt(i, tmpM); continue; }
      const drag = p.kind === 2 ? 0.8 : 2.2;
      p.vx *= Math.exp(-drag * dt); p.vz *= Math.exp(-drag * dt); p.vy = p.kind === 1 ? p.vy : p.vy * Math.exp(-drag * dt) + 0.35 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.size * 0.4) p.y = p.size * 0.4;
      const u = p.age / p.life;
      let s = p.size * puffEnv(u) * (p.kind === 2 ? 1 + 0.35 * Math.min(1, p.age / 1.5) : 1 + 0.4 * u);
      if (p.kind === 1) s = p.size * (u < 0.85 ? 1 : (1 - u) / 0.15) * (1 + 0.2 * Math.sin(t * 20 + p.seed)); // bubbles pop
      const w = Math.sin(t * 7 + p.seed) * 0.08;
      tmpS.set(s * (1 + w), s * (1 - w), s * (1 + w * 0.5));
      tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ.setFromEuler(tmpE.set(0, p.seed + p.age * 0.6, 0)), tmpS);
      FX.puff.setMatrixAt(i, tmpM);
      tmpS.multiplyScalar(p.kind === 1 ? 1.15 : 1.07);
      tmpM.compose(tmpV, tmpQ, tmpS);
      FX.puffO.setMatrixAt(i, tmpM);
    }
    FX.puff.instanceMatrix.needsUpdate = FX.puffO.instanceMatrix.needsUpdate = true;
    for (i = 0; i < FX.NF; i++) {
      p = FX.fires[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; FX.fire.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
      p.vx *= Math.exp(-3 * dt); p.vz *= Math.exp(-3 * dt); p.vy += 2 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const u = p.age / p.life, s = p.size * (u < 0.2 ? u / 0.2 : 1 - (u - 0.2) / 0.8 * 0.9);
      FX.fire.setMatrixAt(i, tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ.identity(), tmpS.set(s, s, s)));
      FX.fire.setColorAt(i, tmpC.setHex(0xfff2a0).lerp(tmpC2.setHex(u < 0.5 ? 0xff8a20 : 0xd02a10), Math.min(1, u * 1.6)));
    }
    FX.fire.instanceMatrix.needsUpdate = true; FX.fire.instanceColor.needsUpdate = true;
    for (i = 0; i < FX.NS; i++) {
      p = FX.sparks[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; FX.spark.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
      p.vy -= 14 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy = -p.vy * 0.4; }
      tmpV2.set(p.vx, p.vy, p.vz).normalize();
      tmpQ.setFromUnitVectors(tmpV.set(0, 0, 1), tmpV2);
      const s = 1 - p.age / p.life;
      FX.spark.setMatrixAt(i, tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ, tmpS.set(s, s, s * 1.5)));
      FX.spark.setColorAt(i, tmpC.setHex(0xffffa0).lerp(tmpC2.setHex(0xff6a10), p.age / p.life));
    }
    FX.spark.instanceMatrix.needsUpdate = true; FX.spark.instanceColor.needsUpdate = true;
    for (i = 0; i < FX.NL; i++) {
      p = FX.lines[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; FX.line.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const u = p.age / p.life, s = Math.sin(u * Math.PI);
      FX.line.setMatrixAt(i, tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ.setFromEuler(tmpE.set(0, p.yaw, 0)), tmpS.set(s, s, p.len * s)));
    }
    FX.line.instanceMatrix.needsUpdate = true;
    for (i = 0; i < FX.NH; i++) {
      p = FX.shims[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; FX.shim.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
      p.y += 0.3 * dt;
      const u = p.age / p.life, s = p.size * Math.sin(u * Math.PI) * (1 + 0.15 * Math.sin(t * 13 + p.seed));
      FX.shim.setMatrixAt(i, tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ.identity(), tmpS.set(s, s * 1.2, s)));
    }
    FX.shim.instanceMatrix.needsUpdate = true;
    for (i = 0; i < FX.NK; i++) {
      p = FX.stinks[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; FX.stink.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
      p.y += 0.5 * dt;
      const u = p.age / p.life, s = Math.sin(Math.min(1, u * 1.3) * Math.PI) * 1.1;
      tmpE.set(0, p.seed + Math.sin(t * 3 + p.seed) * 0.8, Math.sin(t * 5 + p.seed) * 0.25);
      FX.stink.setMatrixAt(i, tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ.setFromEuler(tmpE), tmpS.set(s, s * (1 + 0.2 * Math.sin(t * 9 + p.seed)), s)));
      FX.stink.setColorAt(i, tmpC.setHex(p.seed > 3 ? 0x3c9a22 : 0x7ac83a));
    }
    FX.stink.instanceMatrix.needsUpdate = true; FX.stink.instanceColor.needsUpdate = true;
    FX.rings.forEach(R => {
      if (R.t <= 0) return;
      R.t -= dt; const u = 1 - Math.max(0, R.t) / R.life;
      const s = 0.5 + R.r * (1 - Math.pow(1 - u, 3));
      R.m.scale.set(s, s, 1 + u); R.m.material.opacity = 0.95 * (1 - u);
      if (R.t <= 0) R.m.visible = false;
    });
    // lingering broccoli clouds: the stun area
    for (i = S.clouds.length - 1; i >= 0; i--) {
      const c = S.clouds[i];
      c.t -= dt; c.emit -= dt; c.stink -= dt;
      if (c.emit <= 0) { c.emit = 0.5; bus.emit('stun', { pos: { x: c.x, y: 0, z: c.z }, radius: 5, kind: 'broccoli' }); }
      if (c.stink <= 0 && c.t > 1) { c.stink = 0.35; spawnStink(c.x + rnd(-3, 3), rnd(1, 2.5), c.z + rnd(-3, 3)); if (Math.random() < 0.6) spawnPuff('broccoli', c.x + rnd(-2.5, 2.5), 0.3, c.z + rnd(-2.5, 2.5), 0, rnd(0.6, 1.2), 0, rnd(0.08, 0.16), rnd(1, 1.8), 1); }
      if (c.t <= 0) S.clouds.splice(i, 1);
    }
  }
  const tmpC2 = new T.Color();

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  function init(c) {
    core = c; scene = c.scene; GRAD = gradient();
    const root = cart.group = new T.Group(); scene.add(root);
    K.tilt = grp(root, 0, 0, 0);
    K.pivot = grp(K.tilt, 0, 0, 0);
    const inner = grp(K.pivot, 0, 0, 0); K.inner = inner;
    buildCart(inner);
    buildMan(K.tilt); cart.man = M.root;
    buildFX();
    reset(C.START.x, C.START.z, C.START.yaw);
  }
  function reset(x, z, yaw) {
    cart.pos.set(x || 0, floorAt(x || 0, z || 0), z || 0); cart.vel.set(0, 0, 0);
    cart.yaw = yaw || 0; cart.speed = 0; cart.airborne = false; cart.boosting = false; cart.drifting = false; cart.wipeout = false; cart.stealth = 0;
    TYPES.forEach(t => { cart.gas[t] = 0; }); cart.gasTotal = 0;
    Object.assign(S, { yawRate: 0, vy: 0, tip: 0, wipeT: 0, wipeImmune: 0, beansT: 0, burstT: 0, windT: 0, flameT: 0, fartCd: 0, airT: 0, pitch: 0, lean: 0, roll: 0, chompT: 0, reliefT: 0, puffT: 0, bugT: 0, sadT: 0 });
    if (S.beansOn) sfx('fartStop'); S.beansOn = false;
    S.clouds.length = 0;
    if (FX.puffs) [FX.puffs, FX.fires, FX.sparks, FX.lines, FX.shims, FX.stinks].forEach(p => p.forEach(q => { q.alive = false; }));
    if (FX.puff) {
      tmpM.makeScale(0, 0, 0);
      [FX.puff, FX.puffO, FX.fire, FX.spark, FX.line, FX.shim, FX.stink].forEach(m => { for (let i = 0; i < m.count; i++) m.setMatrixAt(i, tmpM); m.instanceMatrix.needsUpdate = true; });
    }
    if (cart.group) place();
  }
  function floorAt(x, z) { return has('store', 'floorAt') ? +BR.store.floorAt(x, z) || 0 : 0; }
  function frictionAt(x, z) { return has('store', 'frictionAt') ? clamp(+BR.store.frictionAt(x, z), 0.05, 1.5) || 1 : 1; }
  function selType() { const r = BR.rules && BR.rules.gasSel; return TYPES.includes(r) ? r : TYPES.includes(cart.gasSel) ? cart.gasSel : 'beans'; }
  function fullest() { let b = null, v = 0.02; TYPES.forEach(t => { if (cart.gas[t] > v) { v = cart.gas[t]; b = t; } }); return b; }
  function buttWorld(out) { M.butt.getWorldPosition(out); return out; }
  const fwd = () => tmpV2.set(-Math.sin(cart.yaw), 0, -Math.cos(cart.yaw));

  // ── Eating ─────────────────────────────────────────────────────────────────
  function foodKey(f) {
    if (!f) return null;
    if (typeof f === 'string') return C.FOODS[f] ? f : null;
    const k = f.food || f.type || f.kind || f.id || f.gas;
    return C.FOODS[k] ? k : typeof k === 'object' ? foodKey(k) : null;
  }
  function eat(food) {
    const k = foodKey(food); if (!k) return false;
    const F = C.FOODS[k], g = F.gas;
    cart.gas[g] = Math.min(1, (cart.gas[g] || 0) + F.amount);
    S.chompT = 0.6; S.lastFood = k;
    sfx('chomp', { food: k });
    bus.emit('eat', { food: k, gas: g });
    return true;
  }
  function tryEat(dt) {
    S.eatCd -= dt;
    const st = BR.store; if (!st || S.eatCd > 0) return;
    const P = st.pickups; if (!P) return;
    let p = null;
    try {
      if (typeof P.nearest === 'function') p = P.nearest(cart.pos, 1.4);
      else if (Array.isArray(P)) { let d = 1.4; P.forEach(q => { if (q && !q.taken && q.x != null) { const dd = Math.hypot(q.x - cart.pos.x, q.z - cart.pos.z); if (dd < d) { d = dd; p = q; } } }); }
    } catch (e) { p = null; }
    if (!p || p.taken || !foodKey(p)) return;
    if (Math.abs((p.y || 0) - cart.pos.y) > 2.5 && p.y != null) return;
    let ok = true;
    if (typeof P.take === 'function') ok = P.take(p);
    else if (typeof p.take === 'function') ok = p.take();
    else p.taken = true;
    if (ok !== false) { eat(p); S.eatCd = 0.1; }
  }

  // ── Farting ────────────────────────────────────────────────────────────────
  function announceFart(type, power, stream) {
    const b = buttWorld(new T.Vector3());
    const d = { type, power, pos: { x: b.x, y: b.y, z: b.z } };
    if (stream) d.stream = true;
    bus.emit('fart', d);
    if (type === 'beans') { if (!stream) sfx('fart', { type, power, hold: true }); }
    else sfx('fart', { type, power });
  }
  function fart(type) {
    if (!cart.group || S.wipeT > 0) return false;
    let t = TYPES.includes(type) ? type : selType();
    if ((cart.gas[t] || 0) < 0.02) t = fullest();
    if (!t) { // sad tiny squeak
      if (S.fartCd > 0) return false;
      S.fartCd = 0.5; S.sadT = 1.2;
      const b = buttWorld(tmpV);
      spawnPuff('squeak', b.x, b.y, b.z, 0, 0.3, 0, 0.12, 0.9);
      sfx('nogas');
      return false;
    }
    if (t === 'beans') {
      if (S.beansT <= 0) { S.beansEmit = 0; S.beansOn = false; S.puffT = 0.15; }
      S.beansT = Math.max(S.beansT, TN.beansMin); S.beansHold = true;
      return true;
    }
    if (S.fartCd > 0 || S.windT > 0) return false;
    const cost = t === 'burrito' ? TN.burritoCost : t === 'hotdog' ? TN.hotdogCost : t === 'broccoli' ? TN.brocCost : TN.cheeseCost;
    const power = clamp(cart.gas[t] / cost, 0.25, 1);
    cart.gas[t] = Math.max(0, cart.gas[t] - cost);
    S.fartCd = 0.35;
    if (t === 'burrito') { S.windT = TN.windup; S.windPow = power; S.puffT = TN.windup; sfx('clench', { power }); return true; }
    blast(t, power);
    return true;
  }
  function blast(t, power) {
    const f = fwd(), fx = f.x, fz = f.z, b = buttWorld(new T.Vector3()), cv = cart.vel;
    S.reliefT = 1.4; S.bugT = t === 'cheese' ? 0 : 0.6; S.puffT = 0;
    if (t === 'hotdog') {
      addForward(TN.hotdogDv * power);
      S.burstT = 0.55;
      for (let i = 0; i < 12; i++) spawnPuff('hotdog', b.x, b.y, b.z, -fx * rnd(2, 6) + rnd(-2.5, 2.5) + cv.x * 0.7, rnd(-0.3, 1.5), -fz * rnd(2, 6) + rnd(-2.5, 2.5) + cv.z * 0.7, rnd(0.3, 0.6) * (0.6 + power * 0.4), rnd(1, 1.6));
      for (let i = 0; i < 3; i++) spawnStink(b.x - fx * rnd(1, 3), b.y + 0.4, b.z - fz * rnd(1, 3));
      ring(b.x - fx * 0.5, b.y, b.z - fz * 0.5, 1.6, 0xffd060, true);
      speedLines(10);
      core.shake(0.25, 0.2);
    } else if (t === 'burrito') {
      addForward(TN.burritoDv * power);
      S.vy = Math.max(S.vy, TN.burritoVy * (0.7 + 0.3 * power));
      cart.airborne = true; S.airT = 0; S.flameT = TN.flame; S.burstT = TN.flame;
      for (let i = 0; i < 22; i++) spawnPuff('burrito', b.x + rnd(-0.3, 0.3), Math.max(0.3, b.y - 0.4), b.z + rnd(-0.3, 0.3), rnd(-4.5, 4.5) - fx * 2 + cv.x * 0.4, rnd(0, 2.5), rnd(-4.5, 4.5) - fz * 2 + cv.z * 0.4, rnd(0.4, 0.8), rnd(1.4, 2.4));
      for (let i = 0; i < 20; i++) spawnFire(b.x, Math.max(0.3, b.y - 0.3), b.z, rnd(-5, 5) + cv.x * 0.4, rnd(0, 3), rnd(-5, 5) + cv.z * 0.4, rnd(0.3, 0.6), rnd(0.4, 0.8));
      ring(cart.pos.x, cart.pos.y + 0.1, cart.pos.z, 9, 0xff8a30);
      FX.rings.forEach(R => { if (R.t <= 0) { R.t = R.life * 1.3; R.r = 6; R.m.position.set(cart.pos.x, cart.pos.y + 0.15, cart.pos.z); R.m.material.color.set(0xffffff); R.m.rotation.set(Math.PI / 2, 0, 0); R.m.visible = true; } });
      speedLines(16);
      core.shake(1.2, 0.6); core.slowmo(0.3, 0.3); sfx('launch');
    } else if (t === 'broccoli') {
      addForward(TN.brocDv * power);
      S.burstT = 0.3;
      const cx = b.x - fx * 1.4, cz = b.z - fz * 1.4;
      for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, r = rnd(0, 2.2); spawnPuff('broccoli', b.x, b.y, b.z, (cx + Math.cos(a) * r - b.x) * 1.6, rnd(0.2, 1.4), (cz + Math.sin(a) * r - b.z) * 1.6, rnd(0.45, 0.85) * (0.7 + 0.3 * power), TN.brocLife * rnd(0.8, 1), 2); }
      for (let i = 0; i < 8; i++) spawnPuff('broccoli', cx + rnd(-2, 2), 0.3, cz + rnd(-2, 2), 0, rnd(0.5, 1), 0, rnd(0.08, 0.15), rnd(1, 2), 1);
      for (let i = 0; i < 5; i++) spawnStink(cx + rnd(-2, 2), rnd(1, 2.4), cz + rnd(-2, 2));
      S.clouds.push({ x: cx, z: cz, t: TN.brocLife, emit: 0, stink: 0.2 });
      core.shake(0.2, 0.2);
    } else if (t === 'cheese') {
      addForward(TN.cheeseDv * power);
      S.burstT = 0.2; S.shimmerT = 6; cart.stealth = 6;
      for (let i = 0; i < 7; i++) spawnShim(b.x + rnd(-0.6, 0.6), b.y + rnd(-0.2, 0.6), b.z + rnd(-0.6, 0.6), rnd(0.35, 0.7));
      bus.emit('stealth', { seconds: 6 });
    }
    announceFart(t, power);
  }
  function addForward(dv) {
    const f = fwd(); const vF = cart.vel.x * f.x + cart.vel.z * f.z;
    const add = Math.max(0, Math.min(dv, VMAX - Math.max(0, vF)));
    cart.vel.x += f.x * add; cart.vel.z += f.z * add;
  }
  function speedLines(n) {
    const f = fwd();
    for (let i = 0; i < n; i++) {
      const L = take(FX.lines), a = Math.random() * 6.28, r = rnd(0.8, 1.8);
      const rx = Math.cos(cart.yaw), rz = -Math.sin(cart.yaw);
      Object.assign(L, { alive: true, x: cart.pos.x + rx * Math.cos(a) * r + f.x * rnd(-1, 3), y: cart.pos.y + 1 + Math.sin(a) * r, z: cart.pos.z + rz * Math.cos(a) * r + f.z * rnd(-1, 3),
        vx: cart.vel.x * 0.6 - f.x * 10, vy: 0, vz: cart.vel.z * 0.6 - f.z * 10, yaw: cart.yaw, len: rnd(1.2, 2.4), life: rnd(0.25, 0.45), age: 0 });
    }
  }
  function bump(dir, force) {
    if (!dir) return;
    const l = Math.hypot(dir.x || 0, dir.z || 0) || 1, f = +force || 4;
    cart.vel.x += (dir.x || 0) / l * f; cart.vel.z += (dir.z || 0) / l * f;
    S.hitT = 0.4; S.bugT = Math.max(S.bugT, 0.4); S.flapV += 8;
    core && core.shake(Math.min(0.8, f / 12), 0.25);
    if (f > 9 && S.wipeT <= 0 && S.wipeImmune <= 0 && !cart.airborne) startWipe(Math.sign((dir.x || 0) * Math.cos(cart.yaw) - (dir.z || 0) * Math.sin(cart.yaw)) || 1);
  }
  function startWipe(side) {
    if (S.beansOn) sfx('fartStop');
    S.wipeT = 1.5; S.wipeSide = side; S.tip = 0; S.beansT = 0; S.beansOn = false; S.windT = 0; S.flameT = 0;
    cart.vel.multiplyScalar(0.6);
    sfx('wipeout');
    core.shake(0.6, 0.35);
    bus.emit('wipeout', { pos: { x: cart.pos.x, y: cart.pos.y, z: cart.pos.z } });
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  function update(dt, c) {
    if (!cart.group) return;
    core = c || core;
    const inp = core.input || {}, t = core.time;
    dt = Math.min(dt, 0.05);
    S.fartCd -= dt; S.crashCd -= dt; S.wipeImmune -= dt; S.squeakCd -= dt; S.squealCd -= dt;
    ['chompT', 'reliefT', 'bugT', 'sadT', 'hitT', 'burstT', 'landT', 'puffT'].forEach(k => { S[k] = Math.max(0, S[k] - dt); });
    cart.stealth = Math.max(0, cart.stealth - dt); S.shimmerT = Math.max(0, S.shimmerT - dt);

    // gas input
    const sel = selType();
    if (inp.boostPressed && S.wipeT <= 0) fart(sel);
    if (S.beansT > 0) {
      S.beansHold = S.beansHold && !!inp.boost;
      S.beansT -= dt;
      if (S.beansHold) S.beansT = Math.max(S.beansT, 0.05);
      const burn = TN.beansBurn * dt;
      if (cart.gas.beans <= 0.001 || S.wipeT > 0) S.beansT = 0;
      else {
        cart.gas.beans = Math.max(0, cart.gas.beans - burn);
        S.beansEmit -= dt;
        if (S.beansEmit <= 0) { announceFart('beans', 0.6, S.beansOn); S.beansOn = true; S.beansEmit = 0.3; S.reliefT = 1; }
      }
      if (S.beansT <= 0) { if (S.beansOn) sfx('fartStop'); S.beansOn = false; }
    } else S.beansOn = false;
    if (S.windT > 0) { S.windT -= dt; S.puffT = S.windT; if (S.windT <= 0) blast('burrito', S.windPow || 1); }
    const beans = S.beansT > 0;
    cart.boosting = beans || S.burstT > 0 || S.flameT > 0;

    physics(dt, inp, beans, t);
    collide(dt);
    tryEat(dt);
    if (has('store', 'hitProps')) BR.store.hitProps(cart.pos, cart.vel, RAD);

    // beans trail
    if (beans) {
      S.beansPuff -= dt;
      if (S.beansPuff <= 0) {
        S.beansPuff = 0.045;
        const b = buttWorld(tmpV), f = fwd();
        spawnPuff('beans', b.x, b.y, b.z, -f.x * rnd(1, 4) + rnd(-1.2, 1.2) + cart.vel.x * 0.55, rnd(-0.2, 0.9), -f.z * rnd(1, 4) + rnd(-1.2, 1.2) + cart.vel.z * 0.55, rnd(0.25, 0.48), rnd(0.9, 1.5));
        if (Math.random() < 0.12) spawnStink(b.x - f.x * 1.5, b.y + 0.3, b.z - f.z * 1.5, 1.2);
        if (Math.random() < 0.5) speedLines(1);
      }
    }
    if (S.flameT > 0) {
      S.flameT -= dt;
      const b = buttWorld(tmpV), f = fwd();
      for (let i = 0; i < 2; i++) spawnFire(b.x - f.x * 0.6, b.y, b.z - f.z * 0.6, -f.x * rnd(4, 8) + rnd(-1, 1), rnd(-2, 0), -f.z * rnd(4, 8) + rnd(-1, 1), rnd(0.25, 0.45), rnd(0.25, 0.45));
      if (Math.random() < 0.5) spawnPuff('burrito', b.x - f.x, b.y, b.z - f.z, -f.x * rnd(2, 4) + rnd(-1, 1), rnd(-1, 0.5), -f.z * rnd(2, 4) + rnd(-1, 1), rnd(0.3, 0.55), rnd(1, 1.6));
      if (Math.random() < 0.3) speedLines(1);
    }
    if (S.shimmerT > 0 && Math.random() < dt * 3) { const b = buttWorld(tmpV); spawnShim(b.x + rnd(-0.4, 0.4), b.y + rnd(0, 0.8), b.z + rnd(-0.4, 0.4), rnd(0.2, 0.4)); }

    cart.gasTotal = TYPES.reduce((a, k) => a + (cart.gas[k] || 0), 0);
    cart.wipeout = S.wipeT > 0; cart.tip = S.tip;
    place();
    animate(dt, t, inp, beans);
    updateFX(dt, t);
  }

  function physics(dt, inp, beans, t) {
    const pos = cart.pos, vel = cart.vel;
    const fx = -Math.sin(cart.yaw), fz = -Math.cos(cart.yaw), rx = Math.cos(cart.yaw), rz = -Math.sin(cart.yaw);
    let vF = vel.x * fx + vel.z * fz, vR = vel.x * rx + vel.z * rz;
    const fric = frictionAt(pos.x, pos.z);
    cart.drifting = false; S.kicking = 0;

    if (S.wipeT > 0) {
      S.wipeT -= dt;
      vF *= Math.exp(-2.5 * dt); vR *= Math.exp(-3 * dt);
      S.yawRate = damp(S.yawRate, 0, 3, dt);
      if (S.wipeT <= 0) { S.wipeImmune = 1.2; S.tip = 0; }
    } else if (!cart.airborne) {
      // kick push
      const thr = clamp(+inp.throttle || 0, 0, 1);
      if (thr > 0 && !beans) {
        S.kickPhase += dt * (1.8 + Math.max(0, Math.min(vF, KICK)) * 0.2);
        const pulse = Math.max(0, Math.sin(S.kickPhase * Math.PI * 2));
        if (vF < KICK) vF = Math.min(Math.max(vF, KICK), vF + TN.kickAccel * thr * (0.3 + 1.2 * pulse) * dt);
        S.kicking = thr;
      }
      // brake / reverse
      const brk = clamp(+inp.brake || 0, 0, 1);
      if (brk > 0) {
        if (vF > 0.3) vF = Math.max(0, vF - TN.brake * brk * dt);
        else vF = Math.max(-TN.revMax, vF - 3.5 * brk * dt);
      }
      // gas thrust
      if (beans && vF < TN.beansMax) vF = Math.min(TN.beansMax, vF + TN.beansAcc * dt);
      // drag (lower on spills)
      const sp = Math.abs(vF);
      vF -= Math.sign(vF) * Math.min(sp, (TN.drag + TN.dragQ * sp) * sp * dt * (0.5 + 0.5 * fric));
      if (thr === 0 && brk === 0 && !beans && sp < 0.4) vF *= Math.exp(-3 * dt);
      // steering
      const steer = clamp(+inp.steer || 0, -1, 1) * (vF < -0.3 ? -1 : 1);
      const drift = !!inp.drift && Math.abs(vF) > 3;
      let rate = TN.turn * Math.min(1, (Math.abs(vF) + 0.8) / 4) / (1 + Math.max(0, Math.abs(vF) - 8) * 0.045);
      if (drift) rate *= TN.driftTurn;
      S.yawRate = damp(S.yawRate, -steer * rate, drift ? 5 : TN.yawResp, dt);
      // lateral grip
      const slip = Math.atan2(Math.abs(vR), Math.abs(vF) + 0.01);
      let grip = (drift ? TN.driftGrip + Math.max(0, slip - TN.driftSlip) * 14 : TN.grip) * fric;
      const vR0 = vR; vR *= Math.exp(-grip * dt);
      // the scrubbed sideways speed mostly turns into forward speed (arcade carve), less in a drift
      const keep = drift ? TN.driftKeep : TN.carveKeep;
      if (Math.abs(vF) > 0.5) vF = Math.sign(vF) * Math.sqrt(vF * vF + (vR0 * vR0 - vR * vR) * keep);
      if (drift) cart.drifting = true;
      if (fric < 0.5 && Math.abs(vF) > 3) S.yawRate += Math.sin(t * 3.1) * dt * 6 * (1 - fric); // spill spin
      // tip-over: sustained lateral g
      const latG = Math.abs(vF * S.yawRate) * (drift ? 0.5 : 1);
      if (latG > TN.tipG && S.wipeImmune <= 0) { S.tip += (latG - TN.tipG) * TN.tipFill * dt; S.tipSide = Math.sign(S.yawRate * vF) || 1; }
      else S.tip = Math.max(0, S.tip - TN.tipDrain * dt);
      if (S.tip >= 1) startWipe(S.tipSide);
      // drift sparks + squeal
      if (drift && Math.abs(vR) > 1.2) {
        S.sparkT -= dt;
        if (S.sparkT <= 0) {
          S.sparkT = 0.03;
          [-1, 1].forEach(s => {
            const wx = pos.x + rx * s * 0.28 - fx * 0.62, wz = pos.z + rz * s * 0.28 - fz * 0.62;
            spawnSpark(wx, pos.y + 0.05, wz, -vel.x * 0.3 + rnd(-2, 2) - rx * vR * 0.3, rnd(1.5, 4), -vel.z * 0.3 + rnd(-2, 2) - rz * vR * 0.3);
          });
        }
        sfx('squeal', { power: clamp(Math.abs(vR) / 6, 0.3, 1) });
      }
    } else {
      // airborne: a little air steering, no grip
      S.yawRate = damp(S.yawRate, -clamp(+inp.steer || 0, -1, 1) * 1.2, 2, dt);
      if (S.flameT > 0) vF = Math.min(VMAX, vF + 6 * dt);
    }
    vF = clamp(vF, -VMAX, VMAX);
    vel.x = fx * vF + rx * vR; vel.z = fz * vF + rz * vR;
    cart.yaw += S.yawRate * dt;
    cart.yaw = Math.atan2(Math.sin(cart.yaw), Math.cos(cart.yaw));
    const oldFloor = floorAt(pos.x, pos.z);
    pos.x += vel.x * dt; pos.z += vel.z * dt;
    const fl = floorAt(pos.x, pos.z);
    // vertical: ramps and air
    if (cart.airborne) {
      S.vy -= TN.gAir * dt; pos.y += S.vy * dt; S.airT += dt;
      if (pos.y > C.STORE.ceiling - 2.4) { pos.y = C.STORE.ceiling - 2.4; S.vy = Math.min(0, S.vy); }
      if (pos.y <= fl && S.vy <= 0) {
        pos.y = fl; cart.airborne = false;
        const imp = -S.vy; S.vy = 0; S.landT = 0.35; S.flapV += imp * 2;
        if (imp > 2.5) sfx('land', { power: clamp(imp / 12, 0.2, 1) });
        if (imp > 4) core.shake(Math.min(0.9, imp / 14), 0.25);
        if (imp > 7) { cart.vel.multiplyScalar(0.85); S.bugT = 0.5; }
      }
    } else {
      const gv = (fl - oldFloor) / Math.max(dt, 1e-4);
      if (fl < pos.y - 0.12 && Math.hypot(vel.x, vel.z) > 2) { cart.airborne = true; S.airT = 0; S.vy = Math.max(0, S.groundVy); }
      else { pos.y = fl; S.groundVy = gv; }
      if (cart.airborne && S.vy > 0) { /* launched off a ramp */ }
    }
    // store bounds fallback
    const B = (BR.store && BR.store.bounds) || C.STORE;
    const bx = clamp(pos.x, B.minX + RAD, B.maxX - RAD), bz = clamp(pos.z, B.minZ + RAD, B.maxZ - RAD);
    if (bx !== pos.x) { vel.x *= -0.3; pos.x = bx; }
    if (bz !== pos.z) { vel.z *= -0.3; pos.z = bz; }
    cart.speed = Math.hypot(vel.x, vel.z) * Math.sign(vF || 1);
    // visual pitch: ramp slope on the ground, nose-up launch then tumble-level in the air
    const slope = Math.atan2(floorAt(pos.x + fx * 0.6, pos.z + fz * 0.6) - floorAt(pos.x - fx * 0.6, pos.z - fz * 0.6), 1.2);
    const tp = cart.airborne ? clamp(S.vy * 0.05, -0.35, 0.45) : slope;
    S.pitch = damp(S.pitch, tp, cart.airborne ? 4 : 12, dt);
  }

  function collide(dt) {
    if (!has('store', 'collide')) return;
    const pos = cart.pos, vel = cart.vel;
    const fx = -Math.sin(cart.yaw), fz = -Math.cos(cart.yaw);
    let worst = 0;
    // two circles: the basket nose and the man's end
    [[0.25, RAD * 0.8], [-0.45, RAD * 0.8]].forEach(([o, r]) => {
      const cx = pos.x + fx * o, cz = pos.z + fz * o;
      tmpV.set(cx, pos.y, cz);
      const res = BR.store.collide(tmpV, r);
      if (!res || !res.hit) return;
      pos.x += tmpV.x - cx; pos.z += tmpV.z - cz;
      const n = res.normal || { x: tmpV.x - cx, z: tmpV.z - cz };
      let nx = n.x || 0, nz = n.z || 0; const nl = Math.hypot(nx, nz);
      if (nl < 1e-6) return; nx /= nl; nz /= nl;
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) {
        vel.x -= (1 + TN.restitution) * vn * nx; vel.z -= (1 + TN.restitution) * vn * nz;
        vel.multiplyScalar(TN.crashLoss + (1 - TN.crashLoss) * Math.min(1, 2 / (-vn + 2)));
        worst = Math.max(worst, -vn);
        // spin the cart away from the wall a little
        S.yawRate += (fx * nz - fz * nx) * Math.min(3, -vn * 0.25);
      }
    });
    if (worst > 3 && S.crashCd <= 0) {
      S.crashCd = 0.25; S.hitT = 0.4; S.bugT = 0.6; S.flapV += worst * 2;
      sfx('crash', { power: clamp(worst / 14, 0.15, 1) });
      if (worst > 6) core.shake(Math.min(1, worst / 14), 0.3);
      if (worst > TN.crashWipe && S.wipeT <= 0 && S.wipeImmune <= 0 && !cart.airborne) startWipe(Math.random() < 0.5 ? -1 : 1);
    }
  }

  function place() {
    const g = cart.group, p = cart.pos;
    g.position.set(p.x, p.y, p.z); g.rotation.y = cart.yaw;
    if (FX.blob) {
      const fl = floorAt(p.x, p.z), h = p.y - fl;
      FX.blob.position.set(p.x, fl + 0.03, p.z);
      const s = clamp(1 - h * 0.12, 0.35, 1); FX.blob.scale.set(s * 0.75, s * 1.35, 1); FX.blob.rotation.z = cart.yaw;
      FX.blob.material.opacity = 0.22 * s;
    }
  }

  // ── Animation ──────────────────────────────────────────────────────────────
  function animate(dt, t, inp, beans) {
    const sp = Math.abs(cart.speed), air = cart.airborne, wipe = S.wipeT > 0;
    // cart tilt: pitch + two-wheel warning + drift lean + landing squash
    const latSide = S.tipSide;
    S.roll = damp(S.roll, (wipe ? 0 : -latSide * Math.min(1, S.tip) * 0.28) + (cart.drifting ? S.yawRate * 0.04 : 0), 10, dt);
    K.tilt.rotation.set(S.pitch, 0, S.roll);
    K.tilt.position.y = (S.landT > 0 ? -Math.sin(S.landT / 0.35 * Math.PI) * 0.05 : 0) + (S.hitT > 0 ? Math.sin(t * 60) * 0.02 : 0);
    // wipeout roll about the wheel edge
    let wr = 0;
    if (wipe) {
      const e = 1.5 - S.wipeT;
      wr = e < 0.25 ? e / 0.25 * 1.45 : e < 1.05 ? 1.45 : e < 1.4 ? 1.45 * (1 - (e - 1.05) / 0.35) : -0.12 * Math.sin((e - 1.4) / 0.1 * Math.PI);
    }
    K.pivot.position.x = S.wipeSide * 0.32; K.inner.position.x = -S.wipeSide * 0.32;
    K.pivot.rotation.z = S.wipeSide * wr;
    // wheels: roll, caster swivel toward the velocity, the squeaky wobble
    const fx = -Math.sin(cart.yaw), fz = -Math.cos(cart.yaw), rx = Math.cos(cart.yaw), rz = -Math.sin(cart.yaw);
    const vF = cart.vel.x * fx + cart.vel.z * fz, vR = cart.vel.x * rx + cart.vel.z * rz;
    S.wheelSpin -= vF * dt / 0.09;
    const trail = Math.abs(vF) > 0.3 || Math.abs(vR) > 0.3 ? Math.atan2(-vR, vF) : 0;
    S.swF = damp(S.swF, clamp(trail + S.yawRate * 0.25, -1.4, 1.4), 8, dt);
    S.swR = damp(S.swR, clamp(trail - S.yawRate * 0.1, -1.4, 1.4) * 0.6, 8, dt);
    K.wheels.forEach(w => {
      w.wh.rotation.x = S.wheelSpin;
      let a = w.front ? S.swF : S.swR;
      if (w.squeaky) a += Math.sin(t * (6 + sp * 3) + w.seed) * (0.25 + Math.min(0.5, sp * 0.06)) + Math.sin(t * 37) * 0.08;
      else a += Math.sin(t * 17 + w.seed) * 0.03 * Math.min(1, sp);
      w.sw.rotation.y = a;
      w.ax.position.y = -0.11 + (w.squeaky ? Math.abs(Math.sin(t * 11)) * 0.012 * Math.min(1, sp) : 0);
    });
    if (sp > 1 && sp < 9 && S.squeakCd <= 0 && !air && !wipe) { sfx('squeak', { power: 0.25 }); S.squeakCd = rnd(1.6, 3.2); }
    sfx('rattle', { speed: air || wipe ? 0 : sp, on: !air });
    // flap: spring driven by acceleration and hits
    S.flapV += (-S.flap * 60 - S.flapV * 6) * dt + (cart.boosting ? rnd(-3, 3) : 0) + (air ? Math.sin(t * 20) * 0.6 : 0);
    S.flap += S.flapV * dt; S.flap = clamp(S.flap, -0.2, 1.1);
    K.flap.rotation.x = -Math.abs(S.flap);

    // the man
    const L = M.legs, A = M.arms, E = M.eyes;
    const crouch = S.windT > 0 ? 1 : 0;
    let lean = damp(S.lean, wipe ? 0 : clamp(S.yawRate * (cart.drifting ? 0.2 : 0.12), -0.4, 0.4), 6, dt); S.lean = lean;
    const boostBack = cart.boosting ? 0.25 : 0;
    M.root.rotation.set(0, 0, 0); M.root.position.set(0, 0.2, 0.92);
    M.hips.position.set(0, 0.86 - crouch * 0.22, 0); M.hips.rotation.set(0, 0, lean * 0.4);
    M.torso.rotation.set(0.25 - boostBack + crouch * 0.35 - (S.kicking ? 0.0 : 0), 0, lean);
    M.head.rotation.set(-0.15 + boostBack * 0.5 - crouch * 0.2, clamp(-S.yawRate * 0.15, -0.4, 0.4), -lean * 0.5);
    // legs
    const kickOn = S.kicking > 0 && !air && !wipe;
    const ph = S.kickPhase * Math.PI * 2;
    L.forEach(l => {
      let th = 0.1, kn = -0.15, ft = 0.05, spread = l.s * 0.06;
      if (crouch) { th = 0.9; kn = -1.5; ft = 0.6; spread = l.s * 0.25; }
      if (kickOn && l.s > 0) { th = -0.35 - 0.55 * Math.sin(ph); kn = -0.2 - 0.9 * Math.max(0, Math.cos(ph)); ft = 0.3; }
      else if (kickOn) { th = 0.35; kn = -0.55; ft = 0.2; }
      l.th.rotation.set(th, 0, spread); l.kn.rotation.set(kn, 0, 0); l.ft.rotation.set(ft, 0, 0);
    });
    if (kickOn) M.hips.position.y -= 0.12;
    // arms grip the handle
    A.forEach(a => {
      let sx = 0.08 + boostBack * 0.35 + crouch * 0.15, sz = a.s * 0.05, el = 0.3;
      a.sh.rotation.set(sx, 0, sz); a.el.rotation.set(el, 0, 0);
    });
    if (air && !wipe) { // ragdoll flail
      const k = Math.min(1, S.airT * 3);
      A.forEach(a => { a.sh.rotation.set(lerp(0.08, -2.4 + Math.sin(t * 13 + a.s) * 1.3, k), 0, lerp(a.s * 0.05, -a.s * (1 + Math.sin(t * 11 + a.s * 2) * 0.6), k)); a.el.rotation.x = -0.5 - Math.sin(t * 17 + a.s) * 0.6; });
      L.forEach(l => { l.th.rotation.set(Math.sin(t * 12 + l.s * 1.6) * 0.9 * k + 0.2, 0, l.s * 0.3 * k); l.kn.rotation.x = -0.6 - Math.sin(t * 12 + l.s * 1.6 + 1) * 0.6 * k; });
      M.torso.rotation.x += -0.25 * k; M.hips.position.y += 0.15 * k;
    }
    if (S.windT > 0) { M.root.position.x = rnd(-0.03, 0.03); M.root.position.y += rnd(-0.02, 0.02); }
    if (S.hitT > 0) M.root.position.z += Math.sin(S.hitT * 30) * 0.05;
    // wipeout: thrown off, flat on his back, dizzy, hops back on
    if (wipe) {
      const e = 1.5 - S.wipeT, sd = S.wipeSide;
      const out = e < 0.35 ? e / 0.35 : e < 1.1 ? 1 : 1 - (e - 1.1) / 0.4;
      const o = Math.max(0, out);
      M.root.position.set(sd * 1.5 * o, 0.2 + Math.sin(Math.min(1, e / 0.35) * Math.PI) * 0.9 * (e < 0.35 ? 1 : 0) + (0.3 - 0.2) * o - (e >= 0.35 && e < 1.1 ? 0.12 : 0), 0.92 + 0.8 * o);
      const lie = e < 0.35 ? e / 0.35 : o;
      M.root.rotation.set(lie * Math.PI / 2 + (e < 0.35 ? Math.sin(e * 20) * 0.5 : 0), 0, -sd * (e < 0.35 ? e * 9 : 0) * (1 - lie * 0.9));
      if (e >= 0.35 && e < 1.1) {
        A.forEach(a => { a.sh.rotation.set(-0.3, 0, -a.s * (1.3 + Math.sin(t * 9 + a.s) * 0.15)); a.el.rotation.x = -0.2; });
        L.forEach(l => { l.th.rotation.set(0.4 + Math.sin(t * 7 + l.s) * 0.2, 0, l.s * 0.45); l.kn.rotation.x = -0.3; });
      }
    }
    M.stars.forEach((s, i) => {
      s.visible = wipe && (1.5 - S.wipeT) > 0.3;
      const a = t * 5 + i * 2.09; s.position.set(Math.cos(a) * 0.3, 0.55 + Math.sin(t * 7 + i) * 0.04, Math.sin(a) * 0.3); s.rotation.y = t * 6;
    });
    // face
    const bug = S.bugT > 0 || cart.boosting || (air && !wipe);
    const relief = S.reliefT > 0 && !bug;
    const puff = S.puffT > 0 || S.windT > 0 || (beans ? 0.5 : 0);
    E.forEach(e => {
      const es = bug ? 1.55 : 1;
      e.g.scale.setScalar(damp(e.g.scale.x, es, 14, dt));
      e.g.position.z = -0.17 - (bug ? 0.05 : 0);
      let lid = 1.4;
      if (relief) lid = -0.45; // blissful half-closed
      if (S.windT > 0) lid = -1.55; // squeezed shut (clench)
      if (S.sadT > 0) lid = -0.2;
      if (wipe) lid = 1.4;
      if (!bug && !wipe && Math.sin(t * 1.3 + e.s * 0.02) > 0.985) lid = -1.55; // blink
      e.lid.rotation.x = damp(e.lid.rotation.x, lid, 20, dt);
      if (wipe) { const a = t * 12 * e.s; e.pupil.position.set(Math.cos(a) * 0.025, Math.sin(a) * 0.025, -0.05); }
      else e.pupil.position.set(clamp(-S.yawRate * 0.012, -0.02, 0.02), bug ? 0 : relief ? -0.01 : 0.005, -0.05);
      e.pupil.scale.setScalar(bug ? 0.7 : 1);
      let br = 0, by = 0.355;
      if (bug) { by = 0.39; br = e.s * 0.15; }
      else if (S.windT > 0) { by = 0.335; br = -e.s * 0.4; }
      else if (relief) { by = 0.375; br = e.s * 0.1; }
      else if (S.sadT > 0) { by = 0.365; br = e.s * 0.45; }
      e.brow.position.y = damp(e.brow.position.y, by, 14, dt); e.brow.rotation.z = damp(e.brow.rotation.z, br, 14, dt);
    });
    const ch = puff ? (S.windT > 0 ? 1.9 + Math.sin(t * 40) * 0.1 : 1.6) : (S.chompT > 0 ? 1.3 + Math.abs(Math.sin(S.chompT * 18)) * 0.3 : 1);
    M.cheeks.forEach(c => c.scale.setScalar(damp(c.scale.x, ch, 16, dt)));
    // mouth: chomp, boost "O", relief smile, clench line, sad
    let mx = 1.3, my = 0.35;
    if (S.chompT > 0) { my = 0.25 + Math.abs(Math.sin(S.chompT * 16)) * 1.1; mx = 1.1; }
    else if (bug) { mx = 1.0; my = 1.3; }
    else if (S.windT > 0 || S.puffT > 0) { mx = 1.5; my = 0.12; }
    else if (relief) { mx = 1.7; my = 0.55; }
    else if (S.sadT > 0) { mx = 0.9; my = 0.3; }
    M.mouth.scale.x = damp(M.mouth.scale.x, mx, 18, dt); M.mouth.scale.y = damp(M.mouth.scale.y, my, 18, dt);
    M.mouth.position.y = relief ? 0.06 : 0.065;
    M.tongue.visible = relief || S.chompT > 0;
    if (S.chompT > 0) M.head.rotation.x += Math.sin(S.chompT * 16) * 0.12;
    // face redness while clenching
    const red = S.windT > 0 ? 1 - S.windT / TN.windup : 0;
    M.skin.color.copy(M.skinBase).lerp(tmpC.setHex(0xff5a4a), red * 0.6);
    // belly jiggle
    const jig = Math.sin(t * 18) * Math.min(0.06, sp * 0.004 + (S.landT > 0 ? 0.05 : 0) + (S.hitT > 0 ? 0.05 : 0) + (cart.boosting ? 0.03 : 0));
    M.belly.scale.set(1.02 - jig * 0.5, 0.92 + jig, 1 - jig * 0.3);
    // flame jet
    M.flame.visible = S.flameT > 0;
    if (M.flame.visible) {
      const f = 0.7 + Math.random() * 0.5, k = Math.min(1, S.flameT / 0.3);
      M.flameO.scale.set(f * k, f * k, (1 + Math.random() * 0.5) * k); M.flameI.scale.set(f * k, f * k, (0.8 + Math.random() * 0.5) * k);
    }
    // cheese stealth aura
    M.aura.material.opacity = S.shimmerT > 0 ? 0.1 + 0.06 * Math.sin(t * 9) : 0;
    M.aura.visible = S.shimmerT > 0;
    M.aura.scale.set(0.8 + Math.sin(t * 7) * 0.05, 1.35 + Math.sin(t * 5) * 0.05, 0.8 + Math.cos(t * 7) * 0.05);
  }
})();
