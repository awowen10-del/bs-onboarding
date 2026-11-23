// Trainerize access comes from GHL: paying members stay on with the right tag, cancellations go off on time.
const assert = require("assert");
const { memberFix, accessRecords, offDecision } = require("../netlify/functions/challenge-tick.js");
const DAY = 86400000, t0 = Date.UTC(2026, 10, 23);
// members
assert.deepEqual(memberFix(["member"], { status: "active", tags: ["Trialist"] }), { addMember: true, removeTrialist: true, reactivate: false });
assert.deepEqual(memberFix(["member"], { status: "deactivated", tags: ["Full Time Member"] }), { addMember: false, removeTrialist: false, reactivate: true }); // Rachael's case
assert.deepEqual(memberFix(["member"], { status: "active", tags: ["full time member"] }), { addMember: false, removeTrialist: false, reactivate: false });
assert.equal(memberFix(["member", "cancel approved"], { status: "active", tags: [] }).skip, "cancelling");   // never pulled back while leaving
assert.equal(memberFix(["member", "lapsed member"], { status: "deactivated", tags: [] }).skip, "cancelling");
assert.equal(memberFix(["member", "cancelled member"], { status: "deactivated", tags: [] }).skip, "cancelling"); // a stale member tag never switches a leaver back on
assert.equal(memberFix(["member"], null).skip, "not on Trainerize");
// records: first seen today, due 60 days (30 for 'now'), never moved once set
let r = accessRecords({}, [{ id: "c1", email: "A@b.c", firstName: "Amy", tags: ["cancel approved"] }, { id: "c2", email: "n@b.c", tags: ["Cancel Approved Now"] }], t0);
assert.deepEqual(r["a@b.c"], { name: "Amy", contactId: "c1", kind: "cancel approved", seen: "2026-11-23", due: "2027-01-22" });
assert.equal(r["n@b.c"].due, "2026-12-23");
const r2 = accessRecords(r, [{ id: "c1", email: "a@b.c", tags: ["cancel approved"] }], t0 + 10 * DAY);
assert.equal(r2["a@b.c"].seen, "2026-11-23");
// decisions
const rec = { kind: "cancel approved", due: "2026-12-01" };
assert.equal(offDecision(rec, ["cancel approved"], false, Date.UTC(2026, 10, 30)), "wait");
assert.equal(offDecision(rec, ["cancel approved"], false, Date.UTC(2026, 11, 1)), "off");
assert.equal(offDecision(rec, ["cancel approved"], true, Date.UTC(2026, 11, 1)), "active subscription");   // rejoined or still paying
assert.equal(offDecision(rec, ["member"], false, Date.UTC(2026, 11, 1)), "dropped");                     // cancel tag taken off: they stayed
assert.equal(offDecision({ kind: "ontraport", due: "2026-12-02" }, null, false, Date.UTC(2026, 11, 2)), "off");   // carried over from Zapier, no GHL contact
assert.equal(offDecision({ ...rec, done: "2026-12-01" }, ["cancel approved"], false, Date.UTC(2026, 11, 5)), "done");
console.log("trainerize-access: ok");
