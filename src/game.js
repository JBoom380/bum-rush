// ─── CORE: renderer, camera, lights, states, integration ─────────────────────
(function () {
  const C = BR.config, T = THREE, bus = BR.bus;
  const MODS = ['audio', 'store', 'cart', 'people', 'rules', 'controls', 'ui'];
  BR._broken = {};
  const has = (m, fn) => BR[m] && typeof BR[m][fn] === 'function' && !BR._broken[m];
  // A crash inside one module disables that module instead of stopping the game.
  MODS.forEach(m => {
    const mod = BR[m]; if (!mod) return;
    Object.keys(mod).forEach(k => {
      const f = mod[k]; if (typeof f !== 'function') return;
      mod[k] = function () { try { return f.apply(mod, arguments); } catch (e) { console.error(`[BR.${m}.${k}]`, e); BR._broken[m] = true; } };
    });
  });
  const call = (m, fn, ...a) => (has(m, fn) ? BR[m][fn](...a) : undefined);

  // ── DOM ────────────────────────────────────────────────────────────────────
  const stage = document.getElementById('stage');
  const glCanvas = document.getElementById('gl'), uiCanvas = document.getElementById('ui');
  uiCanvas.width = C.UI_W; uiCanvas.height = C.UI_H;
  const uiCtx = uiCanvas.getContext('2d');
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const quality = isTouch ? 'low' : 'high';

  // ── Renderer ───────────────────────────────────────────────────────────────
  const renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: quality === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = quality === 'high'; renderer.shadowMap.type = T.PCFShadowMap;

  function fit() {
    const ww = window.innerWidth, wh = window.innerHeight, s = Math.min(ww / 16, wh / 9);
    const w = Math.floor(s * 16), h = Math.floor(s * 9);
    Object.assign(stage.style, { width: w + 'px', height: h + 'px', left: Math.floor((ww - w) / 2) + 'px', top: Math.floor((wh - h) / 2) + 'px' });
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  // ── Scene, camera, lights ──────────────────────────────────────────────────
  const scene = new T.Scene();
  scene.background = new T.Color(0xcfd6dc);
  scene.fog = new T.Fog(0xcfd6dc, 60, 190);
  const camera = new T.PerspectiveCamera(62, 16 / 9, 0.1, 400);
  const hemi = new T.HemisphereLight(0xfff4e0, 0x8a8a90, 1.6); scene.add(hemi);
  scene.add(new T.AmbientLight(0xffffff, 0.35));
  const sun = new T.DirectionalLight(0xffffff, 1.6);
  sun.position.set(30, 60, 20);
  if (quality === 'high') {
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 150 });
    sun.shadow.bias = -0.0005;
  }
  scene.add(sun); scene.add(sun.target);
  window.addEventListener('resize', fit); fit();

  const S = { shakeA: 0, shakeT: 0, slowF: 1, slowT: 0, music: null, results: null, notes: [], announce: [] };
  const NEUTRAL = { steer: 0, throttle: 0, brake: 0, drift: false, boost: false, boostPressed: false, gasNext: false, gasPrev: false, horn: false, pause: false, look: 0 };
  const core = BR.core = {
    THREE: T, scene, camera, renderer, time: 0, dt: 0, state: 'TITLE', input: NEUTRAL, quality, isTouch, sun, hemi,
    shake(a, s) { S.shakeA = Math.max(S.shakeA, a); S.shakeT = Math.max(S.shakeT, s || 0.3); },
    slowmo(f, s) { S.slowF = f; S.slowT = s || 0.5; },
  };

  // ── Init modules ───────────────────────────────────────────────────────────
  if (has('store', 'init')) BR.store.init(core);
  else {
    const floor = new T.Mesh(new T.PlaneGeometry(180, 120), new T.MeshLambertMaterial({ color: 0x9a9a9a }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  }
  ['cart', 'people', 'rules', 'controls'].forEach(m => call(m, 'init', core));

  // ── Camera rig (third-person chase; the cart module may override with cart.cameraTarget) ──
  const camPos = new T.Vector3(0, 6, 62), camLook = new T.Vector3(0, 1, 50), tmp = new T.Vector3();
  let fovKick = 0;
  function updateCamera(dt) {
    const c = BR.cart;
    if (!c || !c.pos) { camera.position.set(0, 8, 64); camera.lookAt(0, 1, 40); return; }
    const yaw = c.yaw || 0, sp = Math.min(1, (c.speed || 0) / C.CART.maxSpeed);
    const back = 4.0 + sp * 1.6, up = 2.1 + sp * 0.5 + (c.airborne ? 0.9 : 0); // close chase: the man fills the lower middle of the screen
    const look = (core.input.look || 0) * 1.2;
    tmp.set(c.pos.x + Math.sin(yaw + look) * back, c.pos.y + up, c.pos.z + Math.cos(yaw + look) * back);
    // keep the camera inside the store and out of the shelves
    if (has('store', 'collide')) BR.store.collide(tmp, 0.4);
    camPos.lerp(tmp, 1 - Math.exp(-dt * 6));
    if (has('store', 'collide')) BR.store.collide(camPos, 0.4); // the lerp can cut through a rack corner
    camLook.lerp(tmp.set(c.pos.x - Math.sin(yaw) * 3, c.pos.y + 1.5, c.pos.z - Math.cos(yaw) * 3), 1 - Math.exp(-dt * 10));
    camera.position.copy(camPos); camera.lookAt(camLook);
    fovKick += ((c.boosting ? 14 : 0) + sp * 8 - fovKick) * Math.min(1, dt * 4);
    camera.fov = 62 + fovKick; camera.updateProjectionMatrix();
    sun.position.set(c.pos.x + 30, 60, c.pos.z + 20); sun.target.position.set(c.pos.x, 0, c.pos.z);
  }
  function titleCamera(t) {
    const a = t * 0.08;
    camera.position.set(Math.sin(a) * 40, 12 + Math.sin(t * 0.3) * 2, Math.cos(a) * 30);
    camera.lookAt(0, 3, 0);
  }

  // ── States and actions ─────────────────────────────────────────────────────
  function music(n) { if (S.music !== n) { S.music = n; call('audio', 'setMusic', n); } }
  function startRun() {
    call('audio', 'init');
    const seed = (Math.random() * 1e9) | 0;
    call('cart', 'reset', C.START.x, C.START.z, C.START.yaw);
    call('people', 'reset');
    call('rules', 'startRun', seed);
    S.results = null; core.state = 'PLAY'; music('shop');
  }
  bus.on('runEnd', d => { S.results = d; core.state = 'RESULTS'; music('results'); });
  bus.on('announce', d => { S.announce.push({ text: d.text, t: core.time }); if (S.announce.length > 3) S.announce.shift(); call('audio', 'speak', d.text); });

  function doAction(a) {
    if (!a) return false;
    call('audio', 'sfx', 'click');
    switch (a.type) {
      case 'play': case 'again': startRun(); break;
      case 'resume': core.state = 'PLAY'; break;
      case 'title': core.state = 'TITLE'; music('title'); break;
      case 'how': S.how = true; break;
      case 'closeHow': S.how = false; break;
      case 'gas': if (BR.rules) BR.rules.gasSel = a.id; break;
      default: return false;
    }
    return true;
  }
  function view() {
    const r = BR.rules || {}, c = BR.cart || {};
    return {
      state: core.state, how: !!S.how, isTouch, time: core.time,
      list: r.list || [], timeLeft: r.timeLeft != null ? r.timeLeft : C.RUN_SECONDS, wanted: r.wanted || 0, score: r.score || 0, combo: r.combo || 0,
      gas: c.gas || {}, gasSel: r.gasSel || c.gasSel || 'beans', speed: c.speed || 0, best: (() => { try { return +localStorage.getItem('bumRush.best') || 0; } catch (e) { return 0; } })(),
      results: S.results, announcements: S.announce.filter(a => core.time - a.t < 6),
    };
  }

  window.addEventListener('keydown', e => {
    if (core.state === 'PLAY') return; // gameplay keys belong to controls
    const a = has('ui', 'key') ? BR.ui.key(e, view()) : null;
    if (a) { e.preventDefault(); doAction(a); return; }
    if (core.state === 'TITLE' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startRun(); }
    if (core.state === 'PAUSE' && e.key === 'Escape') core.state = 'PLAY';
  });
  stage.addEventListener('pointerdown', e => {
    call('audio', 'init');
    const r = uiCanvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * C.UI_W, y = (e.clientY - r.top) / r.height * C.UI_H;
    const a = has('ui', 'hit') ? BR.ui.hit(x, y, view()) : null;
    if (doAction(a)) return;
    if (core.state === 'TITLE' && !has('ui', 'hit')) startRun();
  });
  stage.addEventListener('contextmenu', e => e.preventDefault());

  // ── Loop ───────────────────────────────────────────────────────────────────
  let last = performance.now();
  function frame(now) {
    const real = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    core.time += real;
    if (S.slowT > 0) { S.slowT -= real; if (S.slowT <= 0) S.slowF = 1; }
    const dt = real * S.slowF; core.dt = dt;

    call('controls', 'update', real, core);
    core.input = core.state === 'PLAY' && BR.controls && BR.controls.state ? BR.controls.state : NEUTRAL;
    if (core.state === 'PLAY' && core.input.pause) core.state = 'PAUSE';

    if (core.state === 'PLAY') {
      ['cart', 'people', 'rules'].forEach(m => call(m, 'update', dt, core));
      if (core.state === 'PLAY') music(BR.rules && BR.rules.wanted >= 1 ? 'chase' : 'shop');
    }
    call('store', 'update', dt, core);
    if (core.state === 'PLAY' || core.state === 'PAUSE' || core.state === 'RESULTS') updateCamera(real); else titleCamera(core.time);

    if (S.shakeT > 0) {
      S.shakeT -= real; const k = S.shakeA * Math.max(0, S.shakeT) * 3;
      camera.position.x += (Math.random() - 0.5) * k * 0.3; camera.position.y += (Math.random() - 0.5) * k * 0.3;
      if (S.shakeT <= 0) S.shakeA = 0;
    }
    renderer.render(scene, camera);
    uiCtx.clearRect(0, 0, C.UI_W, C.UI_H);
    const v = view();
    call('ui', 'draw', uiCtx, core.time, v);
    if (core.state === 'PLAY' && isTouch) call('controls', 'drawTouch', uiCtx, core.time);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  music('title');

  // ── Debug hooks ────────────────────────────────────────────────────────────
  BR.debug = {
    play() { startRun(); },
    tp(x, z, yaw) { call('cart', 'reset', x, z, yaw || 0); },
    give(type, amount) { if (BR.cart && BR.cart.gas) BR.cart.gas[type] = Math.min(1, (BR.cart.gas[type] || 0) + (amount == null ? 1 : amount)); },
    fart(type) { return call('cart', 'fart', type || 'beans'); },
    wanted(n) { if (BR.rules) BR.rules.wanted = n; },
    state(name) { core.state = name; },
    time(s) { if (BR.rules) BR.rules.timeLeft = s; },
    cam(mode) { S.cam = mode; },
    view, S,
  };
})();
