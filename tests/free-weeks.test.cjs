// Free weeks (Black Friday 2026): someone can train before their six weeks begin.
//
// m.sixStart is the day their six weeks start. Until then they have started (first session done,
// welcome email and welcome guides sent) but the clock sits at day 0: no day 2, 7, 14... email, no
// weekly nutrition guide, no membership email, no "finished". On that day the clock starts by
// itself and everything runs as it always has. A coach can set, change or clear the date on the
// Edit form, and the new-payer webhook sets it when the workflow calling it sends the date
// (the Black Friday paid workflow does; the normal sign-up workflow doesn't).
const assert = require("assert");
const { boot, daysFromToday, dateInput } = require("./lib/env.cjs");
const tick = require("../netlify/functions/challenge-tick.js");
const { sixStartFrom } = require("../netlify/functions/new-challenger.js");

const fmt = (ts) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const challenger = (id, name, day, extra) => Object.assign({
  id, name, coach: "Dan", dob: null, personal: "", email: id + "@example.com",
  day0: daysFromToday(-day), booked: daysFromToday(-day), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  followUpOn: null, followUpStatus: null, notes: "",
}, extra || {});

/* ---------- the tracker: on their free weeks ---------- */
{
  // first session 20 days ago, six weeks start in 30 days
  const app = boot({ members: [challenger("a", "Annie", 20, { sixStart: daysFromToday(30) })] });
  const a = app.find("a");
  assert.strictEqual(app.ctx.currentDay(a), 0, "the clock sits at day 0");
  assert.strictEqual(app.ctx.status(a), "live", "they are still on the board");
  assert.strictEqual(app.ctx.inFreeWeeks(a), true);
  assert.strictEqual(app.ctx.finishDate(a), daysFromToday(30 + 42), "they finish six weeks after that day");
  assert.strictEqual(app.ctx.challengeEnd(a), daysFromToday(72), "and that is when a membership would start");
  const html = app.html("memberList");
  assert.ok(html.includes("Free weeks"), "the card says so");
  assert.ok(html.includes("Six weeks start " + fmt(daysFromToday(30))), "and when the six weeks begin");
  assert.ok(!html.includes("Day 20 of 42"), "not the day count from their first session");
}

/* ---------- the tracker: once the six weeks have begun ---------- */
{
  // first session 50 days ago, six weeks began 9 days ago
  const app = boot({ members: [challenger("a", "Annie", 50, { sixStart: daysFromToday(-9) })] });
  const a = app.find("a");
  assert.strictEqual(app.ctx.currentDay(a), 9, "the day counts from the day the six weeks began");
  assert.strictEqual(app.ctx.inFreeWeeks(a), false);
  assert.strictEqual(app.ctx.finishDate(a), daysFromToday(33));
  assert.ok(app.html("memberList").includes("Day 9 of 42"));
}
{
  // the day itself is day 0
  const app = boot({ members: [challenger("a", "Annie", 40, { sixStart: daysFromToday(0) })] });
  assert.strictEqual(app.ctx.currentDay(app.find("a")), 0);
  assert.strictEqual(app.ctx.inFreeWeeks(app.find("a")), false);
}

/* ---------- nobody else changes ---------- */
{
  const app = boot({ members: [challenger("a", "Annie", 20), challenger("b", "Ben", 20, { sixStart: daysFromToday(-60) })] });
  assert.strictEqual(app.ctx.currentDay(app.find("a")), 20, "no date: the clock runs from the first session");
  assert.strictEqual(app.ctx.currentDay(app.find("b")), 20, "a date before their first session is ignored");
  assert.strictEqual(app.find("a").sixStart, null, "older records get the field");
}

/* ---------- a pause during the free weeks doesn't eat into the six weeks ---------- */
{
  const app = boot({ members: [challenger("a", "Annie", 20, { sixStart: daysFromToday(30), pausedAt: daysFromToday(-5) })] });
  app.ctx.resume("a");
  assert.strictEqual(app.find("a").pausedDays, 0, "nothing banked");
}
{
  // paused 10 days ago, six weeks began 4 days ago: only those 4 days count
  const app = boot({ members: [challenger("a", "Annie", 30, { sixStart: daysFromToday(-4), pausedAt: daysFromToday(-10) })] });
  assert.strictEqual(app.ctx.currentDay(app.find("a")), 0);
  app.ctx.resume("a");
  assert.strictEqual(app.find("a").pausedDays, 4);
}

/* ---------- the Edit form ---------- */
{
  const app = boot({ members: [challenger("a", "Annie", 5)] });
  app.ctx.openEdit("a");
  assert.strictEqual(app.el("f-sixstart").value, "", "blank means the day of their first session");
  app.el("f-sixstart").value = dateInput(daysFromToday(40));
  app.ctx.saveMember();
  assert.strictEqual(app.find("a").sixStart, daysFromToday(40));
  assert.strictEqual(app.ctx.currentDay(app.find("a")), 0, "and the clock goes back to day 0");
  app.ctx.openEdit("a");
  assert.strictEqual(app.el("f-sixstart").value, dateInput(daysFromToday(40)));
  app.el("f-sixstart").value = "";
  app.ctx.saveMember();
  assert.strictEqual(app.find("a").sixStart, null, "clearing it puts the clock back on their first session");
  assert.strictEqual(app.ctx.currentDay(app.find("a")), 5);
}
{
  // not started yet: the card still says when the six weeks begin
  const app = boot({ members: [challenger("a", "Annie", 0, { firstSessionDone: false, day0: null, booked: daysFromToday(2), sixStart: daysFromToday(50) })] });
  assert.ok(app.ctx.memberCardHtml(app.find("a")).includes("Six weeks start " + fmt(daysFromToday(50))));
}

/* ---------- the coach still checks in during the free weeks ---------- */
{
  const ids = (app, id) => Array.from(app.ctx.dueToday(app.find(id)), (it) => it.id);
  // the day after their first session: the morning-after text, off the real first session
  let app = boot({ members: [challenger("a", "Annie", 1, { sixStart: daysFromToday(40) })] });
  assert.deepEqual(ids(app, "a"), ["d1_text"]);
  // a week in: the first free weeks check-in
  app = boot({ members: [challenger("a", "Annie", 7, { sixStart: daysFromToday(40), completed: ["intro", "d1_text"] })] });
  assert.deepEqual(ids(app, "a"), ["fw1"]);
  assert.strictEqual(app.ctx.dueToday(app.find("a"))[0].title, "Free weeks check-in");
  assert.ok(app.html("todayList").includes("Free weeks check-in"), "it is on Today's moves");
  assert.ok(app.html("todayList").includes("Free weeks, day 7"));
  // ticked off like any other, and it stays ticked
  app.ctx.toggleDone("a", "fw1", true);
  assert.deepEqual(ids(app, "a"), []);
  assert.ok(app.find("a").completed.includes("fw1"));
  // three weeks in, the first two done: the third
  app = boot({ members: [challenger("a", "Annie", 21, { sixStart: daysFromToday(20), completed: ["intro", "d1_text", "fw1", "fw2"] })] });
  assert.deepEqual(ids(app, "a"), ["fw3"]);
  // a week missed drops off after seven days, like any touchpoint
  app = boot({ members: [challenger("a", "Annie", 16, { sixStart: daysFromToday(20), completed: ["intro", "d1_text"] })] });
  assert.deepEqual(ids(app, "a"), ["fw2"]);
  // no check-in is planned on or after the day the six weeks begin
  app = boot({ members: [challenger("a", "Annie", 14, { sixStart: daysFromToday(0), completed: ["intro", "d1_text", "fw1"] })] });
  assert.deepEqual(ids(app, "a"), [], "day 0 of the six weeks: nothing from the free weeks");
  // once the six weeks are running, the normal check-ins come due from that day
  app = boot({ members: [challenger("a", "Annie", 50, { sixStart: daysFromToday(-7), completed: ["intro", "d1_text"] })] });
  assert.deepEqual(ids(app, "a"), ["wk2"], "the Week 2 check-in, seven days into the six weeks");
  // and nobody without free weeks sees any of it
  app = boot({ members: [challenger("a", "Annie", 7, { completed: ["intro", "d1_text"] })] });
  assert.deepEqual(ids(app, "a"), ["wk2"]);
  app = boot({ members: [challenger("a", "Annie", 1)] });
  assert.deepEqual(ids(app, "a"), ["d1_text"]);
}

/* ---------- the morning job ---------- */
{
  const DAY = 86400000, t0 = Date.UTC(2026, 11, 10);                 // Thursday 10 December 2026
  const SIX = Date.UTC(2027, 0, 4);                                  // Monday 4 January 2027
  const m = (o) => Object.assign({ email: "a@b.c", completed: ["intro"], firstSessionDone: true, day0: Date.UTC(2026, 10, 18), sixStart: SIX }, o || {});
  assert.ok(tick.currentDay(m(), t0) < 0, "before the six weeks, the day is negative");

  let p = tick.plan(m(), [], t0);
  assert.deepEqual(p.add, ["6wc day 0"], "the welcome email still goes at the start");
  assert.strictEqual(p.guides.length, 3, "and the three welcome guides");
  assert.deepEqual(p.weekly, [], "no weekly nutrition guide on a Thursday in the free weeks");

  p = tick.plan(m(), ["6wc day 0"], t0);
  assert.deepEqual(p.add, [], "then nothing: no day 2, 7 or 14 email in December");
  assert.deepEqual(tick.plan(m(), ["6wc day 0"], Date.UTC(2026, 11, 30)).add, [], "nor the membership emails, six weeks after their first session");
  assert.ok(!tick.plan(m(), ["6wc day 0"], Date.UTC(2027, 0, 3)).add.includes("6wc finished"), "and they are not finished");

  assert.strictEqual(tick.currentDay(m(), SIX), 0, "4 January is day 0");
  assert.deepEqual(tick.plan(m(), ["6wc day 0"], SIX).add, [], "day 0 was already sent");
  assert.deepEqual(tick.plan(m(), ["6wc day 0"], SIX + 2 * DAY).add, ["6wc day 2"], "day 2 goes on 6 January");
  assert.deepEqual(tick.plan(m(), ["6wc day 2"], SIX + 7 * DAY).add, ["6wc day 7"]);
  const thu = Date.UTC(2027, 0, 7);                                  // the first Thursday of their six weeks
  assert.ok(tick.plan(m(), ["6wc day 2"], thu).weekly.length > 0, "the weekly guides start in week 1");
  assert.deepEqual(tick.plan(m(), ["6wc day 41"], SIX + 42 * DAY).add, ["6wc finished"], "finished six weeks after 4 January");

  // not started yet, first session booked for November: nothing fires off the booked date either
  const booked = { email: "a@b.c", completed: ["intro"], booked: Date.UTC(2026, 10, 18), sixStart: SIX };
  assert.deepEqual(tick.plan(booked, ["6wc day 0"], t0).add, []);

  // someone without the date is untouched
  const plain = { email: "a@b.c", completed: ["intro"], firstSessionDone: true, day0: t0 - 7 * DAY };
  assert.deepEqual(tick.plan(plain, ["6wc day 2"], t0).add, ["6wc day 7"]);
  assert.deepEqual(tick.plan(Object.assign({ sixStart: null }, plain), ["6wc day 2"], t0).add, ["6wc day 7"]);
}

/* ---------- who gets the date when they pay ---------- */
{
  const JAN4 = Date.UTC(2027, 0, 4);
  assert.strictEqual(sixStartFrom({ sixStart: "2027-01-04" }, null), JAN4, "the Black Friday workflow sends the date in the body");
  assert.strictEqual(sixStartFrom({}, { six: "2027-01-04" }), JAN4, "or on the end of the URL");
  assert.strictEqual(sixStartFrom({ six_start: " 2027-01-04 " }, {}), JAN4);
  assert.strictEqual(sixStartFrom({}, {}), null, "the normal sign-up workflow sends nothing: six weeks from their first session");
  assert.strictEqual(sixStartFrom({ name: "Annie", email: "a@b.c" }, null), null);
  assert.strictEqual(sixStartFrom({ sixStart: "4 January" }, null), null, "anything that is not a date is ignored");
  assert.strictEqual(sixStartFrom({ sixStart: "2027-02-31" }, null), null);
  assert.strictEqual(sixStartFrom({ sixStart: "2027-07-05" }, null), Date.UTC(2027, 6, 4, 23), "a summer date is midnight in Warrington, not UTC");
  assert.strictEqual(new Date(JAN4).getUTCDay(), 1, "4 January 2027 is a Monday");
}

console.log("free-weeks: ok");
