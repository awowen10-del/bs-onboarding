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
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    alert: (m) => alerts.push(String(m)),
    confirm: () => true,
    // no supabase global and no BSJ_CONFIG => the app's local-only path
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  // Top-level `let` bindings (members, notesTarget, …) are not properties of the vm global,
  // so the app exposes nothing by itself. Append an accessor to reach them.
  const src = extract() + `
;globalThis.__t = {
  get members(){ return members; }, set members(v){ members = v; },
  get notesTarget(){ return notesTarget; },
  get fuTarget(){ return fuTarget; },
  get CACHE(){ return CACHE; }
};`;
  vm.runInContext(src, ctx, { filename: "index.html<script>" });

  // The Challengers list is filtered by two live controls; give them the values a freshly
  // loaded page has ("Everyone", empty search) so renderMembers isn't filtering to nothing.
  doc.getElementById("filter").value = "all";
  doc.getElementById("search").value = "";

  const seed = opts.members || [];
  ctx.__t.members = opts.raw ? seed : ctx.migrateList(JSON.parse(JSON.stringify(seed)));
  if (opts.render !== false) ctx.renderAll();

  return {
    ctx,
    els,
    alerts,
    execCommands,
    setFormatBlock(v) { formatBlockValue = v; },
    el: (id) => doc.getElementById(id),
    html: (id) => doc.getElementById(id).innerHTML,
    // what the app actually persisted through save() — the same blob that is pushed to
    // Supabase and picked up by every other device
    cached: () => JSON.parse(store.get(ctx.__t.CACHE) || "[]"),
    members: () => ctx.__t.members,
    find: (id) => ctx.__t.members.find((m) => m.id === id),
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

module.exports = { boot, daysFromToday, dateInput };
