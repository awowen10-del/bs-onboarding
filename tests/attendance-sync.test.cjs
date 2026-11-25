// TeamUp attendance sync: weeks, what counts, and when someone became a member.
const assert = require("assert");
const { isoWeekKey, memberSince, foldAttendances, isTraining, goneFromTracker } = require("../netlify/functions/attendance-sync-background.js");
const U = (s) => Date.parse(s + "T12:00:00Z");
// ISO weeks, Monday start
assert.equal(isoWeekKey(U("2026-11-23")), "2026-W48");   // Monday
assert.equal(isoWeekKey(U("2026-11-29")), "2026-W48");   // Sunday, same week
assert.equal(isoWeekKey(U("2026-11-30")), "2026-W49");
assert.equal(isoWeekKey(U("2027-01-01")), "2026-W53");   // Friday 1 Jan 2027 belongs to 2026's last week
assert.equal(isoWeekKey(U("2025-12-29")), "2026-W01");
// what counts
for (const t of ["Bodysculpt PT", "BUILD", "SWEAT", "Capacity", "Online PT"]) assert.ok(isTraining(t), t);
for (const t of ["Intro Session", "One-to-One Review", "OLYMPIC LIFTING WORKSHOP", "Quiz", "Group Goal Setting", "Cold Water Immersion", "Bodysculpt Games", null]) assert.ok(!isTraining(t), String(t));
// member since: plan changes don't restart the clock, leaving and coming back does
assert.equal(memberSince([{ start: "2022-05-26", end: "2026-11-01", status: "cancelled" }, { start: "2026-11-01", end: null, status: "active" }]), "2022-05-26");
assert.equal(memberSince([{ start: "2021-01-10", end: "2021-06-01", status: "cancelled" }, { start: "2026-09-01", end: null, status: "active" }]), "2026-09-01");
assert.equal(memberSince([{ start: "2024-02-01", end: null, status: "complete" }, { start: "2025-03-01", end: null, status: "active" }]), "2024-02-01");  // no end date on record: assume unbroken
assert.equal(memberSince([{ start: "2026-10-01", end: null, status: "hold" }]), "2026-10-01");
assert.equal(memberSince([]), null);
// folding: attended only (no-shows and late cancels never counted), training only, members only, latest day
const weeks = {}, last = {};
foldAttendances([
  { customer: 1, status: "attended", event: { starts_at: "2026-11-24T07:00:00Z", offering_type: { name: "Bodysculpt PT" } } },
  { customer: 1, status: "attended", event: { starts_at: "2026-11-26T07:00:00Z", offering_type: { name: "BUILD" } } },
  { customer: 1, status: "no_show", event: { starts_at: "2026-11-27T07:00:00Z", offering_type: { name: "Bodysculpt PT" } } },
  { customer: 1, status: "late_cancelled", event: { starts_at: "2026-11-28T07:00:00Z", offering_type: { name: "Bodysculpt PT" } } },
  { customer: 1, status: "attended", event: { starts_at: "2026-11-25T07:00:00Z", offering_type: { name: "Intro Session" } } },
  { customer: 2, status: "attended", event: { starts_at: "2026-11-24T07:00:00Z", offering_type: { name: "Bodysculpt PT" } } },
], weeks, last, new Set(["1"]));
assert.deepEqual(weeks, { "1": { "2026-W48": 2 } });   // the no-show is not counted anywhere
assert.deepEqual(last, { "1": "2026-11-26" });
// the Members tab follows GHL: gone by email, else full name; already-left people untouched
const ret = [{ id: "1", name: "Sarah  Doyle" }, { id: "2", name: "Mark Lee", email: "MARK@x.com" }, { id: "3", name: "Amy Ray", left: true }, { id: "4", name: "Kim Day" }];
const gone = [{ firstName: "sarah", lastName: "doyle" }, { email: "mark@x.com", firstName: "Marcus", lastName: "Lee" }, { firstName: "Amy", lastName: "Ray" }];
assert.deepEqual(goneFromTracker(ret, gone).map((m) => m.id), ["1", "2"]);
console.log("attendance-sync: ok");
