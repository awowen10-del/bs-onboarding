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
c.setTaView("risk");
assert.ok(/Upcoming bookings come in/.test(app.html("taTable")), "no upcoming data yet: says when it arrives");
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
// actions + notes
{
  const DAY2 = 864e5, ymd2 = (d) => new Date(Date.now() - d * DAY2).toISOString().slice(0, 10);
  const until = new Date(Date.now() + 20 * DAY2).toISOString().slice(0, 10);
  c.__t.tuAtt = { updated: new Date().toISOString(), members: [
    { id: "a", name: "Sarah Doyle", email: "s@x", tid: "1", since: ymd2(45), plan: "Membership - Gold" },
    { id: "b", name: "Mark Lee", email: "m@x", tid: "2", since: ymd2(38), plan: "Membership - Silver" },
    { id: "c", name: "Gone Person", email: "g@x", tid: "3", since: ymd2(300), plan: "Membership - Gold" }],
    weeks, last: { "1": ymd2(1), "2": ymd2(30), "3": ymd2(2) } };
  c.__t.taExtrasLoaded = true;
  c.__t.taActions = { items: [
    { id: "x1", type: "pause", days: 30, ghlId: "b", at: new Date().toISOString(), status: "done", until },
    { id: "x2", type: "left", ghlId: "c", at: new Date().toISOString(), status: "done" }] };
  c.__t.taNotes = { a: [{ id: "n1", type: "training", text: "Knee niggle", by: "Dan", at: new Date().toISOString() },
                        { id: "n2", type: "attendance", text: "Away 1-14 Dec", by: "Gaz", at: new Date().toISOString() }] };
  c.setTaView("all");
  const tb = app.html("taTable");
  assert.ok(tb.includes("Paused") && !/Mark Lee[\s\S]*Gone quiet/.test(tb.split("</tr>").find((r) => r.includes("Mark Lee"))), "a paused member reads Paused, not Gone quiet");
  assert.ok(!tb.includes("Gone Person"), "someone marked as left drops off the list");
  assert.ok(/aria-label="2 notes for Sarah Doyle"/.test(tb), "notes marker shows the count");
  c.__t.tuAtt.upcomingRead = true; c.__t.tuAtt.upcoming = {};
  c.setTaView("risk");
  assert.ok(!app.html("taTable").includes("Mark Lee"), "paused people are not on the At Risk list");
  c.openTaProfile("a");
  let pr = app.html("taProfileBody");
  assert.ok(pr.includes("Manage membership") && !pr.includes("Mark as left"), "one Manage button, options folded away");
  c.__t.taMenu = true; c.openTaProfile("a", true); pr = app.html("taProfileBody");
  assert.ok(pr.includes("Pause 30 days") && pr.includes("Mark as left") && /forms/.test(pr), "the options, and that the forms come first");
  assert.ok(pr.includes("Knee niggle") && !pr.includes("Away 1-14 Dec"), "training notes by default, attendance notes kept apart");
  c.taSetNoteType("attendance"); pr = app.html("taProfileBody");
  assert.ok(pr.includes("Away 1-14 Dec") && !pr.includes("Knee niggle"));
  c.openTaProfile("b");
  c.__t.taMenu = true; c.openTaProfile("b", true);
  assert.ok(app.html("taProfileBody").includes("Resume now") && !app.html("taProfileBody").includes("Pause 30 days"), "paused: offer resume");
  c.__t.taPanel = "left"; c.openTaProfile("a", true);
  assert.ok(/Mark Sarah as left\?/.test(app.html("taProfileBody")) && /task on Ash/.test(app.html("taProfileBody")), "confirm says exactly what happens");
}
// paused or leaving in GHL (the forms) shows up here too
{
  const DAY3 = 864e5, y3 = (d) => new Date(Date.now() - d * DAY3).toISOString().slice(0, 10);
  c.__t.taActions = { items: [] };
  c.__t.tuAtt = { updated: new Date().toISOString(), members: [
    { id: "p", name: "Paused Person", tid: "1", since: y3(200), plan: "Membership - Gold", paused: true },
    { id: "l", name: "Leaving Person", tid: "1", since: y3(200), plan: "Membership - Gold", leaving: true }], weeks, last: { "1": y3(30) } };
  c.setTaView("all"); const tb = app.html("taTable");
  assert.ok(/Paused Person[\s\S]*?Paused/.test(tb) && /Leaving Person[\s\S]*?Leaving/.test(tb));
  c.__t.tuAtt.upcomingRead = true; c.__t.tuAtt.upcoming = {};
  c.setTaView("risk");
  assert.ok(!app.html("taTable").includes("Paused Person") && !app.html("taTable").includes("Leaving Person"), "neither is on the At Risk list");
}
// the Members tab hides people who have left
c.__t.retention = [{ id: "r1", name: "Stays", joined: Date.now(), attendance: {} }, { id: "r2", name: "Went", joined: Date.now(), attendance: {}, left: true }];
c.renderRetentionMembers();
assert.ok(app.html("retMemberList").includes("Stays") && !app.html("retMemberList").includes(">Went<") && /1 person who has left is hidden/.test(app.html("retMemberList")));
// At Risk: nothing booked in 7 days; the ten whose visits fell most vs their own previous 4 weeks; new joiners apart
{
  const D = 864e5, y = (d) => new Date(Date.now() - d * D).toISOString().slice(0, 10);
  const wk = (n) => c.isoWeekKeyOf(Date.now() - n * 7 * D);
  const W = {};
  const set = (tid, counts) => { W[tid] = {}; counts.forEach((n, i) => { W[tid][wk(counts.length - i)] = n; }); };  // oldest first, ending LAST week
  set("1", [3, 3, 3, 3, 1, 1, 0, 0]);   // big drop
  set("2", [2, 2, 2, 2, 2, 2, 1, 1]);   // small drop
  set("3", [1, 1, 1, 1, 2, 2, 2, 2]);   // going up
  set("4", [3, 3, 3, 3, 0, 0, 0, 0]);   // big drop but booked in next week
  set("5", [0, 0, 0, 0, 0, 0, 1, 1]);   // new
  c.__t.taActions = { items: [] }; c.__t.taNotes = {}; c.__t.taExtrasLoaded = true;
  c.__t.tuAtt = { updated: new Date().toISOString(), upcomingRead: true, upcoming: { "4": [new Date(Date.now() + 2 * D).toISOString()] },
    members: [
      { id: "a", name: "Big Drop", tid: "1", since: y(300), plan: "Membership - Gold" },
      { id: "b", name: "Small Drop", tid: "2", since: y(300), plan: "Membership - Gold" },
      { id: "c", name: "Going Up", tid: "3", since: y(300), plan: "Membership - Gold" },
      { id: "d", name: "Booked In", tid: "4", since: y(300), plan: "Membership - Gold" },
      { id: "e", name: "New Joiner", tid: "5", since: y(20), plan: "Membership - Gold" }],
    weeks: W, last: { "1": y(15), "2": y(9), "3": y(4), "4": y(30), "5": y(3) } };
  const r = c.taRisk();
  assert.deepEqual(r.top.map((x) => x.t.name), ["Big Drop", "Small Drop"], "ten = biggest drop first, only drops");
  assert.deepEqual(r.rest.map((x) => x.t.name), ["Going Up"], "no booking but not dropping: listed, not in the ten");
  assert.deepEqual(r.fresh.map((x) => x.t.name), ["New Joiner"], "joined in the last 30 days kept apart");
  assert.ok(!JSON.stringify(r).includes("Booked In"), "anyone booked in the next 7 days is not at risk");
  assert.equal(r.top[0].prev4, 12); assert.equal(r.top[0].last4, 2);
  c.setTaView("risk"); const h = app.html("taTable");
  assert.ok(h.includes("Check in with these 2") && h.includes("Copy message") && /not proof someone will leave/.test(h));
  assert.ok(/\[first name\]/.test(h), "message shown with a placeholder to personalise");
  assert.ok(/Hi Big, hope you're OK!/.test(c.taCheckinMsg(r.top[0].t)));
  // a check-in note keeps them off the ten for a week
  c.__t.taNotes = { a: [{ id: "n", type: "attendance", text: "Checked in: no sessions booked", by: "Dan", at: new Date().toISOString() }] };
  assert.deepEqual(c.taRisk().top.map((x) => x.t.name), ["Small Drop"]);
  // Today's moves carries the ten, once
  c.__t.retention = [];
  c.renderRetentionToday();
  const tm = app.html("retTodayList");
  assert.ok(tm.includes("Check in: no sessions booked") && tm.includes("Small Drop") && !tm.includes("Big Drop"));
  // plain words a coach reads at a glance, not "x → y visits"
  assert.ok(!tm.includes("→") && /Came \d+ times the month before, (came \d+ times?|came once|none) in the last 4 weeks/.test(tm), tm.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400));
  assert.ok(/Last session (today|yesterday|\d+ days ago)|no sessions yet/.test(tm));
  console.log("  line:", tm.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/No sessions booked[^]*?(ago|today|yesterday|yet)/)[0]);
}
console.log("attendance-teamup: ok");
