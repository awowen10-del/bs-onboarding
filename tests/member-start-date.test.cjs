// A member's start date, and the weeks counted from it.
//
// `joined` is the single date everything about a member hangs off: their welcome card, their
// day-30 and day-60 check-ins, their anniversary, the six-month window that decides whether
// we are still watching them, and — since this change — which weeks of attendance are theirs
// at all. It was set once by the handoff and never editable, which is a problem when it is
// wrong: somebody handed over on the day the paperwork was done rather than the day they
// actually started carries a whole journey and a whole attendance history shifted sideways.
//
// So it is editable, and moving it moves all of them. That is the intended consequence and it
// is what most of this file asserts — not that the field saves, but that everything counted
// from it recounts.
//
// The other half is what a member's WEEK is. Week 1 is their first FULL ISO week: join on a
// Wednesday and those three days are not a week, they are three days, and counting them as
// one produces a low first number followed by a normal one — a rise nobody made, at exactly
// the moment the history is shortest and every number counts double.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday, dateInput } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const member = (id, name, joinedDaysAgo, extra) => Object.assign({
  id, name, coach: "Gaz", email: id + "@example.com", dob: null, personal: "", notes: "",
  joined: joinedDaysAgo === null ? null : daysFromToday(-joinedDaysAgo), fromChallenger: null,
  completed: [], missed: [], doneMeta: {}, attendance: {},
}, extra || {});

// fill the member form and press Save, the way a coach does
function saveForm(app, fields) {
  Object.keys(fields).forEach((k) => { app.el("rf-" + k).value = fields[k]; });
  app.ctx.saveRetMember();
}
// the Monday n weeks back from this week's Monday
function mondayWeeksAgo(n) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() || 7) - 1) - n * 7);
  return d;
}
const rowOf = (app, name) =>
  (app.html("attList").split("<tr").find((r) => r.includes(name)) || "");

/* ---------- 1: the field, and what it says it does ---------- */
{
  assert.ok(/id="rf-joined"/.test(HTML), "the member form has a start date input");
  const field = /<div class="field">(?:(?!<\/div>\s*<div class="field")[\s\S])*?id="rf-joined"[\s\S]*?<\/div>\s*<\/div>/.exec(HTML)[0];
  assert.ok(/type="date"/.test(field), "…as a date input");
  assert.ok(/Start date/.test(field), "…labelled as the start date");
  assert.ok(/changing it moves their welcome card|renumbers their attendance weeks/.test(field),
    "…with a note saying that moving it moves their journey and their attendance");
  assert.ok(/class="field-note"/.test(field), "…as its own styled line under the input");
  const CSS = HTML.slice(HTML.indexOf("<style>") + 7, HTML.indexOf("</style>"));
  assert.ok(/\.field-note\{/.test(CSS), "…which has a rule, rather than falling back to body text");

  const app = boot({ retention: [member("r1", "Mo Member", 100)] });
  app.ctx.openRetEdit("r1");
  assert.strictEqual(app.el("rf-joined").value, dateInput(daysFromToday(-100)),
    "it opens pre-filled with the date they have");
  app.ctx.openRetAdd();
  assert.strictEqual(app.el("rf-joined").value, dateInput(daysFromToday(0)),
    "…and defaults to today for somebody joining now");
}

/* ---------- 2: saving it moves everything counted from it ----------
   The point of the field. Not "the number changed" — the four touchpoints, the window and the
   weeks all recount off the new date. */
{
  const app = boot({ retention: [member("r1", "Mo Member", 40)] });
  const m = () => app.findMember("r1");

  // at 40 days: their welcome card and day-30 are behind them, day-60 is not
  assert.strictEqual(app.ctx.memberDay(m()), 40, "sanity: day 40 of membership");
  assert.deepStrictEqual([...app.ctx.memberDueToday(m())].map((i) => i.id),
    ["welcome_card", "day30"], "…and this is what they are owed");
  assert.strictEqual(app.ctx.withinFirstMonths(m(), 6), true, "…and we are watching them");

  // move their start date back to a week ago: they are a new member again
  app.ctx.openRetEdit("r1");
  saveForm(app, { name: "Mo Member", email: "r1@example.com", coach: "Gaz", dob: "",
    sessions: "", joined: dateInput(daysFromToday(-7)) });

  assert.strictEqual(m().joined, daysFromToday(-7), "the date moved");
  assert.strictEqual(app.ctx.memberDay(m()), 7, "…so their day count moved with it");
  assert.deepStrictEqual([...app.ctx.memberDueToday(m())].map((i) => i.id), ["welcome_card"],
    "…and day 30 is ahead of them again rather than behind");

  // …and forward, past the watch window
  app.ctx.openRetEdit("r1");
  saveForm(app, { name: "Mo Member", email: "r1@example.com", coach: "Gaz", dob: "",
    sessions: "", joined: dateInput(daysFromToday(-300)) });
  assert.strictEqual(app.ctx.withinFirstMonths(m(), 6), false, "past six months, we stop watching");
  assert.ok(!app.html("attList").includes("Mo Member"), "…and they come off the Attendance tab");

  // it goes through the member list's own save path, like every other field on the form
  assert.strictEqual(app.retentionCached()[0].joined, daysFromToday(-300),
    "…and the new date is what was stored");
}

/* ---------- 3: a member must have one ---------- */
{
  const app = boot({ retention: [member("r1", "Mo Member", 40)] });
  const before = app.findMember("r1").joined;

  app.ctx.openRetEdit("r1");
  saveForm(app, { name: "Renamed", email: "r1@example.com", coach: "Gaz", dob: "",
    sessions: "", joined: "" });
  assert.strictEqual(app.findMember("r1").joined, before, "a blank start date is refused");
  assert.strictEqual(app.findMember("r1").name, "Mo Member", "…and nothing else on the form saved");
  assert.ok(app.alerts.some((a) => /start date/i.test(a)), "…and it says why");

  // …and so is a date that is not one
  app.ctx.openRetEdit("r1");
  saveForm(app, { name: "Mo Member", email: "r1@example.com", coach: "Gaz", dob: "",
    sessions: "", joined: "2026-02-30" });
  assert.strictEqual(app.findMember("r1").joined, before, "30 February is not a date");

  const norm = app.ctx.normalizeJoinedDate;
  assert.strictEqual(norm("2026-08-03"), new Date("2026-08-03T00:00:00").getTime(),
    "a real date is local midnight on that day");
  for (const bad of ["", "   ", null, "not a date", "2026-13-01", "2026-02-30"]) {
    assert.strictEqual(norm(bad), null, JSON.stringify(bad) + " is refused");
  }

  // a member added from scratch gets the date that was typed, not today
  const add = boot({ retention: [] });
  add.ctx.openRetAdd();
  saveForm(add, { name: "Nina New", email: "n@example.com", coach: "Gaz", dob: "",
    sessions: "", joined: dateInput(daysFromToday(-21)) });
  assert.strictEqual(add.retention()[0].joined, daysFromToday(-21), "…back-dated on the way in");
}

/* ---------- 4: Week 1 is the first FULL week ----------
   A part-week join is not a week. Every day of the week is checked, because the rule has an
   edge on both Monday and Sunday and getting either wrong shifts a whole history by one. */
{
  const app = boot({ retention: [] });
  const { firstFullWeekMonday, memberWeekOneKey, isoWeekKeyFrom } = app.ctx;
  const keyOfMonday = (d) => isoWeekKeyFrom(d.getFullYear(), d.getMonth() + 1, d.getDate());

  // a known Monday, and the seven days from it
  const mon = new Date("2026-08-03T00:00:00");                 // Monday, ISO 2026-W32
  assert.strictEqual(keyOfMonday(mon), "2026-W32", "sanity");

  for (let i = 0; i < 7; i++) {
    const joinedOn = new Date(mon); joinedOn.setDate(joinedOn.getDate() + i);
    const expected = i === 0 ? "2026-W32" : "2026-W33";
    assert.strictEqual(memberWeekOneKey({ joined: joinedOn.getTime() }), expected,
      "joined " + ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]
      + " → week 1 is " + expected + (i === 0 ? " (that same week)" : " (the following one)"));
  }
  assert.strictEqual(new Date(firstFullWeekMonday(new Date("2026-08-05T00:00:00").getTime())).getDay(), 1,
    "and it always lands on a Monday");
  assert.strictEqual(memberWeekOneKey({ joined: null }), null, "no start date, no week 1");
  assert.strictEqual(memberWeekOneKey(null), null);
}

/* ---------- 5: their weeks are numbered from their start ---------- */
{
  const app = boot({ retention: [] });
  const { memberWeekKeys, memberWeekNumber, isoWeekKeyOf } = app.ctx;

  // joined the Wednesday of the week eleven weeks ago: their week 1 is ten weeks ago
  const wed = mondayWeeksAgo(11); wed.setDate(wed.getDate() + 2);
  const m = { joined: wed.getTime(), attendance: {} };
  const weeks = memberWeekKeys(m);

  assert.strictEqual(weeks[0], isoWeekKeyOf(mondayWeeksAgo(10).getTime()),
    "week 1 is the Monday after they joined, not the week they joined in");
  assert.strictEqual(weeks[weeks.length - 1], isoWeekKeyOf(mondayWeeksAgo(0).getTime()),
    "…and their latest week is the week we are in");
  assert.strictEqual(weeks.length, 11, "eleven weeks of membership, week 1 to week 11");
  assert.strictEqual(memberWeekNumber(m, weeks[2]), 3, "the third of them is their week 3");
  assert.strictEqual(memberWeekNumber(m, isoWeekKeyOf(mondayWeeksAgo(11).getTime())), 0,
    "the part-week they joined in is not a week of theirs at all");

  // somebody who joined this week has no full week yet, and that is an answer, not a fault
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (today.getDay() !== 1) {
    const justJoined = { joined: today.getTime(), attendance: {} };
    assert.strictEqual(memberWeekKeys(justJoined).length, 0,
      "joined mid-week: no full week yet, so no weeks");
  }
  assert.strictEqual(memberWeekKeys({ joined: null }).length, 0, "no start date, no weeks");
}

/* ---------- 6: the grid shows a member's own weeks ---------- */
{
  /* Ada joined the WEDNESDAY of five weeks ago. That part-week is not a week, so her week 1
     is the Monday four weeks ago and she is in her week 5 today: five of the eight columns
     are weeks of hers and the three before them are not. */
  const wed = mondayWeeksAgo(5); wed.setDate(wed.getDate() + 2);
  const app = boot({ retention: [
    Object.assign(member("a", "Ada Fiveweeks", null), { joined: wed.getTime() }),
    member("b", "Bea Longtime", 140),                        // twenty weeks a member
  ] });
  const ada = rowOf(app, "Ada Fiveweeks");

  assert.strictEqual((ada.match(/att-n before/g) || []).length, 3,
    "the three columns before her week 1 are not weeks of hers");
  assert.strictEqual((ada.match(/att-n none/g) || []).length, 5,
    "…and her five weeks are dashes, because nobody has uploaded for them");
  assert.ok(/not a member yet/.test(ada), "…and the columns before say so on hover");
  assert.ok(/· week 1 \(/.test(ada), "her first column is labelled as her week 1");
  assert.ok(/· week 5 \(/.test(ada), "…and her last as her week 5");
  assert.ok(!/· week 6 \(/.test(ada), "…and the part-week she joined in was never counted as one");
  assert.ok(/week 5 of membership/.test(ada), "…with where she has got to under her name");

  // Bea, twenty weeks in, gets eight columns of her own weeks — not twenty
  const bea = rowOf(app, "Bea Longtime");
  assert.strictEqual((bea.match(/att-n /g) || []).length, 8, "eight cells, however long she has been here");
  assert.strictEqual((bea.match(/att-n before/g) || []).length, 0, "…all of them weeks of hers");
  const nums = [...bea.matchAll(/· week (\d+) \(/g)].map((x) => Number(x[1]));
  assert.deepStrictEqual(nums, [13, 14, 15, 16, 17, 18, 19, 20],
    "…her most recent eight membership weeks, numbered from her start");

  // the header is still eight calendar columns, because everyone's latest week is this week
  const head = /<thead>[\s\S]*?<\/thead>/.exec(app.html("attList"))[0];
  assert.strictEqual((head.match(/<th[ >]/g) || []).length, 10, "Member, eight weeks, Trend");
  assert.ok(/this week/.test(head), "…ending with the week we are in");
  assert.ok(/week 1 is their first full week/.test(app.html("attList")),
    "and the legend says what a week is");
}

/* ---------- 7: somebody with no full week yet ---------- */
{
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (today.getDay() !== 1) {
    const app = boot({ retention: [member("n", "Nell Newest", 0)] });
    const row = rowOf(app, "Nell Newest");
    assert.ok(row, "she is on the tab from the day she joins");
    assert.strictEqual((row.match(/att-n before/g) || []).length, 8,
      "…with no weeks of her own yet, so not one cell is a dash");
    assert.strictEqual((row.match(/att-n none/g) || []).length, 0,
      "…because a dash would claim we are missing a file for a week she was here");
    assert.ok(/first full week starts/.test(row), "…and it says when her week 1 opens");
  }
}

/* ---------- 8: the alert counts the same weeks the grid draws ----------
   The two must agree about what a member's weeks are, or a coach reads three falling numbers
   on screen and no task, or a task and four flat numbers. They come from the same function. */
{
  // three falling weeks, all of them inside her membership
  const app = boot({ retention: [member("d", "Dee Dropping", 84)] });
  const d = app.findMember("d");
  const at = (n) => app.ctx.isoWeekKeyOf(mondayWeeksAgo(n).getTime());
  [3, 2, 1].forEach((n, i) => {
    d.attendance[at(3 - i)] = { attendedPT: n, attendedOther: 0, noShow: 0, lateCancelled: 0, registered: 0 };
  });
  app.ctx.renderAll();
  assert.ok(app.ctx.attendanceAlert(d), "3 → 2 → 1 raises the flag");
  assert.ok(/att-flagged/.test(rowOf(app, "Dee Dropping")), "…and the row is marked");

  /* Now move her start date so that the first of those three weeks is BEFORE she was a
     member. It is no longer a week of hers, the run is two weeks long, and the flag has to go
     — because the grid will not be showing that week either. */
  app.ctx.openRetEdit("d");
  saveForm(app, { name: "Dee Dropping", email: "d@example.com", coach: "Gaz", dob: "",
    sessions: "", joined: dateInput(mondayWeeksAgo(2).getTime()) });

  assert.strictEqual(app.ctx.attendanceAlert(app.findMember("d")), null,
    "with her start moved, 3 → 2 → 1 is only 2 → 1 and no longer a run");
  const row = rowOf(app, "Dee Dropping");
  assert.ok(!/att-flagged/.test(row), "…so the row is not flagged");
  // her new start date is a MONDAY, so that week is her week 1: three weeks of hers, and the
  // five columns before them are not
  assert.strictEqual((row.match(/att-n before/g) || []).length, 5,
    "…and the grid agrees: five columns before she was a member");
  assert.ok(/>3</.test(row) === false, "…the 3 is in a week that is not hers, so it is not shown");
  assert.ok(/>2</.test(row) && />1</.test(row), "…while her own two weeks still read 2 and 1");

  // the same weeks, from the same function, on both sides
  const own = [...app.ctx.memberWeekKeys(app.findMember("d"))];
  assert.deepStrictEqual([...app.ctx.attendanceWeeks(app.findMember("d"))],
    own.filter((w) => app.findMember("d").attendance[w]),
    "the history the alert reads is exactly the weeks of hers we hold data for");
}

console.log("member-start-date.test.cjs: OK");
