// Test sandbox for the index.html inline script.
//
// Boots the whole tracker in a vm context against a stub DOM and a stub localStorage, with
// no Supabase client — which is exactly the app's "local-only mode" path, so save() writes
// the roster to the cache and nothing tries to reach the network. Tests drive the real
// functions (setOutcome, confirmFollowUp, notesFlush, renderToday, …) and assert on the HTML
// the real renderers produce.
//
// The stub elements store innerHTML/textContent/value/classList for real, because that IS
// what the assertions read: "does the follow-up row appear on Today", "is the notes icon
// coloured", "did the modal open".
const vm = require("vm");
const { extract } = require("./extract.cjs");

// The gym is in Warrington and the follow-up dates are calendar days, so the clock changes
// matter. Pin the zone or a machine running UTC would hide a DST bug.
process.env.TZ = process.env.TZ || "Europe/London";

function classListFor(el) {
  return {
    add(...cs) { cs.forEach((c) => el.__classes.add(c)); },
    remove(...cs) { cs.forEach((c) => el.__classes.delete(c)); },
    toggle(c, force) {
      const on = force === undefined ? !el.__classes.has(c) : !!force;
      if (on) el.__classes.add(c); else el.__classes.delete(c);
      return on;
    },
    contains(c) { return el.__classes.has(c); },
  };
}

// A stand-in for the Supabase browser client — only the calls the app actually makes: one
// select-in over the key/value table, upserts, and a realtime channel. Tests that ask for it
// (with `cloud:`) drive the app's REAL cloud path: bootData pulls rows out of `table`, every
// write lands in `upserts`, and `emit()` delivers a change the way the server would, so
// "another coach tapped it on their phone" is something a test can actually do.
function fakeCloud(seedRows) {
  const table = new Map(Object.entries(seedRows || {}));   // key -> value (the JSON column)
  const upserts = [];
  const handlers = [];
  const stamp = (k) => (table.has(k + "@t") ? table.get(k + "@t") : new Date(0).toISOString());

  const client = {
    from() {
      return {
        select() {
          return {
            in(col, keys) {
              const data = keys.filter((k) => table.has(k))
                .map((k) => ({ key: k, value: table.get(k), updated_at: stamp(k) }));
              return Promise.resolve({ data, error: null });
            },
          };
        },
        upsert(row) {
          upserts.push(JSON.parse(JSON.stringify(row)));
          table.set(row.key, row.value);
          if (row.updated_at) table.set(row.key + "@t", row.updated_at);
          return Promise.resolve({ error: null });
        },
      };
    },
    channel() {
      const ch = {
        on(evt, opts, fn) { handlers.push({ filter: opts && opts.filter, fn }); return ch; },
        subscribe() { return ch; },
      };
      return ch;
    },
  };

  return {
    client,
    upserts,
    table,
    // what the app pushed for a given key, most recent last
    writesTo: (key) => upserts.filter((u) => u.key === key),
    lastWriteTo(key) { const w = this.writesTo(key); return w.length ? w[w.length - 1] : null; },
    // deliver a realtime change for `key`, as another device's write would arrive
    emit(key, value, updatedAt) {
      const payload = { new: { key, value, updated_at: updatedAt || new Date().toISOString() } };
      handlers.filter((h) => h.filter === "key=eq." + key).forEach((h) => h.fn(payload));
    },
    subscribedTo: () => handlers.map((h) => h.filter),
  };
}

function fakeElement(id) {
  const attrs = {};
  const el = {
    id,
    dataset: {},
    style: {},
    value: "",
    textContent: "",
    innerHTML: "",
    src: "",
    alt: "",
    hidden: false,
    disabled: false,
    __classes: new Set(),
    __listeners: {},
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    setAttribute(k, v) { attrs[k] = String(v); },
    hasAttribute(k) { return k in attrs; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener(type, fn) { (this.__listeners[type] = this.__listeners[type] || []).push(fn); },
    removeEventListener() {},
    // fire a listener the app registered, so gate/backdrop wiring is drivable
    __fire(type, ev) { (this.__listeners[type] || []).forEach((fn) => fn(ev || {})); },
    appendChild() {},
    remove() {},
    focus() {},
    blur() {},
    select() {},
    click() {},
    scrollIntoView() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
  Object.defineProperty(el, "className", {
    get() { return [...el.__classes].join(" "); },
    set(v) { el.__classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  // A real DOM stringifies these on assignment (el.textContent = 3 reads back as "3"), and
  // the app does assign numbers — the counters. Coerce, or tests compare against the wrong type.
  for (const prop of ["textContent", "innerHTML", "value"]) {
    let v = "";
    Object.defineProperty(el, prop, {
      get() { return v; },
      set(next) { v = next == null ? "" : String(next); },
      enumerable: true,
    });
  }
  el.classList = classListFor(el);
  return el;
}

// opts:
//   members  — roster the app boots with (written straight into the cache, i.e. what a
//              returning device would have). Passed through the app's own migrateList.
//   raw      — true: put `members` into the cache untouched, so migration itself is testable.
//   cloud    — {rows} : install a stub Supabase client seeded with those key/value rows, so
//              `await app.ctx.bootData()` runs the app's real connected path instead of the
//              local-only one. Seed data through `rows`, not `members`, in a cloud test —
//              bootData replaces the in-memory lists with what it pulls.
function boot(opts = {}) {
  const store = new Map();
  const els = new Map();
  const execCommands = [];   // every document.execCommand the app issued
  let formatBlockValue = "";

  const doc = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, fakeElement(id));
      return els.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return fakeElement("el:" + tag); },
    addEventListener() {},
    removeEventListener() {},
    body: fakeElement("body"),
    documentElement: fakeElement("html"),
    execCommand(cmd, ui, arg) { execCommands.push({ cmd, arg }); return true; },
    queryCommandValue(cmd) { return cmd === "formatBlock" ? formatBlockValue : ""; },
  };

  const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };

  const alerts = [];
  const ctx = {
    document: doc,
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    // The app polls the cloud on an interval (the fallback for a dead realtime channel). A
    // browser tab lives forever so that is free; a node test process would simply never exit,
    // so the sandbox's intervals are unref'd. They still fire while a test is running.
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); if (t && t.unref) t.unref(); return t; },
    clearInterval,
    Date,
    Math,
    JSON,
    alert: (m) => alerts.push(String(m)),
    confirm: () => true,
    // no supabase global and no BSJ_CONFIG => the app's local-only path
  };
  // …unless a test asked for the connected path, in which case both are in place before the
  // app script runs, exactly as the two <script> tags in the page put them there.
  const cloud = opts.cloud ? fakeCloud(opts.cloud.rows) : null;
  if (cloud) {
    ctx.BSJ_CONFIG = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "test-anon-key", GYM_PASSWORD: "x" };
    ctx.supabase = { createClient: () => cloud.client };
  }
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  // Top-level `let` bindings (members, notesTarget, …) are not properties of the vm global,
  // so the app exposes nothing by itself. Append an accessor to reach them.
  const src = extract() + `
;globalThis.__t = {
  get members(){ return members; }, set members(v){ members = v; },
  get retention(){ return retention; }, set retention(v){ retention = v; },
  get tracker(){ return tracker; },
  get activeTab(){ return activeTab; },
  get memberFilter(){ return memberFilter; },
  get MEMBER_FILTERS(){ return MEMBER_FILTERS; },
  get BIRTHDAY_MILESTONES(){ return BIRTHDAY_MILESTONES; },
  get showIgnoredBirthdays(){ return showIgnoredBirthdays; },
  get showBirthdayExamples(){ return showBirthdayExamples; },
  get notesTarget(){ return notesTarget; },
  get fuTarget(){ return fuTarget; },
  get CACHE(){ return CACHE; },
  get RET_CACHE(){ return RET_CACHE; },
  // the journey definitions — top-level consts, so not properties of the vm global either
  get JOURNEY(){ return JOURNEY; },
  get TABLE_COLS(){ return TABLE_COLS; },
  get MEMBER_JOURNEY(){ return MEMBER_JOURNEY; },
  get MEMBER_COLS(){ return MEMBER_COLS; }
};`;
  // localStorage as it is BEFORE the app script runs — a returning device. The app reads a
  // key or two at load (the theme), so they have to be in place first, not written after.
  for (const [k, v] of Object.entries(opts.stored || {})) store.set(k, String(v));

  vm.runInContext(src, ctx, { filename: "index.html<script>" });

  // The Challengers list is filtered by two live controls. The search box gets the value a
  // freshly loaded page has; the filter is a row of tabs now rather than a dropdown, and it
  // defaults to Currently Active in the app itself, so a test that wants another group asks
  // for it by name: app.ctx.setMemberFilter("left"). There is no "everyone" to fall back to —
  // the five tabs are a partition, so seeing everybody at once is not a state the screen has.
  doc.getElementById("search").value = "";

  const seed = opts.members || [];
  ctx.__t.members = opts.raw ? seed : ctx.migrateList(JSON.parse(JSON.stringify(seed)));
  // The retention tracker's own roster — the second list in the same backend. Seeded the
  // same way, through the app's own migration, so a test boots the state a real device has.
  const retSeed = opts.retention || [];
  ctx.__t.retention = opts.raw ? retSeed : ctx.migrateRetentionList(JSON.parse(JSON.stringify(retSeed)));
  if (opts.render !== false) ctx.renderAll();

  return {
    ctx,
    els,
    alerts,
    cloud,
    execCommands,
    setFormatBlock(v) { formatBlockValue = v; },
    el: (id) => doc.getElementById(id),
    html: (id) => doc.getElementById(id).innerHTML,
    // what the app actually persisted through save() — the same blob that is pushed to
    // Supabase and picked up by every other device
    cached: () => JSON.parse(store.get(ctx.__t.CACHE) || "[]"),
    members: () => ctx.__t.members,
    find: (id) => ctx.__t.members.find((m) => m.id === id),
    // the retention tracker's equivalents — its own list, its own cache blob
    retentionCached: () => JSON.parse(store.get(ctx.__t.RET_CACHE) || "[]"),
    retention: () => ctx.__t.retention,
    findMember: (id) => ctx.__t.retention.find((m) => m.id === id),
    // what localStorage holds, for the keys the app persists outside the rosters
    stored: (k) => (store.has(k) ? store.get(k) : null),
  };
}

// Local-midnight timestamp n days from today — the app's own notion of a day boundary.
function daysFromToday(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.getTime();
}
function dateInput(ts) {
  const d = new Date(ts), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// let a debounced write (save(), saveRetention(), saveTracker() — all 400ms) actually land
const settle = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 500 : ms));

module.exports = { boot, daysFromToday, dateInput, settle };
