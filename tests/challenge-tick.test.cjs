// challenge-tick: what is due is worked out from the tracker's own clock.
const assert = require("assert");
const { plan } = require("../netlify/functions/challenge-tick.js");
const DAY = 86400000, t0 = Date.UTC(2026, 10, 30);
const m = (d, o = {}) => Object.assign({ email: "a@b.c", completed: ["intro"], firstSessionDone: true, day0: t0 - d * DAY }, o);
const F = "6wc finished", L = "6wc day 41";
assert.deepEqual(plan(m(0), [], t0).add, ["6wc day 0"]);
assert.deepEqual(plan(m(1), ["6wc day 0"], t0).add, []);
let p = plan(m(7), ["6wc day 2"], t0);
assert.deepEqual(p.add, ["6wc day 7"]); assert.deepEqual(p.remove, ["6wc day 2"]);          // one tag at a time
assert.equal(plan({ email: "a@b.c", completed: [] }, [], t0).skip, "intro not done");
assert.deepEqual(plan({ email: "a@b.c", completed: ["intro"] }, [], t0).add, ["6wc day 0"]);                 // Intro done, no dates yet
assert.deepEqual(plan({ email: "a@b.c", completed: ["intro"] }, ["6wc day 0"], t0).add, []);                 // then it waits
assert.deepEqual(plan({ email: "a@b.c", completed: ["intro"], booked: t0 + 5 * DAY }, ["6wc day 0"], t0).add, []);  // start date still to come
assert.deepEqual(plan({ email: "a@b.c", completed: ["intro"], booked: t0 - 2 * DAY }, ["6wc day 0"], t0).add, ["6wc day 2"]);
assert.deepEqual(plan({ email: "a@b.c", completed: ["intro"], booked: t0 - 49 * DAY }, ["6wc day 41"], t0).add, []);  // no finish until the clock has run
assert.equal(plan(m(9, { pausedAt: t0 - DAY }), [], t0).skip, "not eligible");
assert.equal(plan(m(9, { outcome: "left" }), [], t0).skip, "not eligible");
assert.deepEqual(plan(m(14, { pausedDays: 7 }), ["6wc day 2"], t0).add, ["6wc day 7"]);     // a banked pause moves the email
assert.deepEqual(plan(m(14), ["member", "6wc day 7"], t0).add, []);                         // joined: no more emails
assert.deepEqual(plan(m(14, { outcome: "stayed" }), ["6wc day 7"], t0).add, ["member"]);
assert.deepEqual(plan(m(42), [L, "member"], t0).add, [F]);                                  // the finish still fires
assert.deepEqual(plan(m(42, { extraDays: 7 }), [L], t0).add, []);                           // an extension moves the end
assert.deepEqual(plan(m(48), [L, F], t0).add, []);
p = plan(m(49), [L, F], t0); assert.deepEqual(p.add, ["6wc lapsed"]); assert.equal(p.lapse, true);
assert.deepEqual(plan(m(49), [L, F, "member"], t0).add, []);
assert.equal(plan(m(3), [], t0, t0).skip, "started before launch");
console.log("challenge-tick: ok");
