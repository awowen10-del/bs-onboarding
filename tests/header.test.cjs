// The Onboarding tracker's HEADER — the count in the corner and the tab row under it.
//
// Two things it exists to hold. First, ONE headcount: the corner used to count live + paused
// + not-started while the date banner on Today's moves counted only the live ones, so the
// same screen said 19 in one place and 14 in the other. There is one rule now (onJourney)
// and one place it is shown (the masthead), and both halves of that are asserted here.
//
// Second, the tab markers. They are presentation, but each one is making a claim about the
// data underneath it, so they are worth a test: the star on The Playbook is fixed furniture,
// the dot on Birthdays is not — it appears only while somebody's birthday is actually inside
// the next month, which is the difference between a marker and a decoration.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const nav = (id) => {
  const i = HTML.indexOf('id="tabs-' + id + '"');
  return HTML.slice(i, HTML.indexOf("</nav>", i));
};
// one tab button out of a nav, by the view it switches to
const tab = (navHtml, view) => {
  const i = navHtml.indexOf('data-view="' + view + '"');
  if (i === -1) return "";
  return navHtml.slice(navHtml.lastIndexOf("<button", i), navHtml.indexOf("</button>", i));
};

// a challenger n days into their journey
const live = (id, name, day, extra) => Object.assign({
  id, name, coach: "Grace",
  day0: daysFromToday(-day), booked: daysFromToday(-day), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [], dob: null,
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
}, extra || {});
// booked in, clock not started — waiting on a first session
const preStart = (id, name, extra) => Object.assign({
  id, name, coach: "Grace", booked: daysFromToday(2), dob: null,
  completed: [], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
}, extra || {});

// an ISO date of birth n days from today, on some long-ago year
function dobIn(days) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, "0");
  return "1990-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/* ---------- 1: the corner is the only place the headcount is stated ---------- */
{
  const app = boot({ members: [live("a", "Sam Live", 8), live("b", "Bo Live", 20)] });
  assert.strictEqual(app.el("liveCount").textContent, "2", "two challengers are on the journey");

  const banner = app.html("todayBanner");
  assert.ok(/^It’s <strong>[^<]+<\/strong>\.$/.test(banner.trim()),
    "the banner is the date and nothing after it. Found: " + banner);
  assert.ok(!/challenger/.test(banner), "…so it does not quote a headcount");
  assert.ok(!/\d/.test(banner.replace(/<strong>[^<]*<\/strong>/, "")),
    "…and the only number left in it is the day of the month");

  // and the whole page says the number once — the corner
  assert.strictEqual((HTML.match(/id="liveCount"/g) || []).length, 1,
    "there is exactly one element holding the figure");
  assert.ok(/id="liveCount"[\s\S]{0,80}on the journey/.test(HTML),
    "…and it is labelled, so a bare number in the corner still reads as something");
}

/* ---------- 2: one rule behind it — on the journey means the clock is running ----------
   This is the fix for the two-numbers bug stated as behaviour rather than as wiring. Each of
   these four is a challenger the old masthead rule counted and the old banner rule did not
   (or the other way round); now there is nothing for them to disagree about. */
{
  const app = boot({ members: [
    live("live", "Sam Live", 8),                                   // counts
    preStart("new", "Ned New", { booked: daysFromToday(-1) }),     // not started — no
    live("paused", "Pat Paused", 10, { pausedAt: daysFromToday(-2) }),   // paused — no
    live("left", "Lee Left", 12, { outcome: "left" }),             // gone — no
    live("done", "Dee Done", 60),                                  // finished — no
  ] });
  assert.strictEqual(app.el("liveCount").textContent, "1",
    "only the challenger whose clock is running today is on the journey");
  assert.strictEqual(app.ctx.onJourneyCount(), 1, "and the rule agrees with what is on screen");

  // the figure is read from the rule, not maintained beside it: start Ned's clock and both move
  app.ctx.markFirstSession("new", true);          // exactly what the task's button calls
  assert.strictEqual(app.ctx.status(app.find("new")), "live", "sanity: Ned's clock is running");
  assert.strictEqual(app.el("liveCount").textContent, "2", "starting a clock puts them on it");
  assert.strictEqual(app.ctx.onJourneyCount(), 2);
}

/* ---------- 3: The Playbook wears the star, and it is the only tab that does ---------- */
{
  const ob = nav("onboarding");
  const playbook = tab(ob, "playbook");
  assert.ok(/class="[^"]*\btab-core\b/.test(playbook), "The Playbook is marked as the core tab");
  assert.ok(/<span class="tab-star"[\s\S]*?<svg/.test(playbook), "…and carries the star");
  assert.ok(playbook.includes("The Playbook"), "…without the marker replacing the name");
  assert.ok(/aria-hidden="true"/.test(playbook), "…and the star is decoration to a screen reader");

  for (const v of ["today", "members", "birthdays"]) {
    assert.ok(!/tab-star/.test(tab(ob, v)), "the " + v + " tab has no star — the star means one tab");
  }
}

/* ---------- 4: Today's moves leads, on both trackers ---------- */
{
  for (const [tracker, view] of [["onboarding", "today"], ["retention", "ret-today"]]) {
    const navHtml = nav(tracker);
    const first = navHtml.indexOf("<button");
    assert.strictEqual(navHtml.indexOf('data-view="' + view + '"') > first
      && navHtml.indexOf("<button", first + 1) > navHtml.indexOf('data-view="' + view + '"'), true,
      tracker + ": Today's moves is the first tab in the row");
    assert.ok(/class="[^"]*\btab-lead\b/.test(tab(navHtml, view)),
      tracker + ": …and is marked as the one a coach lands on");
    assert.ok(/aria-selected="true"/.test(tab(navHtml, view)),
      tracker + ": …and is the tab selected on load");
  }
}

/* ---------- 5: the Birthdays dot is lit only when there is a birthday coming ---------- */
{
  // nobody with a date of birth at all
  const none = boot({ members: [live("a", "Sam Live", 8)] });
  assert.ok(!none.el("bdayDot").classList.contains("on"), "no dobs, no dot");

  // one, a fortnight out
  const soon = boot({ members: [live("a", "Sam Live", 8, { dob: dobIn(14) })] });
  assert.ok(soon.el("bdayDot").classList.contains("on"), "a birthday a fortnight away lights it");

  // one, half a year out
  const far = boot({ members: [live("a", "Sam Live", 8, { dob: dobIn(180) })] });
  assert.ok(!far.el("bdayDot").classList.contains("on"), "one six months out does not");

  // today's own birthday counts as coming up — it is the day it needs doing
  const today = boot({ members: [live("a", "Sam Live", 8, { dob: dobIn(0) })] });
  assert.ok(today.el("bdayDot").classList.contains("on"), "today's birthday lights it");

  // and one that has just gone does not keep it lit
  const gone = boot({ members: [live("a", "Sam Live", 8, { dob: dobIn(-3) })] });
  assert.ok(!gone.el("bdayDot").classList.contains("on"), "a birthday three days ago does not");

  // the boundary, either side of it
  assert.strictEqual(boot({ members: [live("a", "A", 8, { dob: dobIn(30) })] })
    .el("bdayDot").classList.contains("on"), true, "30 days is inside the window");
  assert.strictEqual(boot({ members: [live("a", "A", 8, { dob: dobIn(45) })] })
    .el("bdayDot").classList.contains("on"), false, "45 days is outside it");
}

/* ---------- 6: it is a marker, not a count, and it reads the right roster ---------- */
{
  const app = boot({
    members: [live("a", "Sam Live", 8, { dob: dobIn(5) }), live("b", "Bo Live", 9, { dob: dobIn(6) })],
    retention: [],
  });
  const dot = nav("onboarding").match(/<span class="tab-dot"[^>]*><\/span>/);
  assert.ok(dot, "the dot is an empty span — nothing to fill with a number");
  assert.ok(app.el("bdayDot").classList.contains("on"), "two birthdays light the same one dot");
  assert.strictEqual(app.el("bdayDot").textContent, "", "…and put no digits in it");

  // the two trackers keep their own dots: a challenger's birthday says nothing about members
  assert.ok(!app.el("retBdayDot").classList.contains("on"),
    "the retention dot is dark — its roster is empty");
  assert.ok(/id="retBdayDot"/.test(nav("retention")), "…and it is on the retention Birthdays tab");

  const both = boot({
    members: [live("a", "Sam Live", 8)],
    retention: [{ id: "r1", name: "Mo Member", coach: "Dan", dob: dobIn(3), joined: daysFromToday(-90) }],
  });
  assert.ok(both.el("retBdayDot").classList.contains("on"), "a member's birthday lights the retention dot");
  assert.ok(!both.el("bdayDot").classList.contains("on"), "…and not the onboarding one");
}

/* ---------- 7: a dot with no dob, and a broken dob, are both just no dot ---------- */
{
  assert.strictEqual(boot({ members: [live("a", "A", 8, { dob: "not-a-date" })] })
    .el("bdayDot").classList.contains("on"), false, "a nonsense dob cannot light it");
  assert.strictEqual(boot({ members: [live("a", "A", 8, { dob: "1990-13-40" })] })
    .el("bdayDot").classList.contains("on"), false, "…nor an impossible one");
  assert.strictEqual(boot({ members: [] }).el("bdayDot").classList.contains("on"), false,
    "…nor an empty roster");
}

console.log("header.test.cjs: OK");
