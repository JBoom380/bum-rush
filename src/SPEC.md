# BUM RUSH: a game by Jon Hill. Shared build contract

Every builder reads this first. Edit ONLY your own file. Do not edit `game.js`, `config.js`, `dev.html`, `build.py` or this file. Report any contract change you need.

## The game
A third-person comedy racing/chaos game. A scruffy man rides a shopping cart through BULKZILLA WAREHOUSE, a gigantic bulk warehouse store (made-up brand: never use real store names or logos). He eats food he grabs off the shelves, and the food turns into gas. Farts are his engine: they propel, launch and weaponise the cart. Every run has a random SHOPPING LIST. Grab every item and reach the checkout before the store closes (the timer). Knocking things over raises the WANTED meter (0 to 5 stars) and brings security guards who chase you. Caught = thrown out (the run ends). Style (drifts, air time, knocked-over pyramids, near misses) scores points. Tone: loud, silly, slapstick, cartoon (Saturday-morning cartoon / party-kart game). Crude fart humour is the joke. No other crude content, no gore, no swearing on screen.

Credit line everywhere the title appears: "a game by Jon Hill".

## Files and load order (classic scripts, global `window.BR`; no modules, no network, no image/audio files)
1. `vendor/three.global.js` (THREE r186, done)
2. `config.js` (done): tuning, FOODS, LIST_ITEMS, `BR.rng`, `BR.bus`
3. `audio.js` -> `BR.audio`
4. `store.js` -> `BR.store`
5. `cart.js` -> `BR.cart`
6. `people.js` -> `BR.people`
7. `rules.js` -> `BR.rules`
8. `controls.js` -> `BR.controls`
9. `ui.js` -> `BR.ui`
10. `game.js` (core, done)
`dev.html` loads them with `<script src>`. `build.py` inlines them into `../index.html` (one offline file, served at games.johnslagboom.com/bum-rush/). The `ref/` folder has modules from our earlier game (controls, audio, ui) whose techniques you may copy and adapt. Every module must tolerate every other module being absent (`if (BR.x && BR.x.fn)`). The core wraps each public function in try/catch; a throw disables only that module and logs `[BR.module.fn]`.

## Look
Bright cartoon 3D: chunky, toy-like, bold saturated colours, MeshToonMaterial (a 3-step gradient) or MeshLambert, thick silhouettes, a soft-shadow feel (fake blob shadows under movers; one real shadow-casting directional light is allowed on 'high'). The rendering is full resolution: devicePixelRatio capped at 2 (high) or 1 (low). No pixel filter. The core owns the renderer, the camera, the lights (a warm hemisphere + a directional "skylight" + bright ambient; a warehouse is evenly lit) and scene.fog (a light haze far down the aisles). Colours: warehouse concrete grey floor with yellow safety lines, orange/blue steel racking, cardboard browns, and product boxes in a candy palette.

## World frame
Metres, +Y up. The warehouse interior spans about x -90..90, z -60..60 (180 x 120 m) with a 14 m ceiling. The entrance and checkout lanes are at the south wall (z about +55). The aisles run north-south. The player spawns at the entrance, facing north (-Z).

## Core `BR.core` (created by game.js before the inits)
```
BR.core = { THREE, scene, camera, renderer, time, dt (clamped 0.05), state, input, quality ('high'|'low'), isTouch,
            shake(amount, seconds), slowmo(factor, seconds), sun (DirectionalLight), hemi }
```
state: 'TITLE' | 'PLAY' | 'PAUSE' | 'RESULTS'. `input` = `BR.controls.state` in PLAY, else neutral.

## Event bus `BR.bus` (config.js): on/off/emit
- `eat` {food, gas}: a food was eaten (cart/rules)
- `fart` {type, power, pos}: a fart fired (cart); audio + fx + people react
- `knock` {pos, value, kind}: something was knocked over (store); rules adds chaos + score; people react
- `collect` {item}: a list item grabbed (store -> rules)
- `caught` {by}: a guard caught the player (people -> rules)
- `stun` {pos, radius, kind}: a stun area (a broccoli cloud) for people
- `stealth` {seconds}: the cheese fart; guards lose track
- `announce` {text}: a PA announcement (audio speaks it with speechSynthesis; ui shows a ticker)
- `score` {points, reason, pos}: a style score popup (ui)
- `runEnd` {win, reason, score}

## Modules

### BR.store (store.js)
```
init(core); update(dt, core)
bounds                      // {minX, maxX, minZ, maxZ}
collide(pos, radius) -> {hit, normal}   // pushes pos out of shelves/walls/pillars/checkouts (XZ), returns the contact normal
floorAt(x, z) -> y          // 0 except ramps (loading-dock ramps, a pallet ramp or two for jumps)
spots                       // named locations: entrance, checkout lanes, departments {name, x, z}
spawnFood(type, x, z)       // place food pickups; the store also places ~60 food pickups at start (sample stations, open boxes, hot dog stand)
listItems                   // the current shopping-list pickups [{id, name, x, z, taken}]
setupRun(seed, list)        // place the list items for this run, reset the knocked props
pickups                     // query: nearest(pos, r) etc. (define it)
props                       // the knockable physics props: can pyramids, stacked boxes, TP towers, cones, balloons, sample tables
```
Content: departments with signs (Produce, Bakery, Meat & Deli, Frozen (cold fog, freezer doors), Electronics (huge TVs), Home & Garden, Toys, Bulk Snacks, Pharmacy, Tires, Hot Dog Stand + food court, Sample Stations), tall pallet racking to the ceiling, forklift aisles, end-cap displays, pyramids of cans and giant cereal boxes (knockable: simple physics that tumble and scatter; each emits `knock`), wet-floor spills (low friction), ramps made of stacked pallets, a loading dock, checkout lanes with belts and a big CHECKOUT sign, flat-pack furniture, bulk paper-towel walls. Must run 60 fps on phones: instancing, merged statics, pooled physics bodies (max ~150 active).

### BR.cart (cart.js)
```
init(core); update(dt, core)
pos, vel, yaw, speed, airborne, gas {beans, hotdog, burrito, broccoli, cheese} (0..1 each), gasTotal
fart(type) -> bool         // fire the selected gas type (from input.boost with rules/ui selection or auto-pick)
eat(food)                  // called when driving over food; adds gas, plays chomp; emits 'eat'
bump(dir, force)           // external hits (guards tackling, forklifts)
reset(x, z, yaw)           // place the cart and the man at a start, clear velocity and gas (core calls it at run start)
boosting                   // bool: a boost is active (core kicks the FOV)
gasSel                     // the selected gas type (rules.gasSel wins if set)
```
The core owns the camera: a chase camera behind `pos` at `yaw` (yaw 0 faces -Z). Keep `pos` at the cart's floor centre.
The man: a scruffy cartoon guy (beard, beanie, stained tank top, big belly, shorts, flip-flops) riding standing on the back of the cart (or in the basket for the burrito launch). The cart: a chrome wire basket with a red handle and wobbly wheels. The physics: the player kicks the floor to push (slow, 5 m/s max without gas), steering with momentum and a drift (handbrake = drift; wheels squeal), collisions bounce off shelves, tip-over risk when turning too fast (a comedic wipeout, recover in 1.5 s). The gas types:
- beans: a sustained thrust (hold), up to 16 m/s, a brown puff trail
- hotdog: an instant burst (+10 m/s), a yellow puff
- burrito: a ROCKET LAUNCH: huge thrust + upward launch (airborne 1.5 to 2.5 s over displays), a camera shake, a fireball-orange cloud, an epic sound
- broccoli: a big lingering green cloud behind the cart (emits `stun`), a small push
- cheese: silent but deadly: a faint yellow shimmer; emits `stealth` 6 s; security loses track
Fart visuals: stylised cartoon clouds (puffy spheres that expand and fade), speed lines, a comic "PFFT"/"BRAAP" text burst for big ones (ui can show them from the `fart` event). The camera: third-person chase, spring arm, FOV kick when boosting, a shake on the burrito launch and crashes.

### BR.people (people.js)
```
init(core); update(dt, core)
list                        // shoppers, staff, security, forklifts
reset()                     // clear the guards, respawn the shoppers/staff (core calls it at run start)
```
Shoppers pushing carts (dodge, scream, fall over when hit: slapstick, no injury), staff restocking and sample ladies (offer food: a free sample pickup), forklifts carrying pallets on routes (big obstacles; honk), and SECURITY GUARDS (a stocky guard with a cap and a radio) spawned by the wanted level (1 per star, max 6). They chase the player on foot; at 4+ stars there are guards on mobility scooters. They tackle when adjacent (emit `caught`), are stunned by broccoli clouds (a dizzy swirl, 4 s), and lose track during stealth. PA announcements via `announce` at events ("Security to aisle 12", "Cleanup on aisle 7", "Attention shoppers: a man is FARTING in Electronics"). Cartoon bodies built from primitives with toon shading, bouncy walk cycles, and funny reactions (hands up, gasp, fan the air, pinch the nose near fart clouds).

### BR.rules (rules.js)
```
init(core); update(dt, core)
startRun(seed)              // pick a shopping list (6 to 8 items from config.LIST_ITEMS), call store.setupRun, reset the timer/wanted/score
timeLeft, list, wanted (0..5), chaos, score, combo, running, gasSel (the selected gas type; controls' gasNext/gasPrev/1-5 change it)
```
The timer starts at 4:00 (the store closing), and the PA counts down at 60/30/10 s. Chaos from `knock` raises the wanted level (it decays slowly when you are calm). Win = all the list items + reach the checkout zone -> `runEnd` {win:true}, with a score breakdown (time bonus, style, chaos, items). Lose = the timer runs out or caught -> `runEnd` {win:false}. Style points: drift seconds, air time, near misses of shoppers/forklifts (< 1 m at speed), pyramids toppled, the fart chain combo (farts within 2 s multiply). Best score saved in localStorage 'bumRush.best'.

### BR.controls (controls.js)
`state = { steer (-1..1), throttle (0..1: kick/push forward), brake (0..1), drift (bool), boost (held), boostPressed (one frame), gasNext/gasPrev (one frame), horn (one frame), pause (one frame), look (-1..1 camera orbit) }`
Desktop: W/Up = kick forward, S/Down = brake/reverse, A/D steer, Space = drift, Shift or E = fart (hold for beans), Q/R or the mouse wheel = cycle the gas type, 1-5 = pick a gas type, H = the horn (a cart bell), Esc = pause. Gamepad: the left stick steers, RT kick, LT brake, A fart, B drift, bumpers cycle the gas. Touch: a left steering slider/joystick, the right: a big FART button (hold), a KICK button, a DRIFT button, the gas-type picker (5 food icons) along the right edge. `drawTouch(ctx, t)` draws on the 1280x720 UI canvas.

### BR.ui (ui.js)
`draw(ctx, t, view)`, `hit(x, y, view) -> action|null`, `key(e, view) -> action|null`. The UI canvas is 1280x720, letterboxed 16:9 and crisp.
view = { state, list:[{name, icon, taken}], timeLeft, wanted, score, combo, gas:{beans...}, gasSel, speed, best, results:{win, reason, breakdown}, announcements:[...], isTouch }
Screens: TITLE (a giant bouncy "BUM RUSH" cartoon logo: brown-and-yellow, a cart, fart-cloud letters; the subtitle "a game by Jon Hill"; PLAY / HOW TO PLAY; the best score), HUD (the shopping list as a receipt with the items checked off; a big analog store clock or a countdown; the wanted stars as sheriff badges; the GAS meter: 5 food icons with fill bars and the selected type highlighted; a speedometer; score/combo popups; comic fart onomatopoeia bursts from the `fart` events; the PA ticker), PAUSE, RESULTS (WIN: "CHECKED OUT!" with a receipt-style score breakdown; LOSE: "THROWN OUT!" or "STORE CLOSED!"; buttons PLAY AGAIN / TITLE), and HOW TO PLAY (a simple illustrated card). Actions: {type:'play'}, {type:'how'}, {type:'resume'}, {type:'title'}, {type:'again'}, {type:'gas', id}.

### BR.audio (audio.js)
`init()`, `setMusic(name)` ('title'|'shop'|'chase'|'results'|null), `sfx(name, opts)`, `speak(text)` (PA voice: speechSynthesis with a slightly bored store-announcer voice; duck the music), `setVolume(v)`.
The FART SYNTH is the star: a big, varied library generated procedurally (a filtered noise + pulse/saw buzz with an amplitude flutter at 20 to 60 Hz, pitch bends, "wet" bubbles, a rasp, a squeak). Each gas type has its own family: beans = a long sputtering motorboat, hotdog = a short sharp blat, burrito = a massive thunderous rip with a rumble and a tail, broccoli = a wet gurgling cloud, cheese = an almost silent hiss with a comic squeak at the end. Randomise every fart (never the same twice). Also: cart wheel rattle (speed-dependent loop), wheel squeal (drift), crashes (metal cart clang + cardboard thuds + cans cascading), chomp/munch/gulp, a burp, shopper screams/gasps ("EWW!" via short formant blips, no speech), the security whistle and radio chatter blips, the forklift beep, the checkout scanner beep, a cash register cha-ching, and crowd gasps. Music: upbeat funky elevator-muzak parody for 'shop' (a Rhodes, a bass, a light drum kit, a cheesy lead), a frantic chase version (the tempo rises with the wanted level), a jingly title, and a results fanfare. Keep the crash-safety rules from ref/audio.js (no onended; per-loop buses; look-ahead scheduler; voice cap; limiter).

## Testing
`python tools/shot.py out.png --eval "BR.debug.play()"` from src/ uses headless Chrome on the REAL GPU. IMPORTANT: advance time with a requestAnimationFrame-loop Promise (not wait_for_timeout; headless frames do not advance during plain waits). Debug hooks (core): `BR.debug.play()`, `BR.debug.tp(x, z, yaw)`, `BR.debug.give(gasType, amount)`, `BR.debug.fart(type)`, `BR.debug.wanted(n)`, `BR.debug.state(name)`, `BR.debug.time(seconds)`, `BR.debug.cam(mode)`. Look at every screenshot with the Read tool and iterate until it is funny and polished. Never run taskkill on chrome.exe globally.
