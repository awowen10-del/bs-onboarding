// challenge-tick: what is due is worked out from the tracker's own clock.
const assert = require("assert");
const { plan } = require("../netlify/functions/challenge-tick.js");
const DAY = 86400000, t0 = Date.UTC(2026, 10, 30);
const m = (d, o = {}) => Object.assign({ email: "a@b.c", firstSessionDone: true, day0: t0 - d * DAY }, o);
const tagsUpTo = (n) => [0, 2, 7, 14, 21, 28, 35, 37, 39, 41].filter((d) => d <= n).map((d) => "6wc day " + d);

assert.deepEqual(plan(m(0), [], t0).add, ["6wc day 0"]);
assert.deepEqual(plan(m(1), ["6wc day 0"], t0).add, []);
assert.deepEqual(plan(m(7), tagsUpTo(2), t0).add, ["6wc day 7"]);
assert.equal(plan(m(3, { firstSessionDone: false }), [], t0).skip, "not started");
assert.equal(plan(m(9, { pausedAt: t0 - DAY }), [], t0).skip, "not eligible");
assert.equal(plan(m(9, { outcome: "left" }), [], t0).skip, "not eligible");
assert.deepEqual(plan(m(14, { pausedDays: 7 }), tagsUpTo(2), t0).add, ["6wc day 7"]);          // a banked pause moves the email
assert.deepEqual(plan(m(14), ["member"], t0).add, []);                                        // joined: no more emails
assert.deepEqual(plan(m(42), [...tagsUpTo(41), "member"], t0).add, ["6wc finished"]);         // but the finish still fires
assert.deepEqual(plan(m(42, { extraDays: 7 }), tagsUpTo(41), t0).add, []);                    // an extension moves the end
let p = plan(m(48), [...tagsUpTo(41), "6wc finished"], t0); assert.deepEqual(p.add, []);
p = plan(m(49), [...tagsUpTo(41), "6wc finished"], t0); assert.deepEqual(p.add, ["6wc lapsed"]); assert.equal(p.lapse, true);
p = plan(m(49), [...tagsUpTo(41), "6wc finished", "member"], t0); assert.deepEqual(p.add, []);
p = plan(m(49, { outcome: "stayed" }), [...tagsUpTo(41), "6wc finished"], t0); assert.deepEqual(p.add, []);
assert.equal(plan(m(3), [], t0, t0).skip, "started before launch");
console.log("challenge-tick: ok");
