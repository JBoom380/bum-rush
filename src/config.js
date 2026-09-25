// ─── CONFIG: tuning, content tables, rng, event bus ──────────────────────────
window.BR = window.BR || {};

BR.config = {
  UI_W: 1280, UI_H: 720,
  STORE: { minX: -90, maxX: 90, minZ: -60, maxZ: 60, ceiling: 14 },
  START: { x: 0, z: 52, yaw: 0 },
  RUN_SECONDS: 240,

  // Food -> gas. `gas` is how much of that gas type one pickup adds (0..1 meter).
  FOODS: {
    beans:    { name: 'Baked Beans',   gas: 'beans',    amount: 0.35, color: '#b5541c', icon: '🥫' },
    hotdog:   { name: 'Hot Dog',       gas: 'hotdog',   amount: 0.5,  color: '#e0a030', icon: '🌭' },
    burrito:  { name: 'Mega Burrito',  gas: 'burrito',  amount: 1.0,  color: '#d8b070', icon: '🌯' },
    broccoli: { name: 'Broccoli',      gas: 'broccoli', amount: 0.5,  color: '#3aa040', icon: '🥦' },
    cheese:   { name: 'Stinky Cheese', gas: 'cheese',   amount: 0.5,  color: '#f0d040', icon: '🧀' },
  },
  GAS_TYPES: ['beans', 'hotdog', 'burrito', 'broccoli', 'cheese'],

  // Shopping-list pool (the store places each where it fits its department).
  LIST_ITEMS: [
    { id: 'tv',        name: '85" Television',        dept: 'Electronics',  icon: '📺' },
    { id: 'tp',        name: '48-Pack Toilet Paper',  dept: 'Home & Garden', icon: '🧻' },
    { id: 'chicken',   name: 'Rotisserie Chicken',    dept: 'Meat & Deli',  icon: '🍗' },
    { id: 'mayo',      name: '1-Gallon Mayonnaise',   dept: 'Bulk Snacks',  icon: '🫙' },
    { id: 'tires',     name: 'Set of Tires',          dept: 'Tires',        icon: '🛞' },
    { id: 'teddy',     name: 'Giant Teddy Bear',      dept: 'Toys',         icon: '🧸' },
    { id: 'cake',      name: 'Half-Sheet Cake',       dept: 'Bakery',       icon: '🎂' },
    { id: 'icecream',  name: 'Tub of Ice Cream',      dept: 'Frozen',       icon: '🍨' },
    { id: 'bananas',   name: 'Bunch of Bananas',      dept: 'Produce',      icon: '🍌' },
    { id: 'pills',     name: 'Antacid Megapack',      dept: 'Pharmacy',     icon: '💊' },
    { id: 'chips',     name: 'Party-Size Chips',      dept: 'Bulk Snacks',  icon: '🍟' },
    { id: 'grill',     name: 'Propane Grill',         dept: 'Home & Garden', icon: '🔥' },
    { id: 'soda',      name: '36-Pack Soda',          dept: 'Bulk Snacks',  icon: '🥤' },
    { id: 'kayak',     name: 'Inflatable Kayak',      dept: 'Toys',         icon: '🛶' },
  ],
  LIST_SIZE: [6, 8],

  CART: { kickSpeed: 5.5, maxSpeed: 22, radius: 0.7 },
  WANTED: { perKnock: 0.08, decay: 0.03, guardsPerStar: 1, maxGuards: 6 },
};

// Seeded PRNG (mulberry32).
BR.rng = function (seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Event bus. A throwing listener is logged and skipped.
BR.bus = (function () {
  const h = {};
  return {
    on(n, f) { (h[n] = h[n] || []).push(f); },
    off(n, f) { if (h[n]) h[n] = h[n].filter(x => x !== f); },
    emit(n, d) { (h[n] || []).forEach(f => { try { f(d || {}); } catch (e) { console.error('[BR.bus ' + n + ']', e); } }); },
  };
})();
