// The Attendance tab and profile, fed from TeamUp (the 'attendance-teamup' row).
const assert = require("assert");
const { boot } = require("./lib/env.cjs");
const DAY = 864e5;
const app = boot({ members: [], retention: [{ id: "r1", name: "Sarah Doyle", coach: "Dan", joined: Date.now() - 40 * DAY, attendance: {} }] });
const c = app.ctx;
const wk = (daysAgo) => c.isoWeekKeyOf(Date.now() - daysAgo * DAY);
const ymd = (d) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
const weeks = {};
const mk = (tid, arr) => { weeks[tid] = {}; arr.forEach((n, i) => { weeks[tid][wk((arr.length - 1 - i) * 7)] = n; }); };
mk("1", [3, 3, 2, 3, 4, 3, 1]);        // newish, steady
mk("2", [4, 3, 2, 1, 0]);              // dropping, then nothing
mk("3", Array(20).fill(3));            // long-standing
c.__t.tuAtt = { updated: new Date().toISOString(), members: [
  { id: "a", name: "Sarah Doyle", email: "s@x", tid: "1", since: ymd(45), plan: "Membership - Gold" },
  { id: "b", name: "Mark Lee", email: "m@x", tid: "2", since: ymd(38), plan: "Membership - Silver" },
  { id: "c", name: "Long Timer", email: "l@x", tid: "3", since: ymd(160), plan: "BodySculpt PT 12" },
  { id: "d", name: "No Match", email: "n@x", tid: null, since: null, plan: null }],
  weeks, last: { "1": ymd(1), "2": ymd(16), "3": ymd(2) } };
c.renderAttendance();
const stats = app.html("taStats"), table = app.html("taTable");
assert.ok(/In their first 90 days now/.test(stats));
assert.ok(table.includes("Sarah Doyle") && table.includes("Mark Lee"), "first-90 view lists the new members");
assert.ok(!table.includes("Long Timer"), "…and not someone two years in");
assert.ok(/Week \d+ of 13/.test(table));
assert.ok(table.indexOf("Mark Lee") < table.indexOf("Sarah Doyle"), "whoever needs a nudge sorts first");
assert.ok(/Gone quiet/.test(table), "16 days without a session reads as gone quiet");
assert.ok(/of 2/.test(table) && /of 3/.test(table), "Silver aims at 2, Gold at 3");
c.setTaView("all");
assert.ok(app.html("taTable").includes("Long Timer") && app.html("taTable").includes("Not on TeamUp"));
c.setTaView("nudge");
assert.ok(app.html("taTable").includes("Mark Lee") && !app.html("taTable").includes("Long Timer"));
// profile
c.openTaProfile("c");
const p = app.html("taProfileBody");
assert.ok(p.includes("Long Timer") && /First 90 days/.test(p) && /Last 12 weeks/.test(p));
assert.ok((p.match(/class="ta-col/g) || []).length >= 13 + 12, "13 weeks of first 90 plus 12 recent");
c.openTaProfile("a");
assert.ok(/Week \d+ of 13/.test(app.html("taProfileBody")) && /ta-col future/.test(app.html("taProfileBody")), "weeks still to come drawn as outlines");
c.openTaProfile("d");
assert.ok(/couldn't find/.test(app.html("taProfileBody")));
// a tracker member matched by name feeds the existing sparkline / drop alert from TeamUp
const m = app.findMember("r1");
assert.ok(c.attendanceWeeks(m).length >= 1);
assert.equal(c.attendedPTIn(m, wk(0)), 1);
// no data yet
c.__t.tuAtt = null; c.renderAttendance();
assert.ok(/first load hasn't happened/.test(app.html("taTable")));
// attended only: nothing about no-shows or late cancels anywhere on screen
c.__t.tuAtt = { updated: new Date().toISOString(), members: [{ id: "a", name: "Sarah Doyle", email: "s@x", tid: "1", since: ymd(45), plan: "Membership - Gold" }], weeks, last: {} };
c.openTaProfile("a");
assert.ok(!/missed|late-cancel/i.test(app.html("taProfileBody").replace(/never no-shows or late cancels/g, "")));
console.log("attendance-teamup: ok");
