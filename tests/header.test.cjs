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

// The dot's window is a CALENDAR MONTH, so the fixtures are built out of months and days
// rather than "n days from today" — a day offset lands in a different month depending on when
// the suite is run, which is exactly the confusion this window exists to remove.
const NOW = new Date();
const CUR_M = NOW.getMonth() + 1;                 // 1-12
const CUR_D = NOW.getDate();
const DAYS_IN_CUR_M = new Date(NOW.getFullYear(), CUR_M, 0).getDate();
const NEXT_M = (CUR_M % 12) + 1;                  // wraps December -> January
const OTHER_M = CUR_M === 6 ? 12 : 6;             // a month that is neither of those
// an ISO date of birth on a given month and day, in some long-ago year
const dob = (m, d) => "1990-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
// is the Birthdays dot lit for a roster holding exactly one dob?
const lit = (isoDob) => boot({ members: [live("a", "A", 8, { dob: isoDob })] })
  .el("bdayDot").classList.contains("on");

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

/* ---------- 5: no birthday this month means NO dot ----------
   The bug this block is here for: on 21 August, with not one August birthday on file, the dot
   was lit — a rolling 30-day window had reached forward into September and picked up a
   birthday on the 5th. Tapping the tab then showed "August · This month" with nobody in it.
   The dot now answers the same question that group does, and every case below is stated as
   "is there anybody left in THIS month", never as a number of days. */
{
  // an empty roster, and a roster with nobody's date of birth on file
  assert.strictEqual(boot({ members: [] }).el("bdayDot").classList.contains("on"), false,
    "an empty roster cannot light the dot");
  assert.strictEqual(boot({ members: [live("a", "Sam Live", 8)] })
    .el("bdayDot").classList.contains("on"), false, "no dobs on file, no dot");

  // THE REPORTED CASE: the only birthday on the roster is in NEXT month. Whether that is
  // days away or weeks away is not the question — it is not in the month the tab opens on.
  assert.strictEqual(lit(dob(NEXT_M, 1)), false,
    "the 1st of next month does not light this month's dot, however close it is");
  assert.strictEqual(lit(dob(NEXT_M, 15)), false, "…nor the middle of next month");
  assert.strictEqual(lit(dob(OTHER_M, 15)), false, "…nor a month on the far side of the year");

  // and the same roster with nothing in it lights nothing on either tracker
  const quiet = boot({ members: [live("a", "Sam", 8, { dob: dob(NEXT_M, 1) })], retention: [] });
  assert.strictEqual(quiet.el("bdayDot").classList.contains("on"), false,
    "a roster whose only birthday is next month leaves the tab unmarked");
}

/* ---------- 6: a birthday still to come this month DOES light it ---------- */
{
  // today's own birthday counts as coming up — it is the day it needs doing
  assert.strictEqual(lit(dob(CUR_M, CUR_D)), true, "today's birthday lights the dot");

  // later this month, wherever there is a later day to test
  if (CUR_D < DAYS_IN_CUR_M) {
    assert.strictEqual(lit(dob(CUR_M, CUR_D + 1)), true, "tomorrow lights it");
    assert.strictEqual(lit(dob(CUR_M, DAYS_IN_CUR_M)), true, "so does the last day of the month");
  }

  // one that has already been does not keep it lit — it is not coming up any more
  if (CUR_D > 1) {
    assert.strictEqual(lit(dob(CUR_M, 1)), false, "the 1st, once it has gone, does not light it");
    assert.strictEqual(lit(dob(CUR_M, CUR_D - 1)), false, "…nor yesterday");
  }

  // one person in the window is enough, and it is the same one dot however many there are
  const many = boot({ members: [
    live("a", "Sam", 8, { dob: dob(CUR_M, CUR_D) }),
    live("b", "Bo", 9, { dob: dob(CUR_M, CUR_D) }),
    live("c", "Cal", 10, { dob: dob(NEXT_M, 2) }),
  ] });
  assert.ok(many.el("bdayDot").classList.contains("on"), "two in the window light it");
  assert.strictEqual(many.el("bdayDot").textContent, "", "…and put no digits in it");
  assert.ok(nav("onboarding").match(/<span class="tab-dot"[^>]*><\/span>/),
    "the dot is an empty span — a marker, with nothing to fill with a number");
}

/* ---------- 7: both dots point at the same merged tab, so both read everybody ----------
   The Birthdays tab is one merged screen shown from either tracker. A dot that lit only for
   its own list would be pointing at a tab that has the other list on it too. */
{
  const app = boot({
    members: [live("a", "Sam Live", 8, { dob: dob(CUR_M, CUR_D) })],
    retention: [],
  });
  assert.ok(app.el("bdayDot").classList.contains("on"), "the challenger's birthday lights the dot");
  assert.ok(app.el("retBdayDot").classList.contains("on"),
    "…on both, because both open the same tab and that tab has them on it");
  assert.ok(/id="retBdayDot"/.test(nav("retention")), "the retention dot is on its Birthdays tab");

  const both = boot({
    members: [live("a", "Sam Live", 8, { dob: dob(NEXT_M, 1) })],
    retention: [{ id: "r1", name: "Mo Member", coach: "Dan", dob: dob(CUR_M, CUR_D),
      joined: daysFromToday(-90) }],
  });
  assert.ok(both.el("retBdayDot").classList.contains("on"), "a member's birthday lights the dot");
  assert.ok(both.el("bdayDot").classList.contains("on"),
    "…on both, for the same reason: the tab they point at is the same merged tab");
}

/* ---------- 8: a dob it cannot read is no dot, never a lit one ---------- */
{
  assert.strictEqual(lit("not-a-date"), false, "a nonsense dob cannot light it");
  assert.strictEqual(lit("1990-13-40"), false, "…nor an impossible one");
  assert.strictEqual(lit(""), false, "…nor an empty string");
  assert.strictEqual(lit(null), false, "…nor a missing one");
}

/* ---------- 9: four separate tabs in a row, not four labels in one bar ----------
   Static assertions on the stylesheet, because the node harness has no layout engine. They
   are the shape of the thing rather than a substitute for looking at it, but the shape is
   what regresses: the row was a segmented control once — one recessed track with transparent
   buttons inside it — and the way back to that is for the container to quietly grow a
   background again. So the claim is stated from both ends: the container carries NOTHING but
   the gap, and every tab carries its own surface. */
{
  // every `selector { body }` in the sheet, comments stripped off the selector
  const CSS = HTML.slice(HTML.indexOf("<style>") + 7, HTML.indexOf("</style>"));
  const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ sel: m[1].trim().replace(/\/\*[\s\S]*?\*\//g, "").trim(), body: m[2] }))
    .filter((r) => r.sel && !r.sel.startsWith("@"));
  const rulesFor = (sel) => RULES.filter((r) => r.sel.split(",").map((x) => x.trim()).includes(sel));
  // `border-radius` and `background-color` both contain a shorter property name, so every
  // one of these is anchored to a declaration boundary rather than searched for loose
  const has = (body, prop) => new RegExp("(^|;)\\s*" + prop + "\\s*:").test(body);

  for (const [container, item] of [["nav.tabs", "nav.tabs button"], [".viewtoggle", ".viewtoggle .vt"]]) {
    const outer = rulesFor(container);
    assert.ok(outer.length, container + " is styled");

    // the container holds the tabs apart and does nothing else — no shared bar to sit inside
    for (const r of outer) {
      for (const prop of ["background", "border", "padding"]) {
        assert.ok(!has(r.body, prop),
          container + " must not declare `" + prop + "` — that is what turns the row back into "
          + "one continuous bar with labels in it. Found: " + r.body.trim());
      }
    }
    const gap = outer.map((r) => /(^|;)\s*gap\s*:\s*(\d+)px/.exec(r.body)).filter(Boolean);
    assert.ok(gap.length, container + " sets a gap — the space between them is what separates them");
    assert.ok(gap.every((g) => Number(g[2]) >= 6),
      container + "'s gap is wide enough to read as a space between two things, not a seam");
    assert.ok(outer.some((r) => /flex-wrap\s*:\s*wrap/.test(r.body)),
      container + " wraps, so a narrow screen drops a tab onto a second row rather than "
      + "hiding it off the edge");

    // and each tab is its own surface: something to see, an edge, and a rounded shape.
    // one[0] is the base rule; the ones after it are the phone block trimming the padding.
    const one = rulesFor(item);
    assert.ok(one.length, item + " is styled");
    for (const prop of ["background", "border", "border-radius"]) {
      assert.ok(has(one[0].body, prop),
        item + " needs its own `" + prop + "` — a tab with no surface of its own is a label. "
        + "Found: " + one[0].body.trim());
    }
    for (const r of one) {
      assert.ok(!/background\s*:\s*transparent/.test(r.body),
        item + " must not be transparent — it would show the page through where its own "
        + "surface should be. Found: " + r.body.trim());
      assert.ok(!/border\s*:\s*none/.test(r.body), item + " keeps its edge");
    }
  }

  // the selected one is filled, and it is the only one that is
  const sel = rulesFor('nav.tabs button[aria-selected="true"]');
  assert.strictEqual(sel.length, 1, "one rule paints the selected tab");
  assert.ok(/background:var\(--orange\)/.test(sel[0].body) && /color:var\(--on-accent\)/.test(sel[0].body),
    "the selected tab takes the accent fill, so it is unmistakable among four of them");
  const vtSel = rulesFor(".viewtoggle .vt.active");
  assert.ok(vtSel.length && /background:var\(--orange\)/.test(vtSel[0].body),
    "…and the toggle's selected half does the same");

  // the markers survived the restyle — they are the reason the row is not just four words
  const ob = nav("onboarding");
  assert.ok(/id="todayCount"/.test(tab(ob, "today")), "Today's moves keeps its count badge");
  assert.ok(/tab-star/.test(tab(ob, "playbook")), "The Playbook keeps its star");
  assert.ok(/id="bdayDot"/.test(tab(ob, "birthdays")), "Birthdays keeps its dot");
  assert.strictEqual((ob.match(/<button/g) || []).length, 4, "and there are four of them");
}

console.log("header.test.cjs: OK");
