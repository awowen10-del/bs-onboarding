// Attendance & engagement harness — the most load-bearing thing in the app.
//
// A GoTeamUp export is the whole gym. This turns it into one number per member per week —
// Bodysculpt PT sessions actually attended — and watches for three weeks each lower than the
// last. Everything downstream (the flag, the task, the sparkline) is that number, so most of
// this file is about getting it right: what counts, who it belongs to, which week it lands
// in, and above all that dropping the same file in twice lands on the same numbers.
//
// The zero-fill is the subtle one and it has its own block. A member who has stopped coming
// produces NO rows at all, so if we only recorded people who appear in the file their history
// would simply stop and no decline would ever be detected. Absent from a week the file covers
// means zero — but only from the week they joined, or everyone would arrive with a fake slide.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const HEADER = "Customer Name,Customer Email,Event Starts At,Offering Type Name,Venue Name," +
  "Instructors,Booking Method,Customer Membership ID,Membership ID,Membership Name," +
  "Booking Source,Status,Checkin Timestamp";

// one booking row, in the export's own column order
function row(o) {
  return [o.name || "A Person", o.email === undefined ? "a@example.com" : o.email, o.at,
    o.offering === undefined ? "Bodysculpt PT" : o.offering,
    "Warrington", "Gaz", "Online", "CM1", "M1", "Membership", "Web",
    o.status === undefined ? "Attended" : o.status, o.checkin || ""].join(",");
}
const csv = (...rows) => [HEADER].concat(rows).join("\n");

function member(id, name, email, joinedDaysAgo, extra) {
  return Object.assign({
    id, name, email, coach: "Gaz", dob: null, personal: "", notes: "",
    joined: joinedDaysAgo === null ? null : daysFromToday(-joinedDaysAgo),
    fromChallenger: null, completed: [], missed: [], doneMeta: {}, attendance: {},
  }, extra || {});
}
// Monday of an ISO week, n weeks back from the Monday of this week — so the fixtures below
// are always real, recent, correctly-ordered weeks whenever the suite happens to run.
function mondayWeeksAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() || 7) - 1) - n * 7);
  return d;
}
const iso = (d, hour) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-"
  + String(d.getDate()).padStart(2, "0") + "T" + String(hour || 7).padStart(2, "0") + ":00:00";
// a session on day `dayOffset` of the week `n` weeks ago
const at = (n, dayOffset, hour) => {
  const d = mondayWeeksAgo(n);
  d.setDate(d.getDate() + (dayOffset || 0));
  return iso(d, hour);
};
const weekKey = (app, n) => app.ctx.isoWeekKeyOf(mondayWeeksAgo(n).getTime());

// Give a member a history directly, so the arithmetic can be tested without going through a
// file. `counts` is oldest-first and lands on consecutive weeks ending `endWeeksAgo` back.
const KEYS = boot({}).ctx;
function history(m, counts, endWeeksAgo) {
  const end = endWeeksAgo === undefined ? 1 : endWeeksAgo;
  counts.forEach((n, i) => {
    const wk = KEYS.isoWeekKeyOf(mondayWeeksAgo(end + counts.length - 1 - i).getTime());
    m.attendance[wk] = { attendedPT: n, attendedOther: 0, noShow: 0, lateCancelled: 0, registered: 0 };
  });
  return m;
}
/* A member whose last `counts.length` weeks read `counts`.

   The default start date is derived from the history rather than fixed, because a member's
   weeks are now counted from THEIR first full week: a fixture that gives somebody attendance
   from eight weeks ago and a start date of last month is describing a member who was not a
   member yet, and the app is right to ignore it. Two weeks of margin, so the oldest week in
   the history is comfortably inside their membership. */
function sliding(id, name, counts, joinedDaysAgo, endWeeksAgo) {
  const spanWeeks = counts.length + (endWeeksAgo === undefined ? 1 : endWeeksAgo);
  return history(member(id, name, id + "@example.com",
    joinedDaysAgo === undefined ? (spanWeeks + 2) * 7 : joinedDaysAgo), counts, endWeeksAgo);
}

/* ---------- 1: ISO weeks ---------- */
{
  const app = boot({});
  const { isoWeekKeyFrom, isoWeekStart, attWeekKey } = app.ctx;

  // the canonical awkward ones: years that start and end mid-week
  assert.strictEqual(isoWeekKeyFrom(2026, 1, 1), "2026-W01", "1 Jan 2026 is a Thursday — week 1");
  assert.strictEqual(isoWeekKeyFrom(2025, 12, 29), "2026-W01", "…and the Monday before it belongs there too");
  assert.strictEqual(isoWeekKeyFrom(2021, 1, 1), "2020-W53", "1 Jan 2021 is a Friday — still 2020's week 53");
  assert.strictEqual(isoWeekKeyFrom(2024, 12, 30), "2025-W01");
  assert.strictEqual(isoWeekKeyFrom(2026, 8, 3), "2026-W32");
  assert.strictEqual(isoWeekKeyFrom(2026, 8, 9), "2026-W32", "Sunday closes the same week…");
  assert.strictEqual(isoWeekKeyFrom(2026, 8, 10), "2026-W33", "…and Monday opens the next");

  // week keys sort chronologically, which every comparison in the feature leans on
  const keys = ["2026-W02", "2025-W53", "2026-W10", "2026-W09"];
  assert.deepStrictEqual(keys.slice().sort(), ["2025-W53", "2026-W02", "2026-W09", "2026-W10"]);

  // and a key round-trips to its own Monday
  assert.strictEqual(app.ctx.isoWeekKeyOf(isoWeekStart("2026-W32")), "2026-W32");
  assert.strictEqual(new Date(isoWeekStart("2026-W32")).getDay(), 1, "which is a Monday");

  // dates come off the file as written — a 7am Monday session is that Monday
  assert.strictEqual(attWeekKey("2026-08-03T07:00:00"), "2026-W32");
  assert.strictEqual(attWeekKey("2026-08-03T07:00:00+01:00"), "2026-W32");
  assert.strictEqual(attWeekKey("2026-08-03 07:00:00"), "2026-W32");
  assert.strictEqual(attWeekKey("2026-8-3"), "2026-W32");
  for (const bad of ["", null, undefined, "   ", "not a date"]) {
    assert.strictEqual(attWeekKey(bad), null, JSON.stringify(bad) + " is not a week");
  }
}

/* ---------- 2: what counts — only Attended Bodysculpt PT ---------- */
{
  const app = boot({ retention: [member("m", "Mo Member", "mo@example.com", 30)] });
  const file = csv(
    row({ email: "mo@example.com", at: at(1, 0) }),                                        // ✓ PT attended
    row({ email: "mo@example.com", at: at(1, 2) }),                                        // ✓ PT attended
    row({ email: "mo@example.com", at: at(1, 3), status: "Registered" }),                  // status
    row({ email: "mo@example.com", at: at(1, 4), status: "No show" }),                     // status
    row({ email: "mo@example.com", at: at(1, 5), status: "Late Cancelled" }),              // status
    row({ email: "mo@example.com", at: at(1, 1), offering: "BUILD" }),                     // other offering
    row({ email: "mo@example.com", at: at(1, 1), offering: "SWEAT" }),                     // other offering
    row({ email: "mo@example.com", at: at(1, 6), offering: "BUILD", status: "No show" })   // both
  );
  const r = app.ctx.applyAttendanceCsv(file);
  assert.strictEqual(r.ok, true);

  const wk = weekKey(app, 1);
  const b = app.findMember("m").attendance[wk];
  assert.strictEqual(b.attendedPT, 2, "only Attended + Bodysculpt PT counts towards the signal");
  assert.strictEqual(b.attendedOther, 2, "classes they did turn up to are kept separately");
  assert.strictEqual(b.registered, 1, "…and the other statuses are captured for later");
  assert.strictEqual(b.noShow, 2);
  assert.strictEqual(b.lateCancelled, 1);
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("m"), wk), 2, "the signal reads the PT count");

  // status and offering spellings are forgiving
  const { attStatusKey, isBodysculptPT } = app.ctx;
  assert.strictEqual(attStatusKey("Attended"), "attended");
  ["No show", "No-show", "NOSHOW", " no show "].forEach((s) =>
    assert.strictEqual(attStatusKey(s), "noShow", s));
  ["Late Cancelled", "late-cancelled", "Late Canceled"].forEach((s) =>
    assert.strictEqual(attStatusKey(s), "lateCancelled", s));
  assert.strictEqual(attStatusKey("Something Else"), null, "an unknown status is skipped, not guessed");
  ["Bodysculpt PT", "bodysculpt pt", " BODYSCULPT  PT "].forEach((s) =>
    assert.ok(isBodysculptPT(s), s));
  ["BUILD", "SWEAT", "Bodysculpt Class", ""].forEach((s) => assert.ok(!isBodysculptPT(s), s));
}

/* ---------- 3: matching people, and ignoring the rest of the gym ---------- */
{
  const app = boot({ retention: [
    member("a", "Ann A", "ANN@Example.com ", 30),          // messy on the member record
    member("b", "Bo B", "bo@example.com", 30),
    member("c", "Cal C", "", 30),                          // no email at all
  ] });
  const r = app.ctx.applyAttendanceCsv(csv(
    row({ email: " ann@example.COM ", at: at(1, 0) }),      // …and messy in the file
    row({ email: "bo@example.com", at: at(1, 0) }),
    row({ email: "bo@example.com", at: at(1, 2) }),
    row({ email: "stranger@example.com", at: at(1, 0) }),   // not one of ours
    row({ email: "another@example.com", at: at(1, 1) }),
    row({ email: "", at: at(1, 1) })                        // no email on the row
  ));

  const wk = weekKey(app, 1);
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("a"), wk), 1, "matched case-insensitively, trimmed");
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("b"), wk), 2);
  assert.strictEqual(r.matched, 2, "two members matched");
  assert.strictEqual(r.unmatched, 2, "two customers in the file are not tracked, and are skipped");
  assert.strictEqual(r.noEmail, 1, "a row with no email is counted and skipped");
  assert.strictEqual(app.retention().length, 3, "NOBODY was created by an import");

  // a member with no email can never be matched, but is still zero-filled for the week
  assert.strictEqual(app.findMember("c").attendance[wk], undefined,
    "…no — a member we cannot identify is left alone rather than assumed absent");
}

/* ---------- 4: bucketing by week, across a file that spans two ---------- */
{
  const app = boot({ retention: [member("m", "Mo Member", "mo@example.com", 60)] });
  const r = app.ctx.applyAttendanceCsv(csv(
    row({ email: "mo@example.com", at: at(2, 0) }),
    row({ email: "mo@example.com", at: at(2, 6, 19) }),     // Sunday evening, same week
    row({ email: "mo@example.com", at: at(1, 0) }),
    row({ email: "mo@example.com", at: at(1, 1) }),
    row({ email: "mo@example.com", at: at(1, 2) })
  ));
  assert.strictEqual(r.weekKeys.length, 2, "the file spanned two ISO weeks and both were kept");
  assert.deepStrictEqual([...r.weekKeys], [weekKey(app, 2), weekKey(app, 1)].sort());
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("m"), weekKey(app, 2)), 2);
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("m"), weekKey(app, 1)), 3);
}

/* ---------- 5: THE ONE THAT MATTERS — re-uploading overwrites, never doubles ---------- */
{
  const app = boot({ retention: [member("m", "Mo Member", "mo@example.com", 60)] });
  const week1 = csv(
    row({ email: "mo@example.com", at: at(2, 0) }),
    row({ email: "mo@example.com", at: at(2, 2) }),
    row({ email: "mo@example.com", at: at(2, 4) })
  );
  const week2 = csv(
    row({ email: "mo@example.com", at: at(1, 0) }),
    row({ email: "mo@example.com", at: at(1, 3) })
  );

  app.ctx.applyAttendanceCsv(week1);
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("m"), weekKey(app, 2)), 3);

  // a second week accumulates alongside the first
  app.ctx.applyAttendanceCsv(week2);
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("m"), weekKey(app, 2)), 3, "week one is untouched");
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("m"), weekKey(app, 1)), 2, "week two lands beside it");
  assert.deepStrictEqual([...app.ctx.attendanceWeeks(app.findMember("m"))],
    [weekKey(app, 2), weekKey(app, 1)], "two weeks of history, in order");

  // the same file again — three times, for good measure
  app.ctx.applyAttendanceCsv(week1);
  app.ctx.applyAttendanceCsv(week1);
  app.ctx.applyAttendanceCsv(week2);
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("m"), weekKey(app, 2)), 3, "STILL three, not nine");
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("m"), weekKey(app, 1)), 2, "STILL two");

  // a corrected re-upload replaces the week rather than merging with it
  app.ctx.applyAttendanceCsv(csv(row({ email: "mo@example.com", at: at(2, 0) })));
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("m"), weekKey(app, 2)), 1,
    "a corrected file for that week wins outright");
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("m"), weekKey(app, 1)), 2,
    "…and leaves the other week alone");

  // it all went through the member list's own sync path
  assert.strictEqual(app.retentionCached()[0].attendance[weekKey(app, 1)].attendedPT, 2);
  assert.strictEqual(app.cached().length, 0, "the challenger roster was never written");
}

/* ---------- 6: absence is a zero, but only once they were a member ---------- */
{
  const app = boot({ retention: [
    member("here", "Hank Here", "hank@example.com", 60),
    member("gone", "Gina Gone", "gina@example.com", 60),      // in no rows at all
    member("new", "Nina New", "nina@example.com", 2),         // joined after the week covered
  ] });
  app.ctx.applyAttendanceCsv(csv(row({ email: "hank@example.com", at: at(1, 0) })));

  const wk = weekKey(app, 1);
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("here"), wk), 1);
  assert.ok(app.findMember("gone").attendance[wk], "a member in none of the rows still gets a week");
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("gone"), wk), 0,
    "…recorded as a real zero, which is the only way a full stop is ever detected");
  assert.strictEqual(app.findMember("new").attendance[wk], undefined,
    "somebody who had not joined yet gets nothing, not a fake zero");
}

/* ---------- 7: the 3 → 2 → 1 flag ---------- */
{
  const flags = (counts) => {
    const app = boot({ retention: [sliding("m", "Mo Member", counts)] });
    return !!app.ctx.attendanceAlert(app.findMember("m"));
  };

  assert.strictEqual(flags([3, 2, 1]), true, "3 → 2 → 1 is the case this exists for");
  assert.strictEqual(flags([4, 3, 2]), true, "…any three strictly falling weeks");
  assert.strictEqual(flags([3, 2, 0]), true);
  assert.strictEqual(flags([5, 4, 3, 2, 1]), true, "a longer slide still flags");

  assert.strictEqual(flags([0]), false, "a single zero week is not a decline");
  assert.strictEqual(flags([3, 0]), false, "…nor is one sharp drop");
  assert.strictEqual(flags([3, 3, 0]), false,
    "flat then a cliff does NOT flag — the known gap in this rule, deliberate for v1");
  assert.strictEqual(flags([3, 2, 2]), false, "each week must be strictly lower");
  assert.strictEqual(flags([1, 2, 3]), false, "…and it must be falling, not rising");
  assert.strictEqual(flags([3, 1, 2]), false, "a dip and a recovery is not a slide");
  assert.strictEqual(flags([0, 0, 0]), false, "three zeroes are not three DECLINING weeks");
  assert.strictEqual(flags([3, 2]), false, "two weeks is not enough history");
  assert.strictEqual(flags([]), false, "and neither is none");

  // the run reported is the most recent one, with its counts
  const app = boot({ retention: [sliding("m", "Mo Member", [5, 4, 3, 2, 1])] });
  const run = app.ctx.attendanceAlert(app.findMember("m"));
  assert.deepStrictEqual([...run.counts], [3, 2, 1], "the latest three weeks of the slide");
  assert.strictEqual(run.weeks.length, 3);
  assert.strictEqual(run.key, "drop:" + run.weeks[2], "keyed by the week it ends on");
}

/* ---------- 8: only inside the first six months ---------- */
{
  const flagsAt = (days) => {
    const app = boot({ retention: [sliding("m", "Mo Member", [3, 2, 1], days)] });
    return !!app.ctx.attendanceAlert(app.findMember("m"));
  };

  assert.strictEqual(flagsAt(30), true, "a month in — watched");
  assert.strictEqual(flagsAt(150), true, "five months in — watched");
  assert.strictEqual(flagsAt(400), false, "well past six months — not watched");
  assert.strictEqual(flagsAt(2000), false);

  // …and a member with no joined date is never evaluated
  const app = boot({ retention: [sliding("m", "Mo Member", [3, 2, 1], null)] });
  assert.strictEqual(app.ctx.attendanceAlert(app.findMember("m")), null,
    "no joined date, no six-month window, no flag");

  // the boundary itself
  const six = boot({ retention: [sliding("m", "Mo Member", [3, 2, 1], 30)] });
  assert.strictEqual(six.ctx.withinFirstMonths(six.findMember("m"), 6), true);
  const old = boot({ retention: [sliding("m", "Mo Member", [3, 2, 1], 400)] });
  assert.strictEqual(old.ctx.withinFirstMonths(old.findMember("m"), 6), false);
  assert.strictEqual(old.ctx.withinFirstMonths({ joined: null }, 6), false);
}

/* ---------- 9: the task on Today's moves — appearing, actioning, and not nagging ---------- */
{
  const app = boot({ retention: [sliding("m", "Mo Member", [3, 2, 1])] });
  const h = app.html("retTodayList");
  assert.ok(h.includes("Check in with Mo Member — attendance dropping"), "the task is worded as specified");
  assert.ok(h.includes("Attendance to chase"), "…under its own heading");
  assert.ok(h.includes("3 → 2 → 1"), "…showing the slide");
  assert.ok(h.includes("notes-btn"), "…with the shared notes to hand");

  const run = app.ctx.attendanceAlert(app.findMember("m"));
  assert.ok(h.includes(`retToggleDone('m','${run.key}',true)`), "Done, like every other task");
  assert.ok(h.includes(`retMarkMissed('m','${run.key}')`), "…and Missed");

  // it is counted on the tab alongside the journey touchpoints
  const before = Number(app.el("retTodayCount").textContent);
  assert.ok(before >= 1);

  // actioning it takes it away and it does not come back
  app.ctx.retToggleDone("m", run.key, true);
  assert.strictEqual(app.ctx.attendanceAlert(app.findMember("m")), null, "dealt with");
  assert.ok(!app.html("retTodayList").includes("attendance dropping"), "…and off the screen");
  assert.strictEqual(Number(app.el("retTodayCount").textContent), before - 1);
  app.ctx.renderAll();
  assert.ok(!app.html("retTodayList").includes("attendance dropping"), "…and stays off");

  // A continuation of the SAME slide is the same slide, not a new one. Their run was the
  // three weeks ending last week; a 0 this week makes 2 → 1 → 0, which overlaps it.
  history(app.findMember("m"), [0], 0);
  assert.strictEqual(app.ctx.attendanceAlert(app.findMember("m")), null,
    "2 → 1 → 0 overlaps the run we just dealt with — it does not nag again a week later");

  // A genuinely new decline, starting entirely after the one we handled, does surface.
  // The first slide runs weeks 8-6 ago; the second runs weeks 3-1 ago.
  // …and old enough a member for weeks 8–6 ago to be weeks of theirs
  const fresh = boot({ retention: [sliding("m", "Mo Member", [3, 2, 1], 84, 6)] });
  const firstRun = fresh.ctx.attendanceAlert(fresh.findMember("m"));
  assert.ok(firstRun, "sanity: the older slide is what surfaces first");
  fresh.ctx.retMarkMissed("m", firstRun.key);
  assert.strictEqual(fresh.ctx.attendanceAlert(fresh.findMember("m")), null, "missed also settles it");

  history(fresh.findMember("m"), [4, 3, 2], 1);              // a new slide, weeks later
  const second = fresh.ctx.attendanceAlert(fresh.findMember("m"));
  assert.ok(second, "a fresh decline that starts after the last one we handled does surface");
  assert.notStrictEqual(second.key, firstRun.key, "…as its own task");
  assert.ok(second.weeks[0] > firstRun.weeks[2], "…and it begins after the old one ended");
  fresh.ctx.renderAll();
  assert.ok(fresh.html("retTodayList").includes("attendance dropping"), "…back on Today's moves");
}

/* ---------- 10: what a coach sees without opening anything ---------- */
{
  const app = boot({ retention: [sliding("d", "Dee Dropping", [3, 2, 1]), sliding("s", "Sid Steady", [3, 3, 3])] });

  // the member card
  const cards = app.html("retMemberList");
  assert.ok(/class="spark/.test(cards), "a sparkline on the card");
  assert.ok(cards.includes("Attendance dropping"), "…and an amber tag for the one sliding");
  assert.ok(/Bodysculpt PT sessions, last 3 weeks: 3, 2, 1/.test(cards), "the counts are readable");
  const sid = cards.slice(cards.indexOf("Sid Steady"));
  assert.ok(!sid.includes("Attendance dropping"), "…and not for the one who is fine");

  // the attendance tab
  const tab = app.html("attList");
  assert.ok(tab.includes("Dee Dropping") && tab.includes("Sid Steady"), "everyone is listed");
  assert.ok(tab.indexOf("Dee Dropping") < tab.indexOf("Sid Steady"), "flagged members lead");
  assert.ok(tab.includes("this week"), "the current week is labelled");
  assert.ok(/class="att-n[^>]*>1</.test(tab), "the weekly counts are shown");
  assert.ok(/att-flagged/.test(tab), "…and the flagged row is marked");

  // the only empty state left is a gym with no members in it
  assert.ok(boot({}).html("attList").includes("No members yet"));
}

/* ---------- 11: the file the gym actually gets, and the summary line ---------- */
{
  const app = boot({ retention: [
    member("a", "Ann A", "ann@example.com", 40),
    member("b", "Bo B", "bo@example.com", 40),
  ] });
  // 3 PT for Ann, 1 for Bo, plus classes, other statuses and a crowd of untracked customers
  const rows = [
    row({ email: "ann@example.com", at: at(1, 0) }),
    row({ email: "ann@example.com", at: at(1, 2) }),
    row({ email: "ann@example.com", at: at(1, 4) }),
    row({ email: "ann@example.com", at: at(1, 5), offering: "SWEAT" }),
    row({ email: "bo@example.com", at: at(1, 1) }),
    row({ email: "bo@example.com", at: at(1, 3), status: "No show" }),
  ];
  for (let i = 0; i < 40; i++) rows.push(row({ email: "cust" + i + "@example.com", at: at(1, i % 5) }));
  const r = app.ctx.applyAttendanceCsv(csv(...rows));

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rows, 46, "every row was read");
  assert.strictEqual(r.matched, 2);
  assert.strictEqual(r.unmatched, 40, "the rest of the gym is skipped in silence");
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("a"), weekKey(app, 1)), 3);
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("b"), weekKey(app, 1)), 1);

  const html = app.ctx.attendanceSummaryHtml(r, "attendance.csv");
  assert.ok(html.includes("Week of "), "the summary names the week");
  assert.ok(html.includes("46 rows"), "…the rows read");
  assert.ok(html.includes("2 members matched"), "…who was matched");
  assert.ok(html.includes("40 customers not tracked"), "…and who was not");
  assert.ok(html.includes("flagged as dropping"), "…and the flag count");
  assert.ok(html.includes("attendance.csv"));

  // the exports that go wrong
  const bad = (text) => app.ctx.applyAttendanceCsv(text);
  assert.strictEqual(bad("").ok, false, "an empty file is refused");
  assert.ok(/Customer Email/.test(bad("Name,Date\nx,y").error), "a file with the wrong columns says which");
  assert.strictEqual(bad(csv()).ok, false, "headers with no rows is refused");
  const noDates = bad(csv(row({ email: "ann@example.com", at: "sometime" })));
  assert.strictEqual(noDates.ok, false, "…and so is a file with no readable dates");
  // a BOM, CRLF line endings and quoted commas in names all survive the shared CSV reader
  const messy = "﻿" + csv('"A, Person",ann@example.com,' + at(1, 0)
    + ',Bodysculpt PT,W,Gaz,Online,CM1,M1,"Gold, annual",Web,Attended,').replace(/\n/g, "\r\n");
  const okr = app.ctx.applyAttendanceCsv(messy);
  assert.strictEqual(okr.ok, true, "BOM + CRLF + quoted commas are handled");
  assert.strictEqual(app.ctx.attendedPTIn(app.findMember("a"), weekKey(app, 1)), 1);
}

/* ---------- 12: everything else still works ---------- */
{
  assert.ok(/data-view="ret-attendance"/.test(HTML), "there is an Attendance tab");
  assert.ok(/id="view-ret-attendance"/.test(HTML), "…and a section for it");
  assert.ok(/id="att-file"[^>]*accept="\.csv/.test(HTML), "…with a CSV picker");
  ["ret-today", "ret-members", "ret-birthdays"].forEach((v) =>
    assert.ok(HTML.includes('data-view="' + v + '"'), "the " + v + " tab is still there"));

  const app = boot({
    members: [{ id: "c1", name: "Chris Challenger", coach: "Dan", day0: daysFromToday(-7),
      booked: daysFromToday(-7), firstSessionDone: true, completed: [], doneMeta: {}, checks: {},
      missed: [], outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null }],
    retention: [member("m", "Mo Member", "mo@example.com", 30)],
  });
  const onboardingBefore = app.html("todayList") + app.html("memberList");
  app.ctx.applyAttendanceCsv(csv(row({ email: "mo@example.com", at: at(1, 0) })));
  assert.strictEqual(app.html("todayList") + app.html("memberList"), onboardingBefore,
    "an attendance import does not touch the onboarding tracker at all");
  assert.strictEqual(app.cached().length, 0, "…nor its roster row");
  assert.ok(app.html("retTodayList").includes("Welcome card"), "the member journey is unaffected");
}

/* ---------- 13: the tab is a WATCH LIST, and membership is what puts you on it ----------
   It used to be built the other way round: the rows came out of the attendance data, so the
   whole table sat behind a "no attendance uploaded yet" screen and a member nobody had
   uploaded for had nowhere to appear. Backwards. Membership creates the row; the file fills
   in the numbers. */
{
  // three members, nothing uploaded, ever
  const app = boot({ retention: [
    member("a", "Ann Arrived", "ann@example.com", 1),      // joined yesterday
    member("b", "Bo Bedded-in", "bo@example.com", 120),    // four months in
    member("c", "Cal Current", "cal@example.com", 63),     // nine weeks in
  ] });
  const tab = app.html("attList");

  for (const name of ["Ann Arrived", "Bo Bedded-in", "Cal Current"]) {
    assert.ok(tab.includes(name), name + " is on the tab with no CSV ever uploaded");
  }
  assert.ok(!/No attendance uploaded yet/.test(tab),
    "…and the screen that used to hide the whole table is gone");
  assert.ok(/<table class="journey attend"/.test(tab), "the table is drawn");
  assert.strictEqual((tab.match(/<tr/g) || []).length, 4, "a header row and three members");

  // …and not one cell of it is a zero. "Nobody has uploaded" is a statement about us;
  // "they attended nothing" is a statement about them, and they are not the same claim.
  assert.ok(!/class="att-n[^"]*"[^>]*>0</.test(tab), "no zeros anywhere");
  const rowOf = (name) => (tab.split("<tr").find((r) => r.includes(name)) || "");
  for (const name of ["Bo Bedded-in", "Cal Current"]) {
    assert.strictEqual((rowOf(name).match(/att-n none/g) || []).length, 8,
      name + ": eight dashes — eight weeks of theirs, no file for any of them");
    assert.ok(/no attendance uploaded yet/.test(rowOf(name)),
      "…and it is said in words too, so a row of dashes cannot read as a bad month");
  }
  assert.ok(/“–” means we hold no file for that week/.test(tab), "the legend says what a dash is");
}

/* ---------- 13b: who is on it, and who is not ---------- */
{
  const t = new Date();
  const app = boot({ retention: [
    member("n", "Nell New", "nell@example.com", 0),        // joined today
    member("e", "Ed Edge", "ed@example.com", 175),         // just inside six months
    member("o", "Olly Old", "olly@example.com", 200),      // past it
    member("l", "Lou Left", "lou@example.com", 30, { left: true }),
    member("j", "Jo Nojoin", "jo@example.com", null),      // no joined date at all
  ] });
  const tab = app.html("attList");

  assert.ok(tab.includes("Nell New"), "somebody who joined today is watched from today");
  assert.ok(tab.includes("Ed Edge"), "…and so is somebody just inside their first six months");
  assert.ok(!tab.includes("Olly Old"),
    "past six months they drop off — a decline in month nine is a different question");
  assert.ok(!tab.includes("Lou Left"),
    "a member who has cancelled is not a new member to watch");
  assert.ok(!tab.includes("Jo Nojoin"), "…and neither is somebody with no membership date");

  // the tab's window and the alert's window are the same window, from the same function
  const withinFirstMonths = app.ctx.withinFirstMonths;
  const ATT_WATCH_MONTHS = app.ctx.__t.ATT_WATCH_MONTHS;
  for (const id of ["n", "e"]) {
    assert.strictEqual(withinFirstMonths(app.findMember(id), ATT_WATCH_MONTHS), true,
      id + " is inside the watch window the alert uses");
  }
  assert.strictEqual(withinFirstMonths(app.findMember("o"), ATT_WATCH_MONTHS), false);
  assert.strictEqual(ATT_WATCH_MONTHS, 6, "and that window is six months, on both");

  // a gym where everyone is past it says so, rather than showing an empty table
  const settled = boot({ retention: [member("o", "Olly Old", "o@example.com", 300)] });
  assert.ok(/Nobody in their first 6 months/.test(settled.html("attList")),
    "…and explains why it is empty");
  assert.ok(!/<table/.test(settled.html("attList")), "with no table under it");
}

/* ---------- 13c: eight columns, always the same eight ----------
   By the calendar, not by the data — which is what stops the table disappearing when nothing
   has been uploaded, and stops a six-month member bringing twenty-six columns with them. */
{
  const app = boot({ retention: [sliding("d", "Dee Data", [1, 2, 3], 170)] });
  const tab = app.html("attList");
  const headCells = (/<thead>[\s\S]*?<\/thead>/.exec(tab) || [""])[0];
  assert.strictEqual((headCells.match(/<th[ >]/g) || []).length, 10,
    "Member, eight weeks, Trend");

  const expect = app.ctx.recentWeekKeys(8);
  assert.strictEqual(expect.length, 8, "eight week keys");
  assert.strictEqual(expect[7], app.ctx.isoWeekKeyOf(Date.now()), "ending with the week we are in");
  assert.strictEqual(expect[0], weekKey(app, 7), "…and starting seven weeks back");
  for (let i = 1; i < expect.length; i++) {
    assert.ok(expect[i] > expect[i - 1], "…in order: " + expect.join(" "));
  }
  // each of the eight is a column, labelled with its Monday
  expect.forEach((w) => {
    assert.ok(headCells.includes(app.ctx.fmt(app.ctx.isoWeekStart(w))),
      "week " + w + " has a column");
  });

  // a member with six months of history still gets eight columns and no more
  const long = boot({ retention: [sliding("x", "Xavier Long",
    [4, 4, 3, 4, 4, 3, 4, 4, 3, 4, 4, 3, 4, 4, 3, 4, 4, 3, 4, 4], 175)] });
  assert.strictEqual(
    (/<thead>[\s\S]*?<\/thead>/.exec(long.html("attList"))[0].match(/<th[ >]/g) || []).length, 10,
    "twenty weeks of history, still eight columns");
}

/* ---------- 13d: a member WITH data reads correctly, beside one without ---------- */
{
  const app = boot({ retention: [
    sliding("d", "Dee Data", [3, 2, 1], 84),               // 12 weeks a member, last 3 weeks filled
    member("n", "Nora Nothing", "nora@example.com", 63),   // 9 weeks a member, nothing on file
  ] });
  const tab = app.html("attList");
  const rowOf = (name) => (tab.split("<tr").find((r) => r.includes(name)) || "");

  const dee = rowOf("Dee Data");
  assert.ok(/att-n[^>]*>3</.test(dee) && /att-n[^>]*>2</.test(dee) && /att-n[^>]*>1</.test(dee),
    "her three weeks are on her row, as numbers");
  assert.strictEqual((dee.match(/att-n none/g) || []).length, 5,
    "…and the five weeks nobody uploaded for her are dashes");
  assert.strictEqual((dee.match(/att-n before/g) || []).length, 0,
    "…none of the eight is before she joined — she has been a member twelve weeks");
  assert.ok(!/no attendance uploaded yet/.test(dee), "…so she is not labelled as having none");
  assert.ok(/class="spark/.test(dee), "her trend is drawn");
  assert.ok(/Bodysculpt PT sessions, last 3 weeks: 3, 2, 1/.test(dee), "…and readable");

  const nora = rowOf("Nora Nothing");
  assert.strictEqual((nora.match(/att-n none/g) || []).length, 8, "eight dashes for the member with no file");
  assert.ok(/no attendance uploaded yet/.test(nora), "…and said in words");

  // a real zero is a zero, and reads differently from a dash
  const zeroed = boot({ retention: [sliding("z", "Zed Zero", [2, 0], 84)] });
  const zrow = zeroed.html("attList").split("<tr").find((r) => r.includes("Zed Zero"));
  assert.ok(/att-n zero[^>]*>0</.test(zrow), "an uploaded zero shows as 0, not as a dash");
  assert.ok(/no PT sessions|0 PT sessions/.test(zrow), "…and says so on hover");
}

/* ---------- 13e: the upload control sits above the table ----------
   Always visible, and not pushed down the page as the member list grows. */
{
  const view = /<section class="view" id="view-ret-attendance"[\s\S]*?<\/section>/.exec(HTML)[0];
  assert.ok(/id="att-file"/.test(view), "the upload control is on the tab");
  assert.ok(view.indexOf('id="att-file"') < view.indexOf('id="attList"'),
    "…above the member table, so a long list never pushes it off the screen");
  assert.ok(view.indexOf('id="attResult"') < view.indexOf('id="attList"'),
    "…and so is the summary line it prints");
  assert.ok(/runAttendanceImport/.test(view), "…still wired to the importer");
}

console.log("attendance.test.cjs: OK");
