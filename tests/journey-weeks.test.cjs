// The check-ins are named for the WEEK THEY CLOSE, and that is all that changed.
//
// Today's moves is laid out in weeks now, so the names had to agree with the columns: the
// check-in on day 7 is the Week 1 check-in, the one on day 14 is Week 2, and so on down to
// day 35. Five touchpoints were relabelled and nothing else about them was touched.
//
// Which makes this file mostly a list of things that must NOT have moved. A rename is the
// cheapest change in the app to make and the most expensive to get wrong, because the tick a
// coach made last Tuesday is stored against an ID, not a title — if 'wk2' stopped meaning the
// day-7 check-in, every challenger on the roster would silently lose a touchpoint and gain an
// unfinished one. So: the ids are pinned, the days are pinned, what is due on a given morning
// is pinned, and a record written before any of this happened is opened and read.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const live = (id, name, day, extra) => Object.assign({
  id, name, coach: "Grace",
  day0: daysFromToday(-day), booked: daysFromToday(-day), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
}, extra || {});

// what the whole-journey table renders, from the same app
function tableHtml(app) {
  app.ctx.setTodayView("table");
  const html = app.html("todayTable");
  app.ctx.setTodayView("moves");
  return html;
}

/* ---------- 1: the ids are the ids, and the days are the days ----------
   The one thing a rename is not allowed to be is a re-keying. Written as the full table
   rather than as a spot check, because "wk2 is the Week 1 check-in" is exactly the sort of
   fact that reads like a typo to whoever comes next and gets helpfully corrected. */
{
  const app = boot({ members: [] });
  const J = app.ctx.__t.JOURNEY;
  assert.strictEqual(
    JSON.stringify(J.map((it) => [it.id, it.day, it.title])),
    JSON.stringify([
      ["intro", -1, "Intro / Welcome experience"],
      ["d1_text", 1, "Morning-after-first-session text"],
      ["wk2", 7, "Week 1 check-in"],
      ["wk3", 14, "Week 2 check-in"],
      ["wk4", 21, "Week 3 check-in"],
      ["wk5", 28, "Week 4 check-in"],
      ["wk6", 35, "Week 5 check-in"],
    ]),
    "seven touchpoints, the same seven ids, the same seven days — five of them renamed");

  // the weeks did not add or remove anything; the postcard did, and it is the only one
  assert.strictEqual(J.length, 7, "seven touchpoints");
  assert.strictEqual(app.ctx.__t.TABLE_COLS.length, 7, "…and the table knows all seven");
  assert.ok(!J.some((it) => it.id === "d3_postcard"),
    "the handwritten postcard is not in the journey — nothing is posted to a house any more");

  // the old names are gone from the app entirely, so nothing is half-renamed
  for (const old of ["Start of Week 2 check-in", "Start of Week 3 check-in",
                     "Start of Week 4 check-in", "Start of Week 5 check-in",
                     "Start of Week 6 check-in"]) {
    assert.ok(!HTML.includes(old), "the old title is gone: " + old);
  }
}

/* ---------- 2: what is due on a given morning is exactly what was due before ----------
   The renaming and the regrouping are both presentation. This is the assertion that says so
   in the only language that matters: for every day of a challenger's six weeks, the same
   touchpoints come up, on the same day, flagged the same way. */
{
  // the journey's own arithmetic, restated here independently of the app: a touchpoint is due
  // from its day and stays due for a seven-day grace window
  const expected = (day) => [
    ["d1_text", 1], ["wk2", 7], ["wk3", 14],
    ["wk4", 21], ["wk5", 28], ["wk6", 35],
  ].filter(([, d]) => day >= d && day <= d + 7).map(([id]) => id);

  for (let day = 1; day <= 45; day++) {
    const app = boot({ members: [live("a", "Sam Live", day)] });
    const due = app.ctx.dueToday(app.find("a")).map((it) => it.id).slice().sort().join(",");
    assert.strictEqual(due, expected(day).sort().join(","),
      "day " + day + ": the same touchpoints are due as ever");
  }
}

/* ---------- 3: a record written before any of this still opens ----------
   Every tick is stored against an id, and the ids did not move — so a challenger saved when
   these were called "Start of Week 4" and the board was three channels wide needs nothing
   doing to it. Including the two ids the journey no longer has at all, left behind when the
   month-1 and month-2 follow-ups moved to the retention tracker. */
{
  const old = {
    id: "old", name: "Wendy Booth", coach: "Dan",
    day0: daysFromToday(-16), booked: daysFromToday(-16), firstSessionDone: true,
    // ticked when the day-7 check-in was called "Start of Week 2", plus three ids the journey
    // does not have any more: the two month follow-ups, and the handwritten postcard
    completed: ["intro", "d1_text", "wk2", "month1", "d3_postcard"],
    missed: ["month2"],
    doneMeta: {}, checks: {}, outcome: null, signedUp: false, extraDays: 0,
    pausedDays: 0, pausedAt: null,
  };
  const app = boot({ members: [old], raw: true });
  app.ctx.__t.members = app.ctx.migrateList(JSON.parse(JSON.stringify([old])));
  app.ctx.renderAll();
  const m = app.find("old");

  assert.ok(app.ctx.isDone(m, "wk2"),
    "the tick made against 'wk2' is still a tick against the day-7 check-in, now called Week 1");
  assert.ok(m.completed.includes("month1") && m.completed.includes("d3_postcard")
    && m.missed.includes("month2"),
    "the ids the journey no longer has are left exactly where they were — inert, not tidied");

  // …and inert really does mean inert: they are neither shown, counted nor errored on
  const today = app.html("todayList");
  const DEAD = /month1|month2|d3_postcard|postcard/i;
  assert.ok(!DEAD.test(today), "a dead id renders nothing on Today");
  assert.ok(!DEAD.test(tableHtml(app)), "…and nothing in the table");
  assert.ok(!DEAD.test(app.html("memberList")), "…and nothing on her card");
  assert.ok(!DEAD.test(app.html("playbookList")), "…and nothing on the Playbook");
  assert.ok(app.html("memberList").includes("3 of 7 touchpoints done"),
    "…and it is not counted either: three of the seven that exist, not five of ten");

  // day 16, so the day-14 check-in is up — under its new name, keyed by its old id. It is a
  // week-2 touchpoint, and with nothing outstanding before it that is the week the folder opens.
  assert.ok(today.includes("Week 2 check-in"), "her due check-in is named for the week it closes");
  assert.ok(today.includes("act-old-wk3"), "…and is still the touchpoint it always was");

  // a record with the lists missing or malformed opens rather than throwing
  for (const broken of [{}, { completed: null }, { completed: "wk2", missed: 7 }]) {
    const rec = Object.assign({ id: "b", name: "Broken", coach: "Dan" }, broken);
    const fixed = app.ctx.migrateList([rec])[0];
    assert.ok(Array.isArray(fixed.completed) && Array.isArray(fixed.missed),
      "both lists come out of migration as arrays: " + JSON.stringify(broken));
    assert.strictEqual(app.ctx.isDone(fixed, "wk2"), false, "…and answer without throwing");
  }
}

/* ---------- 4: the same names everywhere they are said ----------
   Today's card, the whole-journey table and the Playbook are three views of one journey, and
   the whole point of the rename is that a coach hears one name for one thing. */
{
  const app = boot({ members: [live("a", "Sam Live", 8), live("b", "Dee Deep", 15),
    live("c", "Ell Late", 22), live("d", "Fay Far", 29), live("e", "Gus Gone", 36)] });

  // one week is on screen at a time, so each is opened and read in turn
  for (const [w, name] of [[1, "Week 1 check-in"], [2, "Week 2 check-in"], [3, "Week 3 check-in"],
                           [4, "Week 4 check-in"], [5, "Week 5 check-in"]]) {
    app.ctx.setOpenWeek(w);
    assert.ok(app.html("todayList").includes(name),
      "Today's moves says " + name + " in week " + w);
  }
  app.ctx.setOpenWeek(1);

  // the table's heads follow the titles, not the ids: 'wk2' is the Week 1 check-in, so Wk1
  const heads = (tableHtml(app).match(/<th[^>]*>([^<]*)<\/th>/g) || [])
    .map((h) => h.replace(/<[^>]*>/g, ""));
  assert.deepStrictEqual(heads,
    ["Challenger", "Day", "Intro", "Text", "Wk1", "Wk2", "Wk3", "Wk4", "Wk5"],
    "the table's week columns are Wk1 to Wk5, in journey order — and there is no Postcard");
  assert.ok(tableHtml(app).includes("Sam Live · Week 1 check-in · due"),
    "…and a cell names its touchpoint the same way the card does");

  const pb = app.html("playbookList");
  for (const name of ["Week 1 check-in", "Week 2 check-in", "Week 3 check-in",
                      "Week 4 check-in", "Week 5 check-in"]) {
    assert.ok(pb.includes(name), "the Playbook says " + name);
  }
  // the seed line came through the rename untouched — it is the whole reason that card exists
  const wk3 = app.ctx.__t.JOURNEY.find((it) => it.id === "wk3");
  assert.ok(/You’re starting to settle in now/.test(wk3.seed), "the seed line is the seed line");
  assert.ok(pb.includes("End the voice note with this"), "…still labelled on the card");
  assert.ok(pb.includes("This is the bit we want"), "…and still printed in full");
  app.ctx.setOpenWeek(2);          // the seed line rides the day-14 check-in, which is week 2's
  assert.ok(app.html("todayList").includes("End the voice note with this:"),
    "…and still on the card a coach reads at the time");
}

/* ---------- 5: the Playbook's day badges are the days ----------
   There was one hard-coded exception in here: wk4 was badged "Day 28" while it fires on day
   21, a leftover from an older set of days. It made the Playbook disagree with Today's moves
   about that one card, and with weeks on the board it would have put it in the wrong column
   as well. The badge is read off the touchpoint now, with no exceptions to keep in step. */
{
  const app = boot({ members: [] });
  const badges = (app.html("playbookList").match(/<span class="pbx-when">([^<]*)<\/span>/g) || [])
    .map((s) => s.replace(/<[^>]*>/g, ""));
  assert.deepStrictEqual(badges,
    ["Before Day 0", "Day 1", "Day 7", "Day 14", "Day 21", "Day 28", "Day 35"],
    "every badge is its touchpoint's own day, in a clean seven-day series");
  for (const it of app.ctx.__t.JOURNEY) {
    assert.strictEqual(app.ctx.dayBadge(it),
      it.phase === "intro" ? "Before Day 0" : "Day " + it.day,
      it.id + ": the badge is the day, with nothing special-cased on top of it");
  }
  assert.ok(!/it\.id==='wk4'/.test(HTML), "…and the exception is gone from the source");
}

/* ---------- 6: an edited wording still lands on the touchpoint it was made against ----------
   Overrides are keyed by id too, so they survived the rename by not noticing it. The one
   thing worth pinning is that the DEFAULT they fall back to is the new title, not the old. */
{
  const app = boot({ members: [live("a", "Sam Live", 8)] });
  const wk2 = app.ctx.__t.JOURNEY.find((it) => it.id === "wk2");
  assert.strictEqual(app.ctx.tpTitle(wk2), "Week 1 check-in", "the default is the new name");

  app.ctx.pbSetField("wk2", "title", "First-week catch-up");
  app.ctx.renderAll();
  assert.ok(app.html("playbookList").includes("First-week catch-up"), "an override still applies");
  assert.ok(app.html("todayList").includes("First-week catch-up"), "…on the board too");
  assert.ok(!app.html("todayList").includes("Week 1 check-in"), "…in place of the default");

  app.ctx.pbResetField("wk2", "title");
  app.ctx.renderAll();
  assert.ok(app.html("todayList").includes("Week 1 check-in"),
    "…and Reset hands it back to the new name, which is the one in the code");
}

console.log("journey-weeks.test.cjs: OK");
